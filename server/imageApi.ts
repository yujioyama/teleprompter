import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { withAuthedJson } from './http.js'

/** Well under what a serverless function may send back (4.5MB on Vercel). */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_REDIRECTS = 3
// Wikimedia refuses requests that don't say who is asking.
const USER_AGENT = 'teleprompter-app/1.0 (image download for one user)'

type FetchImage = (url: string, init: RequestInit) => Promise<Response>
/** Every address a host name resolves to. */
type LookupHost = (hostname: string) => Promise<string[]>

const lookupAll: LookupHost = async hostname => (await lookup(hostname, { all: true })).map(found => found.address)

// Everything that isn't the public internet. An IPv4-mapped IPv6 address is
// checked against the IPv4 ranges too (BlockList does that itself).
const NOT_PUBLIC = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], // this network
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // shared address space
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64: an IPv4 address inside
  ['64:ff9b:1::', 48],
  ['100::', 64], // discard
  ['2001::', 32], // Teredo: an IPv4 address inside
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4: an IPv4 address inside
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link local
  ['ff00::', 8], // multicast
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, 'ipv6')
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  return family !== 0 && !NOT_PUBLIC.check(address, family === 4 ? 'ipv4' : 'ipv6')
}

/**
 * The URL when it is a plain https one whose host resolves only to public
 * addresses, else null: a name can point anywhere, so the name itself proves
 * nothing, and a host that doesn't resolve is refused too. An IP address written
 * in the URL needs no DNS (the URL parser has already normalized the odd ways
 * of writing one). A name changing its answer between this check and the fetch
 * isn't caught: that would take pinning the connection, more than this
 * key-guarded, image-only endpoint calls for.
 */
async function publicHttps(raw: string, lookupHost: LookupHost, base?: string): Promise<URL | null> {
  let url: URL
  try {
    url = new URL(raw, base)
  } catch {
    return null
  }
  // IPv6 literals: no public image needs one.
  if (url.protocol !== 'https:' || url.username || url.password || url.hostname.startsWith('[')) return null
  try {
    const addresses = await lookupHost(url.hostname)
    return addresses.length > 0 && addresses.every(isPublicAddress) ? url : null
  } catch {
    return null
  }
}

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status })
}

/**
 * Downloads an image for the app, which can't fetch from a site that sends no
 * CORS headers. Behind the inbox key, and only for https images on public
 * hosts; each redirect is checked the same way.
 */
export function handleImageRequest(
  request: Request,
  fetchImage: FetchImage = fetch,
  lookupHost: LookupHost = lookupAll,
): Promise<Response> {
  return withAuthedJson(request, 'image', async () => {
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
    const raw = new URL(request.url).searchParams.get('url')
    let url = raw ? await publicHttps(raw, lookupHost) : null
    if (!url) return fail(400, 'an https image url on a public host is required')

    let upstream = await fetchImage(url.href, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT } })
    for (let hops = 0; upstream.status >= 300 && upstream.status < 400; hops++) {
      if (hops === MAX_REDIRECTS) return fail(502, 'too many redirects')
      url = await publicHttps(upstream.headers.get('location') ?? '', lookupHost, url.href)
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
