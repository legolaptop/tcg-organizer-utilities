'use strict';

const { parseRowsFromHtml, isFullyRefunded } = require('./htmlParser');

// ─── JSDoc type definitions ───────────────────────────────────────────────────

/**
 * @typedef {Object} CardItem
 * @property {string}  name       - e.g. "Bloodstained Mire"
 * @property {string}  set        - e.g. "Modern Horizons 3"
 * @property {string}  condition  - e.g. "Near Mint", "Lightly Played Foil"
 * @property {number}  price      - per-card unit price
 * @property {number}  quantity
 * @property {boolean} foil
 * @property {string}  cardSeller - per-card seller for Direct orders; falls back
 *                                  to the order-level seller for regular orders
 */

/**
 * @typedef {Object} Order
 * @property {string}      id
 * @property {string}      date
 * @property {string}      seller
 * @property {number}      total
 * @property {string}      estimatedDelivery
 * @property {string|null} trackingNumber
 * @property {boolean}     shippingConfirmed
 * @property {boolean}     canceled
 * @property {number|null} partialRefund
 * @property {CardItem[]}  cards
 */

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Strip HTML tags from a string.
 * @param {string} html
 * @returns {string}
 */
function stripTags(html) {
  const out = [];
  let inTag = false;
  for (let i = 0; i < html.length; i++) {
    if (html[i] === '<') { inTag = true; continue; }
    if (html[i] === '>') { inTag = false; continue; }
    if (!inTag) out.push(html[i]);
  }
  return out.join('');
}

/**
 * Returns the inner text of the first element whose `data-aid` attribute
 * matches `aidValue` (case-insensitive), or null if not found.
 *
 * @param {string} html
 * @param {string} aidValue
 * @returns {string|null}
 */
function textByDataAid(html, aidValue) {
  const re = new RegExp(
    `data-aid=['"]${aidValue}['"][^>]*>([\\s\\S]*?)<\\/`,
    'i'
  );
  const m = html.match(re);
  if (!m) return null;
  const text = stripTags(m[1]).trim();
  return text || null;
}

/**
 * Parses a partial-refund alert from the preceding HTML and returns the
 * refund amount in dollars, or null if no partial-refund alert is present.
 *
 * Relies on the TCGPlayer `data-aid="div-sellerorderwidget-partialrefund"`
 * attribute to locate the alert element.
 *
 * @param {string} html
 * @returns {number|null}
 */
