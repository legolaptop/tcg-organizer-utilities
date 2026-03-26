'use strict';

// Mock global.fetch before requiring cardValidator so the module uses our mock.
global.fetch = jest.fn();

const { validateCardName, validateCardNames, normalizeCardName, clearCache } = require('../src/cardValidator');

beforeEach(() => {
  clearCache();
  global.fetch.mockClear();
});

// ── normalizeCardName ─────────────────────────────────────────
describe('normalizeCardName', () => {
  test.each([
    ['Solitude (Borderless)',       'Solitude'],
    ['Liliana of the Veil (Promo)', 'Liliana of the Veil'],
    ['Black Lotus',                 'Black Lotus'],
    ["Jace, the Mind Sculptor",     "Jace, the Mind Sculptor"],
    ['Alesha, Who Laughs at Fate',  'Alesha, Who Laughs at Fate'],
    ['Forest',                      'Forest'],
  ])('"%s" → "%s"', (input, expected) => {
    expect(normalizeCardName(input)).toBe(expected);
  });
});

// ── validateCardNames ─────────────────────────────────────────
describe('validateCardNames', () => {
  test('returns true for found cards and false for not-found cards', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ name: 'Black Lotus' }, { name: 'Forest' }],
        not_found: [{ name: 'nonexistentcard xyz' }],
      }),
    });

    const result = await validateCardNames(['Black Lotus', 'Forest', 'NonexistentCard XYZ']);
    expect(result.get('Black Lotus')).toBe(true);
    expect(result.get('Forest')).toBe(true);
    expect(result.get('NonexistentCard XYZ')).toBe(false);
  });

  test('strips parenthetical variants before querying', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ name: 'Solitude' }],
        not_found: [],
      }),
    });

    const result = await validateCardNames(['Solitude (Borderless)']);
    expect(result.get('Solitude (Borderless)')).toBe(true);

    // Verify the API was called with the normalized (stripped) name
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.identifiers[0].name).toBe('solitude');
  });

  test('caches results so Scryfall is called only once per unique name', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ name: 'Forest' }], not_found: [] }),
    });

    await validateCardNames(['Forest', 'Forest']);
    await validateCardNames(['Forest']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('defaults to true when Scryfall is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await validateCardNames(['Some Card']);
    expect(result.get('Some Card')).toBe(true);
  });

  test('defaults to true when Scryfall returns an error status', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const result = await validateCardNames(['Some Card']);
    expect(result.get('Some Card')).toBe(true);
  });

  test('sends requests to Scryfall collection endpoint via POST', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], not_found: [] }),
    });

    await validateCardNames(['Black Lotus']);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.scryfall.com/cards/collection',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ── validateCardName ──────────────────────────────────────────
describe('validateCardName', () => {
  test('returns true for a found card', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ name: 'Forest' }], not_found: [] }),
    });
    expect(await validateCardName('Forest')).toBe(true);
  });

  test('returns false for a not-found card', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], not_found: [{ name: 'not a real card' }] }),
    });
    expect(await validateCardName('Not A Real Card')).toBe(false);
  });
});
