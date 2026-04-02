# Order Tracker Feature Spec
## For Copilot Agent Integration

---

## Overview

Add an order tracking view to the existing TCGplayer MHT webapp. The feature groups parsed orders by estimated delivery date, flags overdue and unshipped orders, and lets the user mark orders as received. Received orders feed into the existing CSV export pipeline.

---

## 1. Expected Input: Parsed Order Object

Your existing MHT parser should produce an array of order objects. The tracker feature expects this shape:

```typescript
interface CardItem {
  name: string;        // e.g. "Bloodstained Mire"
  set: string;         // e.g. "Modern Horizons 3"
  condition: string;   // e.g. "Near Mint", "Lightly Played Foil"
  price: number;       // per-card price, e.g. 18.76
  quantity: number;    // e.g. 1
  foil: boolean;       // true if condition string contains "Foil"
}

interface Order {
  id: string;              // order number, e.g. "D15EE6BF-9B4455-9D46F"
  date: string;            // order placed date, e.g. "March 31, 2026"
  seller: string;          // e.g. "TCG Transfer"
  total: number;           // order total incl. tax/shipping, e.g. 5.98
  estimatedDelivery: string; // e.g. "April 14, 2026"
  trackingNumber: string | null;  // null if no tracking
  shippingConfirmed: boolean;     // false if "Shipping Not Confirmed"
  canceled: boolean;              // true if order was canceled
  refundAmount: number | null;    // e.g. 7.01 if refunded
  cards: CardItem[];
}
```

> **Note:** Canceled orders should be excluded from the tracker view entirely. The existing parser may already handle this.

---

## 2. Grouping Logic

Group orders by `estimatedDelivery` date string, then sort groups chronologically.

```typescript
function groupOrdersByDate(orders: Order[]): Map<string, Order[]> {
  const groups = new Map<string, Order[]>();
  const active = orders.filter(o => !o.canceled);

  active.forEach(order => {
    const key = order.estimatedDelivery;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(order);
  });

  // Sort groups by date ascending
  return new Map(
    [...groups.entries()].sort(
      ([a], [b]) => new Date(a).getTime() - new Date(b).getTime()
    )
  );
}
```

---

## 3. Order Status Flags

Each order should be classified for display purposes:

```typescript
type OrderStatus = 'overdue' | 'unconfirmed' | 'tracked' | 'standard';

function getOrderStatus(order: Order, today: Date): OrderStatus {
  const est = new Date(order.estimatedDelivery);
  if (est < today) return 'overdue';
  if (!order.shippingConfirmed) return 'unconfirmed';
  if (order.trackingNumber) return 'tracked';
  return 'standard';
}
```

**Visual treatment per status:**
| Status | Indicator |
|---|---|
| `overdue` | Red left border + "Past Due" badge |
| `unconfirmed` | Orange left border + "Not Shipped" badge |
| `tracked` | Green "Tracked" badge + show tracking number |
| `standard` | No special treatment |

---

## 4. Received State (localStorage)

Persist received state keyed by order ID. Also store optional per-order notes.

```typescript
interface OrderState {
  received: boolean;
  note?: string;
}

type TrackerState = Record<string, OrderState>; // keyed by order.id

const STORAGE_KEY = 'tcgOrderTracker';

function loadState(): TrackerState {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveState(state: TrackerState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function markReceived(state: TrackerState, orderId: string, received: boolean): TrackerState {
  return {
    ...state,
    [orderId]: { ...state[orderId], received }
  };
}

function saveNote(state: TrackerState, orderId: string, note: string): TrackerState {
  return {
    ...state,
    [orderId]: { ...state[orderId], note }
  };
}
```

---

## 5. Summary Stats

Display at the top of the tracker view:

```typescript
interface TrackerStats {
  total: number;       // all active (non-canceled) orders
  received: number;    // orders marked received
  overdue: number;     // past est. delivery, not yet received
  unconfirmed: number; // shipping not confirmed, not yet received
}

function getStats(orders: Order[], state: TrackerState, today: Date): TrackerStats {
  const active = orders.filter(o => !o.canceled);
  return {
    total: active.length,
    received: active.filter(o => state[o.id]?.received).length,
    overdue: active.filter(o =>
      !state[o.id]?.received && new Date(o.estimatedDelivery) < today
    ).length,
    unconfirmed: active.filter(o =>
      !state[o.id]?.received && !o.shippingConfirmed
    ).length,
  };
}
```

---

## 6. Handoff to CSV Export

When an order is marked as received, pass its `cards` array to your existing export pipeline. The `CardItem` fields map to your existing CSV columns as you already have them defined.

```typescript
function getReceivedCards(orders: Order[], state: TrackerState): CardItem[] {
  return orders
    .filter(o => !o.canceled && state[o.id]?.received)
    .flatMap(o => o.cards);
}
```

Call your existing export function with this array whenever the user triggers the export action.

---

## 7. Filter Modes

The view should support four filter modes toggled by the user:

| Filter | Shows |
|---|---|
| `all` | All active orders |
| `incoming` | Active orders not yet received |
| `overdue` | Orders past est. delivery, not received |
| `received` | Orders marked as received |