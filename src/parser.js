'use strict';

/**
 * Parses a block of unformatted TCGPlayer order text into an array of card objects.
 * Supports the following single-line formats (one card per line):
 *   1x Card Name [Set Name] Near Mint
 *   1x Card Name [Set Name] Near Mint Foil
 *   1  Card Name [Set Name]
 *      Card Name [Set Name]          (quantity defaults to 1)
 *   1x Card Name - Set Name - Near Mint
 *   1x Card Name - Set Name
 *      Card Name - Set Name
 * And a two-line block format (card name / set name on consecutive lines):
 *   Card Name
 *   Set Name
 *
 * @param {string} text - Raw pasted text from a TCGPlayer order/cart/collection page.
 * @returns {{ quantity: number, name: string, setName: string, condition: string, foil: boolean }[]}
 */
function parseLines(text) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const cards = [];
  let i = 0;

  while (i < lines.length) {
    // Try single-line formats first
    const single = parseSingleLine(lines[i]);
    if (single) {
      cards.push(single);
      i += 1;
      continue;
    }

    // Try two-line block: "Card Name" followed by "Set Name"
    if (i + 1 < lines.length) {
      const multi = parseMultiLine(lines[i], lines[i + 1]);
      if (multi) {
        cards.push(multi);
        i += 2;
        continue;
      }
    }

    // Unrecognised line – skip
    i += 1;
  }

  return cards;
}

/**
 * Attempts to parse a single line into a card object.
 * Returns null if the line does not match any known format.
 *
 * @param {string} line
 * @returns {{ quantity: number, name: string, setName: string, condition: string, foil: boolean } | null}
 */
function parseSingleLine(line) {
  // --- Bracket format: [opt qty] Card Name [Set Name] [opt condition] ---
  // e.g. "1x Black Lotus [Limited Edition Alpha] Near Mint Foil"
  //      "Black Lotus [Limited Edition Alpha]"
  const bracketRe = /^(?:(\d+)\s*[xX]\s*)?(.+?)\s*\[(.+?)\](?:\s+(.+?))?$/;
  const bm = line.match(bracketRe);
  if (bm) {
    const { condition, foil } = parseCondition(bm[4] || '');
    return {
      quantity: bm[1] ? parseInt(bm[1], 10) : 1,
      name: bm[2].trim(),
      setName: bm[3].trim(),
      condition,
      foil,
    };
  }

  // --- Dash format: qty x Card Name - Set Name [- Condition] ---
  // Requires an explicit quantity to avoid ambiguity with card names that
  // contain a dash (e.g. "Jace, the Mind Sculptor").
  // e.g. "1x Llanowar Elves - Dominaria - Near Mint Foil"
  //      "2 Llanowar Elves - Dominaria"
  const dashRe = /^(\d+)\s*[xX]?\s*(.+?)\s+-\s+(.+?)(?:\s+-\s+(.+?))?$/;
  const dm = line.match(dashRe);
  if (dm) {
    const conditionStr = dm[4] || '';
    const { condition, foil } = parseCondition(conditionStr);
    // Heuristic: third segment must not look like a price
    if (!dm[3].trim().match(/^\$[\d.]+$/)) {
      return {
        quantity: parseInt(dm[1], 10),
        name: dm[2].trim(),
        setName: dm[3].trim(),
        condition,
        foil,
      };
    }
  }

  return null;
}

/**
 * Attempts to parse two consecutive lines as a card-name / set-name pair.
 * Returns null if:
 *  - the second line does not look like an MTG set name, or
 *  - the second line contains brackets (meaning it is itself a single-line card entry), or
 *  - the first line looks like a price or condition (not a card name).
 *
 * @param {string} cardLine
 * @param {string} setLine
 * @returns {{ quantity: number, name: string, setName: string, condition: string, foil: boolean } | null}
 */
function parseMultiLine(cardLine, setLine) {
  if (!looksLikeSetName(setLine)) return null;
  // Reject if setLine already encodes a card (e.g. "1x Forest [Core Set 2021]")
  if (/\[/.test(setLine)) return null;
  // Reject if cardLine looks like a price
  if (/^\$[\d.]+/.test(cardLine)) return null;

  // Extract optional leading quantity from cardLine
  const qtyPrefixRe = /^(\d+)\s*[xX]\s*(.+)$/;
  const qm = cardLine.match(qtyPrefixRe);

  const quantity = qm ? parseInt(qm[1], 10) : 1;
  const name = qm ? qm[2].trim() : cardLine.trim();

  return {
    quantity,
    name,
    setName: setLine.trim(),
    condition: 'Near Mint',
    foil: false,
  };
}

/**
 * Returns true when a string looks like it could be an MTG set name rather
 * than a price, condition label, or language string.
 *
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeSetName(text) {
  if (!text || text.length === 0 || text.length > 80) return false;
  if (/^\$[\d.]+/.test(text)) return false; // price
  if (/^(Near Mint|Lightly Played|Moderately Played|Heavily Played|Damaged|NM|LP|MP|HP)\b/i.test(text)) return false;
  if (/^(English|French|German|Spanish|Italian|Portuguese|Japanese|Korean|Chinese)\b/i.test(text)) return false;
  if (/^\d+$/.test(text)) return false; // bare number
  return true;
}

/**
 * Parses a condition string (e.g. "Near Mint Foil", "NM", "LP Foil") into
 * a normalised condition label and a foil flag.
 *
 * @param {string} text
 * @returns {{ condition: string, foil: boolean }}
 */
function parseCondition(text) {
  if (!text) return { condition: 'Near Mint', foil: false };

  const foil = /foil/i.test(text);
  const cleaned = text.replace(/foil/i, '').trim().toLowerCase();

  const map = [
    [/^nm\b|near\s*mint/, 'Near Mint'],
    [/^lp\b|lightly\s*played/, 'Lightly Played'],
    [/^mp\b|moderately\s*played/, 'Moderately Played'],
    [/^hp\b|heavily\s*played/, 'Heavily Played'],
    [/^d\b|damaged/, 'Damaged'],
  ];

  for (const [re, label] of map) {
    if (re.test(cleaned)) return { condition: label, foil };
  }

  return { condition: 'Near Mint', foil };
}

module.exports = { parseLines, parseSingleLine, parseMultiLine, parseCondition, looksLikeSetName };
