const CACHE = 'teleprompter-v3'

self.addEventListener('install', event => {
  self.skipWaiting()
  // Do NOT cache index.html — always fetch it fresh so new JS/CSS hashes are picked up
  event.waitUntil(caches.open(CACHE))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)

  // For navigation requests (HTML pages), always go to the network first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    )
    return
  }

  // For hashed assets (JS/CSS/images), use cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached
      return fetch(event.request).then(response => {
        // Only cache same-origin assets with hash-like filenames
        if (
          response.ok &&
          url.origin === self.location.origin &&
          url.pathname.startsWith('/assets/')
        ) {
          const clone = response.clone()
          caches.open(CACHE).then(cache => cache.put(event.request, clone))
        }
        return response
      })
    })
  )
})
