'use strict';

/**
 * Converts MTG set names to their Scryfall set codes (abbreviations).
 *
 * Resolution strategy:
 *   1. A bundled set list (ships with the app) is always available offline.
 *   2. On first use the app attempts to fetch the full set list from the
 *      Scryfall API; on success that data is merged in (Scryfall wins on
 *      conflicts) and cached for the lifetime of the process.
 *   3. If Scryfall is unreachable the bundled list is used silently.
 *
 * Scryfall API reference: https://scryfall.com/docs/api/sets
 */

const BUNDLED_SETS = require('./sets');
const SCRYFALL_SETS_URL = 'https://api.scryfall.com/sets';

/** @type {Map<string, string> | null} */
let _cache = null;

/**
 * Builds and caches the set Map.  Starts from the bundled list then
 * attempts to overlay live Scryfall data (failures are silenced).
 *
 * @returns {Promise<Map<string, string>>}
 */
async function loadSets() {
  if (_cache) return _cache;

  // Seed from bundled data so the function works offline immediately.
  _cache = new Map(Object.entries(BUNDLED_SETS));

  try {
    const res = await fetch(SCRYFALL_SETS_URL, {
      headers: { 'User-Agent': 'tcg-organizer-utilities/1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      throw new Error(`Scryfall API returned status ${res.status}`);
    }

    const json = await res.json();

    for (const set of json.data) {
      _cache.set(set.name.toLowerCase(), set.code.toUpperCase());
    }
  } catch {
    // Network unavailable or Scryfall unreachable – bundled list is sufficient.
  }

  return _cache;
}

/**
 * Converts a set name string to its set code abbreviation.
 * Resolution order:
 *   1. Exact case-insensitive match  (e.g. "Dominaria"  → "DOM")
 *   2. Input is substring of a set name (e.g. "Core 2021" matches "Core Set 2021")
 *   3. A set name is a substring of the input
 *   4. Returns the original string unchanged if no match is found
 *
 * @param {string} setName
 * @returns {Promise<string>} Uppercase set code, or original setName if not found.
 */
async function convertSetName(setName) {
  const map = await loadSets();
  const normalized = setName.toLowerCase().trim();

  // 1. Exact match
  if (map.has(normalized)) {
    return map.get(normalized);
  }

  // 2 & 3. Partial match – prefer longer set names to reduce false positives
  let bestCode = null;
  let bestLen = 0;
  for (const [name, code] of map) {
    if (
      (normalized.includes(name) || name.includes(normalized)) &&
      name.length > bestLen
    ) {
      bestCode = code;
      bestLen = name.length;
    }
  }
  if (bestCode) return bestCode;

  // 4. No match – return original value
  return setName;
}

/**
 * Clears the in-memory set cache (primarily useful for tests).
 */
function clearCache() {
  _cache = null;
}

module.exports = { loadSets, convertSetName, clearCache };
