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
  name: string;         // e.g. "Bloodstained Mire"
  set: string;          // e.g. "Modern Horizons 3"
  condition: string;    // e.g. "Near Mint", "Lightly Played Foil"
  price: number;        // per-card price, e.g. 18.76
  quantity: number;     // e.g. 1
  foil: boolean;        // true if condition string contains "Foil"
  cardSeller: string;   // per-card seller for Direct orders (e.g. "SuperGamesInc");
                        // falls back to order-level seller for regular marketplace orders
}

interface Order {
  id: string;              // order number, e.g. "D15EE6BF-9B4455-9D46F"
  date: string;            // order placed date, e.g. "March 31, 2026"
  seller: string;          // order-level seller, e.g. "TCGplayer Direct" or "TC's Rockets"
  total: number;           // order total incl. tax/shipping, e.g. 5.98
  estimatedDelivery: string; // e.g. "April 14, 2026"
  trackingNumber: string | null;  // null if no tracking
  shippingConfirmed: boolean;     // false if "Shipping Not Confirmed"
  canceled: boolean;              // true if order was canceled
  partialRefund: number | null;   // e.g. 0.43 if partially refunded, null otherwise
  cards: CardItem[];
}
```

> **Note:** Canceled orders should be excluded from the tracker view entirely. The existing parser may already handle this.

### 1.1 Card Identifier Key

Each card within an order needs a stable unique key for per-card state tracking. Use a composite key derived from fields available in both order types:

```typescript
function cardKey(card: CardItem): string {
  // Combines fields that uniquely identify a card line item within an order.
  // cardSeller differentiates cards in Direct orders from multiple sellers;
  // price handles edge cases where the same card appears twice at different prices.
  return `${card.name}|${card.set}|${card.condition}|${card.price}|${card.cardSeller}`;
}
```

> **Parser note:** For regular marketplace orders, `cardSeller` should be populated with
> the order-level `seller` value during parsing, since the MHT does not list a per-card
> seller for those orders. For TCGplayer Direct orders, parse the `Sold by X` text that
> appears after each card name in the MHT.

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
interface CardState {
  canceled: boolean;  // manually flagged as canceled (partial refund or out of stock)
  missing: boolean;   // order arrived but this card was absent from the package
}

interface OrderState {
  received: boolean;
  note?: string;
  cards?: Record<string, CardState>; // keyed by cardKey() — only populated if
                                     // the order has a partialRefund or user flags a card
}

type TrackerState = Record<string, OrderState>; // keyed by order.id
```

**Card state is opt-in:** The `cards` map is only created on an order when the user
interacts with individual card checkboxes. Orders with no per-card state simply omit it.

**Partial refund flag:** When an order has `partialRefund !== null`, the UI should
display a warning banner on that order prompting the user to identify which card(s)
are affected. This does not auto-populate `cards` — it just surfaces the prompt.

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

## 5. Per-Card State: UI & Behavior

### 5.1 When to Show Per-Card Controls

Show individual card checkboxes inside an expanded order in two situations:

| Trigger | Behavior |
|---|---|
| Order has `partialRefund !== null` | Show warning banner + per-card controls on expand |
| User manually expands and flags a card | Per-card controls always available on expand |

### 5.2 Card Status Options

Each card line item inside an expanded order should have two toggleable states:

```
[ ] Canceled   — card was not fulfilled (partial refund, out of stock)
[ ] Missing    — order arrived but this card was absent from the package
```

Only one state should be active at a time per card. Toggling one clears the other.

### 5.3 Partial Refund Banner

When `order.partialRefund !== null`, show a banner inside the order card:

> ⚠ Partial refund of **$X.XX** issued — expand to identify affected card(s)

This banner should persist until at least one card in the order is marked `canceled`.

### 5.4 State Mutation Helpers

```typescript
function setCardState(
  state: TrackerState,
  orderId: string,
  key: string,
  update: Partial<CardState>
): TrackerState {
  const existing = state[orderId] ?? { received: false };
  const existingCards = existing.cards ?? {};
  return {
    ...state,
    [orderId]: {
      ...existing,
      cards: {
        ...existingCards,
        [key]: { canceled: false, missing: false, ...existingCards[key], ...update }
      }
    }
  };
}
```

