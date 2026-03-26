'use strict';

const {
  parseLines,
  parseSingleLine,
  parseMultiLine,
  parseCondition,
  looksLikeSetName,
  isRarityLine,
  isSoldByLine,
  parseConditionLine,
  parseExtendedMultiLineBlock,
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
    ['Rarity: M',                   false],
    ['Rarity: R',                   false],
    ['Condition: Near Mint',        false],
    ['Sold by SomeSeller',          false],
    ['ITEMS\tDETAILS\tPRICE\tQUANTITY', false],
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

  test('returns null when card line contains a tab (e.g. table header)', () => {
    expect(parseMultiLine('ITEMS\tDETAILS\tPRICE\tQUANTITY', 'Dominaria')).toBeNull();
  });
});

// ── isRarityLine ──────────────────────────────────────────────
describe('isRarityLine', () => {
  test.each([
    ['Rarity: M',   true],
    ['Rarity: R',   true],
    ['rarity: C',   true],
    ['Dominaria',   false],
    ['Near Mint',   false],
    ['',            false],
  ])('"%s" → %s', (input, expected) => {
    expect(isRarityLine(input)).toBe(expected);
  });
});

// ── isSoldByLine ──────────────────────────────────────────────
describe('isSoldByLine', () => {
  test.each([
    ['Sold by SomeSeller',  true],
    ['sold by another',     true],
    ['Sold',                false],
    ['Dominaria',           false],
    ['',                    false],
  ])('"%s" → %s', (input, expected) => {
    expect(isSoldByLine(input)).toBe(expected);
  });
});

// ── parseConditionLine ────────────────────────────────────────
describe('parseConditionLine', () => {
  test('parses condition, price, and quantity separated by tabs', () => {
    expect(parseConditionLine('Condition: Lightly Played\t$10.59\t1'))
      .toEqual({ condition: 'Lightly Played', foil: false, price: 10.59, quantity: 1 });
  });

  test('parses Near Mint with quantity > 1', () => {
    expect(parseConditionLine('Condition: Near Mint\t$6.28\t3'))
      .toEqual({ condition: 'Near Mint', foil: false, price: 6.28, quantity: 3 });
  });

  test('parses condition separated by spaces', () => {
    expect(parseConditionLine('Condition: Near Mint $6.28 1'))
      .toEqual({ condition: 'Near Mint', foil: false, price: 6.28, quantity: 1 });
  });

  test('returns null for a plain card name line', () => {
    expect(parseConditionLine('Black Lotus')).toBeNull();
  });

  test('returns null for a set name line', () => {
    expect(parseConditionLine('Limited Edition Alpha')).toBeNull();
  });

  test('returns null for a rarity line', () => {
    expect(parseConditionLine('Rarity: M')).toBeNull();
  });
});

