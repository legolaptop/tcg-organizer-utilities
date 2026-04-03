'use strict';

const { diffShippingStatus, applyShippingUpdates } = require('../src/mhtDiff');

function makeOrder(overrides = {}) {
  return {
    id: 'ORDER-001',
    trackingNumber: null,
    shippingConfirmed: false,
    ...overrides,
  };
}

// ── diffShippingStatus ────────────────────────────────────────

describe('diffShippingStatus', () => {
  test('returns empty array when nothing changed', () => {
    const prev = [makeOrder({ id: 'A', trackingNumber: null, shippingConfirmed: false })];
    const fresh = [makeOrder({ id: 'A', trackingNumber: null, shippingConfirmed: false })];
    expect(diffShippingStatus(prev, fresh)).toEqual([]);
  });

  test('detects new tracking number', () => {
    const prev = [makeOrder({ id: 'A', trackingNumber: null, shippingConfirmed: false })];
    const fresh = [makeOrder({ id: 'A', trackingNumber: '1ZTRACKING', shippingConfirmed: false })];
    const updates = diffShippingStatus(prev, fresh);
    expect(updates.length).toBe(1);
    expect(updates[0].orderId).toBe('A');
    expect(updates[0].trackingNumber).toBe('1ZTRACKING');
  });

  test('detects shippingConfirmed change', () => {
    const prev = [makeOrder({ id: 'A', trackingNumber: null, shippingConfirmed: false })];
    const fresh = [makeOrder({ id: 'A', trackingNumber: null, shippingConfirmed: true })];
    const updates = diffShippingStatus(prev, fresh);
    expect(updates.length).toBe(1);
    expect(updates[0].shippingConfirmed).toBe(true);
  });

  test('ignores orders that appear only in fresh (new orders)', () => {
    const prev = [];
    const fresh = [makeOrder({ id: 'NEW', trackingNumber: '1Z', shippingConfirmed: true })];
    expect(diffShippingStatus(prev, fresh)).toEqual([]);
  });

  test('handles multiple order updates in one pass', () => {
    const prev = [
      makeOrder({ id: 'A', trackingNumber: null, shippingConfirmed: false }),
      makeOrder({ id: 'B', trackingNumber: null, shippingConfirmed: false }),
      makeOrder({ id: 'C', trackingNumber: '1Z', shippingConfirmed: true }),
    ];
    const fresh = [
      makeOrder({ id: 'A', trackingNumber: '1ZA', shippingConfirmed: false }),
      makeOrder({ id: 'B', trackingNumber: null, shippingConfirmed: false }),
      makeOrder({ id: 'C', trackingNumber: '1Z', shippingConfirmed: true }),
    ];
    const updates = diffShippingStatus(prev, fresh);
    expect(updates.length).toBe(1);
    expect(updates[0].orderId).toBe('A');
  });
});

// ── applyShippingUpdates ──────────────────────────────────────

describe('applyShippingUpdates', () => {
  test('updates order fields in-place', () => {
    const orders = [makeOrder({ id: 'A', trackingNumber: null, shippingConfirmed: false })];
    const updates = [{ orderId: 'A', trackingNumber: '1ZTRACKING', shippingConfirmed: true }];
    const { updatedCount } = applyShippingUpdates({}, updates, orders);
    expect(orders[0].trackingNumber).toBe('1ZTRACKING');
    expect(orders[0].shippingConfirmed).toBe(true);
    expect(updatedCount).toBe(1);
  });

  test('does not update orders marked as received', () => {
    const orders = [makeOrder({ id: 'A', trackingNumber: null, shippingConfirmed: false })];
    const state = { A: { received: true } };
    const updates = [{ orderId: 'A', trackingNumber: '1Z', shippingConfirmed: true }];
    const { updatedCount } = applyShippingUpdates(state, updates, orders);
    expect(orders[0].trackingNumber).toBe(null);
    expect(updatedCount).toBe(0);
  });

  test('returns updated count correctly for mixed updates', () => {
    const orders = [
      makeOrder({ id: 'A', trackingNumber: null, shippingConfirmed: false }),
      makeOrder({ id: 'B', trackingNumber: null, shippingConfirmed: false }),
    ];
    const state = { B: { received: true } };
    const updates = [
      { orderId: 'A', trackingNumber: '1ZA', shippingConfirmed: true },
      { orderId: 'B', trackingNumber: '1ZB', shippingConfirmed: true },
    ];
    const { updatedCount } = applyShippingUpdates(state, updates, orders);
    expect(updatedCount).toBe(1);
    expect(orders[0].trackingNumber).toBe('1ZA');
    expect(orders[1].trackingNumber).toBe(null);
  });

  test('does not mutate the original state object', () => {
    const state = {};
    const orders = [makeOrder({ id: 'A' })];
    const updates = [{ orderId: 'A', trackingNumber: '1Z', shippingConfirmed: true }];
    const { newState } = applyShippingUpdates(state, updates, orders);
    expect(newState).not.toBe(state);
  });

  test('returns zero updatedCount when no matching orders found', () => {
    const orders = [makeOrder({ id: 'A' })];
    const updates = [{ orderId: 'UNKNOWN', trackingNumber: '1Z', shippingConfirmed: true }];
    const { updatedCount } = applyShippingUpdates({}, updates, orders);
    expect(updatedCount).toBe(0);
  });
});
