'use strict';

/**
 * Extract plain text from an HTML string by discarding all tag content.
 * Iterates character-by-character to correctly handle any tag nesting.
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
 * Returns true when the HTML snippet contains a full-refund alert for the
 * corresponding order (indicated by data-aid="div-sellerorderwidget-singlerefund").
 *
 * @param {string} html
 * @returns {boolean}
 */
function isFullyRefunded(html) {
  return /data-aid=['"]div-sellerorderwidget-singlerefund['"]/i.test(html);
}

/**
 * Parse the <tr> rows within a single HTML fragment and return card items.
 * Only rows containing an orderHistoryItems cell are processed.
 *
 * @param {string} tableHtml
 * @returns {Array<{
 *   tcgplayerId: string|null,
 *   title: string|null,
 *   setName: string|null,
 *   quantity: number,
 *   condition: string|null,
 *   foil: boolean,
 *   unitPrice: number|null,
 *   totalPrice: number|null,
 *   rarity: string|null
 * }>}
 */
function parseRowsFromHtml(tableHtml) {
  const items = [];

  // Match each <tr> block; skip header rows by requiring an orderHistoryItems cell.
  const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;

  while ((trMatch = trRegex.exec(tableHtml)) !== null) {
    const rowHtml = trMatch[1];

    // Only process data rows that contain the items cell class.
    if (!rowHtml.includes('orderHistoryItems')) continue;

    const item = {
      tcgplayerId: null,
      title: null,
      setName: null,
      quantity: 1,
      condition: null,
      foil: false,
      unitPrice: null,
      totalPrice: null,
      rarity: null,
    };

    // ── tcgplayerId ─────────────────────────────────────────────
    // Prefer data-original attribute (lazy-loaded thumbnails), fall back to src.
    const imgDataOrig = rowHtml.match(/data-original="[^"]*\/product\/(\d+)_/i);
    if (imgDataOrig) {
      item.tcgplayerId = imgDataOrig[1];
    } else {
      const imgSrc = rowHtml.match(/src="[^"]*\/product\/(\d+)_/i);
      if (imgSrc) item.tcgplayerId = imgSrc[1];
    }

    // Final fallback: extract id from anchor href.
    if (!item.tcgplayerId) {
      const hrefMatch = rowHtml.match(/href="[^"]*\/product\/(\d+)(?!\d)/i);
      if (hrefMatch) item.tcgplayerId = hrefMatch[1];
    }

    // ── title ───────────────────────────────────────────────────
    // The <a> tag's title attribute is the most reliable source.
    const aTitleAttr = rowHtml.match(/<a\b[^>]+\btitle="([^"]+)"/i);
    if (aTitleAttr) {
      item.title = aTitleAttr[1].trim();
    } else {
      const aText = rowHtml.match(/<a\b[^>]+class="nocontext"[^>]*>([\s\S]*?)<\/a>/i);
      if (aText) item.title = stripTags(aText[1]).trim() || null;
    }

    // ── setName ─────────────────────────────────────────────────
    // Text content after the <br> inside the anchor's parent <span>.
    const spanMatch = rowHtml.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i);
    if (spanMatch) {
      const parts = spanMatch[1].split(/<br\s*\/?>/i);
      if (parts.length >= 2) {
        const rawSet = stripTags(parts[parts.length - 1]).trim();
        item.setName = rawSet || null;
      }
    }

    // ── rarity / condition / foil ────────────────────────────────
    const detailMatch = rowHtml.match(/<td\b[^>]*class="orderHistoryDetail"[^>]*>([\s\S]*?)<\/td>/i);
    if (detailMatch) {
      const detailText = detailMatch[1].replace(/<br\s*\/?>/gi, '\n');
      const lines = stripTags(detailText).split('\n').map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (/^rarity\s*:/i.test(line)) {
          item.rarity = line.split(':').slice(1).join(':').trim() || null;
        } else if (/^condition\s*:/i.test(line)) {
          let cond = line.split(':').slice(1).join(':').trim();
          if (/\bfoil\b/i.test(cond)) {
            item.foil = true;
            cond = cond.replace(/\bfoil\b/gi, '').trim();
          }
          item.condition = cond || null;
        }
      }
    }

    // ── unitPrice ────────────────────────────────────────────────
    const priceMatch = rowHtml.match(/<td\b[^>]*class="orderHistoryPrice"[^>]*>([\s\S]*?)<\/td>/i);
    if (priceMatch) {
      const priceText = stripTags(priceMatch[1]).trim();
      const numMatch = priceText.match(/\$?\s*([0-9,]+(?:\.[0-9]{1,2})?)/);
      if (numMatch) {
        const parsed = parseFloat(numMatch[1].replace(/,/g, ''));
        if (!isNaN(parsed)) item.unitPrice = parsed;
      }
    }

    // ── quantity ─────────────────────────────────────────────────
    const qtyMatch = rowHtml.match(/<td\b[^>]*class="orderHistoryQuantity"[^>]*>([\s\S]*?)<\/td>/i);
    if (qtyMatch) {
      const qtyText = stripTags(qtyMatch[1]).trim();
      const num = parseInt(qtyText, 10);
      if (!isNaN(num) && num > 0) item.quantity = num;
    }

    // ── totalPrice ───────────────────────────────────────────────
    if (item.unitPrice !== null) {
      item.totalPrice = parseFloat((item.unitPrice * item.quantity).toFixed(2));
    }

    // Skip rows with no identifiable product id AND no price (likely malformed).
    if (item.tcgplayerId === null && item.unitPrice === null) continue;

    items.push(item);
  }

  return items;
}

