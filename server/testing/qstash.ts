import { createHash, createHmac } from 'node:crypto'

function b64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url')
}

/** A JWT as QStash signs it. */
export function qstashSignature(
  key: string,
  body: string,
  url: string,
  claims: Record<string, unknown> = {},
  nowSec = Date.parse('2026-11-07T00:00:00Z') / 1000,
): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({
      iss: 'Upstash',
      sub: url,
      exp: nowSec + 300,
      nbf: nowSec - 10,
      body: createHash('sha256').update(body).digest('base64url'),
      ...claims,
    }),
  )
  const sig = createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
