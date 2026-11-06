// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { accountIdOf, checkR2, newVideoUpload, presignUrl, r2ConfigFromEnv } from './r2.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('presignUrl', () => {
  it('matches the AWS SigV4 presigned URL example', () => {
    // From the AWS docs "Authenticating Requests: Using Query Parameters" example.
    const url = presignUrl({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      expiresSeconds: 86400,
      now: new Date('2013-05-24T00:00:00Z'),
    })
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    )
  })
})

describe('newVideoUpload', () => {
  const config = {
    accountId: 'acct',
    accessKeyId: 'AK',
    secretAccessKey: 'SK',
    bucket: 'teleprompter-posts',
    publicUrl: 'https://pub-abc.r2.dev',
  }

  it('uploads to the bucket and serves the same key from the public URL', () => {
    const { uploadUrl, videoUrl } = newVideoUpload(config, new Date('2026-11-07T00:00:00Z'))
    const key = videoUrl.slice('https://pub-abc.r2.dev/'.length)
    expect(key).toMatch(/^posts\/2026-11-07\/[0-9a-f-]{36}\.mp4$/)
    expect(uploadUrl.startsWith(`https://acct.r2.cloudflarestorage.com/teleprompter-posts/${key}?`)).toBe(true)
    expect(uploadUrl).toContain('%2Fauto%2Fs3%2Faws4_request')
    expect(uploadUrl).toContain('X-Amz-Expires=900')
  })

  it('gives each upload its own key', () => {
    expect(newVideoUpload(config).videoUrl).not.toBe(newVideoUpload(config).videoUrl)
  })
})

describe('r2ConfigFromEnv', () => {
  it('is null until every setting is there', () => {
    vi.stubEnv('R2_ACCOUNT_ID', 'a')
    vi.stubEnv('R2_ACCESS_KEY_ID', 'b')
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'c')
    vi.stubEnv('R2_BUCKET', 'd')
    vi.stubEnv('R2_PUBLIC_URL', '')
    expect(r2ConfigFromEnv()).toBeNull()
    vi.stubEnv('R2_PUBLIC_URL', 'https://pub-x.r2.dev/')
    expect(r2ConfigFromEnv()?.publicUrl).toBe('https://pub-x.r2.dev')
  })
})

describe('accountIdOf', () => {
  it('takes the ID out of a pasted endpoint URL', () => {
    const id = '0123456789abcdef0123456789abcdef'
    expect(accountIdOf(id)).toBe(id)
    expect(accountIdOf(`https://${id}.r2.cloudflarestorage.com`)).toBe(id)
    expect(accountIdOf(`https://${id}.r2.cloudflarestorage.com/teleprompter-posts`)).toBe(id)
  })

  it('trims what was pasted into the env', () => {
    vi.stubEnv('R2_ACCOUNT_ID', ' https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com\n')
    vi.stubEnv('R2_ACCESS_KEY_ID', 'b ')
    vi.stubEnv('R2_SECRET_ACCESS_KEY', ' c')
    vi.stubEnv('R2_BUCKET', 'd')
    vi.stubEnv('R2_PUBLIC_URL', 'https://pub-x.r2.dev')
    expect(r2ConfigFromEnv()).toMatchObject({ accountId: '0123456789abcdef0123456789abcdef', accessKeyId: 'b', secretAccessKey: 'c' })
  })
})

describe('checkR2', () => {
  const config = { accountId: 'acct', accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'b', publicUrl: 'https://pub-x.r2.dev' }

  it("reports R2's reason when the write is refused", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('<Error><Code>SignatureDoesNotMatch</Code><Message>bad sig</Message></Error>', { status: 403 }),
    )
    const check = await checkR2(config, fetchImpl as unknown as typeof fetch)
    expect(check.upload).toEqual({ ok: false, detail: 'HTTP 403 SignatureDoesNotMatch bad sig' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reads back from the public URL after writing', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url)
      return new Response(urls.length === 1 ? '' : 'not found', { status: urls.length === 1 ? 200 : 404 })
    })
    const check = await checkR2(config, fetchImpl as unknown as typeof fetch)
    expect(check).toEqual({ upload: { ok: true, detail: 'HTTP 200' }, publicRead: { ok: false, detail: 'HTTP 404' } })
    expect(urls[1]).toMatch(/^https:\/\/pub-x\.r2\.dev\/posts\/check\//)
  })

  it('says when R2 cannot be reached at all', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND acct.r2.cloudflarestorage.com') })
    })
    const check = await checkR2(config, fetchImpl as unknown as typeof fetch)
    expect(check.upload.detail).toContain('ENOTFOUND')
  })
})
