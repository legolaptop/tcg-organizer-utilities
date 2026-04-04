'use strict';

/**
 * Service Worker for TCG Manifest — offline app shell caching.
 *
 * Strategy:
 *  - install: pre-cache all app shell files
 *  - activate: delete old caches
 *  - fetch: cache-first for same-origin GET requests (app shell);
 *           network-only for cross-origin requests (Drive API, Scryfall, GIS)
 */

var CACHE_NAME = 'tcg-tracker-v1';

var APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './tracker.js',
  './style.css',
  './localStore.js',
  './sw.js',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(APP_SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) { return key !== CACHE_NAME; })
            .map(function (key) { return caches.delete(key); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  // Let cross-origin requests (Drive, Scryfall, GIS) go to the network untouched.
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    })
  );
});
