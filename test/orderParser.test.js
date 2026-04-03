'use strict';

const {
  cardKey,
  groupOrdersByDate,
  getOrderStatus,
  getGroupLabel,
  getStats,
  getReceivedCards,
  markReceived,
  saveNote,
  setCardState,
} = require('../src/orderParser');

// ── Fixture helpers ───────────────────────────────────────────

function makeCard(overrides = {}) {
  return {
    name: 'Bloodstained Mire',
    set: 'Modern Horizons 3',
    condition: 'Near Mint',
    price: 18.76,
    cardSeller: 'CCG Professionals',
    quantity: 1,
    foil: false,
    ...overrides,
  };
}

function makeOrder(overrides = {}) {
  return {
    id: 'ORDER-001',
    date: 'March 31, 2026',
    seller: 'CCG Professionals',
    total: 18.76,
    estimatedDelivery: 'April 14, 2026',
    trackingNumber: null,
    shippingConfirmed: true,
    canceled: false,
    partialRefund: null,
    cards: [makeCard()],
    ...overrides,
  };
}

// ── cardKey ────────────────────────────────────────────────────

describe('cardKey', () => {
  test('produces pipe-delimited composite key', () => {
    const card = makeCard();
    expect(cardKey(card)).toBe('Bloodstained Mire|Modern Horizons 3|Near Mint|18.76|CCG Professionals');
  });

  test('different sellers produce different keys', () => {
    const a = makeCard({ cardSeller: 'SellerA' });
    const b = makeCard({ cardSeller: 'SellerB' });
    expect(cardKey(a)).not.toBe(cardKey(b));
  });

  test('different prices produce different keys', () => {
    const a = makeCard({ price: 10.00 });
    const b = makeCard({ price: 11.00 });
    expect(cardKey(a)).not.toBe(cardKey(b));
  });

  test('different conditions produce different keys', () => {
    const a = makeCard({ condition: 'Near Mint' });
    const b = makeCard({ condition: 'Lightly Played' });
    expect(cardKey(a)).not.toBe(cardKey(b));
  });
});

// ── groupOrdersByDate ─────────────────────────────────────────

describe('groupOrdersByDate', () => {
  test('groups orders by estimatedDelivery date', () => {
    const orders = [
      makeOrder({ id: 'A', estimatedDelivery: 'April 14, 2026' }),
      makeOrder({ id: 'B', estimatedDelivery: 'April 14, 2026' }),
      makeOrder({ id: 'C', estimatedDelivery: 'April 20, 2026' }),
    ];
    const groups = groupOrdersByDate(orders);
    expect(groups.size).toBe(2);
    expect(groups.get('April 14, 2026').length).toBe(2);
    expect(groups.get('April 20, 2026').length).toBe(1);
  });

  test('sorts groups chronologically (earliest first)', () => {
    const orders = [
      makeOrder({ id: 'C', estimatedDelivery: 'April 20, 2026' }),
      makeOrder({ id: 'A', estimatedDelivery: 'April 10, 2026' }),
      makeOrder({ id: 'B', estimatedDelivery: 'April 14, 2026' }),
    ];
    const keys = [...groupOrdersByDate(orders).keys()];
    expect(keys).toEqual(['April 10, 2026', 'April 14, 2026', 'April 20, 2026']);
  });

  test('excludes canceled orders', () => {
    const orders = [
      makeOrder({ id: 'A', estimatedDelivery: 'April 14, 2026', canceled: false }),
      makeOrder({ id: 'B', estimatedDelivery: 'April 14, 2026', canceled: true }),
    ];
    const groups = groupOrdersByDate(orders);
    expect(groups.get('April 14, 2026').length).toBe(1);
    expect(groups.get('April 14, 2026')[0].id).toBe('A');
  });

  test('returns empty map when all orders are canceled', () => {
    const orders = [
      makeOrder({ canceled: true }),
      makeOrder({ id: 'B', canceled: true }),
    ];
    expect(groupOrdersByDate(orders).size).toBe(0);
  });

  test('returns empty map for empty input', () => {
    expect(groupOrdersByDate([]).size).toBe(0);
  });
});

// ── getOrderStatus ────────────────────────────────────────────

