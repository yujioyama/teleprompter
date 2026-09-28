import { describe, it, expect } from 'vitest'
import { burnSubtitlesWebCodecs } from './burnSubtitlesWebCodecs'
import { CancelledError } from '../cancellation'

describe('burnSubtitlesWebCodecs', () => {
  it('rejects a cancelled burn before starting it', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      burnSubtitlesWebCodecs(new Blob(['x']), [], undefined, controller.signal),
    ).rejects.toBeInstanceOf(CancelledError)
  })
})
