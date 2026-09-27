import { describe, it, expect } from 'vitest'
import { sameDecoderConfig } from './concatClips'

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
