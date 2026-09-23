import { describe, it, expect } from 'vitest'
import { buildTrimAndNormalizeArgs } from './trimAndNormalizeShot'

describe('buildTrimAndNormalizeArgs', () => {
  it('places -ss and -t around the input, re-encodes to a fixed H.264/AAC profile', () => {
    const args = buildTrimAndNormalizeArgs(1.5, 4.0)
    expect(args).toEqual([
      '-ss', '1.500',
      '-i', 'in.mp4',
      '-t', '2.500',
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      'out.mp4',
    ])
  })

  it('omits -ss entirely when start is 0 (nothing to seek past)', () => {
    const args = buildTrimAndNormalizeArgs(0, 3.2)
    expect(args[0]).toBe('-i')
    expect(args).toContain('-t')
    expect(args[args.indexOf('-t') + 1]).toBe('3.200')
  })
})
