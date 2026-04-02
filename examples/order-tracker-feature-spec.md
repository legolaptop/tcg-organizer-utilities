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

## 4. Received State (Google Drive)

Persist tracker state as a single JSON file on the user's Google Drive. This keeps state synced across devices and browsers. Use the app's existing Google OAuth flow to obtain an access token.

### 4.1 State Schema

```typescript
interface OrderState {
  received: boolean;
  note?: string;
}

type TrackerState = Record<string, OrderState>; // keyed by order.id
```

### 4.2 Drive File Config

```typescript
const DRIVE_FILE_NAME = 'tcg-tracker-state.json';

// Use 'appDataFolder' to store the file in a hidden app-specific folder
// (not visible in the user's Drive root, cleaner UX).
// Requires scope: https://www.googleapis.com/auth/drive.appdata
//
// Alternatively use 'root' if you want the file visible in Drive
// and easier to debug. Requires scope: https://www.googleapis.com/auth/drive.file
const DRIVE_SPACE = 'appDataFolder';
```

### 4.3 Load State on App Init

```typescript
async function loadStateFromDrive(accessToken: string): Promise<TrackerState> {
  // 1. Search for existing state file
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?spaces=${DRIVE_SPACE}&q=name='${DRIVE_FILE_NAME}'&fields=files(id)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const { files } = await searchRes.json();

  if (!files || files.length === 0) {
    return {}; // No state file yet, start fresh
  }

  // 2. Fetch file contents
  const fileId = files[0].id;
  const contentRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return await contentRes.json();
}
```

### 4.4 Save State to Drive (Debounced)

```typescript
// Cache the file ID after first load to avoid repeated searches
let driveFileId: string | null = null;

async function saveStateToDrive(state: TrackerState, accessToken: string): Promise<void> {
  const body = JSON.stringify(state);
  const blob = new Blob([body], { type: 'application/json' });

  if (driveFileId) {
    // Update existing file (PATCH)
    await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
      }
    );
  } else {
    // Create new file (POST multipart)
    const metadata = { name: DRIVE_FILE_NAME, parents: [DRIVE_SPACE] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      }
    );
    const { id } = await res.json();
    driveFileId = id;
  }
}

// Debounce writes — 500ms delay to batch rapid checkbox/note changes
function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

const debouncedSave = debounce(saveStateToDrive, 500);
```

### 4.5 State Mutation Helpers

```typescript
function markReceived(state: TrackerState, orderId: string, received: boolean): TrackerState {
  return { ...state, [orderId]: { ...state[orderId], received } };
}

function saveNote(state: TrackerState, orderId: string, note: string): TrackerState {
  return { ...state, [orderId]: { ...state[orderId], note } };
}
```

### 4.6 Save Indicator UI

Show a subtle status indicator near the top of the tracker view that reflects Drive sync state:

| State | Display |
|---|---|
| Idle | Hidden |
| Saving | "Saving…" in muted text |
| Saved | "Saved ✓" briefly, then fades |
| Error | "Save failed — check connection" in red |

### 4.7 Required OAuth Scope

Add the following scope to your existing Google OAuth consent request:

```
https://www.googleapis.com/auth/drive.appdata
```

Or if using visible Drive root storage:

```
https://www.googleapis.com/auth/drive.file
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