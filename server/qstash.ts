import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

// Upstash QStash calls our own endpoint later (Threads has no scheduling,
// and its video processing outlasts a function), with each call signed.
// https://upstash.com/docs/qstash

export interface QStashConfig {
  token: string
  /** The region's API, e.g. https://qstash.upstash.io (QSTASH_URL). */
  url: string
  currentSigningKey: string
  nextSigningKey: string
}

export function qstashConfigFromEnv(): QStashConfig | null {
  const env = (name: string) => process.env[name]?.trim() ?? ''
  const token = env('QSTASH_TOKEN')
  const currentSigningKey = env('QSTASH_CURRENT_SIGNING_KEY')
  const nextSigningKey = env('QSTASH_NEXT_SIGNING_KEY')
  if (!token || !currentSigningKey || !nextSigningKey) return null
  return { token, url: (env('QSTASH_URL') || 'https://qstash.upstash.io').replace(/\/+$/, ''), currentSigningKey, nextSigningKey }
}

export type Delivery = { delaySeconds: number } | { notBefore: Date }

/** Have QStash POST `body` (as JSON) to `destination` now, after a delay, or at a time; gives the message id. */
export async function enqueue(
  config: QStashConfig,
  destination: string,
  body: unknown,
  delivery: Delivery,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
    'Content-Type': 'application/json',
    'Upstash-Retries': '3',
  }
  if ('delaySeconds' in delivery) {
    if (delivery.delaySeconds > 0) headers['Upstash-Delay'] = `${Math.round(delivery.delaySeconds)}s`
  } else {
    headers['Upstash-Not-Before'] = String(Math.floor(delivery.notBefore.getTime() / 1000))
  }
  const res = await fetchImpl(`${config.url}/v2/publish/${destination}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`QStash publish failed: HTTP ${res.status} ${await res.text().catch(() => '')}`)
  const sent = (await res.json().catch(() => null)) as { messageId?: unknown } | null
  return typeof sent?.messageId === 'string' ? sent.messageId : undefined
}

/** Call off a message QStash has not delivered yet; throws when it can't (already delivered, or refused). */
export async function cancelMessage(config: QStashConfig, messageId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${config.url}/v2/messages/${encodeURIComponent(messageId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${config.token}` },
  })
  if (!res.ok) throw new Error(`QStash cancel failed: HTTP ${res.status} ${await res.text().catch(() => '')}`)
}

function base64url(value: Buffer): string {
  return value.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function verifyWith(key: string, jwt: string, body: string, url: string, nowSec: number): boolean {
  const parts = jwt.split('.')
  if (parts.length !== 3) return false
  const [header, payload, signature] = parts
  const expected = base64url(createHmac('sha256', key).update(`${header}.${payload}`).digest())
  const given = Buffer.from(signature)
  if (given.length !== expected.length || !timingSafeEqual(given, Buffer.from(expected))) return false
  let claims: { iss?: string; sub?: string; exp?: number; nbf?: number; body?: string }
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return false
  }
  if (claims.iss !== 'Upstash') return false
  if (claims.sub !== undefined && claims.sub !== url) return false
  if (typeof claims.exp === 'number' && nowSec > claims.exp) return false
  if (typeof claims.nbf === 'number' && nowSec < claims.nbf) return false
  const bodyHash = base64url(createHash('sha256').update(body).digest())
  return claims.body?.replace(/=+$/, '') === bodyHash
}

/**
 * Whether a request really came from QStash: its Upstash-Signature JWT is
 * signed with the current or the next signing key, for this URL and body.
 */
export function verifySignature(config: QStashConfig, signature: string | null, body: string, url: string, now = new Date()): boolean {
  if (!signature) return false
  const nowSec = Math.floor(now.getTime() / 1000)
  return (
    verifyWith(config.currentSigningKey, signature, body, url, nowSec) ||
    verifyWith(config.nextSigningKey, signature, body, url, nowSec)
  )
}
