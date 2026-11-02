import { describe, it, expect, vi } from 'vitest'
import {
  COLOR_POP,
  LETTERBOX,
  colorPopSaturation,
  keywordTime,
  letterboxHeight,
  openingActive,
  openingEnd,
  openingFilterStages,
  openingKindFor,
  openingLookFor,
} from './openingLook'
import { hasFirstShotExtras, openingPlan, withVideoType, type HookOptions } from './subtitleHook'
import { drawOpening } from './webcodecs/pictureEffects'

const cue = (en: string, start = 0.2, end = 2.2) => ({ id: 'c', start, end, en, ja: null })

const HOOK: HookOptions = {
  style: true,
  position: 50,
  punchIn: { zoom: 1.25, direction: 'out', at: 0, duration: 0.6 },
}

describe('openingKindFor', () => {
  it('gives Type A the black bars, Type B the color pop, and others nothing', () => {
    expect(openingKindFor('A')).toBe('letterbox')
    expect(openingKindFor('B')).toBe('colorPop')
    expect(openingKindFor(undefined)).toBeNull()
    expect(openingKindFor(null)).toBeNull()
  })
})

describe('keywordTime', () => {
  it('spreads the first line over its letters and finds where the keyword starts', () => {
    // "In Japan, we drink " is 19 of the 43 letters, emoji and markers aside.
    const t = keywordTime([cue('In Japan, we drink *turmeric*🍛 before tequila.', 0.2, 2.2)])
    expect(t).toBeCloseTo(0.2 + (19 / 43) * 2, 3)
  })

  it('reads the earliest cue, and is null without a keyword', () => {
    expect(keywordTime([cue('Later *line*', 3, 4), cue('*First* line', 0, 1)])).toBeCloseTo(0, 5)
    expect(keywordTime([cue('I eat toast every morning.')])).toBeNull()
    expect(keywordTime([])).toBeNull()
  })
})

describe('openingLookFor', () => {
  it('opens the bars as line 1 ends, held long enough to be seen but not past the hook', () => {
    expect(openingLookFor('letterbox', [cue('I eat toast every morning.', 0.2, 1.9)])).toEqual({ kind: 'letterbox', at: 1.9 })
    expect(openingLookFor('letterbox', [cue('Hi.', 0, 0.5)]).at).toBe(LETTERBOX.minHold)
    expect(openingLookFor('letterbox', [cue('A very long first line.', 0, 6)]).at).toBe(LETTERBOX.maxHold)
    expect(openingLookFor('letterbox', []).at).toBe(LETTERBOX.minHold)
  })

  it('pops the color at the keyword, or as line 1 ends without one', () => {
    // "In Japan, we drink " is 19 of the 43 letters.
    expect(openingLookFor('colorPop', [cue('In Japan, we drink *turmeric*🍛 before tequila.', 0.2, 3.2)]).at).toBeCloseTo(0.2 + (19 / 43) * 3, 3)
    expect(openingLookFor('colorPop', [cue('No keyword here.', 0.2, 1.8)]).at).toBe(1.8)
  })

  it('holds the gray at least a second, and never past 3 seconds', () => {
    expect(openingLookFor('colorPop', [cue('*Reckon*. To my ears, that is Japanese.', 0.3)]).at).toBe(COLOR_POP.minAt)
    expect(openingLookFor('colorPop', [cue('a b c d e f g h i j k l m n o p q *late*', 0, 10)]).at).toBe(COLOR_POP.maxAt)
  })
})

describe('the look over time', () => {
  const bars = { kind: 'letterbox' as const, at: 1.5 }
  const pop = { kind: 'colorPop' as const, at: 1 }

  it('starts all black, opens like a curtain to the bars, holds them, slides them away, and is done after', () => {
    expect(letterboxHeight(0, bars)).toBe(0.5)
    expect(letterboxHeight(LETTERBOX.coverHold, bars)).toBe(0.5)
    expect(letterboxHeight(LETTERBOX.coverHold + LETTERBOX.reveal / 2, bars)).toBeCloseTo((0.5 + LETTERBOX.height) / 2)
    expect(letterboxHeight(LETTERBOX.coverHold + LETTERBOX.reveal, bars)).toBeCloseTo(LETTERBOX.height)
    expect(letterboxHeight(1.4, bars)).toBeCloseTo(LETTERBOX.height)
    expect(letterboxHeight(1.5 + LETTERBOX.duration / 2, bars)).toBeCloseTo(LETTERBOX.height / 2)
    expect(letterboxHeight(openingEnd(bars), bars)).toBe(0)
    expect(colorPopSaturation(0, bars)).toBe(1)
  })

  it('still starts all black and opens smoothly when moved early to fit a short first shot', () => {
    const early = { kind: 'letterbox' as const, at: 0 }
    expect(letterboxHeight(0, early)).toBe(0.5)
    expect(letterboxHeight(0.2, early)).toBeLessThan(0.5)
    expect(letterboxHeight(LETTERBOX.duration, early)).toBe(0)
  })

  it('keeps the color drained until the keyword, then fills it in', () => {
    expect(colorPopSaturation(0, pop)).toBeCloseTo(COLOR_POP.startSaturation)
    expect(colorPopSaturation(0.99, pop)).toBeCloseTo(COLOR_POP.startSaturation)
    expect(colorPopSaturation(1 + COLOR_POP.duration, pop)).toBe(1)
    expect(letterboxHeight(0, pop)).toBe(0)
  })

  it('is active only until it stops moving', () => {
    expect(openingActive(0.5, pop)).toBe(true)
    expect(openingActive(openingEnd(pop), pop)).toBe(false)
    expect(openingActive(0, null)).toBe(false)
  })
})

