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
    const res = await handleImageRequest(req(URL_OK, 'wrong'), fetchImage)
    expect(res.status).toBe(401)
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('passes the image through with its type', async () => {
    const fetchImage = vi.fn(async () => image('image/png', 4))
    const res = await handleImageRequest(req(), fetchImage)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect((await res.arrayBuffer()).byteLength).toBe(4)
    expect(fetchImage).toHaveBeenCalledWith(URL_OK, expect.objectContaining({ redirect: 'manual' }))
  })

  it.each([
    ['http://images.example.com/a.jpg'],
    ['https://localhost/a.jpg'],
    ['https://127.0.0.1/a.jpg'],
    ['https://10.1.2.3/a.jpg'],
    ['https://192.168.0.2/a.jpg'],
    ['https://172.16.0.1/a.jpg'],
    ['https://169.254.169.254/latest/meta-data'],
    ['https://[::1]/a.jpg'],
    ['not a url'],
  ])('refuses %s', async url => {
    const fetchImage = vi.fn()
    const res = await handleImageRequest(req(url), fetchImage)
    expect(res.status).toBe(400)
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('needs a url', async () => {
    expect((await handleImageRequest(req(null), vi.fn())).status).toBe(400)
  })

  it('follows a redirect, checking where it goes', async () => {
    const fetchImage = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/b.jpg' } }))
      .mockResolvedValueOnce(image())
    const res = await handleImageRequest(req(), fetchImage)
    expect(res.status).toBe(200)
    expect(fetchImage).toHaveBeenLastCalledWith('https://images.example.com/b.jpg', expect.anything())

    const toPrivate = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/' } }))
    expect((await handleImageRequest(req(), toPrivate)).status).toBe(400)
    expect(toPrivate).toHaveBeenCalledTimes(1)
  })

  it('gives up after a few redirects', async () => {
    const fetchImage = vi.fn(async () => new Response(null, { status: 302, headers: { location: '/again.jpg' } }))
    expect((await handleImageRequest(req(), fetchImage)).status).toBe(502)
    expect(fetchImage.mock.calls.length).toBeLessThan(6)
  })

  it('refuses what is not an image, and svg', async () => {
    expect((await handleImageRequest(req(), async () => image('text/html'))).status).toBe(415)
    expect((await handleImageRequest(req(), async () => image('image/svg+xml'))).status).toBe(415)
  })

  it('refuses an image too big to pass through', async () => {
    const declared = await handleImageRequest(req(), async () => image('image/jpeg', 3, { 'content-length': String(MAX_IMAGE_BYTES + 1) }))
    expect(declared.status).toBe(413)
    const actual = await handleImageRequest(req(), async () => image('image/jpeg', MAX_IMAGE_BYTES + 1))
    expect(actual.status).toBe(413)
  })

  it('reports a failed download', async () => {
    expect((await handleImageRequest(req(), async () => new Response(null, { status: 404 }))).status).toBe(502)
  })

  it('only answers GET', async () => {
    expect((await handleImageRequest(req(URL_OK, 'secret', 'POST'), vi.fn())).status).toBe(405)
  })
})
