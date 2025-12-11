// HydroBlox Service Worker
const CACHE_NAME = 'hydroblox-offline-v2';

// Files to cache immediately on install
const PRECACHE_URLS = [
    './',
    './index.html',
    './offline.html',
    './manifest.json',
    './js/app.js',
    './js/db-manager.js',
    './js/hydrolang/hydrolang.js',
    './js/hydrolang/181.hydrolang.js',
    './js/hydrolang/841.hydrolang.js',
    './js/hydrolang/972.hydrolang.js',
    './js/hydrolang/utils/nn.worker.js',
    './js/hydrolang/hydrolang_functions_schema2.json',
    './js/hydrolang/hydrolang_datasources_schema.json',
    './styles/results.css',
    './styles/data-visualizer.css',
    './styles/exports.css',
    './icons/icon-192.svg',
    './icons/icon-512.svg',
    './icons/maskable-icon.svg',
    './data/app-info.json',
    './data/item-index.json',
    './data/workflows.json'
];

// Install event - precache critical files
self.addEventListener('install', event => {
    console.log('[SW] Install event');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching critical resources');
                // Cache files one by one to avoid failing on missing files
                return Promise.allSettled(
                    PRECACHE_URLS.map(url => 
                        cache.add(url).catch(err => 
                            console.warn(`[SW] Failed to cache ${url}:`, err)
                        )
                    )
                );
            })
            .then(() => {
                console.log('[SW] Critical resources cached successfully');
                return self.skipWaiting();
            })
            .catch(err => {
                console.error('[SW] Error during install:', err);
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames
                        .filter(cacheName => cacheName !== CACHE_NAME)
                        .map(cacheName => caches.delete(cacheName))
                );
            })
            .then(() => {
                // Take control of all pages immediately
                return self.clients.claim();
            })
    );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', event => {
    const req = event.request;
    const url = new URL(req.url);
    const isScriptOrStyle = req.destination === 'script' || req.destination === 'style' || url.pathname.endsWith('.js') || url.pathname.endsWith('.css');

    if (isScriptOrStyle) {
        // Network-first for scripts/styles
        event.respondWith(
            fetch(req).then(resp => {
                const copy = resp.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
                return resp;
            }).catch(() => caches.match(req))
        );
        return;
    }

    // Default: cache-first with network fallback
    event.respondWith(
        caches.match(req).then(cached => {
            if (cached) return cached;
            return fetch(req).then(resp => {
                const copy = resp.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
                return resp;
            }).catch(() => {
                if (req.mode === 'navigate') return caches.match('/offline.html');
            });
        })
    );
});

// Handle data API requests
self.addEventListener('fetch', event => {
    if (event.request.url.includes('/data/')) {
        event.respondWith(
            caches.match(event.request)
                .then(response => {
                    if (response) {
                        return response;
                    }
                    return fetch(event.request);
                })
                .catch(() => {
                    // If network fails, return empty data with proper structure
                    if (event.request.url.includes('workflows.json')) {
                        return new Response(JSON.stringify({}), {
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }
                })
        );
    }
});

// Listen for message events from the main thread
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});