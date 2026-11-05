import { withAuthedJson } from './http.js'

/** Well under what a serverless function may send back (4.5MB on Vercel). */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_REDIRECTS = 3
// Wikimedia refuses requests that don't say who is asking.
const USER_AGENT = 'teleprompter-app/1.0 (image download for one user)'

type FetchImage = (url: string, init: RequestInit) => Promise<Response>

const PRIVATE_HOST = [
  /^localhost$/i,
  /\.localhost$/i,
  /^\[/, // IPv6 literals: no public image needs one.
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
]

/** The URL when it is an https one on a public-looking host, else null. */
function publicHttps(raw: string, base?: string): URL | null {
  let url: URL
  try {
    url = new URL(raw, base)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || PRIVATE_HOST.some(host => host.test(url.hostname))) return null
  return url
}

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status })
}

/**
 * Downloads an image for the app, which can't fetch from a site that sends no
 * CORS headers. Behind the inbox key, and only for https images on public
 * hosts; each redirect is checked the same way.
 */
export function handleImageRequest(request: Request, fetchImage: FetchImage = fetch): Promise<Response> {
  return withAuthedJson(request, 'image', async () => {
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
    const raw = new URL(request.url).searchParams.get('url')
    let url = raw ? publicHttps(raw) : null
    if (!url) return fail(400, 'an https image url is required')

    let upstream = await fetchImage(url.href, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT } })
    for (let hops = 0; upstream.status >= 300 && upstream.status < 400; hops++) {
      if (hops === MAX_REDIRECTS) return fail(502, 'too many redirects')
      url = publicHttps(upstream.headers.get('location') ?? '', url.href)
      if (!url) return fail(400, 'redirected away from a public https url')
      upstream = await fetchImage(url.href, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT } })
    }
    if (!upstream.ok) return fail(502, `download failed: ${upstream.status}`)

    const type = upstream.headers.get('content-type') ?? ''
    if (!type.startsWith('image/') || type.startsWith('image/svg')) return fail(415, 'not a supported image')
    if (Number(upstream.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) return fail(413, 'image too large')
    const bytes = await upstream.arrayBuffer()
    if (bytes.byteLength > MAX_IMAGE_BYTES) return fail(413, 'image too large')
    return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } })
  })
}
