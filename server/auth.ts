import { createHash, timingSafeEqual } from 'node:crypto'

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/**
 * Whether `given` is the inbox secret. Both sides are hashed first so the
 * comparison is constant-time regardless of length. With no secret
 * configured nothing matches, so a missing env var never opens the inbox.
 */
export function keyMatches(given: string | null | undefined): boolean {
  const secret = process.env.INBOX_SECRET
  if (!secret || !given) return false
  return timingSafeEqual(digest(given), digest(secret))
}
