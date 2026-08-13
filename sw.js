/**
 * Keeps the table playable without a signal. Fresh copies win whenever
 * the network answers, so a deploy is never more than a reload away.
 */

var CACHE = 'blackjack-coach-v2';

var ASSETS = [
    './',
    'index.html',
    'manifest.webmanifest',
    'app/app.css',
    'app/app.js',
    'app/sound.js',
    'app/coach.worker.js',
    'app/icon.svg',
    'app/icon-180.png',
    'app/icon-192.png',
    'app/icon-512.png',
    'src/Utils.js',
    'src/Strategy.js',
    'src/Game.js'
];

self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE).then(function(cache) {
            return cache.addAll(ASSETS);
        }).then(function() {
            return self.skipWaiting();
        })
    );
});

self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(keys.map(function(key) {
                return key === CACHE ? null : caches.delete(key);
            }));
        }).then(function() {
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', function(event) {
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        fetch(event.request).then(function(response) {
            var copy = response.clone();

            caches.open(CACHE).then(function(cache) {
                cache.put(event.request, copy);
            });

            return response;
        }).catch(function() {
            return caches.match(event.request).then(function(hit) {
                return hit || caches.match('index.html');
            });
        })
    );
});
