'use strict';

const { diffShippingStatus, applyShippingUpdates } = require('../src/mhtDiff');

// Helper: build a minimal Order object for testing
function makeOrder(overrides = {}) {
  return {
    id: 'ORD-001',
    date: 'March 31, 2026',
    seller: 'TCGplayer Direct',
    total: 5.98,
    estimatedDelivery: 'April 14, 2026',
    trackingNumber: null,
    shippingConfirmed: false,
    canceled: false,
    partialRefund: null,
    cards: [],
    ...overrides,
  };
}

// ── diffShippingStatus ────────────────────────────────────────────────────────

describe('diffShippingStatus', () => {
  test('returns empty array when nothing has changed', () => {
    const prev = [makeOrder({ trackingNumber: null, shippingConfirmed: false })];
    const fresh = [makeOrder({ trackingNumber: null, shippingConfirmed: false })];
    expect(diffShippingStatus(prev, fresh)).toEqual([]);
  });

  test('detects tracking number added', () => {
    const prev = [makeOrder({ trackingNumber: null })];
    const fresh = [makeOrder({ trackingNumber: '1Z999AA10123456784' })];
    const updates = diffShippingStatus(prev, fresh);
    expect(updates).toHaveLength(1);
    expect(updates[0].orderId).toBe('ORD-001');
    expect(updates[0].trackingNumber).toBe('1Z999AA10123456784');
  });

  test('detects shippingConfirmed changed from false to true', () => {
    const prev = [makeOrder({ shippingConfirmed: false })];
    const fresh = [makeOrder({ shippingConfirmed: true })];
    const updates = diffShippingStatus(prev, fresh);
    expect(updates).toHaveLength(1);
    expect(updates[0].shippingConfirmed).toBe(true);
  });

  test('detects both tracking and confirmed changing together', () => {
    const prev = [makeOrder({ trackingNumber: null, shippingConfirmed: false })];
    const fresh = [makeOrder({ trackingNumber: 'TRACK-123', shippingConfirmed: true })];
    const updates = diffShippingStatus(prev, fresh);
    expect(updates).toHaveLength(1);
    expect(updates[0].trackingNumber).toBe('TRACK-123');
    expect(updates[0].shippingConfirmed).toBe(true);
  });

  test('skips new orders (ID not in previousOrders)', () => {
    const prev = [makeOrder({ id: 'ORD-001' })];
    const fresh = [
      makeOrder({ id: 'ORD-001' }),
      makeOrder({ id: 'ORD-002', trackingNumber: 'NEW' }),
    ];
    const updates = diffShippingStatus(prev, fresh);
    // ORD-002 is new — not diffed
    expect(updates.every((u) => u.orderId !== 'ORD-002')).toBe(true);
  });

  test('emits updates for multiple changed orders', () => {
    const prev = [
      makeOrder({ id: 'ORD-001', trackingNumber: null }),
      makeOrder({ id: 'ORD-002', shippingConfirmed: false }),
    ];
    const fresh = [
      makeOrder({ id: 'ORD-001', trackingNumber: 'TRACK-A' }),
      makeOrder({ id: 'ORD-002', shippingConfirmed: true }),
    ];
    const updates = diffShippingStatus(prev, fresh);
    expect(updates).toHaveLength(2);
    expect(updates.map((u) => u.orderId).sort()).toEqual(['ORD-001', 'ORD-002']);
  });

  test('does not emit for unchanged orders even when others changed', () => {
    const prev = [
      makeOrder({ id: 'ORD-001', trackingNumber: null }),
      makeOrder({ id: 'ORD-002', trackingNumber: 'TRACK-X' }),
    ];
    const fresh = [
      makeOrder({ id: 'ORD-001', trackingNumber: 'TRACK-NEW' }),
      makeOrder({ id: 'ORD-002', trackingNumber: 'TRACK-X' }), // unchanged
    ];
    const updates = diffShippingStatus(prev, fresh);
    expect(updates).toHaveLength(1);
    expect(updates[0].orderId).toBe('ORD-001');
  });

  test('returns empty array for empty input', () => {
    expect(diffShippingStatus([], [])).toEqual([]);
    expect(diffShippingStatus([], [makeOrder()])).toEqual([]);
  });
});

// ── applyShippingUpdates ──────────────────────────────────────────────────────

describe('applyShippingUpdates', () => {
  test('updates tracking number and shippingConfirmed in the orders array', () => {
    const orders = [makeOrder({ trackingNumber: null, shippingConfirmed: false })];
    const updates = [
      { orderId: 'ORD-001', trackingNumber: 'TRACK-NEW', shippingConfirmed: true },
    ];
    applyShippingUpdates({}, updates, orders);
    expect(orders[0].trackingNumber).toBe('TRACK-NEW');
    expect(orders[0].shippingConfirmed).toBe(true);
  });

  test('does not modify a received order', () => {
    const orders = [makeOrder({ trackingNumber: null })];
    const state = { 'ORD-001': { received: true } };
    const updates = [
      { orderId: 'ORD-001', trackingNumber: 'TRACK-NEW', shippingConfirmed: true },
    ];
    applyShippingUpdates(state, updates, orders);
    // Order was received — tracking must NOT be overwritten
    expect(orders[0].trackingNumber).toBeNull();
  });

  test('returns the same state object (unchanged)', () => {
    const state = { 'ORD-001': { received: false } };
    const { newState } = applyShippingUpdates(state, [], []);
    expect(newState).not.toBe(state); // new object
    expect(newState).toEqual(state);  // same content
  });

  test('returns updatedCount equal to number of updates applied', () => {
    const orders = [
      makeOrder({ id: 'ORD-001' }),
      makeOrder({ id: 'ORD-002' }),
    ];
    const updates = [
      { orderId: 'ORD-001', trackingNumber: 'A', shippingConfirmed: true },
      { orderId: 'ORD-002', trackingNumber: 'B', shippingConfirmed: true },
    ];
    const { updatedCount } = applyShippingUpdates({}, updates, orders);
    expect(updatedCount).toBe(2);
  });

  test('updatedCount includes received orders (they are still in updates list)', () => {
    // applyShippingUpdates returns updates.length regardless of how many were
    // actually applied (received orders are skipped in mutation but still counted)
    const orders = [makeOrder({ id: 'ORD-001' })];
    const state = { 'ORD-001': { received: true } };
    const updates = [
      { orderId: 'ORD-001', trackingNumber: 'TRACK', shippingConfirmed: true },
    ];
    const { updatedCount } = applyShippingUpdates(state, updates, orders);
    expect(updatedCount).toBe(1);
  });

  test('preserves existing state keys not involved in updates', () => {
    const state = { 'ORD-002': { received: true, note: 'keep me' } };
    const orders = [makeOrder({ id: 'ORD-001' })];
    const updates = [
      { orderId: 'ORD-001', trackingNumber: 'T', shippingConfirmed: true },
    ];
    const { newState } = applyShippingUpdates(state, updates, orders);
    expect(newState['ORD-002']).toEqual({ received: true, note: 'keep me' });
  });

  test('handles empty updates gracefully', () => {
    const orders = [makeOrder()];
    const { updatedCount } = applyShippingUpdates({}, [], orders);
    expect(updatedCount).toBe(0);
  });
});
