import { describe, it, expect, vi } from 'vitest'
import {
  LETTERBOX,
  hasOpening,
  letterboxBarHeight,
  letterboxHeight,
  lookOpacity,
  openingActive,
  openingEnd,
  openingFilterStages,
  openingLookFor,
} from './openingLook'
import { hasFirstShotExtras, openingPlan, withVideoType, type HookOptions } from './subtitleHook'
import { layoutCue, type MeasureText } from './subtitleLayout'
import { clampedSubtitleY } from './subtitlePosition'
import { drawOpening } from './webcodecs/pictureEffects'

const cue = (en: string, start = 0.2, end = 2.2, ja: string | null = null) => ({ id: 'c', start, end, en, ja })

const HOOK: HookOptions = {
  style: true,
  position: 50,
  punchIn: { zoom: 1.25, direction: 'out', at: 0, duration: 0.6 },
}

// 30px a letter, so a line wraps past 30 letters.
const measure: MeasureText = text => text.length * 30
const top = (c: { en: string; ja: string | null }, position: number) => clampedSubtitleY(position, layoutCue(c, measure).height)
const bars = (at: number, height: number = LETTERBOX.height) => ({ kind: 'letterbox' as const, at, height, grade: null })

describe('hasOpening', () => {
  it('gives Type A and Type B the bars, and others nothing', () => {
    expect(hasOpening('A')).toBe(true)
    expect(hasOpening('B')).toBe(true)
    expect(hasOpening(undefined)).toBe(false)
    expect(hasOpening(null)).toBe(false)
  })
})

describe('openingLookFor', () => {
  it('slides the bars away as line 1 ends, held long enough to be seen but not past the hook', () => {
    expect(openingLookFor([cue('I eat toast every morning.', 0.2, 1.9)], 72, null, measure).at).toBe(1.9)
    expect(openingLookFor([cue('Hi.', 0, 0.5)], 72, null, measure).at).toBe(LETTERBOX.minHold)
    expect(openingLookFor([cue('A very long first line.', 0, 6)], 72, null, measure).at).toBe(LETTERBOX.maxHold)
    expect(openingLookFor([], 72, null, measure)).toEqual(bars(LETTERBOX.minHold))
  })

  it('keeps the full bars when the subtitles sit well below them', () => {
    expect(openingLookFor([cue('Hi.', 0, 1, 'やあ')], 50, null, measure).height).toBe(LETTERBOX.height)
  })

  it('stops the top bar just above a high subtitle, its Japanese line included', () => {
    const line = cue('Hi.', 0, 1.5, 'やあ')
    const { height } = openingLookFor([line], 22.5, null, measure)
    expect(height).toBeLessThan(LETTERBOX.height)
    expect(height * 1920).toBeCloseTo(top(line, 22.5) - LETTERBOX.gap, 0)
    expect(height * 1920).toBeLessThan(top(line, 22.5))
  })

  it('makes room for a line 1 that wraps', () => {
    const short = cue('I eat toast.', 0, 1.5, 'トースト')
    const long = cue('Every single morning I eat toast with honey and butter.', 0, 1.5, '毎朝トースト')
    const shortBar = openingLookFor([short], 22.5, null, measure).height
    const longBar = openingLookFor([long], 22.5, null, measure).height
    expect(layoutCue(long, measure).en.lines.length).toBeGreaterThan(1)
    expect(longBar).toBeLessThan(shortBar)
    expect(longBar * 1920).toBeLessThan(top(long, 22.5))
  })

  it('clears every cue that starts before the bars are gone, but not later ones', () => {
    const first = cue('Hi.', 0, 0.5, 'やあ')
    const second = cue('Every single morning I eat toast with honey and butter.', 0.5, 1.5, '毎朝')
    const later = cue('Every single morning I eat toast with honey and butter, and jam.', 3, 4, '毎朝')
    expect(openingLookFor([first, second], 22.5, null, measure).height * 1920).toBeCloseTo(top(second, 22.5) - LETTERBOX.gap, 0)
    expect(openingLookFor([first, later], 22.5, null, measure).height * 1920).toBeCloseTo(top(first, 22.5) - LETTERBOX.gap, 0)
  })

  it('reads an emoji in line 1 as the sticker, not as text', () => {
    expect(openingLookFor([cue('Hi 🧴', 0, 1, 'やあ')], 22.5, null, measure).height).toBe(openingLookFor([cue('Hi', 0, 1, 'やあ')], 22.5, null, measure).height)
  })
})

