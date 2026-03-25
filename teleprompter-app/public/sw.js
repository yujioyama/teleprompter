const CACHE = 'teleprompter-v2'

self.addEventListener('install', event => {
  // Take control immediately without waiting for old SW to be released
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(['/', '/index.html'])
    )
  )
})

self.addEventListener('activate', event => {
  // Delete all old caches so stale assets never block a new deployment
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached ?? fetch(event.request))
  )
})
