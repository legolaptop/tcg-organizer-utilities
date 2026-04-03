'use strict';

/**
 * Generates a stable unique key for a card line item within an order.
 * cardSeller differentiates cards in Direct orders from multiple sellers;
 * price handles edge cases where the same card appears twice at different prices.
 *
 * @param {{ name: string, set: string, condition: string, price: number, cardSeller: string }} card
 * @returns {string}
 */
function cardKey(card) {
  return `${card.name}|${card.set}|${card.condition}|${card.price}|${card.cardSeller}`;
}

/**
 * Groups active (non-canceled) orders by their estimatedDelivery date string,
 * sorted chronologically.
 *
 * @param {Array<{canceled: boolean, estimatedDelivery: string}>} orders
 * @returns {Map<string, Array>}
 */
function groupOrdersByDate(orders) {
  const groups = new Map();
  const active = orders.filter(o => !o.canceled);

  active.forEach(order => {
    const key = order.estimatedDelivery;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(order);
  });

  return new Map(
    [...groups.entries()].sort(
      ([a], [b]) => new Date(a).getTime() - new Date(b).getTime()
    )
  );
}

/**
 * Returns the display status for an order.
 *
 * @param {{ estimatedDelivery: string, shippingConfirmed: boolean, trackingNumber: string|null }} order
 * @param {Date} today
 * @returns {'overdue' | 'unconfirmed' | 'tracked' | 'standard'}
 */
function getOrderStatus(order, today) {
  const est = new Date(order.estimatedDelivery);
  if (est < today) return 'overdue';
  if (!order.shippingConfirmed) return 'unconfirmed';
  if (order.trackingNumber) return 'tracked';
  return 'standard';
}

/**
 * Returns a group label based on the estimated delivery date vs today.
 *
 * @param {string} dateStr
 * @param {Date} today
 * @returns {'Overdue' | 'Soon' | 'Incoming'}
 */
function getGroupLabel(dateStr, today) {
  const est = new Date(dateStr);
  if (est < today) return 'Overdue';
  const diffMs = est.getTime() - today.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays <= 3) return 'Soon';
  return 'Incoming';
}

/**
 * Returns summary statistics for the tracker view.
 *
 * @param {Array} orders
 * @param {Object} state - TrackerState keyed by order id
 * @param {Date} today
 * @returns {{ total: number, received: number, overdue: number, unconfirmed: number }}
 */
function getStats(orders, state, today) {
  const active = orders.filter(o => !o.canceled);
  return {
    total: active.length,
    received: active.filter(o => state[o.id] && state[o.id].received).length,
    overdue: active.filter(o =>
      !(state[o.id] && state[o.id].received) && new Date(o.estimatedDelivery) < today
    ).length,
    unconfirmed: active.filter(o =>
      !(state[o.id] && state[o.id].received) && !o.shippingConfirmed
    ).length,
  };
}

/**
 * Returns card items from received orders, excluding cards marked canceled or missing.
 *
 * @param {Array} orders
 * @param {Object} state - TrackerState
 * @returns {Array}
 */
function getReceivedCards(orders, state) {
  return orders
    .filter(o => !o.canceled && state[o.id] && state[o.id].received)
    .flatMap(o => {
      const cardStates = (state[o.id] && state[o.id].cards) || {};
      return o.cards.filter(card => {
        const cs = cardStates[cardKey(card)];
        return !cs || (!cs.canceled && !cs.missing);
      });
    });
}

/**
 * Returns a new state with the received flag updated for an order.
 *
 * @param {Object} state
 * @param {string} orderId
 * @param {boolean} received
 * @returns {Object}
 */
function markReceived(state, orderId, received) {
  return { ...state, [orderId]: { ...state[orderId], received } };
}

/**
 * Returns a new state with the note updated for an order.
 *
 * @param {Object} state
 * @param {string} orderId
 * @param {string} note
 * @returns {Object}
 */
function saveNote(state, orderId, note) {
  return { ...state, [orderId]: { ...state[orderId], note } };
}

/**
 * Returns a new state with the card state updated for a specific card within an order.
 * Toggling one state (canceled/missing) clears the other.
 *
 * @param {Object} state
 * @param {string} orderId
 * @param {string} key - cardKey value
 * @param {{ canceled?: boolean, missing?: boolean }} update
 * @returns {Object}
 */
function setCardState(state, orderId, key, update) {
  const existing = state[orderId] || { received: false };
  const existingCards = existing.cards || {};
  return {
    ...state,
    [orderId]: {
      ...existing,
      cards: {
        ...existingCards,
        [key]: { canceled: false, missing: false, ...existingCards[key], ...update },
      },
    },
  };
}

module.exports = {
  cardKey,
  groupOrdersByDate,
  getOrderStatus,
  getGroupLabel,
  getStats,
  getReceivedCards,
  markReceived,
  saveNote,
  setCardState,
};