describe('letterboxBarHeight', () => {
  it('is at most LETTERBOX.height, and never below 0', () => {
    expect(letterboxBarHeight([])).toBe(LETTERBOX.height)
    expect(letterboxBarHeight([1000])).toBe(LETTERBOX.height)
    expect(letterboxBarHeight([316])).toBeCloseTo(300 / 1920, 4)
    expect(letterboxBarHeight([0])).toBe(0)
  })
})

describe('the look over time', () => {
  it('shows the bars from the first frame, holds them, slides them away, and is done after', () => {
    const look = bars(1.5, 0.15)
    expect(letterboxHeight(0, look)).toBe(0.15)
    expect(letterboxHeight(1.4, look)).toBe(0.15)
    expect(letterboxHeight(1.5 + LETTERBOX.duration / 2, look)).toBeCloseTo(0.075)
    expect(letterboxHeight(openingEnd(look), look)).toBe(0)
  })

  it('is active only until the bars are gone', () => {
    const look = bars(1)
    expect(openingActive(0.5, look)).toBe(true)
    expect(openingActive(openingEnd(look), look)).toBe(false)
    expect(openingActive(0, null)).toBe(false)
  })
})

describe('the film look over time', () => {
  it('is whole until the bars start to go, then fades with them, and is gone when they are', () => {
    const look = bars(1.5, 0.15)
    expect(lookOpacity(0, look)).toBe(1)
    expect(lookOpacity(1.5, look)).toBe(1)
    expect(lookOpacity(1.5 + 0.4, look)).toBeCloseTo(0.5)
    expect(lookOpacity(openingEnd(look), look)).toBe(0)
  })

  it('is gone by the first shot’s end even when the opening is moved early', () => {
    const typed = withVideoType({ ...HOOK, punchIn: null }, 'A', [cue('A long first line.', 0, 2.4)], 72, 'oldFilm')
    const plan = openingPlan(typed, 1.5)!
    expect(plan.grade).toBe('oldFilm')
    expect(lookOpacity(1.5, plan)).toBe(0)
  })
})

describe('openingLookFor with a look', () => {
  it('carries the picked look, or none', () => {
    expect(openingLookFor([], 72, 'mono', measure).grade).toBe('mono')
    expect(openingLookFor([], 72, undefined, measure).grade).toBeNull()
  })
})

