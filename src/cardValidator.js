'use strict';

/**
 * Validates MTG card names against the Scryfall API.
 *
 * Uses the Scryfall collection endpoint to batch-validate up to 75 card names
 * per request, caching results for the lifetime of the process.
 *
 * If Scryfall is unreachable or returns an error the validator falls back to
 * treating all unresolved cards as valid so that network issues never silently
 * drop cards from the output.
 *
 * Scryfall API reference: https://scryfall.com/docs/api/cards/collection
 */

const SCRYFALL_COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
const BATCH_SIZE = 75;

/** @type {Map<string, boolean>} */
const _cache = new Map();

/**
 * Strips trailing parenthetical variant info from a card name so that
 * variant-specific names (e.g. "Solitude (Borderless)") are validated as the
 * canonical card name ("Solitude").
 *
 * @param {string} name
 * @returns {string}
 */
function normalizeCardName(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/**
 * Validates an array of card names against Scryfall in efficient batches.
 * Results are cached so each unique name is only looked up once.
 *
 * Returns a Map from each original name to a boolean (true = valid card found,
 * false = not found on Scryfall).  When Scryfall is unreachable, all uncached
 * names default to true.
 *
 * @param {string[]} names
 * @returns {Promise<Map<string, boolean>>}
 */
async function validateCardNames(names) {
  const normalizedNames = names.map(normalizeCardName);

  // Collect unique names that are not yet cached (use lowercase as cache key)
  const uncachedKeys = [
    ...new Set(
      normalizedNames
        .map((n) => n.toLowerCase())
        .filter((k) => !_cache.has(k))
    ),
  ];

  if (uncachedKeys.length > 0) {
    // Send to Scryfall in batches of up to BATCH_SIZE
    const batches = [];
    for (let i = 0; i < uncachedKeys.length; i += BATCH_SIZE) {
      batches.push(uncachedKeys.slice(i, i + BATCH_SIZE));
    }
    await Promise.all(batches.map((batch) => _validateBatch(batch)));
  }

  // Build result map using original (non-lowercased) names as keys
  const result = new Map();
  for (let i = 0; i < names.length; i++) {
    const key = normalizedNames[i].toLowerCase();
    result.set(names[i], _cache.get(key) ?? true);
  }
  return result;
}

/**
 * Sends a batch of lowercase-normalized card names to the Scryfall collection
 * endpoint and populates the cache with the results.
 *
 * @param {string[]} keys - Lowercase, normalized card names
 * @returns {Promise<void>}
 */
async function _validateBatch(keys) {
  const identifiers = keys.map((k) => ({ name: k }));

  try {
    const res = await fetch(SCRYFALL_COLLECTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'tcg-organizer-utilities/1.0',
      },
      body: JSON.stringify({ identifiers }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) throw new Error(`Scryfall returned ${res.status}`);

    const json = await res.json();

    // Mark explicitly not-found identifiers as invalid
    const notFoundKeys = new Set(
      (json.not_found || [])
        .map((nf) => (nf.name || '').toLowerCase())
        .filter(Boolean)
    );

    for (const k of keys) {
      _cache.set(k, !notFoundKeys.has(k));
    }
  } catch {
    // Network unavailable or Scryfall unreachable – default to valid
    for (const k of keys) {
      if (!_cache.has(k)) {
        _cache.set(k, true);
      }
    }
  }
}

/**
 * Validates a single card name against Scryfall.
 * Returns true if the card is found, false if not found.
 * Falls back to true when Scryfall is unreachable.
 *
 * @param {string} name
 * @returns {Promise<boolean>}
 */
async function validateCardName(name) {
  const result = await validateCardNames([name]);
  return result.get(name) ?? true;
}

/**
 * Clears the in-memory validation cache (primarily useful for tests).
 */
function clearCache() {
  _cache.clear();
}

module.exports = { validateCardName, validateCardNames, normalizeCardName, clearCache };
