import { describe, expect, it } from 'vitest'
import { layoutSceneLabel, sceneLabelY, sceneUnder, SCENE_TOP_BAND_Y, SCENE_SHADOW_ROOM, sceneOf, SCENE_IMAGE_HEIGHT, SCENE_TAG_INSET, withScene } from './sceneLabel'
import { SUBTITLE_TEXT_WIDTH, type MeasureText } from './subtitleLayout'
import { LINE_IMAGE_SLOT } from './lineImages'
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
    expect(sceneUnder(22.5)).toBe(true)
    expect(sceneLabelY(300, 200, 22.5)).toBeGreaterThan(300 + 200 - 40)
    expect(sceneLabelY(300, 200, 22.5)).toBeLessThan(300 + 200)
    expect(sceneLabelY(1850, 200, 50)).toBe(1920 - SCENE_IMAGE_HEIGHT)
  })

  it('goes in the line image\'s place for a subtitle in the lower half, off the face and the SNS caption', () => {
    expect(sceneUnder(72.3)).toBe(false)
    expect(sceneLabelY(1100, 400, 72.3)).toBe(SCENE_TOP_BAND_Y - SCENE_SHADOW_ROOM)
    expect(SCENE_TOP_BAND_Y).toBeGreaterThan(1920 * 0.15)
  })

  it('keeps the opening bars off the label', () => {
    const opened = { ...hook, opening: { kind: 'letterbox', at: 2, height: 0.22, grade: null } } as HookOptions
    const withLabel = withScene(opened, [cue('a', 0)], 'a wrong number')
    expect(withLabel.opening!.height * 1920).toBeLessThan(LINE_IMAGE_SLOT.top)
  })
})