describe('getOrderStatus', () => {
  const today = new Date('2026-04-10T00:00:00Z');

  test('returns overdue when estimated delivery is in the past', () => {
    const order = makeOrder({ estimatedDelivery: 'April 5, 2026', shippingConfirmed: true });
    expect(getOrderStatus(order, today)).toBe('overdue');
  });

  test('returns unconfirmed when shipping not confirmed (and not overdue)', () => {
    const order = makeOrder({ estimatedDelivery: 'April 20, 2026', shippingConfirmed: false });
    expect(getOrderStatus(order, today)).toBe('unconfirmed');
  });

  test('returns tracked when tracking number present (and not overdue/unconfirmed)', () => {
    const order = makeOrder({
      estimatedDelivery: 'April 20, 2026',
      shippingConfirmed: true,
      trackingNumber: '1Z999AA10123456784',
    });
    expect(getOrderStatus(order, today)).toBe('tracked');
  });

  test('returns standard when confirmed, no tracking, not overdue', () => {
    const order = makeOrder({
      estimatedDelivery: 'April 20, 2026',
      shippingConfirmed: true,
      trackingNumber: null,
    });
    expect(getOrderStatus(order, today)).toBe('standard');
  });

  test('overdue takes priority over unconfirmed', () => {
    const order = makeOrder({
      estimatedDelivery: 'April 5, 2026',
      shippingConfirmed: false,
    });
    expect(getOrderStatus(order, today)).toBe('overdue');
  });
});

// ── getGroupLabel ─────────────────────────────────────────────

describe('getGroupLabel', () => {
  const today = new Date('2026-04-10T00:00:00Z');

  test('returns Overdue for past dates', () => {
    expect(getGroupLabel('April 5, 2026', today)).toBe('Overdue');
  });

  test('returns Soon for dates within 3 days', () => {
    expect(getGroupLabel('April 12, 2026', today)).toBe('Soon');
    expect(getGroupLabel('April 13, 2026', today)).toBe('Soon');
  });

  test('returns Incoming for dates more than 3 days away', () => {
    expect(getGroupLabel('April 20, 2026', today)).toBe('Incoming');
    expect(getGroupLabel('May 1, 2026', today)).toBe('Incoming');
  });
});

// ── getStats ──────────────────────────────────────────────────

describe('getStats', () => {
  const today = new Date('2026-04-10T00:00:00Z');

  test('counts all active orders as total', () => {
    const orders = [
      makeOrder({ id: 'A', canceled: false }),
      makeOrder({ id: 'B', canceled: false }),
      makeOrder({ id: 'C', canceled: true }),
    ];
    const stats = getStats(orders, {}, today);
    expect(stats.total).toBe(2);
  });

  test('counts received orders correctly', () => {
    const orders = [
      makeOrder({ id: 'A', estimatedDelivery: 'April 20, 2026' }),
      makeOrder({ id: 'B', estimatedDelivery: 'April 20, 2026' }),
    ];
    const state = { A: { received: true }, B: { received: false } };
    const stats = getStats(orders, state, today);
    expect(stats.received).toBe(1);
  });

  test('counts overdue orders (past delivery, not received)', () => {
    const orders = [
      makeOrder({ id: 'A', estimatedDelivery: 'April 5, 2026' }),
      makeOrder({ id: 'B', estimatedDelivery: 'April 5, 2026' }),
      makeOrder({ id: 'C', estimatedDelivery: 'April 20, 2026' }),
    ];
    const state = { A: { received: true } };
    const stats = getStats(orders, state, today);
    expect(stats.overdue).toBe(1); // B is overdue; A is received; C is not overdue
  });

  test('counts unconfirmed orders (not received, shipping not confirmed)', () => {
    const orders = [
      makeOrder({ id: 'A', shippingConfirmed: false, estimatedDelivery: 'April 20, 2026' }),
      makeOrder({ id: 'B', shippingConfirmed: false, estimatedDelivery: 'April 20, 2026' }),
      makeOrder({ id: 'C', shippingConfirmed: true, estimatedDelivery: 'April 20, 2026' }),
    ];
    const state = { A: { received: true } };
    const stats = getStats(orders, state, today);
    expect(stats.unconfirmed).toBe(1); // B is unconfirmed; A is received; C is confirmed
  });

  test('returns zeros for empty order list', () => {
    const stats = getStats([], {}, today);
    expect(stats).toEqual({ total: 0, received: 0, overdue: 0, unconfirmed: 0 });
  });
});

// ── getReceivedCards ──────────────────────────────────────────

