/**
 * The Fallback - Service Worker
 * Implements Stale-While-Revalidate for fast repeat visits
 * 
 * Strategies:
 * - Cache First: Icons, fonts, external libraries (rarely change)
 * - Stale-While-Revalidate: App files (HTML, CSS, JS) - fast loads, background updates
 * - Network First: API calls, dynamic data
 */

const CACHE_VERSION = 'v64';
const CACHE_NAME = `the-fallback-${CACHE_VERSION}`;

// Files to pre-cache on install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/logo.png'
];

// External resources to cache (Cache First - rarely change)
const EXTERNAL_CACHE = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&display=swap'
];

// Patterns for different caching strategies
const CACHE_STRATEGIES = {
  // Cache First: static assets that rarely change
  cacheFirst: [
    /\/icons\//,
    /\.png$/,
    /\.svg$/,
    /\.woff2?$/,
    /fonts\.googleapis\.com/,
    /fonts\.gstatic\.com/,
    /cdnjs\.cloudflare\.com/
  ],
  
  // Network First: API calls and dynamic content
  networkFirst: [
    /firebasestorage\.app/,
    /firebaseio\.com/,
    /googleapis\.com\/identitytoolkit/,
    /securetoken\.googleapis\.com/
  ],
  
  // Stale-While-Revalidate: app shell files
  staleWhileRevalidate: [
    /\.html$/,
    /\.css$/,
    /\.js$/,
    /manifest\.json$/
  ]
};

// ─────────────────────────────────────────────────────────────────────────────
// INSTALL: Pre-cache essential assets
// ─────────────────────────────────────────────────────────────────────────────

self.addEventListener('install', event => {
  console.log(`[SW] Installing ${CACHE_NAME}`);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Pre-caching app shell');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        // Cache external resources separately (don't fail install if these fail)
        return caches.open(CACHE_NAME).then(cache => {
          return Promise.allSettled(
            EXTERNAL_CACHE.map(url => 
              cache.add(url).catch(err => console.warn(`[SW] Failed to cache: ${url}`, err))
            )
          );
        });
      })
      .then(() => self.skipWaiting()) // Activate immediately
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATE: Clean up old caches
// ─────────────────────────────────────────────────────────────────────────────

self.addEventListener('activate', event => {
  console.log(`[SW] Activating ${CACHE_NAME}`);
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name.startsWith('the-fallback-') && name !== CACHE_NAME)
            .map(name => {
              console.log(`[SW] Deleting old cache: ${name}`);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim()) // Take control immediately
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// FETCH: Apply appropriate caching strategy
// ─────────────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') return;
  
  // Skip chrome-extension and other non-http(s) protocols
  if (!url.protocol.startsWith('http')) return;
  
  // Determine strategy based on URL patterns
  const strategy = getStrategy(url.href);
  
  switch (strategy) {
    case 'cacheFirst':
      event.respondWith(cacheFirst(request));
      break;
    case 'networkFirst':
      event.respondWith(networkFirst(request));
      break;
    case 'staleWhileRevalidate':
    default:
      event.respondWith(staleWhileRevalidate(request));
      break;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CACHING STRATEGIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cache First: Return cached version, fall back to network
 * Best for: Static assets that rarely change (icons, fonts, libraries)
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.warn('[SW] Cache First fetch failed:', error);
    return new Response('Offline', { status: 503 });
  }
}

/**
 * Network First: Try network, fall back to cache
 * Best for: API calls, dynamic data
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    return new Response('Offline', { status: 503 });
  }
}

/**
 * Stale-While-Revalidate: Return cache immediately, update in background
 * Best for: App shell files (HTML, CSS, JS) - fast loads with fresh updates
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  
  // Fetch fresh version in background
  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(error => {
      console.warn('[SW] Background fetch failed:', error);
      return null;
    });
  
  // Return cached version immediately if available
  if (cached) {
    // Still fetch in background to update cache
    fetchPromise;
    return cached;
  }
  
  // No cache, wait for network
  const response = await fetchPromise;
  if (response) {
    return response;
  }
  
  // Network failed and no cache
  return new Response('Offline', { status: 503 });
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine which caching strategy to use based on URL
 */
function getStrategy(url) {
  // Check Cache First patterns
  for (const pattern of CACHE_STRATEGIES.cacheFirst) {
    if (pattern.test(url)) return 'cacheFirst';
  }
  
  // Check Network First patterns
  for (const pattern of CACHE_STRATEGIES.networkFirst) {
    if (pattern.test(url)) return 'networkFirst';
  }
  
  // Check Stale-While-Revalidate patterns
  for (const pattern of CACHE_STRATEGIES.staleWhileRevalidate) {
    if (pattern.test(url)) return 'staleWhileRevalidate';
  }
  
  // Default to stale-while-revalidate for same-origin requests
  return 'staleWhileRevalidate';
}

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE HANDLING (for manual cache updates)
// ─────────────────────────────────────────────────────────────────────────────

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  
  if (event.data === 'clearCache') {
    caches.delete(CACHE_NAME).then(() => {
      console.log('[SW] Cache cleared');
    });
  }
});
