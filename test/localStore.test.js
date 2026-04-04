'use strict';

// ── IndexedDB mock ─────────────────────────────────────────────
// A minimal in-memory IndexedDB mock sufficient to test localStore.js.

function makeIdbMock() {
  const stores = {};

  function makeRequest(resultFn) {
    const req = { onsuccess: null, onerror: null };
    Promise.resolve().then(() => {
      try {
        req.result = resultFn();
        if (req.onsuccess) req.onsuccess({ target: req });
      } catch (err) {
        req.error = err;
        if (req.onerror) req.onerror({ target: req });
      }
    });
    return req;
  }

  function makeObjectStore(storeName) {
    if (!stores[storeName]) stores[storeName] = {};
    return {
      get(key) {
        return makeRequest(() => stores[storeName][key]);
      },
      put(value, key) {
        return makeRequest(() => { stores[storeName][key] = value; });
      },
      delete(key) {
        return makeRequest(() => { delete stores[storeName][key]; });
      },
    };
  }

  function makeTransaction(storeNames, _mode) {
    return {
      objectStore(name) { return makeObjectStore(name); },
    };
  }

  function makeDb(storeNamesToCreate) {
    storeNamesToCreate.forEach(n => { if (!stores[n]) stores[n] = {}; });
    return {
      objectStoreNames: {
        contains(name) { return Object.prototype.hasOwnProperty.call(stores, name); },
      },
      createObjectStore(name) { stores[name] = {}; },
      transaction: makeTransaction,
    };
  }

  const idb = {
    open(dbName, version) {
      const req = { onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null };
      Promise.resolve().then(() => {
        const db = makeDb([]);
        if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: db } });
        req.result = db;
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
    _stores: stores,
  };
  return idb;
}

// ── Helpers ────────────────────────────────────────────────────

function loadModule(idbMock) {
  // Set up browser globals that localStore.js expects.
  global.indexedDB = idbMock;
  global.window = global;

  // Clear module cache so the IIFE re-runs with fresh state.
  jest.resetModules();
  // Require by path — localStore.js is a plain script, not a CommonJS module,
  // but require() will execute it in the module wrapper.
  require('../docs/localStore.js');
  return global.window.localStore;
}

// ── Tests ──────────────────────────────────────────────────────

describe('localStore', () => {
  let store;

  beforeEach(() => {
    const idb = makeIdbMock();
    store = loadModule(idb);
  });

  afterEach(() => {
    delete global.indexedDB;
    // window === global in this env; leave it but remove localStore
    delete global.window.localStore;
  });

  test('load() returns null when nothing has been saved', async () => {
    const result = await store.load();
    expect(result).toBeNull();
  });

  test('save() and load() round-trip a full payload', async () => {
    const payload = {
      version: 2,
      orders: [{ id: 'order-1', cards: [] }],
      trackerState: { 'order-1': { received: true } },
      updatedAt: '2024-01-15T10:00:00.000Z',
    };
    await store.save(payload);
    const loaded = await store.load();
    expect(loaded).toEqual(payload);
  });

  test('save() overwrites a previously stored payload', async () => {
    const first = { version: 2, orders: [], trackerState: {}, updatedAt: '2024-01-01T00:00:00.000Z' };
    const second = { version: 2, orders: [{ id: 'order-2', cards: [] }], trackerState: {}, updatedAt: '2024-01-02T00:00:00.000Z' };
    await store.save(first);
    await store.save(second);
    const loaded = await store.load();
    expect(loaded).toEqual(second);
  });

  test('clear() removes stored state so load() returns null', async () => {
    const payload = { version: 2, orders: [], trackerState: {}, updatedAt: '2024-01-01T00:00:00.000Z' };
    await store.save(payload);
    await store.clear();
    const loaded = await store.load();
    expect(loaded).toBeNull();
  });

  test('load() returns null (not undefined) when store is empty', async () => {
    const result = await store.load();
    expect(result).toBeNull();
    expect(result).not.toBeUndefined();
  });

  test('save() preserves the updatedAt field', async () => {
    const updatedAt = '2025-06-01T12:34:56.789Z';
    await store.save({ version: 2, orders: [], trackerState: {}, updatedAt });
    const loaded = await store.load();
    expect(loaded.updatedAt).toBe(updatedAt);
  });

  test('multiple independent save/load cycles are independent', async () => {
    const a = { version: 2, orders: [{ id: 'a' }], trackerState: {}, updatedAt: '2024-01-01T00:00:00.000Z' };
    await store.save(a);
    await store.clear();
    const afterClear = await store.load();
    expect(afterClear).toBeNull();

    const b = { version: 2, orders: [{ id: 'b' }], trackerState: {}, updatedAt: '2024-01-02T00:00:00.000Z' };
    await store.save(b);
    const afterSecondSave = await store.load();
    expect(afterSecondSave).toEqual(b);
  });
});