describe('getReceivedCards', () => {
  test('returns cards from received orders', () => {
    const card = makeCard();
    const orders = [
      makeOrder({ id: 'A', cards: [card] }),
      makeOrder({ id: 'B', cards: [makeCard({ name: 'Other' })] }),
    ];
    const state = { A: { received: true } };
    const result = getReceivedCards(orders, state);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Bloodstained Mire');
  });

  test('excludes canceled cards from received orders', () => {
    const cardA = makeCard({ name: 'Card A' });
    const cardB = makeCard({ name: 'Card B' });
    const order = makeOrder({ id: 'A', cards: [cardA, cardB] });
    const state = {
      A: {
        received: true,
        cards: { [cardKey(cardA)]: { canceled: true, missing: false } },
      },
    };
    const result = getReceivedCards([order], state);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Card B');
  });

  test('excludes missing cards from received orders', () => {
    const cardA = makeCard({ name: 'Card A' });
    const cardB = makeCard({ name: 'Card B' });
    const order = makeOrder({ id: 'A', cards: [cardA, cardB] });
    const state = {
      A: {
        received: true,
        cards: { [cardKey(cardA)]: { canceled: false, missing: true } },
      },
    };
    const result = getReceivedCards([order], state);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Card B');
  });

  test('excludes canceled orders', () => {
    const order = makeOrder({ id: 'A', canceled: true, cards: [makeCard()] });
    const state = { A: { received: true } };
    expect(getReceivedCards([order], state)).toEqual([]);
  });

  test('excludes orders not marked received', () => {
    const order = makeOrder({ id: 'A', cards: [makeCard()] });
    const state = { A: { received: false } };
    expect(getReceivedCards([order], state)).toEqual([]);
  });
});

// ── markReceived ──────────────────────────────────────────────

describe('markReceived', () => {
  test('sets received to true for an order', () => {
    const state = {};
    const next = markReceived(state, 'ORDER-1', true);
    expect(next['ORDER-1'].received).toBe(true);
  });

  test('sets received to false for an order', () => {
    const state = { 'ORDER-1': { received: true, note: 'hi' } };
    const next = markReceived(state, 'ORDER-1', false);
    expect(next['ORDER-1'].received).toBe(false);
    expect(next['ORDER-1'].note).toBe('hi');
  });

  test('does not mutate original state', () => {
    const state = {};
    markReceived(state, 'ORDER-1', true);
    expect(state['ORDER-1']).toBeUndefined();
  });
});

// ── saveNote ──────────────────────────────────────────────────

describe('saveNote', () => {
  test('saves a note to an order', () => {
    const state = { 'ORDER-1': { received: true } };
    const next = saveNote(state, 'ORDER-1', 'Missing card');
    expect(next['ORDER-1'].note).toBe('Missing card');
    expect(next['ORDER-1'].received).toBe(true);
  });

  test('creates order entry if not present', () => {
    const next = saveNote({}, 'ORDER-1', 'Note text');
    expect(next['ORDER-1'].note).toBe('Note text');
  });
});

// ── setCardState ──────────────────────────────────────────────

describe('setCardState', () => {
  test('sets canceled state for a card', () => {
    const state = {};
    const next = setCardState(state, 'ORDER-1', 'card-key', { canceled: true });
    expect(next['ORDER-1'].cards['card-key'].canceled).toBe(true);
    expect(next['ORDER-1'].cards['card-key'].missing).toBe(false);
  });

  test('sets missing state for a card', () => {
    const state = {};
    const next = setCardState(state, 'ORDER-1', 'card-key', { missing: true });
    expect(next['ORDER-1'].cards['card-key'].missing).toBe(true);
    expect(next['ORDER-1'].cards['card-key'].canceled).toBe(false);
  });

  test('toggling canceled clears missing (via update override)', () => {
    const state = setCardState({}, 'ORDER-1', 'card-key', { missing: true });
    const next = setCardState(state, 'ORDER-1', 'card-key', { canceled: true, missing: false });
    expect(next['ORDER-1'].cards['card-key'].canceled).toBe(true);
    expect(next['ORDER-1'].cards['card-key'].missing).toBe(false);
  });

  test('preserves existing order-level received flag', () => {
    const state = { 'ORDER-1': { received: true } };
    const next = setCardState(state, 'ORDER-1', 'card-key', { canceled: true });
    expect(next['ORDER-1'].received).toBe(true);
  });

  test('does not mutate original state', () => {
    const state = {};
    setCardState(state, 'ORDER-1', 'card-key', { canceled: true });
    expect(state['ORDER-1']).toBeUndefined();
  });
});
