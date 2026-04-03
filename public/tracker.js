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
  const DRIVE_AUTOCONNECT_KEY = 'tcg-tracker-drive-autoconnect';
  const AUTH_REQUEST_TIMEOUT_MS = 6000;
  const AUTH_POPUP_PROBE_MS = 1200;
  const SAVE_DEBOUNCE_MS = 500;
  const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB per file

  // Trusted hostnames for carrier/parcel tracking links sourced from uploaded files.
  // Any tracking URL whose hostname does not match this list is silently dropped —
  // the tracking number is still shown as plain text.
  const TRUSTED_TRACKING_HOSTS = [
    'ups.com',
    'usps.com',
    'fedex.com',
    'dhl.com',
    'parcelsapp.com',
    '17track.net',
    'aftership.com',
    'stamps.com',
  ];

  // ── Auth state ────────────────────────────────────────────────
  // Tokens are held in memory only — never stored in localStorage or cookies.
  let authState = {
    accessToken: null,   // string | null
    expiresAt: null,     // Unix timestamp ms | null
  };

  let tokenClient = null;   // google.accounts.oauth2.TokenClient
  let driveFileId = null;
  let authRequestTimer = null;
  let authPopupProbeTimer = null;
  let authRequestMode = null; // 'silent' | 'interactive' | null
  let authErrorMessage = 'Connection failed — try again';

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
  const sharedScryfallState = getSharedScryfallSessionState();
  const scryfallByTcgplayerId = sharedScryfallState.byTcgplayerId; // Session cache: Map<tcgplayerId, cardData|null>
  const scryfallInFlightByTcgplayerId = sharedScryfallState.inFlightByTcgplayerId;
  const SCRYFALL_CONCURRENCY = 2;
  const SCRYFALL_MAX_RETRIES = 2;
  const SCRYFALL_BASE_BACKOFF_MS = 1000;
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
  const statTotalCost = document.getElementById('stat-total-cost');
  const statReceived = document.getElementById('stat-received');
  const statOverdue = document.getElementById('stat-overdue');
  const statUnconfirmed = document.getElementById('stat-unconfirmed');
  const ordersList = document.getElementById('orders-list');
  const noOrders = document.getElementById('no-orders');
  const exportSection = document.getElementById('tracker-export-section');
  const exportFormat = document.getElementById('tracker-export-format');
  const exportBtn = document.getElementById('tracker-export-btn');
    const toggleAllBtn = document.getElementById('toggle-all-btn');
  const defaultTrackerParseBtnText = trackerParseBtn.textContent;

  // ── Tab navigation ────────────────────────────────────────────

  function getSharedScryfallSessionState() {
    if (!window.__tcgScryfallSessionState) {
      window.__tcgScryfallSessionState = {
        byTcgplayerId: new Map(),
        inFlightByTcgplayerId: new Map(),
        backoffUntilMs: 0,
      };
    }
    return window.__tcgScryfallSessionState;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
  }

  function parseRetryAfterMs(headerValue) {
    if (!headerValue) return 0;
    const trimmed = String(headerValue).trim();
    const seconds = parseInt(trimmed, 10);
    if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
    const parsedDate = Date.parse(trimmed);
    if (!Number.isNaN(parsedDate)) return Math.max(0, parsedDate - Date.now());
    return 0;
  }

  function normalizeScryfallCardData(tcgId, json) {
    return {
      id: tcgId,
      name: json.name || '',
      setCode: (json.set || '').toUpperCase(),
      setName: json.set_name || '',
      collectorNumber: json.collector_number || '',
      rarity: json.rarity || '',
      scryfallId: json.id || '',
      scryfallUri: json.scryfall_uri || '',
    };
  }

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
    clearAuthRequestTimeout();
    clearAuthPopupProbe();

    if (response.error) {
      console.error('OAuth error:', response.error);
      if (authRequestMode === 'interactive') {
        if (response.error === 'popup_failed_to_open' || response.error === 'popup_closed') {
          authErrorMessage = 'Google popup blocked or closed — allow popups and try again';
        } else {
          authErrorMessage = 'Connection failed — try again';
        }
      }
      setAuthStatus(authRequestMode === 'silent' ? 'disconnected' : 'error');
      authRequestMode = null;
      return;
    }

    authState = {
      accessToken: response.access_token,
      expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
    };

    setAuthStatus('connected');
    setDriveAutoconnectEnabled(true);
    authRequestMode = null;

    // Load Drive state now that we have a valid token
    try {
      applyDrivePayload(await loadStateFromDrive());
    } catch (e) {
      console.error('Failed to load state from Drive:', e);
    }
    renderTracker();
  }

  /**
   * Connect to Google Drive. Shows the OAuth consent popup if needed.
   * If already authenticated, loads Drive state immediately.
   */
  async function connectGoogleDrive(mode = 'interactive') {
    if (!window.google) {
      authErrorMessage = 'Google auth is not available — refresh and try again';
      setAuthStatus('error');
      return;
    }

    if (!tokenClient) {
      initGoogleAuth();
      if (!tokenClient) {
        authErrorMessage = 'Google auth is not ready yet — refresh and try again';
        setAuthStatus('error');
        return;
      }
    }

    if (isAuthenticated()) {
      setAuthStatus('connected');
      setDriveAutoconnectEnabled(true);
      try {
        applyDrivePayload(await loadStateFromDrive());
      } catch (e) {
        console.error('Failed to load state from Drive:', e);
      }
      renderTracker();
      return;
    }

    authRequestMode = mode;
    authErrorMessage = 'Connection failed — try again';
    setAuthStatus('connecting');
    startAuthRequestTimeout(mode);
    startAuthPopupProbe(mode);
    tokenClient.requestAccessToken({ prompt: mode === 'silent' ? '' : 'consent' });
  }

  /**
   * Disconnect from Google Drive. Revokes the token and clears auth state.
   */
  function disconnectGoogleDrive() {
    clearAuthRequestTimeout();
    clearAuthPopupProbe();
    authRequestMode = null;
    if (authState.accessToken) {
      google.accounts.oauth2.revoke(authState.accessToken, () => {
        console.log('Token revoked');
      });
    }
    authState = { accessToken: null, expiresAt: null };
    driveFileId = null;
    authErrorMessage = 'Connection failed — try again';
    setDriveAutoconnectEnabled(false);
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
      const timer = setTimeout(() => {
        tokenClient.callback = originalCallback;
        reject(new Error('Token refresh timed out'));
      }, AUTH_REQUEST_TIMEOUT_MS);

      tokenClient.callback = (response) => {
        clearTimeout(timer);
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

  function clearAuthRequestTimeout() {
    if (authRequestTimer) {
      clearTimeout(authRequestTimer);
      authRequestTimer = null;
    }
  }

  function clearAuthPopupProbe() {
    if (authPopupProbeTimer) {
      clearTimeout(authPopupProbeTimer);
      authPopupProbeTimer = null;
    }
  }

  function startAuthPopupProbe(mode) {
    clearAuthPopupProbe();
    if (mode !== 'interactive') return;

    authPopupProbeTimer = setTimeout(() => {
      authPopupProbeTimer = null;
      if (authRequestMode !== 'interactive') return;

      // If the page still has focus shortly after requesting auth, the popup was likely blocked.
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        authErrorMessage = 'Google popup blocked — allow popups and try again';
        clearAuthRequestTimeout();
        authRequestMode = null;
        setAuthStatus('error');
      }
    }, AUTH_POPUP_PROBE_MS);
  }

  function startAuthRequestTimeout(mode) {
    clearAuthRequestTimeout();
    authRequestTimer = setTimeout(() => {
      authRequestTimer = null;
      authRequestMode = null;
      if (mode === 'interactive') {
        authErrorMessage = 'Connection timed out — allow popups and try again';
      }
      setAuthStatus(mode === 'silent' ? 'disconnected' : 'error');
    }, AUTH_REQUEST_TIMEOUT_MS);
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
      driveAuthStatus.textContent = authErrorMessage || 'Connection failed — try again';
      driveAuthStatus.className = 'drive-auth-status drive-auth-status--error';
      driveAuthStatus.hidden = false;
      driveConnectNote.hidden = false;
    }
  }

  // Wire up Connect / Disconnect buttons
  driveConnectBtn.addEventListener('click', () => connectGoogleDrive('interactive'));
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
    return normalizeDrivePayload(await contentRes.json());
  }

  async function saveStateToDrive() {
    if (!isAuthenticated()) return;
    const body = JSON.stringify({
      version: 2,
      orders,
      trackerState,
    });

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

  function normalizeDrivePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { orders: [], trackerState: {} };
    }

    // Backward compatibility: old payloads stored trackerState directly.
    if (!Object.prototype.hasOwnProperty.call(payload, 'orders') && !Object.prototype.hasOwnProperty.call(payload, 'trackerState')) {
      return { orders: [], trackerState: payload };
    }

    return {
      orders: Array.isArray(payload.orders) ? payload.orders : [],
      trackerState: payload.trackerState && typeof payload.trackerState === 'object' ? payload.trackerState : {},
    };
  }

  function applyDrivePayload(payload) {
    const normalized = normalizeDrivePayload(payload);
    const mergedOrders = mergeOrders(normalized.orders, orders);
    orders = mergedOrders;
    trackerState = Object.assign({}, trackerState, normalized.trackerState);
  }

  function mergeOrders(primaryOrders, secondaryOrders) {
    const merged = new Map();
    (Array.isArray(primaryOrders) ? primaryOrders : []).forEach(order => {
      if (order && order.id) merged.set(order.id, order);
    });
    (Array.isArray(secondaryOrders) ? secondaryOrders : []).forEach(order => {
      if (order && order.id && !merged.has(order.id)) merged.set(order.id, order);
    });
    return Array.from(merged.values());
  }

  function setDriveAutoconnectEnabled(enabled) {
    try {
      if (enabled) {
        localStorage.setItem(DRIVE_AUTOCONNECT_KEY, '1');
      } else {
        localStorage.removeItem(DRIVE_AUTOCONNECT_KEY);
      }
    } catch {
      // Ignore storage restrictions.
    }
  }

  function getDriveAutoconnectEnabled() {
    try {
      return localStorage.getItem(DRIVE_AUTOCONNECT_KEY) === '1';
    } catch {
      return false;
    }
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

  // ── File validation helpers ───────────────────────────────────

  /**
   * Returns true if the given URL is from a trusted parcel/carrier tracking host.
   * Any URL whose protocol is not http(s) or whose hostname is not on the allowlist
   * is rejected so that arbitrary hrefs from uploaded files cannot become live links.
   *
   * @param {string} url - Fully-resolved URL string.
   * @returns {boolean}
   */
  function isTrustedTrackingUrl(url) {
    if (!url) return false;
    try {
      const { hostname, protocol } = new URL(url);
      if (protocol !== 'https:' && protocol !== 'http:') return false;
      return TRUSTED_TRACKING_HOSTS.some(
        d => hostname === d || hostname.endsWith('.' + d)
      );
    } catch {
      return false;
    }
  }

  // Patterns used to detect TCGPlayer order-history content in uploaded files.
  const TCG_CONTENT_PATTERNS = [
    /orderHistoryItems/i,
    /div-sellerorderwidget/i,
    /class="orderWrap"/i,
    /tcgplayer\.com\/product\/\d+/i,
  ];

  /**
   * Returns true if the file text contains at least one marker that strongly
   * suggests TCGPlayer order-history HTML.  Used to reject obviously wrong files
   * before running the full parser.
   *
   * @param {string} text
   * @returns {boolean}
   */
  function hasExpectedTcgPlayerContent(text) {
    return TCG_CONTENT_PATTERNS.some(re => re.test(text));
  }

  trackerParseBtn.addEventListener('click', async () => {
    await loadTrackerOrdersFromSelection(true);
  });

  trackerFileInput.addEventListener('change', async () => {
    if (!trackerFileInput.files || trackerFileInput.files.length === 0) return;
    await loadTrackerOrdersFromSelection(false);
  });

  async function loadTrackerOrdersFromSelection(showMissingFileError) {
    if (trackerParseBtn.disabled) return;
    const files = trackerFileInput.files;
    if (!files || files.length === 0) {
      if (showMissingFileError) {
        showUploadMsg('Please choose one or more order-history files (.mht, .mhtml, or .html).', true);
      }
      return;
    }

    // Validate file sizes before reading.
    const fileArr = Array.from(files);
    const oversized = fileArr.find(f => f.size > MAX_FILE_BYTES);
    if (oversized) {
      showUploadMsg(`"${oversized.name}" exceeds the 50 MB limit. Please upload a smaller file.`, true);
      return;
    }

    trackerParseBtn.disabled = true;
    trackerParseBtn.textContent = 'Loading…';
    showUploadMsg('Loading selected files…', false);

    try {
      const reads = fileArr.map(
        (f) =>
          new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result || ''));
            r.onerror = () => resolve('');
            r.readAsText(f);
          })
      );
      const texts = await Promise.all(reads);

      // Validate content before parsing.
      const hasAnyValidContent = texts.some(hasExpectedTcgPlayerContent);
      if (!hasAnyValidContent) {
        showUploadMsg(
          'Selected file(s) do not look like TCGPlayer order history. ' +
          'Save your Order History page as .mht, .mhtml, or .html and try again.',
          true
        );
        return;
      }

      const freshOrders = [];
      for (let i = 0; i < texts.length; i++) {
        if (!hasExpectedTcgPlayerContent(texts[i])) continue;
        freshOrders.push(...parseArchiveIntoOrders(texts[i]));
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

      if (updatedCount > 0 || visibleNewOrders.length > 0) debouncedSave();

      renderTracker();
      if (visibleNewOrders.length > 0) {
        hydrateScryfallForOrderCards(visibleNewOrders)
          .then((resolvedCount) => {
            if (resolvedCount > 0) renderTracker();
          })
          .catch((err) => {
            console.warn('Scryfall enrichment unavailable for tracker links.', err);
          });
      }
    } catch (e) {
      showUploadMsg('An error occurred parsing files.', true);
      console.error(e);
    } finally {
      trackerParseBtn.disabled = false;
      trackerParseBtn.textContent = defaultTrackerParseBtnText;
    }
  }

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
    const orderSummary = extractOrderSummary(orderEl);
    const cards = extractCardsFromElement(orderEl, seller);
    if (cards.length === 0) {
      console.warn(`parseOrderFromElement: No cards found for order ${id}`);
      return null;
    }
    // Use summary total as the canonical per-order total when present.
    const fallbackTotal = extractOrderTotal(orderEl, cards);
    const canonicalTotal = orderSummary.total > 0 ? orderSummary.total : fallbackTotal;
    if (!(orderSummary.quantity > 0)) {
      orderSummary.quantity = cards.reduce((sum, c) => sum + (c.quantity || 1), 0);
    }
    if (!(orderSummary.subtotal > 0)) {
      orderSummary.subtotal = calculateCardsTotal(cards);
    }
    if (!(orderSummary.total > 0)) {
      orderSummary.total = canonicalTotal;
    }
    return {
      id,
      date,
      seller,
      total: canonicalTotal,
      orderSummary,
      estimatedDelivery,
      trackingNumber,
      shippingConfirmed,
      canceled,
      partialRefund,
      cards,
    };
  }

  function extractOrderSummary(orderEl) {
    const summary = {
      quantity: 0,
      subtotal: 0,
      shipping: 0,
      salesTax: 0,
      total: 0,
    };

    const table = orderEl.querySelector('[data-aid="tbl-sellerorderwidget-productsinorder"]');
    if (!table) return summary;

    table.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) return;
      const rawLabel = (cells[0].textContent || '').trim().toLowerCase();
      const rawValue = (cells[1].textContent || '').trim();
      const amount = parseDollarAmount(rawValue);

      if (rawLabel.startsWith('quantity')) {
        const qty = parseInt(rawValue.replace(/[^\d]/g, ''), 10);
        if (!Number.isNaN(qty) && qty > 0) summary.quantity = qty;
        return;
      }
      if (rawLabel.startsWith('subtotal')) {
        summary.subtotal = amount;
        return;
      }
      if (rawLabel.startsWith('shipping')) {
        summary.shipping = amount;
        return;
      }
      if (rawLabel.includes('sales tax') || rawLabel.startsWith('tax')) {
        summary.salesTax = amount;
        return;
      }
      if (rawLabel.startsWith('total') || rawLabel.includes('order total') || rawLabel.includes('grand total')) {
        summary.total = amount;
      }
    });

    return summary;
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
        const trustedSourceUrl = isTrustedTrackingUrl(link.href) ? link.href : null;
        return { number, url: trustedSourceUrl || getTrackingUrl(orderEl, number) };
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

  function extractOrderTotal(orderEl, cards) {
    const selectors = [
      '[data-aid*="ordertotal"]',
      '[data-aid*="order-total"]',
      '[data-aid*="total"]',
    ];
    for (const selector of selectors) {
      const totalEl = orderEl.querySelector(selector);
      if (!totalEl) continue;
      const parsed = parseDollarAmount(totalEl.textContent || '');
      if (parsed > 0) return parsed;
    }

    const text = orderEl.textContent || '';
    const patterns = [
      /Order\s+Total[:\s]*\$?\s*([\d,.]+)/i,
      /Grand\s+Total[:\s]*\$?\s*([\d,.]+)/i,
      /Total[:\s]*\$?\s*([\d,.]+)/i,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (!m) continue;
      const parsed = parseFloat(String(m[1]).replace(/,/g, ''));
      if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }

    return calculateCardsTotal(cards);
  }

  function parseDollarAmount(text) {
    const m = String(text || '').match(/\$\s*([\d,.]+)/);
    if (!m) return 0;
    const parsed = parseFloat(m[1].replace(/,/g, ''));
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  function calculateCardsTotal(cards) {
    if (!Array.isArray(cards) || cards.length === 0) return 0;
    const sum = cards.reduce((acc, card) => {
      const qty = card && card.quantity != null ? card.quantity : 1;
      const unit = card && card.price != null ? card.price : 0;
      return acc + (qty * unit);
    }, 0);
    return Number.isFinite(sum) && sum > 0 ? parseFloat(sum.toFixed(2)) : 0;
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

  function toDateOnly(value) {
    const parsed = new Date(value);
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
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
      [...groups.entries()].sort(([a], [b]) => toDateOnly(a).getTime() - toDateOnly(b).getTime())
    );
  }

  function getOrderStatus(order, today) {
    const est = toDateOnly(order.estimatedDelivery);
    const currentDay = toDateOnly(today);
    if (est < currentDay) return 'overdue';
    if (!order.shippingConfirmed) return 'unconfirmed';
    if (order.trackingNumber) return 'tracked';
    return 'standard';
  }

  function getGroupLabel(dateStr, today) {
    const est = toDateOnly(dateStr);
    const currentDay = toDateOnly(today);
    if (est < currentDay) return 'Overdue';
    const diffDays = (est.getTime() - currentDay.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays <= 3) return 'Soon';
    return 'Incoming';
  }

  function getStats(orderArr, state, today) {
    const active = orderArr.filter(o => !o.canceled);
    const currentDay = toDateOnly(today);
    return {
      total: active.length,
      totalCost: active.reduce((sum, o) => sum + (o.total || 0), 0),
      received: active.filter(o => state[o.id] && state[o.id].received).length,
      overdue: active.filter(o => !(state[o.id] && state[o.id].received) && toDateOnly(o.estimatedDelivery) < currentDay).length,
      unconfirmed: active.filter(o => !(state[o.id] && state[o.id].received) && !o.shippingConfirmed).length,
    };
  }

  function getFilteredOrders(orderArr, state, filter, today) {
    const active = orderArr.filter(o => !o.canceled);
    switch (filter) {
      case 'incoming':
        return active.filter(o => !(state[o.id] && state[o.id].received));
      case 'overdue':
        return active.filter(o => !(state[o.id] && state[o.id].received) && toDateOnly(o.estimatedDelivery) < toDateOnly(today));
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
    statTotalCost.textContent = `$${stats.totalCost.toFixed(2)}`;
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

    const sellerEl = document.createElement('span');
    sellerEl.className = 'order-card__seller';
    sellerEl.textContent = order.seller;

    const totalEl = document.createElement('span');
    totalEl.className = 'order-card__total';
    totalEl.textContent = order.total > 0 ? `$${order.total.toFixed(2)}` : '';

    info.appendChild(sellerEl);

    // Status badge
    const badges = document.createElement('div');
    badges.className = 'order-card__badges';

    if (status === 'overdue') {
      badges.appendChild(makeBadge('Past Due', 'overdue'));
    } else if (status === 'unconfirmed') {
      badges.appendChild(makeBadge('Not Shipped', 'unconfirmed'));
    } else if (status === 'tracked') {
      if (order.trackingNumber && order.trackingNumber.url) {
        const trackedLink = document.createElement('a');
        trackedLink.className = 'status-badge status-badge--tracked status-badge--link';
        trackedLink.textContent = 'Tracked';
        trackedLink.href = order.trackingNumber.url;
        trackedLink.target = '_blank';
        trackedLink.rel = 'noopener noreferrer';
        if (order.trackingNumber.number) trackedLink.title = order.trackingNumber.number;
        badges.appendChild(trackedLink);
      } else {
        badges.appendChild(makeBadge('Tracked', 'tracked'));
      }
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

    const metaRow = document.createElement('div');
    metaRow.className = 'order-card__subheader';

    const idEl = document.createElement('span');
    idEl.className = 'order-card__id';
    idEl.textContent = `Order ${order.id}`;
    metaRow.appendChild(idEl);

    const summary = order.orderSummary || {};
    const summaryEl = document.createElement('div');
    summaryEl.className = 'order-card__summary';
    appendSummaryItem(summaryEl, 'Qty', summary.quantity > 0 ? String(summary.quantity) : null);
    appendSummaryItem(summaryEl, 'Subtotal', summary.subtotal > 0 ? `$${summary.subtotal.toFixed(2)}` : null);
    appendSummaryItem(summaryEl, 'Shipping', summary.shipping >= 0 ? `$${summary.shipping.toFixed(2)}` : null);
    appendSummaryItem(summaryEl, 'Tax', summary.salesTax >= 0 ? `$${summary.salesTax.toFixed(2)}` : null);
    appendSummaryItem(summaryEl, 'Total', order.total > 0 ? `$${order.total.toFixed(2)}` : null);
    if (summaryEl.children.length > 0) metaRow.appendChild(summaryEl);

    body.appendChild(metaRow);

    // Partial refund banner
    if (order.partialRefund !== null && order.partialRefund !== undefined) {
      const hasAnyCanceled = Object.values(orderState.cards || {}).some(cs => cs.canceled);
      if (!hasAnyCanceled) {
        const banner = document.createElement('div');
        banner.className = 'partial-refund-banner';
        banner.appendChild(document.createTextNode('\u26a0 Partial refund of '));
        const refundAmountEl = document.createElement('strong');
        refundAmountEl.textContent = `$${order.partialRefund.toFixed(2)}`;
        banner.appendChild(refundAmountEl);
        banner.appendChild(document.createTextNode(' issued \u2014 identify the affected card(s) below.'));
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
    li.className = `card-row${cs.canceled ? ' card-row--canceled' : ''}${cs.missing ? ' card-row--missing' : ''}`;

    // Left: name + set
    const nameBlock = document.createElement('span');
    nameBlock.className = 'card-row__name';
    const exactPrintingUrl = getExactPrintingScryfallUrl(card);
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
    const quantity = card.quantity != null ? card.quantity : 1;
    if (card.price > 0) {
      if (metaText) meta.appendChild(document.createTextNode(' · '));
      const priceEl = document.createElement('span');
      priceEl.className = 'card-row__price';
      priceEl.textContent = quantity > 1 ? `${quantity} x $${card.price.toFixed(2)}` : `$${card.price.toFixed(2)}`;
      meta.appendChild(priceEl);
    } else if (quantity > 1) {
      if (metaText) meta.appendChild(document.createTextNode(' · '));
      const qtyEl = document.createElement('span');
      qtyEl.className = 'card-row__price';
      qtyEl.textContent = `Qty ${quantity}`;
      meta.appendChild(qtyEl);
    }

    // Controls (hidden until row is clicked)
    const controls = document.createElement('div');
    controls.className = 'card-row__controls';
    if (exactPrintingUrl) {
      const scryLink = document.createElement('a');
      scryLink.className = 'card-row__scryfall-link';
      scryLink.href = exactPrintingUrl;
      scryLink.target = '_blank';
      scryLink.rel = 'noopener noreferrer';
      scryLink.textContent = 'Scryfall ↗';
      controls.appendChild(scryLink);
    }

    const issueGroup = document.createElement('div');
    issueGroup.className = 'card-row__issue-group';
    issueGroup.setAttribute('role', 'radiogroup');
    issueGroup.setAttribute('aria-label', `Card issue status for ${card.name}`);

    const refundBtn = document.createElement('button');
    refundBtn.type = 'button';
    refundBtn.className = `card-row__issue-btn${cs.canceled ? ' is-active' : ''}`;
    refundBtn.setAttribute('role', 'radio');
    refundBtn.setAttribute('aria-checked', cs.canceled ? 'true' : 'false');
    refundBtn.textContent = 'Refunded';
    refundBtn.addEventListener('click', () => {
      const currentlyCanceled = getCurrentCardField(orderId, key, 'canceled');
      const nextCanceled = !currentlyCanceled;
      setCardStateFn(orderId, key, { canceled: nextCanceled, missing: nextCanceled ? false : getCurrentCardField(orderId, key, 'missing') });
      debouncedSave();
      renderTracker();
    });

    const missingBtn = document.createElement('button');
    missingBtn.type = 'button';
    missingBtn.className = `card-row__issue-btn${cs.missing ? ' is-active' : ''}`;
    missingBtn.setAttribute('role', 'radio');
    missingBtn.setAttribute('aria-checked', cs.missing ? 'true' : 'false');
    missingBtn.textContent = 'Missing';
    missingBtn.addEventListener('click', () => {
      const currentlyMissing = getCurrentCardField(orderId, key, 'missing');
      const nextMissing = !currentlyMissing;
      setCardStateFn(orderId, key, { missing: nextMissing, canceled: nextMissing ? false : getCurrentCardField(orderId, key, 'canceled') });
      debouncedSave();
      renderTracker();
    });

    issueGroup.appendChild(refundBtn);
    issueGroup.appendChild(missingBtn);
    controls.appendChild(issueGroup);

    li.appendChild(nameBlock);
    li.appendChild(meta);
    li.appendChild(controls);
    return li;
  }

  function getExactPrintingScryfallUrl(card) {
    if (!card || !card.tcgplayerId) return null;
    const data = scryfallByTcgplayerId.get(card.tcgplayerId);
    if (!data) return null;
    if (data.scryfallUri) return data.scryfallUri;
    if (data.setCode && data.collectorNumber) {
      return `https://scryfall.com/card/${encodeURIComponent(data.setCode.toLowerCase())}/${encodeURIComponent(data.collectorNumber)}`;
    }
    if (data.scryfallId) {
      return `https://scryfall.com/card/${encodeURIComponent(data.scryfallId)}`;
    }
    return null;
  }

  function makeBadge(text, type) {
    const badge = document.createElement('span');
    badge.className = `status-badge status-badge--${type}`;
    badge.textContent = text;
    return badge;
  }

  function appendSummaryItem(container, label, value) {
    if (!value) return;
    const item = document.createElement('span');
    item.className = 'order-card__summary-item';

    const labelEl = document.createElement('span');
    labelEl.className = 'order-card__summary-label';
    labelEl.textContent = `${label}: `;

    const valueEl = document.createElement('span');
    valueEl.className = 'order-card__summary-value';
    valueEl.textContent = value;

    item.appendChild(labelEl);
    item.appendChild(valueEl);
    container.appendChild(item);
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

  exportBtn.addEventListener('click', async () => {
    const receivedCards = getReceivedCardsForExport(orders, trackerState);
    if (receivedCards.length === 0) {
      alert('No received cards to export yet.');
      return;
    }
    exportBtn.disabled = true;
    const originalLabel = exportBtn.textContent;
    exportBtn.textContent = 'Preparing...';
    try {
      const selectedFormat = exportFormat ? exportFormat.value : 'generic';
      const enrichedCards = await enrichCardsForExport(receivedCards);
      const csv = formatCardsToCSV(enrichedCards, selectedFormat);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `received-cards-${selectedFormat}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = originalLabel;
    }
  });

  async function enrichCardsForExport(cards) {
    const ids = Array.from(new Set(
      cards.map(c => c.tcgplayerId).filter(id => typeof id === 'string' && id.trim() !== '')
    ));
    if (ids.length > 0) await fetchAllScryfall(ids);

    return cards.map(card => {
      const tcgId = card.tcgplayerId;
      if (!tcgId) return card;
      const scry = scryfallByTcgplayerId.get(tcgId);
      if (!scry) return card;
      return {
        ...card,
        name: card.name || scry.name,
        setName: scry.setName || card.set || '',
        setCode: scry.setCode || '',
        collectorNumber: scry.collectorNumber || '',
        scryfallId: scry.scryfallId || '',
      };
    });
  }

  async function hydrateScryfallForOrderCards(orderArr) {
    const ids = Array.from(new Set(
      (orderArr || [])
        .flatMap(order => (order.cards || []).map(card => card.tcgplayerId))
        .filter(id => typeof id === 'string' && id.trim() !== '')
    ));
    if (ids.length === 0) return 0;
    const before = ids.filter(id => scryfallByTcgplayerId.has(id)).length;
    await fetchAllScryfall(ids);
    const after = ids.filter(id => scryfallByTcgplayerId.has(id) && scryfallByTcgplayerId.get(id)).length;
    return Math.max(0, after - before);
  }

  async function fetchScryfallByTcgplayerId(tcgId, attempt = 0) {
    const now = Date.now();
    if (sharedScryfallState.backoffUntilMs > now) {
      await sleep(sharedScryfallState.backoffUntilMs - now);
    }
    try {
      const res = await fetch(`https://api.scryfall.com/cards/tcgplayer/${tcgId}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 429) {
        const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
        const exponentialMs = SCRYFALL_BASE_BACKOFF_MS * (2 ** Math.min(attempt, 3));
        const backoffMs = Math.max(retryAfterMs, exponentialMs);
        sharedScryfallState.backoffUntilMs = Date.now() + backoffMs;
        if (attempt < SCRYFALL_MAX_RETRIES) {
          await sleep(backoffMs);
          return fetchScryfallByTcgplayerId(tcgId, attempt + 1);
        }
        return null;
      }
      sharedScryfallState.backoffUntilMs = 0;
      if (!res.ok) return null;
      const json = await res.json();
      return normalizeScryfallCardData(tcgId, json);
    } catch {
      if (attempt < 1) {
        await sleep(SCRYFALL_BASE_BACKOFF_MS);
        return fetchScryfallByTcgplayerId(tcgId, attempt + 1);
      }
      return null;
    }
  }

  async function fetchScryfallByTcgplayerIdCached(tcgId) {
    if (!tcgId) return null;
    if (scryfallByTcgplayerId.has(tcgId)) return scryfallByTcgplayerId.get(tcgId);
    if (scryfallInFlightByTcgplayerId.has(tcgId)) {
      return scryfallInFlightByTcgplayerId.get(tcgId);
    }
    const promise = fetchScryfallByTcgplayerId(tcgId)
      .then((card) => {
        scryfallByTcgplayerId.set(tcgId, card);
        return card;
      })
      .catch(() => {
        scryfallByTcgplayerId.set(tcgId, null);
        return null;
      })
      .finally(() => {
        scryfallInFlightByTcgplayerId.delete(tcgId);
      });
    scryfallInFlightByTcgplayerId.set(tcgId, promise);
    return promise;
  }

  async function fetchAllScryfall(ids, concurrency = SCRYFALL_CONCURRENCY) {
    const results = new Map();
    const idArr = Array.from(new Set((ids || []).filter(id => typeof id === 'string' && id.trim() !== '')));
    if (idArr.length === 0) return results;
    let cursor = 0;

    async function worker() {
      while (cursor < idArr.length) {
        const i = cursor++;
        const id = idArr[i];
        const card = await fetchScryfallByTcgplayerIdCached(id);
        results.set(id, card);
      }
    }

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, idArr.length); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return results;
  }

  function formatCardsToCSV(cards, format) {
    const kind = String(format || 'generic').toLowerCase();
    switch (kind) {
      case 'moxfield':
        return formatCardsToMoxfieldCSV(cards);
      case 'archidekt':
        return formatCardsToArchidektCSV(cards);
      case 'deckbox':
        return formatCardsToDeckboxCSV(cards);
      default:
        return formatCardsToGenericCSV(cards);
    }
  }

  function formatCardsToGenericCSV(cards) {
    const header = 'Name,Set name,Condition,Foil,Quantity,Purchase price';
    const rows = cards.map(c => [
      csvField(c.name || ''),
      csvField(c.set || ''),
      csvField(c.condition || 'Near Mint'),
      c.foil ? 'foil' : '',
      c.quantity != null ? c.quantity : 1,
      c.price > 0 ? c.price.toFixed(2) : '',
    ].join(','));
    return [header, ...rows].join('\n');
  }

  function formatCardsToMoxfieldCSV(cards) {
    const header = 'Count,Name,Edition,Condition,Language,Foil,Collector Number,Alter,Playtest Card,Purchase Price';
    const rows = cards.map(c => [
      c.quantity != null ? c.quantity : 1,
      csvField(c.name || ''),
      csvField(c.setCode || c.set || ''),
      csvField(c.condition || 'Near Mint'),
      'English',
      c.foil ? 'foil' : '',
      csvField(c.collectorNumber || ''),
      '',
      'FALSE',
      c.price > 0 ? c.price.toFixed(2) : '',
    ].join(','));
    return [header, ...rows].join('\n');
  }

  function formatCardsToArchidektCSV(cards) {
    const header = 'Quantity,Name,Edition,Condition,Foil,Purchase Price';
    const rows = cards.map(c => [
      c.quantity != null ? c.quantity : 1,
      csvField(c.name || ''),
      csvField(c.setCode || c.set || ''),
      csvField(c.condition || 'Near Mint'),
      c.foil ? 'foil' : '',
      c.price > 0 ? c.price.toFixed(2) : '',
    ].join(','));
    return [header, ...rows].join('\n');
  }

  function formatCardsToDeckboxCSV(cards) {
    const header = 'Count,Tradelist Count,Name,Edition,Card Number,Condition,Language,Foil,Signed,Artist Proof,Altered Art,Misprint,Promo,Textless';
    const rows = cards.map(c => [
      c.quantity != null ? c.quantity : 1,
      '',
      csvField(c.name || ''),
      csvField(c.setName || c.set || ''),
      csvField(c.collectorNumber || ''),
      csvField(toShortCondition(c.condition || 'Near Mint')),
      'English',
      c.foil ? 'foil' : '',
      '',
      '',
      '',
      '',
      '',
      '',
    ].join(','));
    return [header, ...rows].join('\n');
  }

  function toShortCondition(condition) {
    const value = String(condition || '').trim().toLowerCase();
    if (value.startsWith('near mint') || value === 'nm') return 'NM';
    if (value.startsWith('lightly played') || value === 'lp') return 'LP';
    if (value.startsWith('moderately played') || value === 'mp' || value === 'played') return 'MP';
    if (value.startsWith('heavily played') || value === 'hp') return 'HP';
    if (value.startsWith('damaged') || value === 'd' || value === 'dm') return 'D';
    return condition;
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
    const tabParam = new URLSearchParams(window.location.search).get('t');
    const initialTab = tabParam === 'converter' ? 'converter' : 'tracker';
    showTab(initialTab);
    renderTracker();
    if (getDriveAutoconnectEnabled()) {
      connectGoogleDrive('silent').catch((e) => {
        console.error('Auto-connect failed:', e);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onPageReady);
  } else {
    onPageReady();
  }

})();
