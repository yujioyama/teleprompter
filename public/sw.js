const CACHE = 'teleprompter-v3'

// How long a launch waits on the network for a fresh index.html before
// opening the copy kept from last time.
const SHELL_TIMEOUT_MS = 4000

self.addEventListener('install', event => {
  self.skipWaiting()
  event.waitUntil(caches.open(CACHE))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// index.html: from the network, so new JS/CSS hashes are picked up, and
// kept for next time. Offline, or on a network too slow to answer, the kept
// copy opens the app instead (its hashed assets are in the cache too); every
// processing step runs on the device, so it then works as it did.
async function shell(request) {
  const cache = await caches.open(CACHE)
  const kept = await cache.match('/index.html')
  const fresh = fetch(request).then(response => {
    if (response.ok) cache.put('/index.html', response.clone())
    return response
  })
  if (!kept) return fresh
  const slow = new Promise(resolve => setTimeout(() => resolve(kept), SHELL_TIMEOUT_MS))
  return Promise.race([fresh.catch(() => kept), slow])
}

// Files that never change under their URL: hashed build output, the
// ffmpeg.wasm core (its URL carries the package version) and the BGM tracks.
function isKept(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/ffmpeg/') || url.pathname.startsWith('/music/'))
  )
}

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  // A media element asks for byte ranges, and Safari won't play a whole
  // file answered in their place: leave those to the browser.
  if (request.headers.has('range')) return
  const url = new URL(request.url)

  // Navigations, and the app's own check for a newer version.
  if (request.mode === 'navigate' || (url.origin === self.location.origin && url.pathname === '/index.html')) {
    event.respondWith(shell(request))
    return
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached
      return fetch(request).then(response => {
        if (response.status === 200 && isKept(url)) {
          const clone = response.clone()
          caches.open(CACHE).then(cache => cache.put(request, clone))
        }
        return response
      })
    })
  )
})