### 5.5 Visual Treatment

| Card State | Display |
|---|---|
| Default | Normal |
| `canceled` | Strikethrough text + muted red tint |
| `missing` | Strikethrough text + muted orange tint |

---

## 6. Summary Stats

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

## 7. Handoff to CSV Export

When an order is marked as received, pass its `cards` array to your existing export pipeline, excluding any cards marked as `canceled` or `missing`.

```typescript
function getReceivedCards(orders: Order[], state: TrackerState): CardItem[] {
  return orders
    .filter(o => !o.canceled && state[o.id]?.received)
    .flatMap(o => {
      const cardStates = state[o.id]?.cards ?? {};
      return o.cards.filter(card => {
        const cs = cardStates[cardKey(card)];
        // Exclude cards explicitly marked canceled or missing
        return !cs?.canceled && !cs?.missing;
      });
    });
}
```

Call your existing export function with this array whenever the user triggers the export action.

> **Note:** A card marked `missing` implies it was not received and should not be
> exported to Moxfield. The user should follow up with the seller separately.

---

## 8. Filter Modes

The view should support four filter modes toggled by the user:

| Filter | Shows |
|---|---|
| `all` | All active orders |
| `incoming` | Active orders not yet received |
| `overdue` | Orders past est. delivery, not received |
| `received` | Orders marked as received |

---

## 9. Automatic Shipping Updates (MHT Diff)

When the user uploads a fresh MHT export, diff it against the current tracker state and automatically update shipping fields for any orders that have changed. This requires no additional APIs or OAuth scopes — it uses the same MHT parser already in the app.

### 8.1 What This Updates

The diff should only update shipping-related fields. It must never overwrite `received: true` or clear a user's notes.

```typescript
interface ShippingUpdate {
  orderId: string;
  trackingNumber: string | null;  // null if still untracked
  shippingConfirmed: boolean;
}
```

### 8.2 Diff Logic

After parsing the fresh MHT into a new `Order[]`, compare each order against the existing loaded orders and emit updates for any orders where shipping status has changed.

```typescript
function diffShippingStatus(
  previousOrders: Order[],
  freshOrders: Order[]
): ShippingUpdate[] {
  const updates: ShippingUpdate[] = [];

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
```

### 8.3 Applying Updates to State

Merge shipping updates into the existing `TrackerState` without touching `received` or `note`.

```typescript
function applyShippingUpdates(
  state: TrackerState,
  updates: ShippingUpdate[],
  orders: Order[]
): { newState: TrackerState; updatedCount: number } {
  let newState = { ...state };

  updates.forEach(update => {
    // Never overwrite a manually received order
    if (newState[update.orderId]?.received) return;

    // Update the in-memory order object
    const order = orders.find(o => o.id === update.orderId);
    if (order) {
      order.trackingNumber = update.trackingNumber;
      order.shippingConfirmed = update.shippingConfirmed;
    }
  });

  return { newState, updatedCount: updates.length };
}
```

### 8.4 Trigger Points

Run the diff automatically whenever the user uploads a new MHT file, immediately after parsing:

```typescript
async function onMhtUpload(file: File, existingOrders: Order[], state: TrackerState) {
  // 1. Parse the new MHT using existing parser
  const freshOrders = await parseMht(file);

  // 2. Diff shipping status
  const updates = diffShippingStatus(existingOrders, freshOrders);

  // 3. Apply updates
  const { newState, updatedCount } = applyShippingUpdates(state, updates, existingOrders);

  // 4. Persist updated state to Drive if anything changed
  if (updatedCount > 0) {
    await debouncedSave(newState, accessToken);
  }

  // 5. Notify user
  return { freshOrders, updatedCount };
}
```

### 8.5 User Notification

After a diff, show a brief toast or inline message indicating what changed:

| Result | Message |
|---|---|
| No changes | "Orders up to date" |
| 1+ updates | "Updated shipping status for N order(s)" |
| New orders found | "N new order(s) detected — reload to view" |

> **Note on new orders:** If the fresh MHT contains order IDs not present in `existingOrders`, surface them as a notification rather than silently merging. The user may want to reload the full order list intentionally.