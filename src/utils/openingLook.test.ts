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
  it('opens the bars just after the start', () => {
    expect(openingLookFor('letterbox', [])).toEqual({ kind: 'letterbox', at: LETTERBOX.hold })
  })

  it('pops the color at the keyword, or soon after the start without one', () => {
    expect(openingLookFor('colorPop', [cue('*Reckon*. To my ears, that is Japanese.', 0.3)]).at).toBeCloseTo(0.3, 3)
    expect(openingLookFor('colorPop', [cue('No keyword here.')]).at).toBe(COLOR_POP.fallbackAt)
  })

  it('never waits past 3 seconds', () => {
    expect(openingLookFor('colorPop', [cue('a b c d e f g h i j k l m n o p q *late*', 0, 10)]).at).toBe(3)
  })
})

describe('the look over time', () => {
  const bars = { kind: 'letterbox' as const, at: 0.15 }
  const pop = { kind: 'colorPop' as const, at: 1 }

  it('holds the bars, slides them away, and is done after', () => {
    expect(letterboxHeight(0, bars)).toBeCloseTo(LETTERBOX.height)
    expect(letterboxHeight(0.15 + LETTERBOX.duration / 2, bars)).toBeCloseTo(LETTERBOX.height / 2)
    expect(letterboxHeight(openingEnd(bars), bars)).toBe(0)
    expect(colorPopSaturation(0, bars)).toBe(1)
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
    expect(typed.opening).toEqual({ kind: 'letterbox', at: LETTERBOX.hold })
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
})

describe('openingFilterStages', () => {
  it('slides two black bars off over the input', () => {
    const stages = openingFilterStages({ kind: 'letterbox', at: 0.15 }, '[in]', '[out]', 1080, 1920)
    expect(stages[0]).toContain('s=1080x211')
    expect(stages[1]).toMatch(/^\[in\]\[lbtop\]overlay=x=0:y='-211\+211\*/)
    expect(stages[2]).toMatch(/^\[lbmid\]\[lbbot\]overlay=x=0:y='H-211\*.*\[out\]$/)
  })

  it('fades the saturation up from the keyword', () => {
    const [stage] = openingFilterStages({ kind: 'colorPop', at: 0.8 }, '[in]', '[out]', 1080, 1920)
    expect(stage).toBe("[in]hue=s='0.3+0.70*clip((t-0.800)/0.4,0,1)*clip((t-0.800)/0.4,0,1)*(3-2*clip((t-0.800)/0.4,0,1))'[out]")
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
    expect(calls).toContain('rect saturation 0.70 #808080 0,0,1080,1920')
  })

  it('draws the bars at the top and bottom', () => {
    const { ctx, calls } = fakeCtx()
    drawOpening(ctx as unknown as OffscreenCanvasRenderingContext2D, 0, { kind: 'letterbox', at: 0.15 }, 1080, 1920)
    expect(calls).toContain('rect source-over 1.00 #000 0,0,1080,211')
    expect(calls).toContain('rect source-over 1.00 #000 0,1709,1080,211')
  })

  it('draws nothing once the look is done', () => {
    const { ctx } = fakeCtx()
    drawOpening(ctx as unknown as OffscreenCanvasRenderingContext2D, 5, { kind: 'letterbox', at: 0.15 }, 1080, 1920)
    expect(ctx.fillRect).not.toHaveBeenCalled()
  })
})