describe('withVideoType', () => {
  it('swaps the zoom for the type’s look', () => {
    const typed = withVideoType(HOOK, 'A', [])
    expect(typed.punchIn).toBeNull()
    expect(typed.opening).toEqual({ kind: 'letterbox', at: LETTERBOX.minHold })
    expect(withVideoType(HOOK, 'B', [cue('*Hankering*')]).opening?.kind).toBe('colorPop')
  })

  it('leaves an untyped script as set', () => {
    expect(withVideoType(HOOK, undefined, [])).toBe(HOOK)
  })

  it('needs an encode for the first shot only', () => {
    const typed = withVideoType({ ...HOOK, punchIn: null }, 'A', [])
    expect(hasFirstShotExtras(typed, 2)).toBe(true)
    expect(openingPlan(typed, null)).toBeNull()
    expect(hasFirstShotExtras(typed, null)).toBe(false)
  })

  it('moves the look earlier when it would outlast the first shot', () => {
    const typed = withVideoType({ ...HOOK, punchIn: null }, 'A', [cue('A long first line.', 0, 2.4)])
    expect(openingPlan(typed, 5)).toEqual({ kind: 'letterbox', at: 2.4 })
    const plan = openingPlan(typed, 2.6)!
    expect(plan.at).toBeCloseTo(2.6 - LETTERBOX.duration, 5)
    expect(openingEnd(plan)).toBeCloseTo(2.6, 5)
    expect(openingPlan(typed, 0.3)!.at).toBe(0)
  })
})

describe('openingFilterStages', () => {
  it('slides two half-frame black boxes over the input, showing the same bars as letterboxHeight', () => {
    const look = { kind: 'letterbox' as const, at: 1.5 }
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

  it('fades the saturation up from the keyword', () => {
    const [stage] = openingFilterStages({ kind: 'colorPop', at: 0.8 }, '[in]', '[out]', 1080, 1920)
    expect(stage).toBe("[in]hue=s='0.1+0.90*clip((t-0.800)/0.6,0,1)*clip((t-0.800)/0.6,0,1)*(3-2*clip((t-0.800)/0.6,0,1))'[out]")
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

  it('blends gray in with "saturation" to drain the color', () => {
    const { ctx, calls } = fakeCtx()
    drawOpening(ctx as unknown as OffscreenCanvasRenderingContext2D, 0, { kind: 'colorPop', at: 1 }, 1080, 1920)
    expect(calls).toContain('rect saturation 0.90 #808080 0,0,1080,1920')
  })

  it('draws the bars at the top and bottom', () => {
    const { ctx, calls } = fakeCtx()
    drawOpening(ctx as unknown as OffscreenCanvasRenderingContext2D, 0, { kind: 'letterbox', at: 1.5 }, 1080, 1920)
    expect(calls).toContain('rect source-over 1.00 #000 0,0,1080,960')
    expect(calls).toContain('rect source-over 1.00 #000 0,960,1080,960')
    const { ctx: later, calls: laterCalls } = fakeCtx()
    drawOpening(later as unknown as OffscreenCanvasRenderingContext2D, 1, { kind: 'letterbox', at: 1.5 }, 1080, 1920)
    expect(laterCalls).toContain('rect source-over 1.00 #000 0,0,1080,422')
    expect(laterCalls).toContain('rect source-over 1.00 #000 0,1498,1080,422')
  })

  it('draws nothing once the look is done', () => {
    const { ctx } = fakeCtx()
    drawOpening(ctx as unknown as OffscreenCanvasRenderingContext2D, 5, { kind: 'letterbox', at: 0.15 }, 1080, 1920)
    expect(ctx.fillRect).not.toHaveBeenCalled()
  })
})
