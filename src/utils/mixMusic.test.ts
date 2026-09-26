import { describe, it, expect, vi } from 'vitest'
import { buildMixFilterComplex, mixMusic } from './mixMusic'

// Mocks a shared, stateful FFmpeg instance so we can assert that two
// concurrent mixMusic() calls never have their FFmpeg-touching bodies
// "in flight" at the same time (the real risk this queue guards against:
// writeFile/exec/readFile/deleteFile interleaving on the same fixed
// filenames across two overlapping calls).
vi.mock('@ffmpeg/ffmpeg', () => {
  let active = false
  let overlapDetected = false
  return {
    FFmpeg: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      const handlers: Record<string, ((arg: { message: string }) => void)[]> = {}
      this.on = vi.fn((event: string, handler: (arg: { message: string }) => void) => {
        ;(handlers[event] ??= []).push(handler)
      })
      this.off = vi.fn((event: string, handler: (arg: { message: string }) => void) => {
        handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler)
      })
      this.load = vi.fn().mockResolvedValue(undefined)
      this.writeFile = vi.fn(async (name: string) => {
        if (name === 'in.mp4') {
          if (active) overlapDetected = true
          active = true
        }
        await new Promise((r) => setTimeout(r, 2))
      })
      this.exec = vi.fn(async () => {
        handlers['log']?.forEach((h) => h({ message: 'Duration: 00:00:10.00' }))
        await new Promise((r) => setTimeout(r, 5))
      })
      this.readFile = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
      this.deleteFile = vi.fn((name: string) => {
        if (name === 'out.mp4') active = false
      })
      return this
    }),
    __getOverlapDetected: () => overlapDetected,
  }
})

vi.mock('@ffmpeg/util', () => ({
  fetchFile: vi.fn(async () => new Uint8Array([0])),
}))

describe('buildMixFilterComplex', () => {
  it('loops the track, fades in/out around the exact video duration, applies volume, then mixes with the original audio', () => {
    const result = buildMixFilterComplex(30, 0.5)
    expect(result).toBe(
      "[1:a]aloop=loop=-1:size=2e9,atrim=0:30.000,afade=t=in:d=1,afade=t=out:st=29.000:d=1,volume=0.5[bgm];" +
      "[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0[aout]"
    )
  })

  it('formats a fractional duration to 3 decimal places', () => {
    const result = buildMixFilterComplex(12.3456, 0.8)
    expect(result).toContain('atrim=0:12.346')
    expect(result).toContain('afade=t=out:st=11.346:d=1')
  })

  it('clamps the fade-out start at 0 for a very short video (under 1s)', () => {
    const result = buildMixFilterComplex(0.5, 1)
    expect(result).toContain('afade=t=out:st=0.000:d=1')
  })
})

describe('mixMusic', () => {
  it('serializes concurrent calls so their FFmpeg-touching bodies never overlap', async () => {
    const video1 = new Blob(['video-one'], { type: 'video/mp4' })
    const video2 = new Blob(['video-two'], { type: 'video/mp4' })
    const track = new Blob(['track'], { type: 'audio/mp3' })

    const [result1, result2] = await Promise.all([
      mixMusic(video1, track, 0.5),
      mixMusic(video2, track, 0.8),
    ])

    expect(result1).toBeInstanceOf(Blob)
    expect(result2).toBeInstanceOf(Blob)

    const ffmpegModule = (await import('@ffmpeg/ffmpeg')) as unknown as {
      __getOverlapDetected: () => boolean
    }
    expect(ffmpegModule.__getOverlapDetected()).toBe(false)
  })
})
