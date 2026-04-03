'use strict';

/**
 * Compares shipping status between previous and fresh order lists.
 * Returns shipping updates for orders where tracking or confirmation status changed.
 *
 * @param {Array<{id: string, trackingNumber: string|null, shippingConfirmed: boolean}>} previousOrders
 * @param {Array<{id: string, trackingNumber: string|null, shippingConfirmed: boolean}>} freshOrders
 * @returns {Array<{orderId: string, trackingNumber: string|null, shippingConfirmed: boolean}>}
 */
function diffShippingStatus(previousOrders, freshOrders) {
  const updates = [];

  freshOrders.forEach(fresh => {
    const prev = previousOrders.find(o => o.id === fresh.id);
    if (!prev) return; // New order not previously seen — no diff needed

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
 * Applies shipping updates to in-memory order objects. Never overwrites
 * orders that the user has already marked as received.
 *
 * @param {Object} state - TrackerState
 * @param {Array<{orderId: string, trackingNumber: string|null, shippingConfirmed: boolean}>} updates
 * @param {Array} orders - Mutable order objects (mutated in place)
 * @returns {{ newState: Object, updatedCount: number }}
 */
function applyShippingUpdates(state, updates, orders) {
  const newState = { ...state };
  let updatedCount = 0;

  updates.forEach(update => {
    // Never overwrite a manually received order
    if (newState[update.orderId] && newState[update.orderId].received) return;

    const order = orders.find(o => o.id === update.orderId);
    if (order) {
      order.trackingNumber = update.trackingNumber;
      order.shippingConfirmed = update.shippingConfirmed;
      updatedCount++;
    }
  });

  return { newState, updatedCount };
}

module.exports = { diffShippingStatus, applyShippingUpdates };
