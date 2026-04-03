'use strict';

// ─── Drive configuration ─────────────────────────────────────────────────────

/** Name of the JSON state file stored on Google Drive. */
const DRIVE_FILE_NAME = 'tcg-tracker-state.json';

/**
 * App-specific hidden folder on Google Drive (not visible in Drive root).
 * Requires scope: https://www.googleapis.com/auth/drive.appdata
 */
const DRIVE_SPACE = 'appDataFolder';

// ─── JSDoc type definitions ───────────────────────────────────────────────────

/**
 * @typedef {Object} CardState
 * @property {boolean} canceled - card was not fulfilled (partial refund / OOS)
 * @property {boolean} missing  - order arrived but this card was absent
 */

/**
 * @typedef {Object} OrderState
 * @property {boolean}                    received
 * @property {string}                     [note]
 * @property {Record<string, CardState>}  [cards] - keyed by cardKey(); only
 *   populated when the user interacts with per-card controls
 */

/**
 * @typedef {Record<string, OrderState>} TrackerState - keyed by order.id
 */

// ─── In-memory Drive file-ID cache ───────────────────────────────────────────

/** @type {string|null} */
let driveFileId = null;

/**
 * Resets the cached Drive file ID (useful for testing or after sign-out).
 */
function resetDriveFileId() {
  driveFileId = null;
}

// ─── Drive I/O ───────────────────────────────────────────────────────────────

/**
 * Loads the tracker state JSON file from the app's Google Drive appDataFolder.
 * Returns an empty object if no state file has been saved yet.
 *
 * @param {string} accessToken - Google OAuth access token
 * @returns {Promise<TrackerState>}
 */
async function loadStateFromDrive(accessToken) {
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files` +
      `?spaces=${DRIVE_SPACE}&q=name='${DRIVE_FILE_NAME}'&fields=files(id)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!searchRes.ok) {
    const text = await searchRes.text();
    throw new Error(`Drive search failed (${searchRes.status}): ${text}`);
  }
  const { files } = await searchRes.json();

  if (!files || files.length === 0) {
    return {}; // No state file yet — start fresh
  }

  const fileId = files[0].id;
  driveFileId = fileId; // Cache for subsequent saves

  const contentRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!contentRes.ok) {
    const text = await contentRes.text();
    throw new Error(`Drive content fetch failed (${contentRes.status}): ${text}`);
  }
  return await contentRes.json();
}

/**
 * Saves the tracker state to Google Drive.
 *
 * If a file ID is already cached (from a previous load/save), the file is
 * updated via PATCH. Otherwise a new file is created via multipart POST and
 * the returned ID is cached for future saves.
 *
 * @param {TrackerState} state
 * @param {string}       accessToken - Google OAuth access token
 * @returns {Promise<void>}
 */
