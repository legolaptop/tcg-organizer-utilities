'use strict';

const { parseOrdersFromHtml } = require('./orderParser');
const { debouncedSave } = require('./driveSync');

// ─── JSDoc type definitions ───────────────────────────────────────────────────

/**
 * @typedef {import('./orderParser').Order}        Order
 * @typedef {import('./driveSync').TrackerState}   TrackerState
 */

/**
 * @typedef {Object} ShippingUpdate
 * @property {string}      orderId
 * @property {string|null} trackingNumber
 * @property {boolean}     shippingConfirmed
 */

/**
 * @typedef {Object} MhtUploadResult
 * @property {Order[]}  freshOrders   - All orders parsed from the new MHT
 * @property {number}   updatedCount  - Number of orders whose shipping status changed
 * @property {number}   newOrderCount - Number of order IDs not seen in existingOrders
 */

// ─── Diff logic ───────────────────────────────────────────────────────────────

/**
 * Compares shipping fields between the previous and fresh order lists and
 * returns an update record for every order whose tracking number or
 * `shippingConfirmed` flag has changed.
 *
 * New orders (IDs not present in `previousOrders`) are skipped — they are
 * surfaced separately via `MhtUploadResult.newOrderCount`.
 *
 * @param {Order[]} previousOrders
 * @param {Order[]} freshOrders
 * @returns {ShippingUpdate[]}
 */
function diffShippingStatus(previousOrders, freshOrders) {
  const updates = [];

  freshOrders.forEach((fresh) => {
    const prev = previousOrders.find((o) => o.id === fresh.id);
    if (!prev) return; // New order — handled separately

    const trackingChanged = fresh.trackingNumber !== prev.trackingNumber;
    const confirmedChanged = fresh.shippingConfirmed !== prev.shippingConfirmed;

    if (trackingChanged || confirmedChanged) {
      updates.push({
        orderId: fresh.id,
        trackingNumber: fresh.trackingNumber,
        shippingConfirmed: fresh.shippingConfirmed,
      });
    }
  });

  return updates;
}

/**
 * Merges a set of shipping updates into the existing tracker state and the
 * in-memory orders array.
 *
 * Rules:
 * - Orders already marked `received: true` in the state are never modified.
 * - Only `trackingNumber` and `shippingConfirmed` are updated; `received`,
 *   `note`, and per-card state are left untouched.
 *
 * @param {TrackerState}    state
 * @param {ShippingUpdate[]} updates
 * @param {Order[]}          orders - mutated in-place (tracking / confirmed fields)
 * @returns {{ newState: TrackerState, updatedCount: number }}
 */
function applyShippingUpdates(state, updates, orders) {
  const newState = { ...state };

  updates.forEach((update) => {
    // Never overwrite a manually received order
    if (newState[update.orderId]?.received) return;

    // Update the in-memory order object
    const order = orders.find((o) => o.id === update.orderId);
    if (order) {
      order.trackingNumber = update.trackingNumber;
      order.shippingConfirmed = update.shippingConfirmed;
    }
  });

  return { newState, updatedCount: updates.length };
}

/**
 * Handles an MHT file upload:
 * 1. Parses the file into a fresh Order array.
 * 2. Diffs shipping status against the existing orders.
 * 3. Applies updates (without touching `received` or `note`).
 * 4. Persists updated state to Drive if anything changed.
 *
 * Intended to be wired directly to the file-upload event in the UI layer.
 * The caller is responsible for providing the current `accessToken`.
 *
 * @param {string}        htmlText       - Raw HTML/MHT text content
 * @param {Order[]}       existingOrders - Current in-memory orders (mutated in place)
 * @param {TrackerState}  state          - Current tracker state
 * @param {string}        accessToken    - Google OAuth access token
 * @returns {Promise<MhtUploadResult>}
 */
async function onMhtUpload(htmlText, existingOrders, state, accessToken) {
  // 1. Parse the new MHT
  const freshOrders = parseOrdersFromHtml(htmlText);

  // 2. Detect new order IDs (present in fresh but not in existing)
  const existingIds = new Set(existingOrders.map((o) => o.id));
  const newOrderCount = freshOrders.filter((o) => !existingIds.has(o.id)).length;

  // 3. Diff shipping status for known orders
  const updates = diffShippingStatus(existingOrders, freshOrders);

  // 4. Apply updates (mutates existingOrders in place)
  const { newState, updatedCount } = applyShippingUpdates(state, updates, existingOrders);

  // 5. Persist to Drive if anything changed
  if (updatedCount > 0) {
    await debouncedSave(newState, accessToken);
  }

  return { freshOrders, updatedCount, newOrderCount };
}

module.exports = {
  diffShippingStatus,
  applyShippingUpdates,
  onMhtUpload,
};