/**
 * Parse a TCGPlayer order-history HTML page into an array of card items.
 *
 * Accepts the raw HTML string of an order page (or the full .mht/.mhtml body).
 * Locates each <table class="orderTable"> element and checks whether the HTML
 * immediately preceding it contains a full-refund alert; if so, that order is
 * skipped entirely. For each non-refunded order table the per-card details are
 * extracted from the well-known TCGPlayer column structure (orderHistoryItems,
 * orderHistoryDetail, orderHistoryPrice, orderHistoryQuantity).
 *
 * Cards from different orders are never combined: each order row is returned
 * as its own item so that per-order purchase prices are preserved.
 *
 * Falls back to searching all <tr> elements in the input when no
 * <table class="orderTable"> wrappers are found (supports bare HTML snippets).
 *
 * @param {string} htmlText - Raw HTML string.
 * @returns {Array<{
 *   tcgplayerId: string|null,
 *   title: string|null,
 *   setName: string|null,
 *   quantity: number,
 *   condition: string|null,
 *   foil: boolean,
 *   unitPrice: number|null,
 *   totalPrice: number|null,
 *   rarity: string|null
 * }>}
 */
function parseOrderTableHtml(htmlText) {
  if (!htmlText) return [];

  const items = [];

  // Find each <table class="orderTable"> block.  For each one, inspect the
  // HTML that precedes it (since the last table) for a full-refund alert and
  // skip the table if found.
  const tableRegex = /<table\b[^>]*class="orderTable"[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  let foundTable = false;
  let lastEnd = 0;

  while ((tableMatch = tableRegex.exec(htmlText)) !== null) {
    foundTable = true;
    const precedingHtml = htmlText.slice(lastEnd, tableMatch.index);
    lastEnd = tableMatch.index + tableMatch[0].length;

    if (isFullyRefunded(precedingHtml)) continue;

    items.push(...parseRowsFromHtml(tableMatch[1]));
  }

  if (foundTable) return items;

  // Fallback: no <table class="orderTable"> wrappers found; search all <tr>
  // elements directly (supports bare HTML snippets used in tests and edge cases).
  return parseRowsFromHtml(htmlText);
}

module.exports = { parseOrderTableHtml, isFullyRefunded };
