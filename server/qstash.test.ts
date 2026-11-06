// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { enqueue, verifySignature, type QStashConfig } from './qstash.js'
import { qstashSignature } from './testing/qstash.js'

const config: QStashConfig = { token: 'qtok', url: 'https://qstash.upstash.io', currentSigningKey: 'cur', nextSigningKey: 'next' }
const URL_ = 'https://app.test/api/threads'
const NOW = new Date('2026-11-07T00:00:00Z')
const nowSec = NOW.getTime() / 1000

describe('verifySignature', () => {
  const body = '{"step":"create"}'

  it('accepts a signature by the current or the next key', () => {
    expect(verifySignature(config, qstashSignature('cur', body, URL_), body, URL_, NOW)).toBe(true)
    expect(verifySignature(config, qstashSignature('next', body, URL_), body, URL_, NOW)).toBe(true)
  })

  it('refuses another key, another body, another URL, an expired one, or none', () => {
    expect(verifySignature(config, qstashSignature('other', body, URL_), body, URL_, NOW)).toBe(false)
    expect(verifySignature(config, qstashSignature('cur', body, URL_), '{"step":"publish"}', URL_, NOW)).toBe(false)
    expect(verifySignature(config, qstashSignature('cur', body, 'https://evil.test/x'), body, URL_, NOW)).toBe(false)
    expect(verifySignature(config, qstashSignature('cur', body, URL_, { exp: nowSec - 1 }), body, URL_, NOW)).toBe(false)
    expect(verifySignature(config, null, body, URL_, NOW)).toBe(false)
    expect(verifySignature(config, 'not.a.jwt', body, URL_, NOW)).toBe(false)
  })
})

describe('enqueue', () => {
  it('publishes to the destination with a delay or a not-before time', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'))
    await enqueue(config, URL_, { a: 1 }, { delaySeconds: 30 }, fetchImpl as unknown as typeof fetch)
    await enqueue(config, URL_, { a: 1 }, { notBefore: new Date('2026-11-07T03:00:00Z') }, fetchImpl as unknown as typeof fetch)
    await enqueue(config, URL_, { a: 1 }, { delaySeconds: 0 }, fetchImpl as unknown as typeof fetch)
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][]
    expect(calls[0][0]).toBe('https://qstash.upstash.io/v2/publish/https://app.test/api/threads')
    expect(calls[0][1].headers).toMatchObject({ Authorization: 'Bearer qtok', 'Upstash-Delay': '30s' })
    expect(calls[1][1].headers).toMatchObject({ 'Upstash-Not-Before': '1794020400' })
    expect(calls[2][1].headers).not.toHaveProperty('Upstash-Delay')
    expect(calls[0][1].body).toBe('{"a":1}')
  })

  it('throws when QStash refuses', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad token', { status: 401 }))
    await expect(enqueue(config, URL_, {}, { delaySeconds: 0 }, fetchImpl as unknown as typeof fetch)).rejects.toThrow('401')
  })
})
