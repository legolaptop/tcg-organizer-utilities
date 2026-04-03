'use strict';

/* ============================================================
   Order Tracker — browser-side UI
   Depends on: Google Identity Services (loaded in index.html)
   ============================================================ */

(function () {

  // ── Configuration ────────────────────────────────────────────
  // Client ID from Google Cloud Console (Web Application OAuth 2.0 credential).
  // See src/config.ts.
  const GOOGLE_CLIENT_ID = '1072507978414-bifrk9rra5knrkf6rfpbjahb9174gd1t.apps.googleusercontent.com';
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const DRIVE_FILE_NAME = 'tcg-tracker-state.json';
  const DRIVE_SPACE = 'appDataFolder';
  const SAVE_DEBOUNCE_MS = 500;

  // ── Auth state ────────────────────────────────────────────────
  // Tokens are held in memory only — never stored in localStorage or cookies.
  let authState = {
    accessToken: null,   // string | null
    expiresAt: null,     // Unix timestamp ms | null
  };

  let tokenClient = null;   // google.accounts.oauth2.TokenClient
  let driveFileId = null;

  function isAuthenticated() {
    return (
      authState.accessToken !== null &&
      authState.expiresAt !== null &&
      Date.now() < authState.expiresAt
    );
  }

  // ── App state ─────────────────────────────────────────────────
  let trackerState = {};   // TrackerState: Record<orderId, OrderState>
  let orders = [];         // Order[]
  let orderBodyHiddenState = {}; // Ephemeral UI state: Record<orderId, boolean>
  let activeFilter = 'all';
  let saveTimer = null;

  // ── DOM references ────────────────────────────────────────────
  const navConverter = document.getElementById('nav-converter');
  const navTracker = document.getElementById('nav-tracker');
  const converterSection = document.getElementById('converter-section');
  const trackerSection = document.getElementById('tracker-section');

  // Drive auth control (compact, top-right of tracker view)
  const driveAuthControl = document.getElementById('drive-auth-control');
  const driveConnectBtn = document.getElementById('drive-connect-btn');
  const driveDisconnectBtn = document.getElementById('drive-disconnect-btn');
  const driveAuthStatus = document.getElementById('drive-auth-status');
  const driveConnectNote = document.getElementById('drive-connect-note');

  const saveIndicator = document.getElementById('save-indicator');
  const trackerFileInput = document.getElementById('tracker-file-input');
  const trackerParseBtn = document.getElementById('tracker-parse-btn');
  const trackerUploadMsg = document.getElementById('tracker-upload-msg');

  const filterTabs = document.querySelectorAll('.filter-tab');
  const statTotal = document.getElementById('stat-total');
  const statReceived = document.getElementById('stat-received');
  const statOverdue = document.getElementById('stat-overdue');
  const statUnconfirmed = document.getElementById('stat-unconfirmed');
  const ordersList = document.getElementById('orders-list');
  const noOrders = document.getElementById('no-orders');
  const exportSection = document.getElementById('tracker-export-section');
  const exportBtn = document.getElementById('tracker-export-btn');
    const toggleAllBtn = document.getElementById('toggle-all-btn');

  // ── Tab navigation ────────────────────────────────────────────

  navConverter.addEventListener('click', () => showTab('converter'));
  navTracker.addEventListener('click', () => showTab('tracker'));

  function showTab(tab) {
    if (tab === 'converter') {
      converterSection.hidden = false;
      trackerSection.hidden = true;
      navConverter.classList.add('tab-btn--active');
      navConverter.setAttribute('aria-selected', 'true');
      navTracker.classList.remove('tab-btn--active');
      navTracker.setAttribute('aria-selected', 'false');
    } else {
      converterSection.hidden = true;
      trackerSection.hidden = false;
      navConverter.classList.remove('tab-btn--active');
      navConverter.setAttribute('aria-selected', 'false');
      navTracker.classList.add('tab-btn--active');
      navTracker.setAttribute('aria-selected', 'true');
    }
  }

  // ── Google Identity Services ──────────────────────────────────

  /**
   * Initialize the GIS token client on page load.
   * Does NOT prompt the user — just configures the client.
   * Called from window.onload (see bottom of file).
   */
  function initGoogleAuth() {
    if (!window.google) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: handleTokenResponse,
    });
  }

  /**
   * Handles the token response from GIS after requestAccessToken().
   * Updates authState and triggers Drive state load on success.
   *
   * @param {google.accounts.oauth2.TokenResponse} response
   */
  async function handleTokenResponse(response) {
    if (response.error) {
      console.error('OAuth error:', response.error);
      setAuthStatus('error');
      return;
    }

    authState = {
      accessToken: response.access_token,
      expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
    };

    setAuthStatus('connected');

    // Load Drive state now that we have a valid token
    try {
      const driveState = await loadStateFromDrive();
      // Merge Drive state over any in-memory state (Drive wins for existing keys)
      trackerState = Object.assign({}, trackerState, driveState);
    } catch (e) {
      console.error('Failed to load state from Drive:', e);
    }
    renderTracker();
  }

  /**
   * Connect to Google Drive. Shows the OAuth consent popup if needed.
   * If already authenticated, loads Drive state immediately.
   */
  async function connectGoogleDrive() {
    if (!window.google || !tokenClient) {
      setAuthStatus('error');
      return;
    }

    if (isAuthenticated()) {
      setAuthStatus('connected');
      try {
        const driveState = await loadStateFromDrive();
        trackerState = Object.assign({}, trackerState, driveState);
      } catch (e) {
        console.error('Failed to load state from Drive:', e);
      }
      renderTracker();
      return;
    }

    setAuthStatus('connecting');
    // prompt: '' requests a new token silently if consent was previously granted,
    // or shows the consent popup if it is the first time.
    tokenClient.requestAccessToken({ prompt: '' });
  }

  /**
   * Disconnect from Google Drive. Revokes the token and clears auth state.
   */
  function disconnectGoogleDrive() {
    if (authState.accessToken) {
      google.accounts.oauth2.revoke(authState.accessToken, () => {
        console.log('Token revoked');
      });
    }
    authState = { accessToken: null, expiresAt: null };
    driveFileId = null;
    setAuthStatus('disconnected');
  }

  /**
   * Returns a valid access token, requesting a silent refresh if expired.
   * Throws if the user has never connected or the refresh fails.
   *
   * @returns {Promise<string>}
   */
  function getValidAccessToken() {
    if (isAuthenticated()) {
      return Promise.resolve(authState.accessToken);
    }

    if (!tokenClient) {
      return Promise.reject(new Error('Google auth not initialized'));
    }

    // Token expired — request a new one silently
    return new Promise((resolve, reject) => {
      const originalCallback = tokenClient.callback;
      tokenClient.callback = (response) => {
        tokenClient.callback = originalCallback;
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        authState.accessToken = response.access_token;
        authState.expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
        resolve(authState.accessToken);
      };
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  /**
   * Update the Drive auth control UI to reflect the current status.
   *
   * @param {'disconnected'|'connecting'|'connected'|'error'} status
   */
  function setAuthStatus(status) {
    driveAuthControl.dataset.status = status;

    if (status === 'disconnected') {
      driveConnectBtn.hidden = false;
      driveConnectBtn.disabled = false;
      driveConnectBtn.textContent = 'Connect Google Drive';
      driveDisconnectBtn.hidden = true;
      driveAuthStatus.hidden = true;
      driveConnectNote.hidden = false;
    } else if (status === 'connecting') {
      driveConnectBtn.hidden = false;
      driveConnectBtn.disabled = true;
      driveConnectBtn.textContent = 'Connecting…';
      driveDisconnectBtn.hidden = true;
      driveAuthStatus.hidden = true;
      driveConnectNote.hidden = true;
    } else if (status === 'connected') {
      driveConnectBtn.hidden = true;
      driveDisconnectBtn.hidden = false;
      driveAuthStatus.textContent = 'Google Drive connected ✓';
      driveAuthStatus.className = 'drive-auth-status drive-auth-status--connected';
      driveAuthStatus.hidden = false;
      driveConnectNote.hidden = true;
    } else if (status === 'error') {
      driveConnectBtn.hidden = false;
      driveConnectBtn.disabled = false;
      driveConnectBtn.textContent = 'Connect Google Drive';
      driveDisconnectBtn.hidden = true;
      driveAuthStatus.textContent = 'Connection failed — try again';
      driveAuthStatus.className = 'drive-auth-status drive-auth-status--error';
      driveAuthStatus.hidden = false;
      driveConnectNote.hidden = false;
    }
  }

  // Wire up Connect / Disconnect buttons
  driveConnectBtn.addEventListener('click', () => connectGoogleDrive());
  driveDisconnectBtn.addEventListener('click', () => disconnectGoogleDrive());

  // ── Drive persistence ─────────────────────────────────────────

  async function loadStateFromDrive() {
    const token = await getValidAccessToken();
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?spaces=${DRIVE_SPACE}&q=name%3D'${DRIVE_FILE_NAME}'&fields=files(id)`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
    );
    if (!searchRes.ok) throw new Error(`Drive search failed: ${searchRes.status}`);

    const { files } = await searchRes.json();
    if (!files || files.length === 0) return {};

    driveFileId = files[0].id;

    const contentRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
    );
    if (!contentRes.ok) throw new Error(`Drive read failed: ${contentRes.status}`);
    return await contentRes.json();
  }

  async function saveStateToDrive() {
    if (!isAuthenticated()) return;
    const body = JSON.stringify(trackerState);

    try {
      const token = await getValidAccessToken();
      if (driveFileId) {
        const res = await fetch(
          `https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body,
            signal: AbortSignal.timeout(8000),
          }
        );
        if (!res.ok) throw new Error(`Drive update failed: ${res.status}`);
      } else {
        const metadata = { name: DRIVE_FILE_NAME, parents: [DRIVE_SPACE] };
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', new Blob([body], { type: 'application/json' }));

        const res = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form,
            signal: AbortSignal.timeout(8000),
          }
        );
        if (!res.ok) throw new Error(`Drive create failed: ${res.status}`);
        const { id } = await res.json();
        driveFileId = id;
      }
      setSaveStatus('saved');
    } catch (e) {
      console.error('Drive save failed:', e);
      setSaveStatus('error');
    }
  }

  function debouncedSave() {
    if (!isAuthenticated()) return;
    setSaveStatus('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveStateToDrive(), SAVE_DEBOUNCE_MS);
  }

  function setSaveStatus(status) {
    saveIndicator.className = 'save-indicator save-indicator--' + status;
    if (status === 'saving') {
      saveIndicator.textContent = 'Saving…';
    } else if (status === 'saved') {
      saveIndicator.textContent = 'Saved ✓';
      setTimeout(() => {
        saveIndicator.className = 'save-indicator';
        saveIndicator.textContent = '';
      }, 2000);
    } else if (status === 'error') {
      saveIndicator.textContent = 'Save failed — check connection';
    }
  }

  // ── MHT file upload ───────────────────────────────────────────

  trackerParseBtn.addEventListener('click', async () => {
    const files = trackerFileInput.files;
    if (!files || files.length === 0) {
      showUploadMsg('Please select one or more MHT/HTML archive files.', true);
      return;
    }

    trackerParseBtn.disabled = true;
    showUploadMsg('Parsing…', false);

    try {
      const reads = Array.from(files).map(
        (f) =>
          new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result || ''));
            r.onerror = () => resolve('');
            r.readAsText(f);
          })
      );
      const texts = await Promise.all(reads);

      const freshOrders = [];
      for (const text of texts) {
        freshOrders.push(...parseArchiveIntoOrders(text));
      }

      if (freshOrders.length === 0) {
        showUploadMsg('No orders found in the uploaded files.', true);
        return;
      }

      // Diff shipping status against existing orders
      const updates = diffShippingStatus(orders, freshOrders);
      const { updatedCount } = applyShippingUpdates(trackerState, updates, orders);

      // Merge: add new orders that weren't previously loaded
      const existingIds = new Set(orders.map(o => o.id));
      const newOrders = freshOrders.filter(o => !existingIds.has(o.id));
      const visibleNewOrders = newOrders.filter(o => !o.canceled);
      orders = [...orders, ...visibleNewOrders];

      const parts = [];
      if (visibleNewOrders.length > 0) parts.push(`${visibleNewOrders.length} new order(s) added`);
      if (updatedCount > 0) parts.push(`shipping updated for ${updatedCount} order(s)`);
      if (parts.length === 0) parts.push('Orders up to date');
      showUploadMsg(parts.join(' · '), false);

      if (updatedCount > 0) debouncedSave();

      renderTracker();
    } catch (e) {
      showUploadMsg('An error occurred parsing files.', true);
      console.error(e);
    } finally {
      trackerParseBtn.disabled = false;
    }
  });

  function showUploadMsg(msg, isError) {
    trackerUploadMsg.textContent = msg;
    trackerUploadMsg.style.color = isError ? '#c53030' : '#4a5568';
    trackerUploadMsg.hidden = false;
  }

  // ── Archive HTML → Order parser ───────────────────────────────
  // Parses TCGPlayer order-history MHTML (MIME HTML archive) files.
  // MHTML is a MIME multipart document; we extract the HTML part, parse
  // it with DOMParser, and use CSS selectors — no regex on raw HTML.

  function parseArchiveIntoOrders(rawText) {
    const htmlText = extractHtmlFromMhtml(rawText);
    if (!htmlText) {
      console.warn('parseArchiveIntoOrders: Could not extract HTML from MHTML');
      return [];
    }
    let doc;
    try {
      doc = new DOMParser().parseFromString(htmlText, 'text/html');
    } catch (e) {
      console.error('parseArchiveIntoOrders: DOMParser error', e);
      return [];
    }
    if (!doc || !doc.body) return [];
    return extractOrdersFromDom(doc);
  }

  function extractHtmlFromMhtml(rawText) {
    if (!rawText) return '';
    const text = String(rawText);
    const boundaryMatch = text.match(/boundary=["']?([^\s"';]+)["']?/i);
    if (!boundaryMatch) {
      return /<html|<body|<div/i.test(text) ? text : '';
    }
    const boundary = boundaryMatch[1];
    const parts = text.split(new RegExp(`\\r?\\n--${escapeRegex(boundary)}(?:--)?(?:\\r?\\n|$)`));
    for (const part of parts) {
      if (/content-type:\s*text\/html/i.test(part)) {
        const bodyMatch = part.match(/\r?\n\r?\n([\s\S]*)/);
        if (!bodyMatch) continue;
        let html = bodyMatch[1];
        if (/content-transfer-encoding:\s*quoted-printable/i.test(part)) {
          html = decodeQuotedPrintable(html);
        }
        return html.trim();
      }
    }
    return '';
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Mirrors parseCondition() from src/parser.js.
   * Strips "Foil" from the condition text, normalises to a canonical label,
   * and returns { condition, foil } so the two fields never duplicate each other.
   */
  function parseCondition(text) {
    if (!text) return { condition: 'Near Mint', foil: false };
    const foil = /foil/i.test(text);
    const cleaned = text.replace(/foil/gi, '').trim().toLowerCase();
    const map = [
      [/^nm\b|near\s*mint/, 'Near Mint'],
      [/^lp\b|lightly\s*played/, 'Lightly Played'],
      [/^mp\b|moderately\s*played/, 'Moderately Played'],
      [/^hp\b|heavily\s*played/, 'Heavily Played'],
      [/^d\b|damaged/, 'Damaged'],
    ];
    for (const [re, label] of map) {
      if (re.test(cleaned)) return { condition: label, foil };
    }
    return { condition: cleaned || 'Near Mint', foil };
  }

  function decodeQuotedPrintable(text) {
    if (!text) return '';
    return text
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  function extractOrdersFromDom(doc) {
    const results = [];
    let orderElements = doc.querySelectorAll('[data-aid="div-sellerorderwidget-ordercontainer"]');
    if (orderElements.length === 0) orderElements = doc.querySelectorAll('.orderWrap');
    if (orderElements.length === 0) {
      console.warn('extractOrdersFromDom: No order containers found');
      return [];
    }
    orderElements.forEach(el => {
      const order = parseOrderFromElement(el);
      if (order) results.push(order);
    });
    return results;
  }

  function parseOrderFromElement(orderEl) {
    const id = extractOrderId(orderEl);
    if (!id) return null;
    const seller = extractSeller(orderEl);
    const date = extractOrderDate(orderEl);
    const estimatedDelivery = extractEstimatedDelivery(orderEl);
    const trackingNumber = extractTrackingNumber(orderEl);
    const shippingConfirmed = !/Shipping Not Confirmed/i.test(orderEl.textContent);
    const canceled = /Canceled|Refunded in Full/i.test(orderEl.textContent);
    const partialRefund = extractPartialRefund(orderEl);
    const total = extractOrderTotal(orderEl);
    const cards = extractCardsFromElement(orderEl, seller);
    if (cards.length === 0) {
      console.warn(`parseOrderFromElement: No cards found for order ${id}`);
      return null;
    }
    return { id, date, seller, total, estimatedDelivery, trackingNumber, shippingConfirmed, canceled, partialRefund, cards };
  }

  function extractOrderId(orderEl) {
    const idEl = orderEl.querySelector('[data-aid*="ordernumber"]');
    if (idEl) {
      const m = idEl.textContent.match(/([A-Z0-9]{6,}-[A-Z0-9]{4,}-[A-Z0-9]{4,})/);
      if (m) return m[1];
    }
    // Regular marketplace order: "Order Number\n2847D9A7-CB55FA-7FE2E"
    const regularM = orderEl.textContent.match(/Order\s+(?:#|Number)?\s*([A-Z0-9]{6,}-[A-Z0-9]{4,}-[A-Z0-9]{4,})/i);
    if (regularM) return regularM[1];
    // TCGPlayer Direct order: "TCGPLAYER DIRECT #\n260326-CF38"
    const directM = orderEl.textContent.match(/TCGPLAYER\s+DIRECT\s+#\s*([A-Z0-9]{6,}-[A-Z0-9]{2,})/i);
    if (directM) return directM[1];
    return 'ORDER-' + Math.random().toString(36).slice(2, 10).toUpperCase();
  }

  function extractSeller(orderEl) {
    const span = orderEl.querySelector('[data-aid="spn-sellerorderwidget-vendorname"]');
    if (span) {
      const link = span.querySelector('a');
      const text = (link ? link.textContent : span.textContent).trim();
      if (text) return text;
    }
    // TCGPlayer Direct orders have no vendorname span; they link to /help/shopdirect
    if (orderEl.querySelector('a[href*="shopdirect"]')) return 'TCGplayer Direct';
    const m = orderEl.textContent.match(/SHIPPED AND SOLD BY[:\s]+([^\n]+)/i);
    if (m) return m[1].trim();
    return 'Unknown Seller';
  }

  function extractOrderDate(orderEl) {
    const el = orderEl.querySelector('[data-aid*="orderdate"], [data-aid*="placed"]');
    if (el) {
      const m = el.textContent.match(/([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})/);
      if (m) return m[1];
    }
    const m = orderEl.textContent.match(/(?:Order\s+(?:Date|Placed)|Placed)[:\s]+([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})/i);
    if (m) return m[1];
    return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function extractEstimatedDelivery(orderEl) {
    const el = orderEl.querySelector('[data-aid*="delivery"], [data-aid*="arrival"]');
    if (el) {
      const m = el.textContent.match(/([A-Z][a-z]+\s+\d{1,2}[\s\-–]*\d{0,2},?\s*\d{4})/);
      if (m) return m[1];
    }
    const m = orderEl.textContent.match(/(?:Estimated\s+)?(?:Delivery|Arrives?)\s+(?:by\s+)?([A-Z][a-z]+\s+\d{1,2}[\s\-–]*\d{0,2},?\s*\d{4})/i);
    if (m) return m[1];
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function extractTrackingNumber(orderEl) {
    const linkCandidates = orderEl.querySelectorAll('a[href]');
    for (const link of linkCandidates) {
      const m = (link.textContent || '').trim().match(/([A-Z0-9]{10,40})/);
      if (m) {
        const number = m[1];
        return { number, url: getTrackingUrl(orderEl, number) };
      }
    }
    const m = orderEl.textContent.match(/(?:Tracking(?:\s+Number)?|Track)[:\s#]+([A-Z0-9]{10,40})/i);
    if (!m) return null;
    const number = m[1];
    return { number, url: getTrackingUrl(orderEl, number) };
  }

  function getTrackingUrl(orderEl, trackingNumber) {
    const encoded = encodeURIComponent(trackingNumber);
    const canonical = `https://tcgp.shipment.co/track/${encoded}`;

    // Prefer a normalized archive link only if it already looks like a tracking URL.
    const links = orderEl.querySelectorAll('a[href]');
    for (const link of links) {
      const rawHref = (link.getAttribute('href') || '').trim();
      if (!rawHref) continue;
      if (!/shipment|track/i.test(rawHref) && !rawHref.includes(trackingNumber)) continue;
      const normalized = normalizeExternalUrl(rawHref, 'https://www.tcgplayer.com');
      if (normalized && /shipment|track/i.test(normalized)) return normalized;
    }

    return canonical;
  }

  function normalizeExternalUrl(href, root) {
    if (!href) return null;
    if (/^https?:\/\//i.test(href)) return href;
    if (href.startsWith('//')) return `https:${href}`;
    if (href.startsWith('/')) return `${root}${href}`;
    return `${root}/${href.replace(/^\.?\//, '')}`;
  }

  function extractPartialRefund(orderEl) {
    const m = orderEl.textContent.match(/Partial\s+Refund[:\s]*\$?\s*([\d.]+)/i);
    return m ? parseFloat(m[1]) : null;
  }

  function extractOrderTotal(orderEl) {
    const m = orderEl.textContent.match(/Order\s+Total[:\s]*\$?\s*([\d,.]+)/i);
    return m ? parseFloat(m[1].replace(/,/g, '')) : 0;
  }

  function extractCardsFromElement(orderEl, orderSeller) {
    const cards = [];
    orderEl.querySelectorAll('table').forEach(table => {
      table.querySelectorAll('tbody tr').forEach(row => {
        const itemCell = row.querySelector('td.orderHistoryItems');
        if (!itemCell) return;
        const link = itemCell.querySelector('a');
        if (!link) return;
        const name = (link.title || link.textContent || '').trim();
        if (!name) return;

        // Extract tcgplayerId from card image URL (used by CSV export pipeline)
        let tcgplayerId = null;
        const img = itemCell.querySelector('img');
        if (img) {
          const src = img.dataset.original || img.dataset.src || img.getAttribute('src') || '';
          const idm = src.match(/\/product\/(\d+)_/);
          if (idm) tcgplayerId = idm[1];
        }
        if (!tcgplayerId) {
          const href = link.getAttribute('href') || '';
          const hrefm = href.match(/\/product\/(\d+)(?!\d)/);
          if (hrefm) tcgplayerId = hrefm[1];
        }

        // Item cell lines: [name, set] for regular orders;
        // [name, set, "Sold by X"] for TCGPlayer Direct orders.
        const lines = (itemCell.textContent || '').split(/\n/).map(l => l.trim()).filter(Boolean);
        let cardSeller = orderSeller;
        let setLines = lines.slice(1); // drop the card name line
        if (setLines.length > 0 && /^Sold by\s/i.test(setLines[setLines.length - 1])) {
          cardSeller = setLines[setLines.length - 1].replace(/^Sold by\s+/i, '').trim();
          setLines = setLines.slice(0, -1);
        }
        const set = setLines.length > 0 ? setLines[setLines.length - 1] : '';

        let condition = 'Near Mint';
        let foil = false;
        const detailCell = row.querySelector('td.orderHistoryDetail');
        if (detailCell) {
          const cm = (detailCell.textContent || '').match(/condition\s*:\s*([^,\n<]+)/i);
          if (cm) ({ condition, foil } = parseCondition(cm[1].trim()));
        }

        let price = 0;
        const priceCell = row.querySelector('td.orderHistoryPrice');
        if (priceCell) {
          const pm = (priceCell.textContent || '').match(/\$?\s*([\d,.]+)/);
          if (pm) price = parseFloat(pm[1].replace(/,/g, ''));
        }

        let quantity = 1;
        const qtyCell = row.querySelector('td.orderHistoryQuantity');
        if (qtyCell) {
          const n = parseInt(qtyCell.textContent || '1', 10);
          if (!isNaN(n) && n > 0) quantity = n;
        }

        cards.push({ name, set, condition, price, quantity, foil, cardSeller, tcgplayerId });
      });
    });
    return cards;
  }

  // ── Shipping diff helpers ─────────────────────────────────────

  function diffShippingStatus(previousOrders, freshOrders) {
    const updates = [];
    freshOrders.forEach(fresh => {
      const prev = previousOrders.find(o => o.id === fresh.id);
      if (!prev) return;
      const trackingChanged = fresh.trackingNumber !== prev.trackingNumber;
      const confirmedChanged = fresh.shippingConfirmed !== prev.shippingConfirmed;
      if (trackingChanged || confirmedChanged) {
        updates.push({ orderId: fresh.id, trackingNumber: fresh.trackingNumber, shippingConfirmed: fresh.shippingConfirmed });
      }
    });
    return updates;
  }

  function applyShippingUpdates(state, updates, orderArr) {
    let updatedCount = 0;
    updates.forEach(update => {
      if (state[update.orderId] && state[update.orderId].received) return;
      const order = orderArr.find(o => o.id === update.orderId);
      if (order) {
        order.trackingNumber = update.trackingNumber;
        order.shippingConfirmed = update.shippingConfirmed;
        updatedCount++;
      }
    });
    return { updatedCount };
  }

  // ── Core logic helpers ────────────────────────────────────────

  function cardKey(card) {
    return `${card.name}|${card.set}|${card.condition}|${card.price}|${card.cardSeller}`;
  }

  function groupOrdersByDate(orderArr) {
    const groups = new Map();
    const active = orderArr.filter(o => !o.canceled);
    active.forEach(order => {
      const key = order.estimatedDelivery;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(order);
    });
    return new Map(
      [...groups.entries()].sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
    );
  }

  function getOrderStatus(order, today) {
    const est = new Date(order.estimatedDelivery);
    if (est < today) return 'overdue';
    if (!order.shippingConfirmed) return 'unconfirmed';
    if (order.trackingNumber) return 'tracked';
    return 'standard';
  }

  function getGroupLabel(dateStr, today) {
    const est = new Date(dateStr);
    if (est < today) return 'Overdue';
    const diffDays = (est.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays <= 3) return 'Soon';
    return 'Incoming';
  }

  function getStats(orderArr, state, today) {
    const active = orderArr.filter(o => !o.canceled);
    return {
      total: active.length,
      received: active.filter(o => state[o.id] && state[o.id].received).length,
      overdue: active.filter(o => !(state[o.id] && state[o.id].received) && new Date(o.estimatedDelivery) < today).length,
      unconfirmed: active.filter(o => !(state[o.id] && state[o.id].received) && !o.shippingConfirmed).length,
    };
  }

  function getFilteredOrders(orderArr, state, filter, today) {
    const active = orderArr.filter(o => !o.canceled);
    switch (filter) {
      case 'incoming':
        return active.filter(o => !(state[o.id] && state[o.id].received));
      case 'overdue':
        return active.filter(o => !(state[o.id] && state[o.id].received) && new Date(o.estimatedDelivery) < today);
      case 'received':
        return active.filter(o => state[o.id] && state[o.id].received);
      default:
        return active;
    }
  }

  function getReceivedCardsForExport(orderArr, state) {
    return orderArr
      .filter(o => !o.canceled && state[o.id] && state[o.id].received)
      .flatMap(o => {
        const cardStates = (state[o.id] && state[o.id].cards) || {};
        return o.cards.filter(card => {
          const cs = cardStates[cardKey(card)];
          return !cs || (!cs.canceled && !cs.missing);
        });
      });
  }

  // ── State mutation ────────────────────────────────────────────

  function markReceived(orderId, received) {
    trackerState = {
      ...trackerState,
      [orderId]: { ...trackerState[orderId], received },
    };
  }

  function setCardStateFn(orderId, key, update) {
    const existing = trackerState[orderId] || { received: false };
    const existingCards = existing.cards || {};
    trackerState = {
      ...trackerState,
      [orderId]: {
        ...existing,
        cards: {
          ...existingCards,
          [key]: { canceled: false, missing: false, ...existingCards[key], ...update },
        },
      },
    };
  }

  /**
   * Returns the current value of a card state field (canceled or missing).
   * Defaults to false if the card has no recorded state yet.
   *
   * @param {string} orderId
   * @param {string} key - cardKey value
   * @param {'canceled' | 'missing'} field
   * @returns {boolean}
   */
  function getCurrentCardField(orderId, key, field) {
    const orderState = trackerState[orderId];
    if (!orderState || !orderState.cards) return false;
    const cardState = orderState.cards[key];
    return cardState ? !!cardState[field] : false;
  }

  // ── Rendering ─────────────────────────────────────────────────

  function renderTracker() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Update stats
    const stats = getStats(orders, trackerState, today);
    statTotal.textContent = stats.total;
    statReceived.textContent = stats.received;
    statOverdue.textContent = stats.overdue;
    statUnconfirmed.textContent = stats.unconfirmed;

    // Show/hide export section
    exportSection.hidden = stats.received === 0;

    // Get filtered orders
    const filtered = getFilteredOrders(orders, trackerState, activeFilter, today);
    const groups = groupOrdersByDate(filtered);

    ordersList.innerHTML = '';
    if (groups.size === 0) {
      noOrders.hidden = false;
      return;
    }
    noOrders.hidden = true;

    for (const [dateStr, groupOrders] of groups) {
      const label = getGroupLabel(dateStr, today);
      const groupEl = renderDateGroup(dateStr, label, groupOrders, today);
      ordersList.appendChild(groupEl);
    }
  }

  function renderDateGroup(dateStr, label, groupOrders, today) {
    const group = document.createElement('div');
    group.className = 'order-group';

    const header = document.createElement('div');
    header.className = 'order-group__header';

    const labelEl = document.createElement('span');
    labelEl.className = `order-group__label order-group__label--${label.toLowerCase()}`;
    labelEl.textContent = label;

    const dateEl = document.createElement('span');
    dateEl.className = 'order-group__date';
    dateEl.textContent = `Est. delivery: ${dateStr}`;

    header.appendChild(labelEl);
    header.appendChild(dateEl);

    // Expand / collapse all toggle for this group
    const toggleAllBtn = document.createElement('button');
    toggleAllBtn.className = 'order-group__toggle-all';
    toggleAllBtn.textContent = 'Collapse all';
    toggleAllBtn.addEventListener('click', () => {
      const cards = group.querySelectorAll('.order-card');
      const bodies = group.querySelectorAll('.order-card__body');
      const btns = group.querySelectorAll('.order-card__expand-btn');
      const anyExpanded = Array.from(bodies).some(b => !b.hidden);
      bodies.forEach(b => { b.hidden = anyExpanded; });
      btns.forEach(b => {
        b.textContent = anyExpanded ? '\u25b8 Details' : '\u25be Details';
        b.setAttribute('aria-expanded', String(!anyExpanded));
      });
      cards.forEach(cardEl => {
        const orderId = cardEl.dataset.orderId;
        if (orderId) orderBodyHiddenState[orderId] = anyExpanded;
      });
      toggleAllBtn.textContent = anyExpanded ? 'Expand all' : 'Collapse all';
    });
    header.appendChild(toggleAllBtn);
    group.appendChild(header);

    for (const order of groupOrders) {
      group.appendChild(renderOrderCard(order, today));
    }

    return group;
  }

  function renderOrderCard(order, today) {
    const orderState = trackerState[order.id] || {};
    const isReceived = !!orderState.received;
    const status = isReceived ? 'standard' : getOrderStatus(order, today);
    const hasUiHiddenState = Object.prototype.hasOwnProperty.call(orderBodyHiddenState, order.id);
    const isBodyHidden = hasUiHiddenState ? orderBodyHiddenState[order.id] : isReceived;

    const card = document.createElement('div');
    card.className = `order-card order-card--${status}${isReceived ? ' order-card--received' : ''}`;
    card.dataset.orderId = order.id;

    // ── Header row ─────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'order-card__header';

    // Received checkbox
    const receivedLabel = document.createElement('label');
    receivedLabel.className = 'order-card__received-label';
    const receivedCb = document.createElement('input');
    receivedCb.type = 'checkbox';
    receivedCb.className = 'order-card__received-cb';
    receivedCb.checked = isReceived;
    receivedCb.setAttribute('aria-label', `Mark order ${order.id} as received`);
    receivedCb.addEventListener('change', () => {
      markReceived(order.id, receivedCb.checked);
      orderBodyHiddenState[order.id] = receivedCb.checked;
      debouncedSave();
      renderTracker();
    });
    receivedLabel.appendChild(receivedCb);
    receivedLabel.appendChild(document.createTextNode(' Received'));

    // Order info
    const info = document.createElement('div');
    info.className = 'order-card__info';

    const idEl = document.createElement('span');
    idEl.className = 'order-card__id';
    idEl.textContent = order.id;

    const sellerEl = document.createElement('span');
    sellerEl.className = 'order-card__seller';
    sellerEl.textContent = order.seller;

    const totalEl = document.createElement('span');
    totalEl.className = 'order-card__total';
    totalEl.textContent = order.total > 0 ? `$${order.total.toFixed(2)}` : '';

    info.appendChild(sellerEl);
    info.appendChild(idEl);

    // Status badge
    const badges = document.createElement('div');
    badges.className = 'order-card__badges';

    if (status === 'overdue') {
      badges.appendChild(makeBadge('Past Due', 'overdue'));
    } else if (status === 'unconfirmed') {
      badges.appendChild(makeBadge('Not Shipped', 'unconfirmed'));
    } else if (status === 'tracked') {
      const b = makeBadge('Tracked', 'tracked');
      badges.appendChild(b);
      const tn = document.createElement('a');
      tn.className = 'order-card__tracking';
      tn.textContent = order.trackingNumber.number;
      if (order.trackingNumber.url) {
        tn.href = order.trackingNumber.url;
        tn.target = '_blank';
        tn.rel = 'noopener noreferrer';
      }
      badges.appendChild(tn);
    }

    // Expand/collapse button
    const expandBtn = document.createElement('button');
    expandBtn.className = 'order-card__expand-btn';
    expandBtn.setAttribute('aria-expanded', String(!isBodyHidden));
    expandBtn.setAttribute('aria-label', `Toggle details for order ${order.id}`);
    expandBtn.textContent = isBodyHidden ? '▸ Details' : '▾ Details';

    header.appendChild(receivedLabel);
    header.appendChild(info);
    header.appendChild(badges);
    if (order.total > 0) header.appendChild(totalEl);
    header.appendChild(expandBtn);
    card.appendChild(header);

    // ── Body (expanded) ────────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'order-card__body';
    body.hidden = isBodyHidden;

    // Partial refund banner
    if (order.partialRefund !== null && order.partialRefund !== undefined) {
      const hasAnyCanceled = Object.values(orderState.cards || {}).some(cs => cs.canceled);
      if (!hasAnyCanceled) {
        const banner = document.createElement('div');
        banner.className = 'partial-refund-banner';
        banner.innerHTML = `⚠ Partial refund of <strong>$${order.partialRefund.toFixed(2)}</strong> issued — identify the affected card(s) below.`;
        body.appendChild(banner);
      }
    }

    // Card list
    const cardList = document.createElement('ul');
    cardList.className = 'order-card__card-list';

    for (const card of order.cards) {
      const key = cardKey(card);
      const cs = (orderState.cards && orderState.cards[key]) || { canceled: false, missing: false };
      cardList.appendChild(renderCardRow(card, key, order.id, cs));
    }

    body.appendChild(cardList);
    card.appendChild(body);

    // Expand toggle
    expandBtn.addEventListener('click', () => {
      const expanded = body.hidden === false;
      body.hidden = expanded;
      orderBodyHiddenState[order.id] = expanded;
      expandBtn.textContent = expanded ? '▸ Details' : '▾ Details';
      expandBtn.setAttribute('aria-expanded', String(!expanded));
    });

    return card;
  }

  function renderCardRow(card, key, orderId, cs) {
    const li = document.createElement('li');
    const hasIssue = cs.canceled || cs.missing;
    li.className = `card-row${cs.canceled ? ' card-row--canceled' : ''}${cs.missing ? ' card-row--missing' : ''}${hasIssue ? ' card-row--open' : ''}`;

    // Left: name + set
    const nameBlock = document.createElement('span');
    nameBlock.className = 'card-row__name';
    const nameText = document.createElement('span');
    nameText.className = 'card-row__name-text';
    nameText.textContent = card.name;
    const setEl = card.set ? document.createElement('span') : null;
    if (setEl) {
      setEl.className = 'card-row__set';
      setEl.textContent = card.set;
    }
    nameBlock.appendChild(nameText);
    if (setEl) nameBlock.appendChild(setEl);

    // Right: condition / foil / price
    const meta = document.createElement('span');
    meta.className = 'card-row__meta';
    const metaText = [card.condition, card.foil ? 'Foil' : ''].filter(Boolean).join(' · ');
    if (metaText) {
      meta.appendChild(document.createTextNode(metaText));
    }
    if (card.price > 0) {
      if (metaText) meta.appendChild(document.createTextNode(' · '));
      const priceEl = document.createElement('span');
      priceEl.className = 'card-row__price';
      priceEl.textContent = `$${card.price.toFixed(2)}`;
      meta.appendChild(priceEl);
    }

    // Controls (hidden until row is clicked)
    const controls = document.createElement('div');
    controls.className = 'card-row__controls';

    // Refunded checkbox — toggling on clears missing (mutually exclusive)
    const cancelLabel = document.createElement('label');
    cancelLabel.className = 'card-row__check-label';
    const cancelCb = document.createElement('input');
    cancelCb.type = 'checkbox';
    cancelCb.checked = cs.canceled;
    cancelCb.addEventListener('change', () => {
      const currentMissing = getCurrentCardField(orderId, key, 'missing');
      setCardStateFn(orderId, key, { canceled: cancelCb.checked, missing: cancelCb.checked ? false : currentMissing });
      debouncedSave();
      renderTracker();
    });
    cancelLabel.appendChild(cancelCb);
    cancelLabel.appendChild(document.createTextNode(' Refunded'));

    // Missing checkbox — toggling on clears canceled (mutually exclusive)
    const missingLabel = document.createElement('label');
    missingLabel.className = 'card-row__check-label';
    const missingCb = document.createElement('input');
    missingCb.type = 'checkbox';
    missingCb.checked = cs.missing;
    missingCb.addEventListener('change', () => {
      const currentCanceled = getCurrentCardField(orderId, key, 'canceled');
      setCardStateFn(orderId, key, { missing: missingCb.checked, canceled: missingCb.checked ? false : currentCanceled });
      debouncedSave();
      renderTracker();
    });
    missingLabel.appendChild(missingCb);
    missingLabel.appendChild(document.createTextNode(' Missing'));

    controls.appendChild(cancelLabel);
    controls.appendChild(missingLabel);

    // Toggle controls on row click (but not if clicking a checkbox directly)
    li.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      li.classList.toggle('card-row--open');
    });

    li.appendChild(nameBlock);
    li.appendChild(meta);
    li.appendChild(controls);
    return li;
  }

  function makeBadge(text, type) {
    const badge = document.createElement('span');
    badge.className = `status-badge status-badge--${type}`;
    badge.textContent = text;
    return badge;
  }

  // ── Filter tabs ───────────────────────────────────────────────

  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => {
        t.classList.remove('filter-tab--active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('filter-tab--active');
      tab.setAttribute('aria-selected', 'true');
      activeFilter = tab.dataset.filter;
      renderTracker();
    });
  });

  toggleAllBtn.addEventListener('click', () => {
      const cards = ordersList.querySelectorAll('.order-card');
      const bodies = ordersList.querySelectorAll('.order-card__body');
      const btns = ordersList.querySelectorAll('.order-card__expand-btn');
      const anyExpanded = Array.from(bodies).some(b => !b.hidden);
      bodies.forEach(b => { b.hidden = anyExpanded; });
      btns.forEach(b => {
        b.textContent = anyExpanded ? '▸ Details' : '▾ Details';
        b.setAttribute('aria-expanded', String(!anyExpanded));
      });
      cards.forEach(cardEl => {
        const orderId = cardEl.dataset.orderId;
        if (orderId) orderBodyHiddenState[orderId] = anyExpanded;
      });
      toggleAllBtn.textContent = anyExpanded ? 'Expand all' : 'Collapse all';
  });

  // ── Export received cards ─────────────────────────────────────

  exportBtn.addEventListener('click', () => {
    const receivedCards = getReceivedCardsForExport(orders, trackerState);
    if (receivedCards.length === 0) {
      alert('No received cards to export yet.');
      return;
    }
    const csv = formatCardsToCSV(receivedCards);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'received-cards.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  function formatCardsToCSV(cards) {
    const header = 'Name,Set name,Condition,Foil,Quantity,Purchase price';
    const rows = cards.map(c => {
      const fields = [
        csvField(c.name || ''),
        csvField(c.set || ''),
        csvField(c.condition || 'Near Mint'),
        c.foil ? 'foil' : '',
        c.quantity != null ? c.quantity : 1,
        c.price > 0 ? c.price.toFixed(2) : '',
      ];
      return fields.join(',');
    });
    return [header, ...rows].join('\n');
  }

  function csvField(value) {
    const str = String(value);
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  }

  // ── Initialization ─────────────────────────────────────────────
  // Initialize the GIS token client and set the auth UI to 'disconnected'.
  // We do NOT auto-prompt — the user clicks "Connect Google Drive" to start.

  function onPageReady() {
    initGoogleAuth();
    setAuthStatus('disconnected');
    renderTracker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onPageReady);
  } else {
    onPageReady();
  }

})();