async function saveStateToDrive(state, accessToken) {
  const body = JSON.stringify(state);
  const blob = new Blob([body], { type: 'application/json' });

  if (driveFileId) {
    // Update existing file
    const patchRes = await fetch(
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
    if (!patchRes.ok) {
      const text = await patchRes.text();
      throw new Error(`Drive PATCH failed (${patchRes.status}): ${text}`);
    }
  } else {
    // Create new file (multipart upload)
    const metadata = { name: DRIVE_FILE_NAME, parents: [DRIVE_SPACE] };
    const form = new FormData();
    form.append(
      'metadata',
      new Blob([JSON.stringify(metadata)], { type: 'application/json' })
    );
    form.append('file', blob);

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Drive POST failed (${res.status}): ${text}`);
    }
    const { id } = await res.json();
    driveFileId = id;
  }
}

// ─── Debounce helper ─────────────────────────────────────────────────────────

/**
 * Returns a Promise-aware debounced version of `fn` that delays execution by
 * `ms` milliseconds, resetting the timer on each new call.
 *
 * Every call returns a Promise for the next scheduled execution. All callers
 * that invoked the debounced function during the current window share the same
 * Promise — they all resolve/reject together when `fn` finally runs.
 *
 * This makes it safe to `await` the debounced function and propagates errors
 * from the underlying async function to all waiting callers.
 *
 * @param {(...args: any[]) => any} fn
 * @param {number} ms
 * @returns {(...args: any[]) => Promise<any>}
 */
function debounce(fn, ms) {
  let timer;
  let lastArgs;
  let lastThis;
  /** @type {Array<{ resolveFn: (value: any) => void, rejectFn: (reason?: any) => void }>} */
  let pending = [];

  return function (...args) {
    lastArgs = args;
    lastThis = this;
    clearTimeout(timer);

    return new Promise((resolveFn, rejectFn) => {
      pending.push({ resolveFn, rejectFn });

      timer = setTimeout(async () => {
        const currentPending = pending;
        pending = [];
        try {
          const result = await fn.apply(lastThis, lastArgs);
          currentPending.forEach(({ resolveFn: resolve }) => resolve(result));
        } catch (err) {
          currentPending.forEach(({ rejectFn: reject }) => reject(err));
        }
      }, ms);
    });
  };
}

/**
 * Debounced save — batches rapid checkbox / note changes into a single write.
 * Fires 500 ms after the last invocation.
 */
const debouncedSave = debounce(saveStateToDrive, 500);

// ─── State mutation helpers ───────────────────────────────────────────────────

/**
 * Returns a new TrackerState with the `received` flag toggled for an order.
 *
 * @param {TrackerState} state
 * @param {string}  orderId
 * @param {boolean} received
 * @returns {TrackerState}
 */
function markReceived(state, orderId, received) {
  return { ...state, [orderId]: { ...state[orderId], received } };
}

/**
 * Returns a new TrackerState with a free-text note saved for an order.
 *
 * @param {TrackerState} state
 * @param {string} orderId
 * @param {string} note
 * @returns {TrackerState}
 */
function saveNote(state, orderId, note) {
  return { ...state, [orderId]: { ...state[orderId], note } };
}

/**
 * Returns a new TrackerState with per-card state updated for a single card
 * within an order.
 *
 * The `cards` map is lazily created — it is only added to an OrderState the
 * first time a card is explicitly toggled.
 *
 * @param {TrackerState}        state
 * @param {string}              orderId
 * @param {string}              key    - cardKey() value
 * @param {Partial<CardState>}  update
 * @returns {TrackerState}
 */
function setCardState(state, orderId, key, update) {
  const existing = state[orderId] ?? { received: false };
  const existingCards = existing.cards ?? {};
  return {
    ...state,
    [orderId]: {
      ...existing,
      cards: {
        ...existingCards,
        [key]: {
          canceled: false,
          missing: false,
          ...existingCards[key],
          ...update,
        },
      },
    },
  };
}

// ─── Save-indicator state ─────────────────────────────────────────────────────

/**
 * Possible save-indicator states surfaced to the UI layer.
 * @typedef {'idle'|'saving'|'saved'|'error'} SaveIndicatorState
 */

/**
 * Wraps a `saveStateToDrive` call and reports UI indicator state via a
 * callback, so the UI layer does not need to know about Drive internals.
 *
 * @param {TrackerState} state
 * @param {string}       accessToken
 * @param {(s: SaveIndicatorState) => void} onStatus
 * @returns {Promise<void>}
 */
async function saveWithIndicator(state, accessToken, onStatus) {
  onStatus('saving');
  try {
    await saveStateToDrive(state, accessToken);
    onStatus('saved');
  } catch {
    onStatus('error');
  }
}

module.exports = {
  DRIVE_FILE_NAME,
  DRIVE_SPACE,
  loadStateFromDrive,
  saveStateToDrive,
  debounce,
  debouncedSave,
  markReceived,
  saveNote,
  setCardState,
  saveWithIndicator,
  resetDriveFileId,
};
