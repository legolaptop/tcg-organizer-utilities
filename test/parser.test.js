'use strict';

const {
  parseLines,
  parseSingleLine,
  parseMultiLine,
  parseCondition,
  looksLikeSetName,
} = require('../src/parser');

// ── parseCondition ────────────────────────────────────────────
describe('parseCondition', () => {
  test('empty string returns Near Mint, not foil', () => {
    expect(parseCondition('')).toEqual({ condition: 'Near Mint', foil: false });
  });

  test.each([
    ['NM',                { condition: 'Near Mint',        foil: false }],
    ['Near Mint',         { condition: 'Near Mint',        foil: false }],
    ['LP',                { condition: 'Lightly Played',   foil: false }],
    ['Lightly Played',    { condition: 'Lightly Played',   foil: false }],
    ['MP',                { condition: 'Moderately Played',foil: false }],
    ['Moderately Played', { condition: 'Moderately Played',foil: false }],
    ['HP',                { condition: 'Heavily Played',   foil: false }],
    ['Heavily Played',    { condition: 'Heavily Played',   foil: false }],
    ['Damaged',           { condition: 'Damaged',          foil: false }],
  ])('"%s" → %j', (input, expected) => {
    expect(parseCondition(input)).toEqual(expected);
  });

  test('foil flag is set when "Foil" appears in the string', () => {
    expect(parseCondition('Near Mint Foil')).toEqual({ condition: 'Near Mint', foil: true });
    expect(parseCondition('NM Foil')).toEqual({ condition: 'Near Mint', foil: true });
    expect(parseCondition('LP foil')).toEqual({ condition: 'Lightly Played', foil: true });
  });

  test('unknown condition defaults to Near Mint', () => {
    expect(parseCondition('Excellent')).toEqual({ condition: 'Near Mint', foil: false });
  });
});

// ── looksLikeSetName ─────────────────────────────────────────
describe('looksLikeSetName', () => {
  test.each([
    ['Dominaria',                   true],
    ['Limited Edition Alpha',       true],
    ['Core Set 2021',               true],
    ['$0.25',                       false],
    ['Near Mint',                   false],
    ['NM',                          false],
    ['English',                     false],
    ['Japanese',                    false],
    ['42',                          false],
    ['',                            false],
  ])('"%s" → %s', (input, expected) => {
    expect(looksLikeSetName(input)).toBe(expected);
  });
});

// ── parseSingleLine ───────────────────────────────────────────
describe('parseSingleLine', () => {
  test('bracket format with quantity and condition', () => {
    expect(parseSingleLine('1x Black Lotus [Limited Edition Alpha] Near Mint'))
      .toEqual({ quantity: 1, name: 'Black Lotus', setName: 'Limited Edition Alpha', condition: 'Near Mint', foil: false });
  });

  test('bracket format with foil', () => {
    expect(parseSingleLine('2x Llanowar Elves [Dominaria] Near Mint Foil'))
      .toEqual({ quantity: 2, name: 'Llanowar Elves', setName: 'Dominaria', condition: 'Near Mint', foil: true });
  });

  test('bracket format without quantity defaults to 1', () => {
    expect(parseSingleLine('Elvish Mystic [Magic 2015 Core Set]'))
      .toEqual({ quantity: 1, name: 'Elvish Mystic', setName: 'Magic 2015 Core Set', condition: 'Near Mint', foil: false });
  });

  test('bracket format without quantity but with condition', () => {
    const result = parseSingleLine('Counterspell [Tempest] LP');
    expect(result).toMatchObject({ name: 'Counterspell', setName: 'Tempest', condition: 'Lightly Played' });
  });

  test('dash format with quantity, set and condition', () => {
    expect(parseSingleLine('1x Llanowar Elves - Dominaria - Near Mint Foil'))
      .toEqual({ quantity: 1, name: 'Llanowar Elves', setName: 'Dominaria', condition: 'Near Mint', foil: true });
  });

  test('dash format with quantity and set only', () => {
    expect(parseSingleLine('3x Mountain - Core Set 2021'))
      .toMatchObject({ quantity: 3, name: 'Mountain', setName: 'Core Set 2021' });
  });

  test('does not match a bare card name with no set info', () => {
    expect(parseSingleLine('Black Lotus')).toBeNull();
  });

  test('handles uppercase X in quantity', () => {
    expect(parseSingleLine('1X Forest [Magic 2015 Core Set]'))
      .toMatchObject({ quantity: 1, name: 'Forest', setName: 'Magic 2015 Core Set' });
  });
});

// ── parseMultiLine ────────────────────────────────────────────
describe('parseMultiLine', () => {
  test('card name / set name pair', () => {
    expect(parseMultiLine('Black Lotus', 'Limited Edition Alpha'))
      .toEqual({ quantity: 1, name: 'Black Lotus', setName: 'Limited Edition Alpha', condition: 'Near Mint', foil: false });
  });

  test('with leading quantity on card line', () => {
    expect(parseMultiLine('2x Swamp', 'Core Set 2021'))
      .toMatchObject({ quantity: 2, name: 'Swamp', setName: 'Core Set 2021' });
  });

  test('returns null when second line looks like a price', () => {
    expect(parseMultiLine('Black Lotus', '$500.00')).toBeNull();
  });

  test('returns null when second line looks like a condition', () => {
    expect(parseMultiLine('Black Lotus', 'Near Mint')).toBeNull();
  });
});

// ── parseLines (integration) ──────────────────────────────────
describe('parseLines', () => {
  test('parses a mixed-format block', () => {
    const text = `
1x Black Lotus [Limited Edition Alpha] Near Mint
2x Llanowar Elves - Dominaria - LP Foil
Elvish Mystic [Magic 2015 Core Set]
    `.trim();

    const cards = parseLines(text);
    expect(cards).toHaveLength(3);
    expect(cards[0]).toMatchObject({ quantity: 1, name: 'Black Lotus', setName: 'Limited Edition Alpha' });
    expect(cards[1]).toMatchObject({ quantity: 2, name: 'Llanowar Elves', setName: 'Dominaria', condition: 'Lightly Played', foil: true });
    expect(cards[2]).toMatchObject({ quantity: 1, name: 'Elvish Mystic', setName: 'Magic 2015 Core Set' });
  });

  test('parses two-line block format', () => {
    const text = `Black Lotus\nLimited Edition Alpha`;
    const cards = parseLines(text);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ name: 'Black Lotus', setName: 'Limited Edition Alpha' });
  });

  test('skips unrecognised lines gracefully', () => {
    const text = `$0.25\n1x Forest [Core Set 2021]\nSome random text`;
    const cards = parseLines(text);
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe('Forest');
  });

  test('returns empty array for empty input', () => {
    expect(parseLines('')).toEqual([]);
    expect(parseLines('   \n  ')).toEqual([]);
  });
});
