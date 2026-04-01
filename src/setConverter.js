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
 * Attempts exact and partial matching of a candidate string against the set map.
 *
 * @param {Map<string, string>} map
 * @param {string} candidate - Already lowercased candidate string.
 * @returns {string|null} Uppercase set code, or null if not found.
 */
function _matchCandidate(map, candidate) {
  if (map.has(candidate)) {
    return map.get(candidate);
  }
  let bestCode = null;
  let bestLen = 0;
  for (const [name, code] of map) {
    if (
      (candidate.includes(name) || name.includes(candidate)) &&
      name.length > bestLen
    ) {
      bestCode = code;
      bestLen = name.length;
    }
  }
  return bestCode;
}

/**
 * Derives promo candidate tokens from a TCGPlayer set name that contains "promo".
 *
 * Example: "Buy-A-Box Promos" → tokens ["buy","a","box"]
 *   candidates: "buyabox" (all joined), "buybox" (no single-letter words),
 *               "buy_a_box" (underscore-joined), "buy", "box" (multi-char tokens).
 * These are matched against a Scryfall printing's promo_types array.
 *
 * @param {string} setLower - Already lowercased set name string.
 * @returns {string[]} Array of candidate strings, or [] if "promo" is not present.
 */
function _inferPromoCandidates(setLower) {
  if (!/promo/.test(setLower)) return [];
  const tokens = setLower
    .split(/[^a-z]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t !== 'promo' && t !== 'promos');
  if (tokens.length === 0) return [];

  const candidates = new Set();
  // e.g. ["buy","a","box"] → "buyabox"
  candidates.add(tokens.join(''));
  // join without single-letter words like "a" → "buybox"
  const noSingleLetters = tokens.filter((t) => t.length > 1).join('');
  if (noSingleLetters) candidates.add(noSingleLetters);
  // underscore-joined → "buy_a_box"
  candidates.add(tokens.join('_'));
  // individual tokens (only multi-character to avoid false positives)
  for (const t of tokens) {
    if (t.length > 1) candidates.add(t);
  }
  return Array.from(candidates);
}

/**
 * Converts a set name string to its set code abbreviation.
 * Resolution order:
 *   1. Exact case-insensitive match  (e.g. "Dominaria"  → "DOM")
 *   2. Commander format heuristics – when setName contains "Commander:",
 *      transforms "Commander: NAME" into "NAME Commander" variants and tries
 *      exact/partial matching before falling back to general partial matching.
 *   3. Partial substring match (e.g. "Core 2021" matches "Core Set 2021")
 *   4. Scryfall card prints lookup (only when cardName is provided) –
 *      a. If the TCGPlayer set name contains "promo", infer candidate tokens
 *         (e.g. "Buy-A-Box Promos" → "buyabox") and prefer a printing where
 *         card.promo === true and one of its promo_types matches a candidate.
 *      b. Otherwise, fall back to matching by set_name as before.
 *   5. Returns the original string unchanged if no match is found.
 *
 * @param {string} setName
 * @param {string} [cardName] - Optional card name used for the Scryfall prints fallback.
 * @returns {Promise<string>} Uppercase set code, or original setName if not found.
 */
async function convertSetName(setName, cardName) {
  const map = await loadSets();
  const normalized = setName.toLowerCase().trim();

  // 1. Exact match
  if (map.has(normalized)) {
    return map.get(normalized);
  }

  // 2. Commander format heuristics (runs before general partial matching to avoid
  //    matching the base set instead of the Commander variant)
  if (/^commander:/i.test(setName)) {
    const colonIdx = setName.indexOf(':');
    const nameAfterCommander = setName.slice(colonIdx + 1).trim();
    if (nameAfterCommander) {
      const candidates = [
        `${nameAfterCommander} Commander`.toLowerCase(),
        `${nameAfterCommander.replace(/[^a-z0-9 ]/gi, ' ').replace(/  +/g, ' ').trim()} Commander`.toLowerCase(),
      ];
      for (const candidate of candidates) {
        const code = _matchCandidate(map, candidate);
        if (code) return code;
      }
    }
  }

  // 3. Partial match – prefer longer set names to reduce false positives
  const partialCode = _matchCandidate(map, normalized);
  if (partialCode) return partialCode;

  // 4. Scryfall card prints lookup
  if (cardName) {
    try {
      const encodedQuery = encodeURIComponent(`!"${cardName}"`);
      const url = `https://api.scryfall.com/cards/search?q=${encodedQuery}&unique=prints`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'tcg-organizer-utilities/1.0' },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const json = await res.json();

        // 4a. Promo-aware matching: if the TCGPlayer set name contains "promo",
        //     prefer a printing where card.promo === true and one of its
        //     promo_types matches a candidate derived from the set name tokens.
        //     Example: "Buy-A-Box Promos" → candidate "buyabox" matches
        //     promo_types ["buyabox"], returning e.g. "BLC".
        const promoCandidates = _inferPromoCandidates(normalized);
        if (promoCandidates.length > 0) {
          for (const card of json.data) {
            if (!card.promo) continue;
            const types = (card.promo_types || []).map((t) => t.toLowerCase());
            for (const pc of promoCandidates) {
              if (
                types.includes(pc) ||
                types.some((t) => t.includes(pc) || pc.includes(t))
              ) {
                return card.set.toUpperCase();
              }
            }
          }
        }

        // 4b. Fallback: match by set_name as before
        for (const card of json.data) {
          const printSetName = card.set_name.toLowerCase().trim();
          if (
            printSetName === normalized ||
            normalized.includes(printSetName) ||
            printSetName.includes(normalized)
          ) {
            return card.set.toUpperCase();
          }
        }
      }
    } catch {
      // Scryfall unreachable or card not found – fall through
    }
  }

  // 5. No match – return original value
  return setName;
}

/**
 * Clears the in-memory set cache (primarily useful for tests).
 */
function clearCache() {
  _cache = null;
}

module.exports = { loadSets, convertSetName, clearCache, _inferPromoCandidates };
