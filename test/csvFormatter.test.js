'use strict';

const { formatToCSV, csvField } = require('../src/csvFormatter');

describe('csvField', () => {
  test('returns plain string unchanged', () => {
    expect(csvField('hello')).toBe('hello');
  });

  test('wraps in quotes when value contains a comma', () => {
    expect(csvField('hello, world')).toBe('"hello, world"');
  });

  test('wraps in quotes when value contains a double-quote and escapes it', () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });

  test('wraps in quotes when value contains a newline', () => {
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });

  test('converts numbers to strings', () => {
    expect(csvField(42)).toBe('42');
  });
});

describe('formatToCSV', () => {
  test('produces correct header row', () => {
    const csv = formatToCSV([]);
    expect(csv).toBe('Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,Scryfall ID,Purchase price,Condition');
  });

  test('formats a full card object correctly', () => {
    const cards = [
      {
        name: 'Black Lotus',
        setCode: 'LEA',
        setName: 'Limited Edition Alpha',
        collectorNumber: '232',
        foil: false,
        rarity: 'rare',
        quantity: 1,
        scryfallId: 'abc-123',
        price: 5000.00,
        condition: 'Near Mint',
      },
    ];
    const csv = formatToCSV(cards);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,Scryfall ID,Purchase price,Condition');
    expect(lines[1]).toBe('Black Lotus,LEA,Limited Edition Alpha,232,,rare,1,abc-123,5000.00,Near Mint');
  });

  test('marks foil cards', () => {
    const cards = [{ name: 'Forest', setCode: 'M21', setName: 'Core Set 2021', foil: true, quantity: 2, condition: 'Near Mint' }];
    const csv = formatToCSV(cards);
    const row = csv.split('\n')[1];
    expect(row).toContain(',foil,');
  });

  test('omits price when undefined', () => {
    const cards = [{ name: 'Forest', setCode: 'M21', quantity: 1, condition: 'Near Mint' }];
    const csv = formatToCSV(cards);
    const row = csv.split('\n')[1];
    // price column should be empty (two consecutive commas before Condition)
    expect(row).toMatch(/,,Near Mint$/);
  });

  test('uses sensible defaults when optional fields are missing', () => {
    const cards = [{ name: 'Island' }];
    const csv = formatToCSV(cards);
    const row = csv.split('\n')[1];
    // Should have name, empty set code/name/collector/foil/rarity, quantity 1, empty scryfallId, empty price, Near Mint
    expect(row).toBe('Island,,,,,,1,,,Near Mint');
  });

  test('formats multiple cards', () => {
    const cards = [
      { name: 'Forest', setCode: 'M21', quantity: 4, condition: 'Near Mint' },
      { name: 'Island', setCode: 'M21', quantity: 2, condition: 'Lightly Played' },
    ];
    const csv = formatToCSV(cards);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
  });
});
