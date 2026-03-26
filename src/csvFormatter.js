'use strict';

/**
 * Formats an array of resolved card objects into a CSV string.
 *
 * Output columns:
 *   Count, Name, Edition, Condition, Language, Foil
 *
 * This format is compatible with common MTG collection managers
 * (Moxfield, Archidekt, Deckbox, etc.).
 *
 * @param {{ quantity: number, name: string, setCode: string, condition: string, foil: boolean }[]} cards
 * @returns {string} CSV string including header row.
 */
function formatToCSV(cards) {
  const header = 'Count,Name,Edition,Condition,Language,Foil';
  const rows = cards.map((c) => {
    const foilValue = c.foil ? 'foil' : '';
    return [
      c.quantity,
      csvField(c.name),
      csvField(c.setCode),
      csvField(c.condition),
      'English',
      foilValue,
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

/**
 * Wraps a value in double-quotes if it contains a comma, double-quote,
 * or newline; escapes embedded double-quotes by doubling them.
 *
 * @param {string|number} value
 * @returns {string}
 */
function csvField(value) {
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

module.exports = { formatToCSV, csvField };
