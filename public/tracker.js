'use strict';

/* ============================================================
   Order Tracker — browser-side UI
   Depends on: Google Identity Services (loaded in index.html)
   ============================================================ */

(function () {

  // ── Configuration ────────────────────────────────────────────
  // Replace with your Google OAuth 2.0 client ID from the Google Cloud Console.
  // Required scope: https://www.googleapis.com/auth/drive.appdata
  const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID';
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const DRIVE_FILE_NAME = 'tcg-tracker-state.json';
  const DRIVE_SPACE = 'appDataFolder';
  const SAVE_DEBOUNCE_MS = 500;

  // ── App state ─────────────────────────────────────────────────
  let accessToken = null;
  let driveFileId = null;
  let trackerState = {};   // TrackerState: Record<orderId, OrderState>
  let orders = [];         // Order[]
  let activeFilter = 'all';
  let saveTimer = null;

  // ── DOM references ────────────────────────────────────────────
  const navConverter = document.getElementById('nav-converter');
  const navTracker = document.getElementById('nav-tracker');
  const converterSection = document.getElementById('converter-section');
  const trackerSection = document.getElementById('tracker-section');

  const trackerAuth = document.getElementById('tracker-auth');
  const signInBtn = document.getElementById('tracker-sign-in-btn');
  const authError = document.getElementById('tracker-auth-error');

  const trackerContent = document.getElementById('tracker-content');
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

  // ── Google OAuth ──────────────────────────────────────────────

  signInBtn.addEventListener('click', () => {
    if (!window.google) {
      showAuthError('Google Identity Services library not loaded. Check your network connection.');
      return;
    }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: async (response) => {
        if (response.error) {
          showAuthError('Sign-in failed: ' + response.error);
          return;
        }
        accessToken = response.access_token;
        await onSignedIn();
      },
    });
    client.requestAccessToken();
  });

  function showAuthError(msg) {
    authError.textContent = msg;
    authError.hidden = false;
  }

  async function onSignedIn() {
    authError.hidden = true;
    signInBtn.textContent = 'Signed in ✓';
    signInBtn.disabled = true;
    trackerAuth.hidden = false;

    try {
      trackerState = await loadStateFromDrive();
    } catch (e) {
      console.error('Failed to load state from Drive:', e);
      trackerState = {};
    }

    trackerContent.hidden = false;
    renderTracker();
  }

  // ── Drive persistence ─────────────────────────────────────────

  async function loadStateFromDrive() {
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?spaces=${DRIVE_SPACE}&q=name%3D'${DRIVE_FILE_NAME}'&fields=files(id)`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8000) }
    );
    if (!searchRes.ok) throw new Error(`Drive search failed: ${searchRes.status}`);

    const { files } = await searchRes.json();
    if (!files || files.length === 0) return {};

    driveFileId = files[0].id;

    const contentRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8000) }
    );
    if (!contentRes.ok) throw new Error(`Drive read failed: ${contentRes.status}`);
    return await contentRes.json();
  }

  async function saveStateToDrive() {
    if (!accessToken) return;
    const body = JSON.stringify(trackerState);

    try {
      if (driveFileId) {
        const res = await fetch(
          `https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${accessToken}`,
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
            headers: { Authorization: `Bearer ${accessToken}` },
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
      showUploadMsg('Please select one or more MHT files.', true);
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
        freshOrders.push(...parseMhtIntoOrders(text));
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
      orders = [...orders, ...newOrders].filter(o => !o.canceled);

      const parts = [];
      if (newOrders.length > 0) parts.push(`${newOrders.length} new order(s) added`);
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

  // ── MHT → Order parser ────────────────────────────────────────
  // Parses TCGPlayer order-history HTML/MHT files into Order objects.

  function parseMhtIntoOrders(htmlText) {
    if (!htmlText) return [];

    // Find each order block.  TCGPlayer wraps each order in a div with
    // data-aid="div-sellerorderwidget-ordercontainer" (or similar).
    // We split on per-order section markers and parse each chunk.
    const orderBlocks = splitIntoOrderBlocks(htmlText);
    if (orderBlocks.length === 0) {
      // Fallback: treat the whole text as a single order block
      return [parseOrderBlock(htmlText, 'UNKNOWN')].filter(Boolean);
    }
    return orderBlocks.map(block => parseOrderBlock(block.html, block.hint)).filter(Boolean);
  }

  function splitIntoOrderBlocks(html) {
    const blocks = [];
    // Try to split on order container divs
    const containerRegex = /<div\b[^>]*data-aid=['"]div-sellerorderwidget-ordercontainer['"][^>]*>([\s\S]*?)(?=<div\b[^>]*data-aid=['"]div-sellerorderwidget-ordercontainer['"]|$)/gi;
    let m;
    while ((m = containerRegex.exec(html)) !== null) {
      blocks.push({ html: m[0], hint: '' });
    }
    if (blocks.length > 0) return blocks;

    // Alternate: split on <table class="orderTable"> — each represents one order
    const tableRegex = /(<div[^>]*>[\s\S]{0,2000}?<table\b[^>]*class="orderTable"[^>]*>[\s\S]*?<\/table>[\s\S]{0,500}?<\/div>)/gi;
    while ((m = tableRegex.exec(html)) !== null) {
      blocks.push({ html: m[1], hint: '' });
    }
    return blocks;
  }

  function parseOrderBlock(html, _hint) {
    // ── Order ID ─────────────────────────────────────────────────
    const idMatch = html.match(/Order\s+#?\s*([A-Z0-9]{6,}-[A-Z0-9]+-[A-Z0-9]+)/i)
      || html.match(/data-order(?:id|number)=['"]([^'"]+)['"]/i)
      || html.match(/order(?:id|number)['":\s]+([A-Z0-9]{6,}-[A-Z0-9]+-[A-Z0-9]+)/i);
    const id = idMatch ? idMatch[1].trim() : ('ORDER-' + Math.random().toString(36).slice(2, 10).toUpperCase());

    // ── Seller ────────────────────────────────────────────────────
    const sellerMatch = html.match(/Sold by[:\s]+([^\n<,]+)/i)
      || html.match(/seller[:\s]+([^\n<,]{2,60})/i);
    const seller = sellerMatch ? sellerMatch[1].trim() : 'Unknown Seller';

    // ── Order date ────────────────────────────────────────────────
    const dateMatch = html.match(/Order\s+(?:Date|Placed)[:\s]+([A-Z][a-z]+ \d{1,2},\s*\d{4})/i)
      || html.match(/Placed[:\s]+([A-Z][a-z]+ \d{1,2},\s*\d{4})/i);
    const date = dateMatch ? dateMatch[1].trim() : new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    // ── Estimated delivery ────────────────────────────────────────
    const deliveryMatch = html.match(/(?:Estimated|Est\.?)\s+(?:Delivery|Arrival|Ship)[:\s]+([A-Z][a-z]+ \d{1,2},\s*\d{4})/i)
      || html.match(/(?:Delivery|Arrives?)\s+by\s+([A-Z][a-z]+ \d{1,2},\s*\d{4})/i)
      || html.match(/(?:Estimated|Est\.?)\s+(?:Delivery|Arrival)[:\s]+([A-Z][a-z]+ \d{1,2}\s*[-–]\s*\d{1,2},\s*\d{4})/i);
    // Default estimated delivery: 7 days from today
    const defaultDelivery = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const estimatedDelivery = deliveryMatch ? deliveryMatch[1].trim() : defaultDelivery;

    // ── Tracking number ───────────────────────────────────────────
    const trackMatch = html.match(/(?:Track(?:ing)?(?:\s+Number)?)[:\s#]+([A-Z0-9]{10,40})/i);
    const trackingNumber = trackMatch ? trackMatch[1].trim() : null;

    // ── Shipping confirmed ────────────────────────────────────────
    const shippingConfirmed = !/Shipping Not Confirmed/i.test(html)
      && !/not\s+(?:yet\s+)?shipped/i.test(html);

    // ── Canceled ──────────────────────────────────────────────────
    const canceled = /(?:Order\s+)?Canceled|Refunded in Full/i.test(html)
      || /data-aid=['"]div-sellerorderwidget-singlerefund['"]/i.test(html);

    // ── Partial refund ────────────────────────────────────────────
    const refundMatch = html.match(/Partial\s+Refund[:\s]+\$?([\d.]+)/i)
      || html.match(/\$?([\d.]+)\s+partial\s+refund/i);
    const partialRefund = refundMatch ? parseFloat(refundMatch[1]) : null;

    // ── Order total ───────────────────────────────────────────────
    const totalMatch = html.match(/Order\s+Total[:\s]+\$?([\d,.]+)/i)
      || html.match(/Total[:\s]+\$\s*([\d,.]+)/i);
    const total = totalMatch ? parseFloat(totalMatch[1].replace(/,/g, '')) : 0;

    // ── Cards ─────────────────────────────────────────────────────
    const cards = parseCardsFromBlock(html, seller);

    if (cards.length === 0 && !canceled) return null;

    return {
      id,
      date,
      seller,
      total,
      estimatedDelivery,
      trackingNumber,
      shippingConfirmed,
      canceled,
      partialRefund,
      cards,
    };
  }

  function parseCardsFromBlock(html, orderSeller) {
    const cards = [];
    const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let m;

    while ((m = trRegex.exec(html)) !== null) {
      const row = m[1];
      if (!row.includes('orderHistoryItems')) continue;

      // title
      const titleMatch = row.match(/<a\b[^>]+\btitle="([^"]+)"/i)
        || row.match(/<a\b[^>]+class="nocontext"[^>]*>([\s\S]*?)<\/a>/i);
      const name = titleMatch ? stripTagsSimple(titleMatch[1]).trim() : null;
      if (!name) continue;

      // set name — text after <br> in the span
      let set = '';
      const spanM = row.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i);
      if (spanM) {
        const parts = spanM[1].split(/<br\s*\/?>/i);
        if (parts.length >= 2) set = stripTagsSimple(parts[parts.length - 1]).trim();
      }

      // condition / foil
      let condition = 'Near Mint';
      let foil = false;
      const detailM = row.match(/<td\b[^>]*class="orderHistoryDetail"[^>]*>([\s\S]*?)<\/td>/i);
      if (detailM) {
        const lines = stripTagsSimple(detailM[1].replace(/<br\s*\/?>/gi, '\n')).split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (/^condition\s*:/i.test(line)) {
            let cond = line.split(':').slice(1).join(':').trim();
            if (/\bfoil\b/i.test(cond)) { foil = true; cond = cond.replace(/\bfoil\b/gi, '').trim(); }
            condition = cond || 'Near Mint';
          }
        }
      }

      // price
      let price = 0;
      const priceM = row.match(/<td\b[^>]*class="orderHistoryPrice"[^>]*>([\s\S]*?)<\/td>/i);
      if (priceM) {
        const nm = stripTagsSimple(priceM[1]).match(/\$?\s*([0-9,]+(?:\.[0-9]{1,2})?)/);
        if (nm) price = parseFloat(nm[1].replace(/,/g, '')) || 0;
      }

      // quantity
      let quantity = 1;
      const qtyM = row.match(/<td\b[^>]*class="orderHistoryQuantity"[^>]*>([\s\S]*?)<\/td>/i);
      if (qtyM) {
        const n = parseInt(stripTagsSimple(qtyM[1]).trim(), 10);
        if (!isNaN(n) && n > 0) quantity = n;
      }

      // cardSeller — "Sold by X" after the card title
      let cardSeller = orderSeller;
      const soldByM = row.match(/Sold by\s+([^\n<]+)/i);
      if (soldByM) cardSeller = soldByM[1].trim();

      cards.push({ name, set, condition, price, quantity, foil, cardSeller });
    }

    return cards;
  }

  function stripTagsSimple(html) {
    const out = [];
    let inTag = false;
    for (let i = 0; i < html.length; i++) {
      if (html[i] === '<') { inTag = true; continue; }
      if (html[i] === '>') { inTag = false; continue; }
      if (!inTag) out.push(html[i]);
    }
    return out.join('');
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
    group.appendChild(header);

    for (const order of groupOrders) {
      group.appendChild(renderOrderCard(order, today));
    }

    return group;
  }

  function renderOrderCard(order, today) {
    const orderState = trackerState[order.id] || {};
    const status = getOrderStatus(order, today);
    const isReceived = !!orderState.received;

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

    info.appendChild(idEl);
    info.appendChild(sellerEl);
    if (order.total > 0) info.appendChild(totalEl);

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
      const tn = document.createElement('span');
      tn.className = 'order-card__tracking';
      tn.textContent = order.trackingNumber;
      badges.appendChild(tn);
    }

    // Expand/collapse button
    const expandBtn = document.createElement('button');
    expandBtn.className = 'order-card__expand-btn';
    expandBtn.setAttribute('aria-expanded', 'false');
    expandBtn.setAttribute('aria-label', `Toggle details for order ${order.id}`);
    expandBtn.textContent = '▸ Details';

    header.appendChild(receivedLabel);
    header.appendChild(info);
    header.appendChild(badges);
    header.appendChild(expandBtn);
    card.appendChild(header);

    // ── Body (expanded) ────────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'order-card__body';
    body.hidden = true;

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
      expandBtn.textContent = expanded ? '▸ Details' : '▾ Details';
      expandBtn.setAttribute('aria-expanded', String(!expanded));
    });

    return card;
  }

  function renderCardRow(card, key, orderId, cs) {
    const li = document.createElement('li');
    li.className = `card-row${cs.canceled ? ' card-row--canceled' : ''}${cs.missing ? ' card-row--missing' : ''}`;

    const name = document.createElement('span');
    name.className = 'card-row__name';
    name.textContent = `${card.name}`;

    const meta = document.createElement('span');
    meta.className = 'card-row__meta';
    meta.textContent = [card.set, card.condition, card.foil ? 'Foil' : '', card.price > 0 ? `$${card.price.toFixed(2)}` : '']
      .filter(Boolean).join(' · ');

    const controls = document.createElement('div');
    controls.className = 'card-row__controls';

    // Canceled checkbox
    const cancelLabel = document.createElement('label');
    cancelLabel.className = 'card-row__check-label';
    const cancelCb = document.createElement('input');
    cancelCb.type = 'checkbox';
    cancelCb.checked = cs.canceled;
    cancelCb.addEventListener('change', () => {
      setCardStateFn(orderId, key, { canceled: cancelCb.checked, missing: cancelCb.checked ? false : (trackerState[orderId] && trackerState[orderId].cards && trackerState[orderId].cards[key] ? trackerState[orderId].cards[key].missing : false) });
      debouncedSave();
      renderTracker();
    });
    cancelLabel.appendChild(cancelCb);
    cancelLabel.appendChild(document.createTextNode(' Canceled'));

    // Missing checkbox
    const missingLabel = document.createElement('label');
    missingLabel.className = 'card-row__check-label';
    const missingCb = document.createElement('input');
    missingCb.type = 'checkbox';
    missingCb.checked = cs.missing;
    missingCb.addEventListener('change', () => {
      setCardStateFn(orderId, key, { missing: missingCb.checked, canceled: missingCb.checked ? false : (trackerState[orderId] && trackerState[orderId].cards && trackerState[orderId].cards[key] ? trackerState[orderId].cards[key].canceled : false) });
      debouncedSave();
      renderTracker();
    });
    missingLabel.appendChild(missingCb);
    missingLabel.appendChild(document.createTextNode(' Missing'));

    controls.appendChild(cancelLabel);
    controls.appendChild(missingLabel);

    li.appendChild(name);
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

})();
