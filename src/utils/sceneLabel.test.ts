import { describe, expect, it } from 'vitest'
import { layoutSceneLabel, sceneAbove, sceneLabelY, sceneOf, SCENE_IMAGE_HEIGHT, SCENE_TAG_INSET, withScene } from './sceneLabel'
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

  it('starts with the SCENE tag, the words after it', () => {
    const label = layoutSceneLabel('a wrong number', measure)
    expect(label.tagWidth).toBeGreaterThan(0)
    expect(label.textLeft).toBeGreaterThan(SCENE_TAG_INSET + label.tagWidth)
    expect(label.width).toBeGreaterThan(label.textLeft)
  })

  it('sits right under a subtitle in the upper half, and stays on screen', () => {
    expect(sceneAbove(22.5)).toBe(false)
    expect(sceneLabelY(300, 200, false)).toBeGreaterThan(300 + 200 - 40)
    expect(sceneLabelY(300, 200, false)).toBeLessThan(300 + 200)
    expect(sceneLabelY(1850, 200, false)).toBe(1920 - SCENE_IMAGE_HEIGHT)
  })

  it('sits right above a subtitle in the lower half, clear of the SNS caption', () => {
    expect(sceneAbove(72.3)).toBe(true)
    const y = sceneLabelY(1100, 400, true)
    expect(y + SCENE_IMAGE_HEIGHT).toBeLessThanOrEqual(1100 + 20)
    expect(y + SCENE_IMAGE_HEIGHT).toBeGreaterThan(1100 - 20)
    expect(sceneLabelY(10, 200, true)).toBe(0)
  })
})
