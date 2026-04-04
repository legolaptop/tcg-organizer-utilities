'use strict';

/**
 * Tiny IndexedDB key-value helper for local-first tracker state persistence.
 *
 * DB:    "tcg-tracker"
 * Store: "kv"
 * Key:   "state"
 *
 * Payload shape:
 *   { version: 2, orders: [...], trackerState: {...}, updatedAt: <ISO string> }
 *
 * Exposed as window.localStore = { load, save, clear }
 */
(function () {
  var DB_NAME = 'tcg-tracker';
  var STORE_NAME = 'kv';
  var STATE_KEY = 'state';
  var DB_VERSION = 1;

  var _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) {
        _dbPromise = null;
        reject(e.target.error);
      };
      req.onblocked = function () {
        _dbPromise = null;
        reject(new Error('IndexedDB open blocked'));
      };
    });
    return _dbPromise;
  }

  /**
   * Load the stored state document.
   * @returns {Promise<Object|null>} The stored payload, or null if none exists.
   */
  function load() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var req = tx.objectStore(STORE_NAME).get(STATE_KEY);
        req.onsuccess = function (e) {
          resolve(e.target.result != null ? e.target.result : null);
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  /**
   * Persist the state payload under the fixed "state" key.
   * @param {Object} payload
   * @returns {Promise<void>}
   */
  function save(payload) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var req = tx.objectStore(STORE_NAME).put(payload, STATE_KEY);
        req.onsuccess = function () { resolve(); };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  /**
   * Delete the stored state document.
   * @returns {Promise<void>}
   */
  function clear() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var req = tx.objectStore(STORE_NAME).delete(STATE_KEY);
        req.onsuccess = function () { resolve(); };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  window.localStore = { load: load, save: save, clear: clear };
})();