// ── parseExtendedMultiLineBlock ───────────────────────────────
describe('parseExtendedMultiLineBlock', () => {
  test('parses card / set / rarity / condition block', () => {
    const lines = [
      'Summon: Knights of Round',
      'FINAL FANTASY',
      'Rarity: M',
      'Condition: Lightly Played\t$10.59\t1',
    ];
    const result = parseExtendedMultiLineBlock(lines, 0);
    expect(result).not.toBeNull();
    expect(result.card).toEqual({
      quantity: 1,
      name: 'Summon: Knights of Round',
      setName: 'FINAL FANTASY',
      condition: 'Lightly Played',
      foil: false,
      price: 10.59,
    });
    expect(result.consumed).toBe(4);
  });

  test('parses block with "Commander:" prefixed set name', () => {
    const lines = [
      "Teval's Judgment",
      'Commander: Tarkir: Dragonstorm',
      'Rarity: R',
      'Condition: Near Mint\t$6.28\t1',
    ];
    const result = parseExtendedMultiLineBlock(lines, 0);
    expect(result).not.toBeNull();
    expect(result.card).toMatchObject({
      name: "Teval's Judgment",
      setName: 'Commander: Tarkir: Dragonstorm',
      condition: 'Near Mint',
      quantity: 1,
      price: 6.28,
    });
  });

  test('skips "Sold by" line after condition', () => {
    const lines = [
      'Black Lotus',
      'Limited Edition Alpha',
      'Rarity: M',
      'Condition: Near Mint\t$500.00\t1',
      'Sold by TopSeller',
    ];
    const result = parseExtendedMultiLineBlock(lines, 0);
    expect(result).not.toBeNull();
    expect(result.consumed).toBe(5);
    expect(result.card.name).toBe('Black Lotus');
    expect(result.card.price).toBe(500.00);
  });

  test('works without a rarity line', () => {
    const lines = [
      'Forest',
      'Core Set 2021',
      'Condition: Near Mint\t$0.25\t4',
    ];
    const result = parseExtendedMultiLineBlock(lines, 0);
    expect(result).not.toBeNull();
    expect(result.card).toMatchObject({ name: 'Forest', quantity: 4, price: 0.25 });
    expect(result.consumed).toBe(3);
  });

  test('returns null when there is no condition line', () => {
    const lines = [
      'Black Lotus',
      'Limited Edition Alpha',
      'Rarity: M',
    ];
    expect(parseExtendedMultiLineBlock(lines, 0)).toBeNull();
  });

  test('returns null when set line looks like a condition', () => {
    const lines = [
      'Black Lotus',
      'Near Mint',
      'Condition: Near Mint\t$500.00\t1',
    ];
    expect(parseExtendedMultiLineBlock(lines, 0)).toBeNull();
  });

  test('skips duplicate card name line (TCGPlayer image+name selection)', () => {
    const lines = [
      'Alesha, Who Laughs at Fate',
      'Alesha, Who Laughs at Fate',
      'Foundations',
      'Sold by StevensonGames',
      'Rarity: R',
      'Condition: Near Mint\t$1.76\t1',
    ];
    const result = parseExtendedMultiLineBlock(lines, 0);
    expect(result).not.toBeNull();
    expect(result.card).toEqual({
      quantity: 1,
      name: 'Alesha, Who Laughs at Fate',
      setName: 'Foundations',
      condition: 'Near Mint',
      foil: false,
      price: 1.76,
    });
    expect(result.consumed).toBe(6);
  });

  test('skips "Sold by" line appearing before rarity', () => {
    const lines = [
      'Animate Dead',
      'The List Reprints',
      'Sold by Tarkan\'s Cards',
      'Rarity: U',
      'Condition: Near Mint\t$8.79\t1',
    ];
    const result = parseExtendedMultiLineBlock(lines, 0);
    expect(result).not.toBeNull();
    expect(result.card).toMatchObject({
      name: 'Animate Dead',
      setName: 'The List Reprints',
      condition: 'Near Mint',
      price: 8.79,
    });
    expect(result.consumed).toBe(5);
  });

  test('returns null when card line contains a tab (table header)', () => {
    const lines = [
      'ITEMS\tDETAILS\tPRICE\tQUANTITY',
      'Alesha, Who Laughs at Fate',
      'Foundations',
      'Condition: Near Mint\t$1.76\t1',
    ];
    expect(parseExtendedMultiLineBlock(lines, 0)).toBeNull();
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

  test('parses extended multi-line block format (problem statement examples)', () => {
    const text = [
      'Summon: Knights of Round',
      'FINAL FANTASY',
      'Rarity: M',
      'Condition: Lightly Played\t$10.59\t1',
      '',
      "Teval's Judgment",
      'Commander: Tarkir: Dragonstorm',
      'Rarity: R',
      'Condition: Near Mint\t$6.28\t1',
    ].join('\n');

    const cards = parseLines(text);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toEqual({
      quantity: 1,
      name: 'Summon: Knights of Round',
      setName: 'FINAL FANTASY',
      condition: 'Lightly Played',
      foil: false,
      price: 10.59,
    });
    expect(cards[1]).toEqual({
      quantity: 1,
      name: "Teval's Judgment",
      setName: 'Commander: Tarkir: Dragonstorm',
      condition: 'Near Mint',
      foil: false,
      price: 6.28,
    });
  });

  test('parses extended multi-line block with Sold by line', () => {
    const text = [
      'Black Lotus',
      'Limited Edition Alpha',
      'Rarity: M',
      'Condition: Near Mint\t$500.00\t1',
      'Sold by TopSeller',
    ].join('\n');

    const cards = parseLines(text);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ name: 'Black Lotus', condition: 'Near Mint', quantity: 1, price: 500.00 });
  });

  test('returns empty array for empty input', () => {
    expect(parseLines('')).toEqual([]);
    expect(parseLines('   \n  ')).toEqual([]);
  });

  test('parses TCGPlayer order format with duplicate card name and Sold by before rarity', () => {
    const text = [
      'ITEMS\tDETAILS\tPRICE\tQUANTITY',
      'Alesha, Who Laughs at Fate',
      'Alesha, Who Laughs at Fate',
      'Foundations',
      'Sold by StevensonGames',
      'Rarity: R',
      'Condition: Near Mint\t$1.76\t1',
      'Anguished Unmaking',
      'Anguished Unmaking',
      'Commander: The Lord of the Rings: Tales of Middle-earth',
      'Sold by TheVaultOnline',
      'Rarity: R',
      'Condition: Near Mint\t$2.51\t1',
    ].join('\n');

    const cards = parseLines(text);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toEqual({
      quantity: 1,
      name: 'Alesha, Who Laughs at Fate',
      setName: 'Foundations',
      condition: 'Near Mint',
      foil: false,
      price: 1.76,
    });
    expect(cards[1]).toEqual({
      quantity: 1,
      name: 'Anguished Unmaking',
      setName: 'Commander: The Lord of the Rings: Tales of Middle-earth',
      condition: 'Near Mint',
      foil: false,
      price: 2.51,
    });
  });
});
