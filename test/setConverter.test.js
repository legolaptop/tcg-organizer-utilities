'use strict';

// Mock the global fetch before requiring setConverter so the module uses our mock.
const mockSets = [
  { name: 'Limited Edition Alpha', code: 'lea' },
  { name: 'Limited Edition Beta',  code: 'leb' },
  { name: 'Dominaria',             code: 'dom' },
  { name: 'Magic 2015 Core Set',   code: 'm15' },
  { name: 'Core Set 2021',         code: 'm21' },
  { name: 'Foundations Jumpstart', code: 'fjb' },
];

global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ data: mockSets }),
});

const { loadSets, convertSetName, clearCache } = require('../src/setConverter');

beforeEach(() => {
  clearCache();
  global.fetch.mockClear();
});

describe('loadSets', () => {
  test('calls the Scryfall API once and returns a Map', async () => {
    const map = await loadSets();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.scryfall.com/sets',
      expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': expect.any(String) }) })
    );
    expect(map).toBeInstanceOf(Map);
    // Map includes bundled sets plus anything from mock Scryfall response
    expect(map.size).toBeGreaterThanOrEqual(mockSets.length);
    // All mock sets should be present
    for (const s of mockSets) {
      expect(map.has(s.name.toLowerCase())).toBe(true);
    }
  });

  test('caches results so Scryfall is called only once', async () => {
    await loadSets();
    await loadSets();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('stores codes as uppercase', async () => {
    const map = await loadSets();
    for (const [, code] of map) {
      expect(code).toBe(code.toUpperCase());
    }
  });
});

describe('convertSetName', () => {
  test.each([
    ['Limited Edition Alpha', 'LEA'],
    ['limited edition alpha', 'LEA'],  // case-insensitive
    ['Dominaria',             'DOM'],
    ['Magic 2015 Core Set',   'M15'],
    ['Core Set 2021',         'M21'],
    ['Foundations Jumpstart', 'FJB'],
  ])('"%s" → "%s"', async (input, expected) => {
    const result = await convertSetName(input);
    expect(result).toBe(expected);
  });

  test('returns original string when no match found', async () => {
    const result = await convertSetName('Nonexistent Set XYZ');
    expect(result).toBe('Nonexistent Set XYZ');
  });

  test('partial match: input is a substring of a set name', async () => {
    // "Dominaria" is a full match but if we use a partial keyword…
    // "Magic 2015" is contained in "Magic 2015 Core Set"
    const result = await convertSetName('Magic 2015');
    expect(result).toBe('M15');
  });

  test('handles Scryfall API error gracefully (falls back to bundled data)', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 503 });
    // Should NOT throw – falls back to bundled sets seeded before the fetch attempt
    const result = await convertSetName('Dominaria');
    expect(result).toBe('DOM');
  });
});

describe('convertSetName – Commander heuristics', () => {
  test('"Commander: Bloomburrow" resolves to "BLC"', async () => {
    const result = await convertSetName('Commander: Bloomburrow');
    expect(result).toBe('BLC');
  });

  test('"Commander: Foundations" resolves to "FDC"', async () => {
    const result = await convertSetName('Commander: Foundations');
    expect(result).toBe('FDC');
  });

  test('"Commander: Murders at Karlov Manor" resolves to "MKC"', async () => {
    const result = await convertSetName('Commander: Murders at Karlov Manor');
    expect(result).toBe('MKC');
  });

  test('returns original string when Commander heuristic finds no match', async () => {
    const result = await convertSetName('Commander: Nonexistent Place');
    expect(result).toBe('Commander: Nonexistent Place');
  });
});

describe('convertSetName – card prints fallback', () => {
  test('resolves set via Scryfall card prints when no map match', async () => {
    const mockPrints = {
      data: [
        { set: 'dom', set_name: 'Dominaria' },
        { set: 'xyz', set_name: 'Totally Obscure Set Name' },
      ],
    };
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: mockSets }) })  // sets
      .mockResolvedValueOnce({ ok: true, json: async () => mockPrints });            // prints
    const result = await convertSetName('Totally Obscure Set Name', 'Lightning Bolt');
    expect(result).toBe('XYZ');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('api.scryfall.com/cards/search'),
      expect.any(Object)
    );
  });

  test('card prints URL encodes the card name with exact-match operator', async () => {
    const mockPrints = { data: [] };
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: mockSets }) })
      .mockResolvedValueOnce({ ok: true, json: async () => mockPrints });
    await convertSetName('Unknown Set', 'Sol Ring');
    const printsCall = global.fetch.mock.calls.find((args) =>
      args[0].includes('cards/search')
    );
    expect(printsCall).toBeDefined();
    expect(printsCall[0]).toContain('unique=prints');
    expect(printsCall[0]).toContain(encodeURIComponent('!"Sol Ring"'));
  });

  test('does not query card prints when cardName is omitted', async () => {
    const result = await convertSetName('Nonexistent Set XYZ');
    // Only the sets endpoint should be called
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('https://api.scryfall.com/sets', expect.any(Object));
    expect(result).toBe('Nonexistent Set XYZ');
  });

  test('falls back gracefully when card prints fetch fails', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: mockSets }) })
      .mockRejectedValueOnce(new Error('Network error'));
    const result = await convertSetName('Nonexistent Set XYZ', 'Lightning Bolt');
    expect(result).toBe('Nonexistent Set XYZ');
  });

  test('falls back gracefully when card prints returns non-ok status', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: mockSets }) })
      .mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await convertSetName('Nonexistent Set XYZ', 'Lightning Bolt');
    expect(result).toBe('Nonexistent Set XYZ');
  });
});
