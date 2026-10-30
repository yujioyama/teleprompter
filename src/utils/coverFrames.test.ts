import { describe, it, expect } from 'vitest'
import { buildCoverFramesArgs, clampCoverFrameCount, insertCoverFrames } from './coverFrames'

describe('clampCoverFrameCount', () => {
  it('keeps a whole number of frames from 1 to 5', () => {
    expect(clampCoverFrameCount(3)).toBe(3)
    expect(clampCoverFrameCount(0)).toBe(1)
    expect(clampCoverFrameCount(9)).toBe(5)
    expect(clampCoverFrameCount(2.4)).toBe(2)
    expect(clampCoverFrameCount(Number.NaN)).toBe(1)
  })
})

describe('buildCoverFramesArgs', () => {
  function filterOf(args: string[]): string {
    return args[args.indexOf('-filter_complex') + 1]
  }

  it('puts the cover and its silence before the video for 最初', () => {
    expect(filterOf(buildCoverFramesArgs('first', 2, 3))).toContain('[cv][ca][mv][ma]concat=n=2:v=1:a=1[v][a]')
  })

  it('puts them after the video for 最後', () => {
    expect(filterOf(buildCoverFramesArgs('last', 2, 3))).toContain('[mv][ma][cv][ca]concat=n=2:v=1:a=1[v][a]')
  })

  it('takes exactly `count` frames of the image, over as long a silence', () => {
    const filter = filterOf(buildCoverFramesArgs('first', 3, 3))
    expect(filter).toContain('[1:v]trim=end_frame=3,')
    expect(filter).toContain('atrim=end=0.100000[ca]')
  })

  it("cuts the video's audio where its picture ends", () => {
    expect(filterOf(buildCoverFramesArgs('last', 1, 3.0))).toContain('[0:a]atrim=end=3.000000[ma]')
  })

  it('reads the looped image only a frame longer than it needs', () => {
    const args = buildCoverFramesArgs('last', 5, 3)
    expect(args.slice(args.indexOf('-loop'), args.indexOf('-loop') + 6)).toEqual([
      '-loop', '1', '-framerate', '30', '-t', '0.200000',
    ])
  })
})

describe('insertCoverFrames', () => {
  it('hands the video back untouched for なし', async () => {
    const video = new Blob(['video'], { type: 'video/mp4' })
    expect(await insertCoverFrames(video, new Blob(['png']), 'none', 3)).toBe(video)
  })
})
