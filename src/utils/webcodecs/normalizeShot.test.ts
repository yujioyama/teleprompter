import { describe, it, expect } from 'vitest'
import { normalizeShotWebCodecs } from './normalizeShot'
import { CancelledError } from '../cancellation'

describe('normalizeShotWebCodecs', () => {
  it('rejects a cancelled encode before starting it', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      normalizeShotWebCodecs(new Blob(['x']), 0, 1, undefined, [], controller.signal),
    ).rejects.toBeInstanceOf(CancelledError)
  })
})
