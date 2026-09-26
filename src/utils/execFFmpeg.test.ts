import { describe, it, expect } from 'vitest'
import type { FFmpeg } from '@ffmpeg/ffmpeg'
import { execFFmpeg } from './execFFmpeg'

function fakeFFmpeg(exec: (args: string[]) => Promise<unknown>): FFmpeg {
  return { exec } as unknown as FFmpeg
}

describe('execFFmpeg', () => {
  it('resolves normally when the underlying exec succeeds', async () => {
    const ff = fakeFFmpeg(async () => 0)
    await expect(execFFmpeg(ff, ['-version'])).resolves.toBeUndefined()
  })

  it('swallows the @ffmpeg/core-mt Safari/WebKit exit-unwind TypeError', async () => {
    // Exact message WebKit produces when @ffmpeg/core-mt's own internal
    // `!e.message.startsWith('Aborted')` guard runs against an unwind value
    // that has no `.message` property (see execFFmpeg.ts for the full story).
    const ff = fakeFFmpeg(async () => {
      throw new TypeError("undefined is not an object (evaluating 'e.message.startsWith')")
    })
    await expect(execFFmpeg(ff, ['-version'])).resolves.toBeUndefined()
  })

  it('rethrows any other error unchanged', async () => {
    const ff = fakeFFmpeg(async () => {
      throw new Error('out of memory')
    })
    await expect(execFFmpeg(ff, ['-version'])).rejects.toThrow('out of memory')
  })

  it('rethrows an unrelated TypeError unchanged', async () => {
    const ff = fakeFFmpeg(async () => {
      throw new TypeError('some other bug')
    })
    await expect(execFFmpeg(ff, ['-version'])).rejects.toThrow('some other bug')
  })
})
