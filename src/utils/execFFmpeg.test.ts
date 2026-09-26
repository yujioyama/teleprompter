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

  it('swallows the @ffmpeg/core-mt Safari/WebKit exit-unwind error', async () => {
    // @ffmpeg/ffmpeg's worker catches whatever @ffmpeg/core-mt's own internal
    // `!e.message.startsWith('Aborted')` guard throws (a TypeError on
    // Safari/WebKit, since the unwind value has no `.message` there) and
    // posts it back as a plain string via `e.toString()` — so `ff.exec`
    // rejects with that exact string, never an Error instance (see
    // execFFmpeg.ts for the full story).
    const ff = fakeFFmpeg(async () => {
      throw "TypeError: undefined is not an object (evaluating 'e.message.startsWith')"
    })
    await expect(execFFmpeg(ff, ['-version'])).resolves.toBeUndefined()
  })

  it('rethrows any other error unchanged', async () => {
    const ff = fakeFFmpeg(async () => {
      throw new Error('out of memory')
    })
    await expect(execFFmpeg(ff, ['-version'])).rejects.toThrow('out of memory')
  })

  it('rethrows an unrelated string rejection unchanged', async () => {
    const ff = fakeFFmpeg(async () => {
      throw 'TypeError: some other bug'
    })
    await expect(execFFmpeg(ff, ['-version'])).rejects.toBe('TypeError: some other bug')
  })
})
