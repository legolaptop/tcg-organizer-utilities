'use strict';

/**
 * Formats an array of resolved card objects into a CSV string.
 *
 * Output columns:
 *   Name, Set code, Set name, Collector number, Foil, Rarity, Quantity,
 *   Scryfall ID, Purchase price, Condition
 *
 * @param {{
 *   name: string,
 *   setCode?: string,
 *   setName?: string,
 *   collectorNumber?: string,
 *   foil?: boolean,
 *   rarity?: string,
 *   quantity?: number,
 *   scryfallId?: string,
 *   price?: number,
 *   condition?: string
 * }[]} cards
 * @returns {string} CSV string including header row.
 */
function formatToCSV(cards) {
  const header = 'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,Scryfall ID,Purchase price,Condition';
  const rows = cards.map((c) => {
    const foilValue = c.foil ? 'foil' : '';
    const priceValue = c.price != null ? c.price.toFixed(2) : '';
    return [
      csvField(c.name || ''),
      csvField(c.setCode || ''),
      csvField(c.setName || ''),
      csvField(c.collectorNumber || ''),
      foilValue,
      csvField(c.rarity || ''),
      c.quantity != null ? c.quantity : 1,
      csvField(c.scryfallId || ''),
      priceValue,
      csvField(c.condition || 'Near Mint'),
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
