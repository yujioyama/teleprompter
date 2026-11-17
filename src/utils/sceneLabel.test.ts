import { describe, expect, it } from 'vitest'
import { layoutSceneLabel, sceneOf, SCENE_FONT_MAX_PX, SCENE_FONT_MIN_PX, SCENE_IMAGE_HEIGHT, SCENE_LABEL_Y, SCENE_MAX_WIDTH, SCENE_TAG_INSET, withScene } from './sceneLabel'
import { type MeasureText } from './subtitleLayout'
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
    expect(label.width).toBeLessThanOrEqual(SCENE_MAX_WIDTH)
  })

  it('starts with the SCENE tag, the words after it', () => {
    const label = layoutSceneLabel('a wrong number', measure)
    expect(label.tagWidth).toBeGreaterThan(0)
    expect(label.textLeft).toBeGreaterThan(SCENE_TAG_INSET + label.tagWidth)
    expect(label.width).toBeGreaterThan(label.textLeft)
  })

  it('sits in line 1\'s image slot, below the SNS header', () => {
    expect(SCENE_LABEL_Y).toBeGreaterThan(1920 * 0.15)
    expect(SCENE_LABEL_Y + SCENE_IMAGE_HEIGHT).toBeLessThanOrEqual(LINE_IMAGE_SLOT.top + LINE_IMAGE_SLOT.height)
  })

  it('is big for a short label and smaller for a long one, within the width', () => {
    const short = layoutSceneLabel('a wrong number', measure)
    expect(short.fontPx).toBe(SCENE_FONT_MAX_PX)
    const long = layoutSceneLabel('a parent-teacher meeting online', measure)
    expect(long.fontPx).toBeLessThan(SCENE_FONT_MAX_PX)
    expect(long.fontPx).toBeGreaterThanOrEqual(SCENE_FONT_MIN_PX)
    expect(long.width).toBeLessThanOrEqual(SCENE_MAX_WIDTH)
  })

  it('keeps the opening bars off the label', () => {
    const opened = { ...hook, opening: { kind: 'letterbox', at: 2, height: 0.22, grade: null } } as HookOptions
    const withLabel = withScene(opened, [cue('a', 0)], 'a wrong number')
    expect(withLabel.opening!.height * 1920).toBeLessThan(LINE_IMAGE_SLOT.top)
  })
})
