// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keyMatches } from './auth.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('keyMatches', () => {
  it('accepts the configured secret', () => {
    vi.stubEnv('INBOX_SECRET', 'correct-horse')
    expect(keyMatches('correct-horse')).toBe(true)
  })

  it('rejects a wrong, empty or missing key', () => {
    vi.stubEnv('INBOX_SECRET', 'correct-horse')
    expect(keyMatches('correct-hors')).toBe(false)
    expect(keyMatches('')).toBe(false)
    expect(keyMatches(null)).toBe(false)
    expect(keyMatches(undefined)).toBe(false)
  })

  it('rejects everything when no secret is configured', () => {
    vi.stubEnv('INBOX_SECRET', '')
    expect(keyMatches('')).toBe(false)
    expect(keyMatches('anything')).toBe(false)
  })
})
