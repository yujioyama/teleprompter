// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleImageRequest, MAX_IMAGE_BYTES } from './imageApi.js'

beforeEach(() => {
  vi.stubEnv('INBOX_SECRET', 'secret')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const URL_OK = 'https://images.example.com/a.jpg'
const PUBLIC_ADDRESS = '93.184.216.34'
const publicHost = async () => [PUBLIC_ADDRESS]

/** The handler with DNS answered here; a test about addresses passes its own lookup. */
const handle = (request: Request, fetchImage: Parameters<typeof handleImageRequest>[1]) =>
  handleImageRequest(request, fetchImage, publicHost)

function req(url: string | null = URL_OK, key: string | null = 'secret', method = 'GET') {
  const query = url === null ? '' : `?url=${encodeURIComponent(url)}`
  return new Request(`https://app.test/api/image${query}`, {
    method,
    headers: key === null ? {} : { Authorization: `Bearer ${key}` },
  })
}

function image(type = 'image/jpeg', bytes = 3, headers: Record<string, string> = {}) {
  return new Response(new Uint8Array(bytes), { headers: { 'content-type': type, ...headers } })
}

describe('handleImageRequest', () => {
  it('rejects a wrong key before fetching anything', async () => {
    const fetchImage = vi.fn()
    const res = await handle(req(URL_OK, 'wrong'), fetchImage)
    expect(res.status).toBe(401)
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('passes the image through with its type', async () => {
    const fetchImage = vi.fn(async () => image('image/png', 4))
    const res = await handle(req(), fetchImage)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect((await res.arrayBuffer()).byteLength).toBe(4)
    expect(fetchImage).toHaveBeenCalledWith(URL_OK, expect.objectContaining({ redirect: 'manual' }))
  })

  it.each([
    ['http://images.example.com/a.jpg'],
    ['https://127.0.0.1/a.jpg'],
    ['https://10.1.2.3/a.jpg'],
    ['https://192.168.0.2/a.jpg'],
    ['https://172.16.0.1/a.jpg'],
    ['https://169.254.169.254/latest/meta-data'],
    ['https://100.64.0.1/a.jpg'],
    ['https://2130706433/a.jpg'],
    ['https://0x7f.0.0.1/a.jpg'],
    ['https://[::1]/a.jpg'],
    ['https://[::ffff:127.0.0.1]/a.jpg'],
    ['https://[2606:4700::1111]/a.jpg'],
    ['https://user:secret@images.example.com/a.jpg'],
    ['not a url'],
  ])('refuses %s, with the real lookup', async url => {
    const fetchImage = vi.fn()
    const res = await handleImageRequest(req(url), fetchImage)
    expect(res.status).toBe(400)
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it.each([
    ['loopback', '127.0.0.1'],
    ['a private range', '10.1.2.3'],
    ['another private range', '172.31.0.1'],
    ['yet another private range', '192.168.0.2'],
    ['the cloud metadata address', '169.254.169.254'],
    ['shared address space', '100.64.0.1'],
    ['this network', '0.0.0.0'],
    ['benchmarking space', '198.18.0.1'],
    ['multicast', '224.0.0.1'],
    ['reserved space', '240.0.0.1'],
    ['IPv6 loopback', '::1'],
    ['IPv6 unspecified', '::'],
    ['IPv6 unique local', 'fd00::1'],
    ['IPv6 link local', 'fe80::1'],
    ['IPv6 multicast', 'ff02::1'],
    ['an IPv4-mapped private address', '::ffff:10.0.0.1'],
    ['NAT64 of a private address', '64:ff9b::a00:1'],
  ])('refuses a name that resolves to %s', async (_name, address) => {
    const fetchImage = vi.fn()
    const res = await handleImageRequest(req(), fetchImage, async () => [address])
    expect(res.status).toBe(400)
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('refuses a name when any one of its addresses is not public', async () => {
    const fetchImage = vi.fn()
    const res = await handleImageRequest(req(), fetchImage, async () => [PUBLIC_ADDRESS, '10.0.0.1'])
    expect(res.status).toBe(400)
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it.each([
    ['does not resolve', async () => { throw new Error('ENOTFOUND') }],
    ['resolves to nothing', async () => []],
  ])('refuses a name that %s', async (_name, lookupHost) => {
    const fetchImage = vi.fn()
    expect((await handleImageRequest(req(), fetchImage, lookupHost)).status).toBe(400)
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('accepts public IPv6 addresses', async () => {
    const res = await handleImageRequest(req(), async () => image(), async () => ['2606:4700::1111'])
    expect(res.status).toBe(200)
  })

  it('checks the addresses of where a redirect goes', async () => {
    const fetchImage = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://internal.example.com/a.jpg' } }))
    const lookupHost = vi.fn(async (host: string) => (host === 'internal.example.com' ? ['10.0.0.1'] : [PUBLIC_ADDRESS]))
    expect((await handleImageRequest(req(), fetchImage, lookupHost)).status).toBe(400)
    expect(lookupHost).toHaveBeenCalledWith('internal.example.com')
    expect(fetchImage).toHaveBeenCalledTimes(1)
  })

  it('needs a url', async () => {
    expect((await handle(req(null), vi.fn())).status).toBe(400)
  })

  it('follows a redirect, checking where it goes', async () => {
    const fetchImage = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/b.jpg' } }))
      .mockResolvedValueOnce(image())
    const res = await handle(req(), fetchImage)
    expect(res.status).toBe(200)
    expect(fetchImage).toHaveBeenLastCalledWith('https://images.example.com/b.jpg', expect.anything())

    // Answered by the real lookup's rule for a literal: no name to resolve.
    const toPrivate = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://[::1]/' } }))
    expect((await handle(req(), toPrivate)).status).toBe(400)
    expect(toPrivate).toHaveBeenCalledTimes(1)
  })

  it('gives up after a few redirects', async () => {
    const fetchImage = vi.fn(async () => new Response(null, { status: 302, headers: { location: '/again.jpg' } }))
    expect((await handle(req(), fetchImage)).status).toBe(502)
    expect(fetchImage.mock.calls.length).toBeLessThan(6)
  })

  it('refuses what is not an image, and svg', async () => {
    expect((await handle(req(), async () => image('text/html'))).status).toBe(415)
    expect((await handle(req(), async () => image('image/svg+xml'))).status).toBe(415)
  })

  it('refuses an image too big to pass through', async () => {
    const declared = await handle(req(), async () => image('image/jpeg', 3, { 'content-length': String(MAX_IMAGE_BYTES + 1) }))
    expect(declared.status).toBe(413)
    const actual = await handle(req(), async () => image('image/jpeg', MAX_IMAGE_BYTES + 1))
    expect(actual.status).toBe(413)
  })

  it('reports a failed download', async () => {
    expect((await handle(req(), async () => new Response(null, { status: 404 }))).status).toBe(502)
  })

  it('only answers GET', async () => {
    expect((await handle(req(URL_OK, 'secret', 'POST'), vi.fn())).status).toBe(405)
  })
})
