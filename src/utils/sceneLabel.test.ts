import { describe, expect, it } from 'vitest'
import { layoutSceneLabel, sceneLabelY, sceneOf, SCENE_IMAGE_HEIGHT, withScene } from './sceneLabel'
import { SUBTITLE_TEXT_WIDTH, type MeasureText } from './subtitleLayout'
import type { HookOptions } from './subtitleHook'
import type { SubtitleCue } from './subtitleCues'

const measure: MeasureText = (text, font) => text.length * Number(/(\d+)px/.exec(font)![1]) * 0.55
const hook = { style: true, position: 22.5, punchIn: null } as HookOptions
const cue = (id: string, start: number): SubtitleCue => ({ id, start, end: start + 1, en: id, ja: 'じゃ' }) as SubtitleCue

describe('状況のラベル', () => {
  it('goes with line 1 only', () => {
    const withIt = withScene(hook, [cue('b', 2), cue('a', 0)], ' a wrong number ')
    expect(sceneOf(withIt, 'a')).toBe('a wrong number')
    expect(sceneOf(withIt, 'b')).toBeUndefined()
  })

  it('leaves the hook as it is without one', () => {
    expect(withScene(hook, [cue('a', 0)], '')).toBe(hook)
    expect(withScene(hook, [cue('a', 0)], undefined)).toBe(hook)
  })

  it('shortens a label wider than a subtitle', () => {
    const label = layoutSceneLabel('x'.repeat(80), measure)
    expect(label.text.endsWith('…')).toBe(true)
    expect(label.width).toBeLessThanOrEqual(SUBTITLE_TEXT_WIDTH)
  })

  it('sits right under the subtitle, and stays on screen', () => {
    expect(sceneLabelY(300, 200)).toBeGreaterThan(300 + 200 - 40)
    expect(sceneLabelY(300, 200)).toBeLessThan(300 + 200)
    expect(sceneLabelY(1850, 200)).toBe(1920 - SCENE_IMAGE_HEIGHT)
  })
})