describe('withVideoType', () => {
  it('swaps the zoom for the same bars on Type A and Type B', () => {
    const typed = withVideoType(HOOK, 'A', [], 72)
    expect(typed.punchIn).toBeNull()
    expect(typed.opening).toEqual(bars(LETTERBOX.minHold))
    const lines = [cue('*Hankering*. A word I love.', 0, 1.8, '欲しくてたまらない')]
    expect(withVideoType(HOOK, 'B', lines, 72)).toEqual(withVideoType(HOOK, 'A', lines, 72))
  })

  it('keeps the bars clear of the hook position, or the subtitles’ without the hook style', () => {
    const lines = [cue('Every single morning I eat toast with honey.', 0, 1.8, '毎朝トースト')]
    const atHook = withVideoType({ ...HOOK, position: 22.5 }, 'A', lines, 72).opening!
    expect(atHook.height).toBeLessThan(LETTERBOX.height)
    expect(withVideoType({ ...HOOK, style: false, position: 22.5 }, 'A', lines, 72).opening!.height).toBe(LETTERBOX.height)
    expect(withVideoType({ ...HOOK, style: false, position: 50 }, 'A', lines, 22.5).opening!.height).toBe(atHook.height)
  })

  it('leaves an untyped script as set', () => {
    expect(withVideoType(HOOK, undefined, [], 72)).toBe(HOOK)
    expect(withVideoType(HOOK, undefined, [], 72, 'oldFilm')).toBe(HOOK)
  })

  it('puts the picked look under the bars, or none', () => {
    expect(withVideoType(HOOK, 'A', [], 72, 'oldFilm').opening!.grade).toBe('oldFilm')
    expect(withVideoType(HOOK, 'B', [], 72, 'glitch').opening!.grade).toBe('glitch')
    expect(withVideoType(HOOK, 'A', [], 72).opening!.grade).toBeNull()
    expect(withVideoType(HOOK, 'A', [], 72, null).opening!.grade).toBeNull()
  })

  it('needs an encode for the first shot only', () => {
    const typed = withVideoType({ ...HOOK, punchIn: null }, 'A', [], 72)
    expect(hasFirstShotExtras(typed, 2)).toBe(true)
    expect(openingPlan(typed, null)).toBeNull()
    expect(hasFirstShotExtras(typed, null)).toBe(false)
  })

  it('moves the look earlier when it would outlast the first shot', () => {
    const typed = withVideoType({ ...HOOK, punchIn: null }, 'A', [cue('A long first line.', 0, 2.4)], 72)
    expect(openingPlan(typed, 5)).toEqual(bars(2.4))
    const plan = openingPlan(typed, 2.6)!
    expect(plan.at).toBeCloseTo(2.6 - LETTERBOX.duration, 5)
    expect(openingEnd(plan)).toBeCloseTo(2.6, 5)
    expect(openingPlan(typed, 0.3)!.at).toBe(0)
  })
})

describe('openingFilterStages', () => {
  it('slides two half-frame black boxes over the input, showing the same bars as letterboxHeight', () => {
    const look = bars(1.5, 0.15)
    const stages = openingFilterStages(look, '[in]', '[out]', 1080, 1920)
    expect(stages[0]).toContain('s=1080x960')
    const top = stages[1].match(/^\[in\]\[lbtop\]overlay=x=0:y='-960\+(.*)':eval=frame\[lbmid\]$/)
    const bottom = stages[2].match(/^\[lbmid\]\[lbbot\]overlay=x=0:y='H-\((.*)\)':eval=frame\[out\]$/)
    expect(top?.[1]).toBe(bottom?.[1])
    const shown = new Function('t', 'clip', `return ${top![1]}`) as (t: number, clip: (v: number, lo: number, hi: number) => number) => number
    const clip = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
    for (const t of [0, 0.2, 0.3, 1, 1.5, 1.9, 2.3, 3]) {
      expect(shown(t, clip)).toBeCloseTo(letterboxHeight(t, look) * 1920, 0)
    }
  })
})

describe('drawOpening', () => {
  function fakeCtx() {
    const calls: string[] = []
    const ctx = {
      globalCompositeOperation: 'source-over',
      globalAlpha: 1,
      fillStyle: '',
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
        calls.push(`rect ${ctx.globalCompositeOperation} ${ctx.globalAlpha.toFixed(2)} ${ctx.fillStyle} ${x},${y},${w},${h}`)
      }),
    }
    return { ctx, calls }
  }

  it('draws the bars at the top and bottom from the first frame', () => {
    const { ctx, calls } = fakeCtx()
    drawOpening(ctx as unknown as OffscreenCanvasRenderingContext2D, 0, bars(1.5, 0.15), 1080, 1920)
    expect(calls).toContain('rect source-over 1.00 #000 0,0,1080,288')
    expect(calls).toContain('rect source-over 1.00 #000 0,1632,1080,288')
  })

  it('draws nothing once the look is done', () => {
    const { ctx } = fakeCtx()
    drawOpening(ctx as unknown as OffscreenCanvasRenderingContext2D, 5, bars(0.15), 1080, 1920)
    expect(ctx.fillRect).not.toHaveBeenCalled()
  })
})
