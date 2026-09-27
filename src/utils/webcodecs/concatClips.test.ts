import { describe, it, expect } from 'vitest'
import { AudioTimeline, concatClipsWebCodecs, sameDecoderConfig } from './concatClips'
import { CancelledError } from '../cancellation'

describe('sameDecoderConfig', () => {
  const avcC = new Uint8Array([1, 100, 0, 40, 255])

  it('matches identical codec strings and description bytes', () => {
    expect(
      sameDecoderConfig(
        { codec: 'avc1.640028', description: avcC },
        { codec: 'avc1.640028', description: avcC.slice().buffer },
      ),
    ).toBe(true)
  })

  it('rejects a different codec string', () => {
    expect(
      sameDecoderConfig({ codec: 'avc1.640028', description: avcC }, { codec: 'avc1.64001f', description: avcC }),
    ).toBe(false)
  })

  it('rejects different description bytes (e.g. SPS/PPS from another encoder)', () => {
    expect(
      sameDecoderConfig(
        { codec: 'avc1.640028', description: avcC },
        { codec: 'avc1.640028', description: new Uint8Array([1, 100, 0, 40, 254]) },
      ),
    ).toBe(false)
  })

  it('rejects when only one side has a description', () => {
    expect(sameDecoderConfig({ codec: 'mp4a.40.2', description: avcC }, { codec: 'mp4a.40.2' })).toBe(false)
    expect(sameDecoderConfig({ codec: 'mp4a.40.2' }, { codec: 'mp4a.40.2' })).toBe(true)
  })
})

describe('AudioTimeline', () => {
  const F = 1024 / 48000

  it('lays frames of one clip back to back from its first timestamp', () => {
    const t = new AudioTimeline(F)
    expect(t.place(-F)).toEqual({ drop: false, silenceBefore: 0, timestamp: -F })
    expect(t.place(0)).toEqual({ drop: false, silenceBefore: 0, timestamp: 0 })
  })

  it('drops frames the previous clip already covers (overlap at a join)', () => {
    const t = new AudioTimeline(F)
    t.place(0)
    t.place(F)
    // Next clip starts earlier than the running end by more than half a frame.
    expect(t.place(F - F)).toEqual({ drop: true })
    expect(t.place(2 * F + 0.004)).toEqual({ drop: false, silenceBefore: 0, timestamp: 2 * F })
  })

  it('fills a gap of more than half a frame with silent frames', () => {
    const t = new AudioTimeline(F)
    t.place(0)
    const p = t.place(3.2 * F)
    expect(p).toEqual({ drop: false, silenceBefore: 2, timestamp: 3 * F })
  })

  it('never drifts more than half a frame over many joins', () => {
    const t = new AudioTimeline(F)
    let offset = 0
    for (let clip = 0; clip < 200; clip++) {
      // Clips whose lengths aren't a multiple of the frame duration.
      const length = 1 + ((clip * 0.137) % 1)
      for (let ts = -F; ts < length; ts += F) {
        const p = t.place(offset + ts)
        if (!p.drop) expect(Math.abs(p.timestamp - (offset + ts))).toBeLessThanOrEqual(F / 2 + 1e-9)
      }
      offset += length
    }
  })
})

describe('concatClipsWebCodecs', () => {
  it('rejects a cancelled join before reading any clip', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(concatClipsWebCodecs([new Blob(['x'])], controller.signal)).rejects.toBeInstanceOf(CancelledError)
  })
})