function parsePartialRefund(html) {
  if (!/data-aid=['"]div-sellerorderwidget-partialrefund['"]/i.test(html)) return null;
  const re = /data-aid=['"]div-sellerorderwidget-partialrefund['"][^>]*>([\s\S]*?)<\/div>/i;
  const m = html.match(re);
  if (!m) return null;
  const text = stripTags(m[1]);
  const amountMatch = text.match(/\$\s*([\d,]+(?:\.[0-9]{1,2})?)/);
  if (!amountMatch) return null;
  const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
  return isNaN(amount) ? null : amount;
}

/**
 * Returns true when the preceding HTML indicates a canceled order.
 *
 * TCGPlayer marks canceled orders with
 * `data-aid="div-sellerorderwidget-canceledorder"`.
 *
 * @param {string} html
 * @returns {boolean}
 */
function isCanceled(html) {
  return /data-aid=['"]div-sellerorderwidget-canceledorder['"]/i.test(html);
}

/**
 * Extracts order-level metadata from the HTML that precedes an orderTable.
 *
 * Assumptions about TCGPlayer HTML structure (based on the `data-aid` naming
 * convention observed in the existing codebase):
 * - Order ID    : `data-orderid` attribute on a wrapper div, or a
 *                 `data-aid="div-sellerorderwidget-orderid"` element, or
 *                 bare text matching the TCGPlayer order-number pattern
 *                 (e.g. "D15EE6BF-9B4455-9D46F").
 * - Seller      : `data-aid="div-sellerorderwidget-sellerinfo"` element.
 * - Order date  : `data-aid="div-sellerorderwidget-orderdate"` element.
 * - Delivery    : `data-aid="div-sellerorderwidget-estimateddelivery"` element.
 * - Total       : `data-aid="div-sellerorderwidget-ordertotal"` element.
 * - Tracking    : `data-aid="div-sellerorderwidget-tracking"` element
 *                 (null when element is absent or empty).
 * - Shipping    : absence of "Shipping Not Confirmed" text or
 *                 `data-aid="div-sellerorderwidget-shippingnotconfirmed"`.
 *
 * @param {string} html
 * @returns {{ id: string, seller: string, date: string, total: number,
 *             estimatedDelivery: string, trackingNumber: string|null,
 *             shippingConfirmed: boolean, partialRefund: number|null }}
 */
function extractOrderMeta(html, orderIndex = 0) {
  // ── Order ID ────────────────────────────────────────────────
  let id =
    (html.match(/data-orderid=['"]([^'"]+)['"]/i) ||
     html.match(/data-aid=['"]div-sellerorderwidget-orderid['"][^>]*>[^<]*<[^>]*>([^<]+)/i))?.[1] ||
    null;

  // Fallback: scan plain text for a TCGPlayer order-number pattern
  if (!id) {
    const textContent = stripTags(html);
    const m = textContent.match(/\b([A-Z0-9]{6,8}-[A-Z0-9]{6}-[A-Z0-9]{5})\b/);
    if (m) id = m[1];
  }

  if (!id) id = `UNKNOWN-${orderIndex}`;

  // ── Seller ──────────────────────────────────────────────────
  const seller =
    textByDataAid(html, 'div-sellerorderwidget-sellerinfo') ||
    textByDataAid(html, 'div-sellerorderwidget-sellername') ||
    'Unknown';

  // ── Order date ──────────────────────────────────────────────
  const date =
    textByDataAid(html, 'div-sellerorderwidget-orderdate') ||
    '';

  // ── Total ───────────────────────────────────────────────────
  const totalRaw =
    textByDataAid(html, 'div-sellerorderwidget-ordertotal') || '';
  const totalMatch = totalRaw.match(/\$?\s*([\d,]+(?:\.[0-9]{1,2})?)/);
  const total = totalMatch ? parseFloat(totalMatch[1].replace(/,/g, '')) : 0;

  // ── Estimated delivery ──────────────────────────────────────
  const estimatedDelivery =
    textByDataAid(html, 'div-sellerorderwidget-estimateddelivery') ||
    '';

  // ── Tracking ────────────────────────────────────────────────
  const trackingRaw = textByDataAid(html, 'div-sellerorderwidget-tracking');
  const trackingNumber = trackingRaw ? trackingRaw.trim() || null : null;

  // ── Shipping confirmed ──────────────────────────────────────
  const shippingNotConfirmed =
    /data-aid=['"]div-sellerorderwidget-shippingnotconfirmed['"]/i.test(html) ||
    /shipping\s+not\s+confirmed/i.test(stripTags(html));
  const shippingConfirmed = !shippingNotConfirmed;

  // ── Partial refund ──────────────────────────────────────────
  const partialRefund = parsePartialRefund(html);

  return {
    id,
    seller,
    date,
    total: isNaN(total) ? 0 : total,
    estimatedDelivery,
    trackingNumber,
    shippingConfirmed,
    partialRefund,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns a stable composite key for a card item.
 *
 * Combines fields that uniquely identify a card line item within an order.
 * `cardSeller` differentiates cards in Direct orders sold by multiple sellers;
 * `price` handles the edge case where the same card appears twice at different
 * prices.
 *
 * @param {CardItem} card
 * @returns {string}
 */
function cardKey(card) {
  return `${card.name}|${card.set}|${card.condition}|${card.price}|${card.cardSeller}`;
}

/**
 * Parses a TCGPlayer order-history HTML page into an array of Order objects.
 *
 * Each `<table class="orderTable">` in the HTML is treated as a single order.
 * The HTML preceding each table is scanned for:
 *   - full-refund alerts  (order skipped entirely)
 *   - canceled-order indicators (order included with `canceled: true`)
 *   - order metadata (id, seller, dates, totals, tracking, partial refund)
 *
 * For TCGplayer Direct orders, `cardSeller` on each CardItem is populated from
 * the "Sold by X" text in the orderHistoryDetail cell (parsed by htmlParser).
 * For regular marketplace orders, `cardSeller` falls back to the order-level
 * seller name.
 *
 * @param {string} htmlText - Raw HTML / MHT content.
 * @returns {Order[]}
 */
function parseOrdersFromHtml(htmlText) {
  if (!htmlText) return [];

  const orders = [];
  const tableRegex = /<table\b[^>]*class="orderTable"[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  let lastEnd = 0;
  let orderIndex = 0;

  while ((tableMatch = tableRegex.exec(htmlText)) !== null) {
    const precedingHtml = htmlText.slice(lastEnd, tableMatch.index);
    lastEnd = tableMatch.index + tableMatch[0].length;

    // Skip fully-refunded orders (they contain no fulfillable cards)
    if (isFullyRefunded(precedingHtml)) continue;

    const canceled = isCanceled(precedingHtml);
    const meta = extractOrderMeta(precedingHtml, orderIndex);

    // Parse raw card rows from the table
    const rawItems = parseRowsFromHtml(tableMatch[1]);

    // Map raw items → CardItem, applying cardSeller fallback
    const cards = rawItems.map((item) => ({
      name: item.title || '',
      set: item.setName || '',
      condition: item.condition || 'Near Mint',
      price: item.unitPrice != null ? item.unitPrice : 0,
      quantity: item.quantity || 1,
      foil: item.foil ?? false,
      // Per-card seller (Direct orders) or order-level seller (marketplace)
      cardSeller: item.cardSeller || meta.seller,
    }));

    orders.push({
      id: meta.id,
      date: meta.date,
      seller: meta.seller,
      total: meta.total,
      estimatedDelivery: meta.estimatedDelivery,
      trackingNumber: meta.trackingNumber,
      shippingConfirmed: meta.shippingConfirmed,
      canceled,
      partialRefund: meta.partialRefund,
      cards,
    });
    orderIndex++;
  }

  return orders;
}

/**
 * Reads a File (browser API) and parses its contents as order-history HTML.
 *
 * Intended for use in browser environments. In Node.js tests, call
 * `parseOrdersFromHtml` directly with a string.
 *
 * @param {File} file
 * @returns {Promise<Order[]>}
 */
function parseMht(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(parseOrdersFromHtml(String(reader.result || '')));
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsText(file);
  });
}

module.exports = {
  cardKey,
  parseOrdersFromHtml,
  parseMht,
  // Exported for testing
  extractOrderMeta,
  parsePartialRefund,
  isCanceled,
};
