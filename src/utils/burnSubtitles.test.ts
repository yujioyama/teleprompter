import { describe, it, expect } from 'vitest'
import { buildOverlayFilterGraph, ffmpegProgressRatio } from './burnSubtitles'

describe('buildOverlayFilterGraph', () => {
  it('chains one overlay per cue, each reading the previous stage\'s output', () => {
    const { filterGraph, outputLabel } = buildOverlayFilterGraph([1500, 1400, 1450])
    expect(filterGraph).toContain('[0:v][sub0]overlay')
    expect(filterGraph).toContain('[v0][sub1]overlay')
    expect(filterGraph).toContain('[v1][sub2]overlay')
    expect(outputLabel).toBe('[v2]')
  })

  it('uses each cue\'s own Y coordinate and centers horizontally', () => {
    const { filterGraph } = buildOverlayFilterGraph([300, 250])
    expect(filterGraph).toContain('[sub0]overlay=x=(W-w)/2:y=300')
    expect(filterGraph).toContain('[sub1]overlay=x=(W-w)/2:y=250')
  })

  it('produces a single overlay stage for one cue', () => {
    const { filterGraph, outputLabel } = buildOverlayFilterGraph([100])
    expect(filterGraph).toBe('[0:v][sub0]overlay=x=(W-w)/2:y=100[v0]')
    expect(outputLabel).toBe('[v0]')
  })

  it('handles zero cues by returning an empty filter graph with the base video as output', () => {
    const { filterGraph, outputLabel } = buildOverlayFilterGraph([])
    expect(filterGraph).toBe('')
    expect(outputLabel).toBe('[0:v]')
  })
})

describe('ffmpegProgressRatio', () => {
  it('is the output time (microseconds) over the video duration', () => {
    expect(ffmpegProgressRatio(45_000_000, 90)).toBe(0.5)
  })

  it('stays within 0–1, including ffmpeg\'s bogus early/late timestamps', () => {
    expect(ffmpegProgressRatio(-1_000, 90)).toBe(0)
    expect(ffmpegProgressRatio(95_000_000, 90)).toBe(1)
    expect(ffmpegProgressRatio(NaN, 90)).toBe(0)
  })

  it('is 0 when the duration is unknown', () => {
    expect(ffmpegProgressRatio(45_000_000, 0)).toBe(0)
  })
})
