import { describe, it, expect } from 'vitest'
import { SUBTITLE_SAMPLES } from './subtitleSamples'
import { createCanvasMeasure, layoutCue } from '../utils/subtitleLayout'

const measure = createCanvasMeasure()
const lineCounts = (label: string) => {
  const layout = layoutCue(SUBTITLE_SAMPLES.find(s => s.label === label)!.cue, measure)
  return [layout.en.lines.length, layout.ja?.lines.length]
}

describe('SUBTITLE_SAMPLES', () => {
  it('has a one-line sample in both languages', () => {
    expect(lineCounts('短い字幕')).toEqual([1, 1])
  })

  it('has a sample as tall as a cue gets: three lines in both languages', () => {
    expect(lineCounts('長い字幕')).toEqual([3, 3])
  })
})
