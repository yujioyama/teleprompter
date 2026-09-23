import { describe, it, expect } from 'vitest'
import { buildOverlayFilterGraph } from './burnSubtitles'

describe('buildOverlayFilterGraph', () => {
  it('chains one overlay per cue, each reading the previous stage\'s output', () => {
    const { filterGraph, outputLabel } = buildOverlayFilterGraph(3, 1500)
    expect(filterGraph).toContain('[0:v][sub0]overlay')
    expect(filterGraph).toContain('[v0][sub1]overlay')
    expect(filterGraph).toContain('[v1][sub2]overlay')
    expect(outputLabel).toBe('[v2]')
  })

  it('uses the given Y coordinate and centers horizontally for every cue', () => {
    const { filterGraph } = buildOverlayFilterGraph(1, 300)
    expect(filterGraph).toContain('x=(W-w)/2:y=300')
  })

  it('produces a single overlay stage for one cue', () => {
    const { filterGraph, outputLabel } = buildOverlayFilterGraph(1, 100)
    expect(filterGraph).toBe('[0:v][sub0]overlay=x=(W-w)/2:y=100[v0]')
    expect(outputLabel).toBe('[v0]')
  })

  it('handles zero cues by returning an empty filter graph with the base video as output', () => {
    const { filterGraph, outputLabel } = buildOverlayFilterGraph(0, 100)
    expect(filterGraph).toBe('')
    expect(outputLabel).toBe('[0:v]')
  })
})
