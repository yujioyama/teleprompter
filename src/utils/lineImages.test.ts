import { describe, expect, it } from 'vitest'
import type { LineImage } from '../types'
import {
  assignToLines,
  layoutLineImage,
  LINE_IMAGE_SLOTS,
  lineImageSlot,
  lineImagesOf,
  reconcileLineImages,
  withLineImages,
  wrapCredit,
  type StoredLineImage,
} from './lineImages'
import { hookOptionsOf, type HookOptions } from './subtitleHook'
import { fairiesFromSubtitles } from './fairyPlan'
import { placeSticker } from './stickerMotion'
import type { SubtitleCue } from './subtitleCues'

const image = (en: string, imageId = en): LineImage => ({ en, imageId, url: `https://x.test/${imageId}.jpg` })
const stored = (...ids: string[]) =>
  new Map<string, StoredLineImage>(ids.map(id => [id, { id, blob: new Blob([id]), width: 800, height: 600 }]))
const cue = (id: string, en: string, start: number, end: number): SubtitleCue => ({ id, en, start, end, ja: '訳' })

const HOOK: HookOptions = {
  style: true,
  position: 22.5,
  punchIn: null,
  sticker: 'right',
  stickerMotion: 'none',
  stickerRoute: 0,
  fairies: true,
  midZoom: true,
}

describe('lineImagesOf', () => {
  it('ties each image to the text of its line, counting non-empty lines from 1', () => {
    const body = 'one\n\n  two  \nthree'
    expect(
      lineImagesOf(body, [
        { line: 2, url: 'https://x.test/a.jpg', credit: 'Ann / CC BY 4.0', source: 'https://x.test/a' },
        { line: 3, url: 'https://x.test/b.jpg' },
      ]),
    ).toEqual([
      { en: 'two', imageId: 'https://x.test/a.jpg', url: 'https://x.test/a.jpg', credit: 'Ann / CC BY 4.0' },
      { en: 'three', imageId: 'https://x.test/b.jpg', url: 'https://x.test/b.jpg' },
    ])
  })

  it('leaves out a line that is not there', () => {
    expect(lineImagesOf('one', [{ line: 2, url: 'https://x.test/a.jpg' }])).toEqual([])
  })
})

describe('assignToLines', () => {
  it('finds each image its line, whatever the spacing', () => {
    expect(assignToLines([image('two  words')], ['one', 'two words'])).toEqual([null, image('two  words')])
  })

  it('gives twin lines their images in turn', () => {
    const a = image('same', 'a')
    const b = image('same', 'b')
    expect(assignToLines([a, b], ['same', 'other', 'same'])).toEqual([a, null, b])
  })
})

describe('reconcileLineImages', () => {
  it('follows a line that moved', () => {
    expect(reconcileLineImages([image('I ate toast')], ['New first line here', 'I ate toast'])).toEqual([image('I ate toast')])
  })

  it('follows a lightly edited line, taking its new text', () => {
    const [kept] = reconcileLineImages([image('I ate a toast today', 'a')], ['I ate toast today'])
    expect(kept).toEqual({ ...image('I ate a toast today', 'a'), en: 'I ate toast today' })
  })

  it('drops the image of a line that is gone', () => {
    expect(reconcileLineImages([image('I ate toast')], ['Something else entirely'])).toEqual([])
  })
})

describe('withLineImages', () => {
  const lines = ['*Toast*🍞 hurts', 'My mouth bled', 'Again']
  const cues = [cue('a', lines[0], 0, 2), cue('b', lines[1], 2, 4), cue('c', lines[2], 4, 6)]

  it('leaves a script without images as it was, stickers and all', () => {
    expect(withLineImages(HOOK, { images: [], stored: new Map(), cues, lines })).toBe(HOOK)
  })

  it('turns off every sticker when a script has an image', () => {
    const hook = withLineImages(HOOK, { images: [image(lines[1])], stored: stored(lines[1]), cues, lines })
    const styled = cues.map(c => ({ ...c, variant: c.id === 'a' ? 'hook' : 'normal' }))
    expect(placeSticker(styled, HOOK, 2)).not.toBeNull()
    expect(placeSticker(styled, hook, 2)).toBeNull()
    const withFairies = [cue('a', lines[0], 0, 2), cue('b', 'A peak🔥 line', 2, 4), cue('c', lines[2], 4, 6)]
    expect(fairiesFromSubtitles(withFairies, [2, 2, 2], HOOK, 72)).not.toEqual([])
    expect(fairiesFromSubtitles(withFairies, [2, 2, 2], hook, 72)).toEqual([])
  })

  it('still turns them off while the image is not on this device yet', () => {
    const hook = withLineImages(HOOK, { images: [image(lines[1])], stored: new Map(), cues, lines })
    expect(hook.sticker).toBe('off')
    expect(hook.fairies).toBe(false)
    expect(hook.lineImages).toEqual([])
  })

  it('puts an image on its line, with the credit', () => {
    const hook = withLineImages(HOOK, { images: [{ ...image(lines[1]), credit: 'Ann / CC BY 4.0' }], stored: stored(lines[1]), cues, lines })
    expect(hook.lineImages).toEqual([expect.objectContaining({ cueId: 'b', imageId: lines[1], credit: 'Ann / CC BY 4.0', width: 800, height: 600 })])
  })

  it('goes by order when the subtitles were edited but still match the lines', () => {
    const edited = [cues[0], { ...cues[1], en: 'Completely rewritten subtitle' }, cues[2]]
    const hook = withLineImages(HOOK, { images: [image(lines[1])], stored: stored(lines[1]), cues: edited, lines })
    expect(hook.lineImages?.map(i => i.cueId)).toEqual(['b'])
  })

  it('goes by the closest text when the subtitles are not line for line', () => {
    const heard = [cue('x', 'Toast hurts', 0, 1), cue('y', 'um yeah', 1, 2), cue('z', 'My mouth bled', 2, 3), cue('w', 'Again', 3, 4)]
    const hook = withLineImages(HOOK, { images: [image(lines[1])], stored: stored(lines[1]), cues: heard, lines })
    expect(hook.lineImages?.map(i => i.cueId)).toEqual(['z'])
  })

  it('shows nothing for an image with no subtitle close to its line', () => {
    const heard = [cue('x', 'Nothing alike', 0, 1), cue('y', 'at all here', 1, 2)]
    const hook = withLineImages(HOOK, { images: [image(lines[1])], stored: stored(lines[1]), cues: heard, lines })
    expect(hook.lineImages).toEqual([])
    expect(hook.sticker).toBe('off')
  })

  it('does not touch the bars or the settings it was given', () => {
    const settingsHook = hookOptionsOf({
      hookStyleEnabled: true, hookPosition: 22.5, punchInEnabled: false, punchInZoom: 1.25, punchInDirection: 'in', punchInAt: 0, punchInDuration: null,
      stickerPlacement: 'right', stickerMotion: 'none', stickerRoute: 0, fairyEnabled: true, midZoomEnabled: true, cinemaLookThrough: false, cinemaLookStrength: 1,
    })
    const opening = { kind: 'letterbox', at: 1, height: 0.2, grade: null } as unknown as HookOptions['opening']
    const hook = withLineImages({ ...settingsHook, opening }, { images: [image(lines[1])], stored: stored(lines[1]), cues, lines })
    expect(hook.opening).toBe(opening)
    expect(hook.midZoom).toBe(true)
    expect(settingsHook.sticker).toBe('right')
  })
})

describe('lineImageSlot', () => {
  it('goes on the chest, unless the subtitle is down there', () => {
    expect(lineImageSlot(22.5)).toBe(LINE_IMAGE_SLOTS.chest)
    expect(lineImageSlot(50)).toBe(LINE_IMAGE_SLOTS.chest)
    expect(lineImageSlot(72.3)).toBe(LINE_IMAGE_SLOTS.top)
  })

  it('stays out of the feed header, off the face and inside what TikTok keeps of the sides', () => {
    const { top, chest } = LINE_IMAGE_SLOTS
    expect(top.top / 1920).toBeGreaterThanOrEqual(0.15)
    expect((top.top + top.height) / 1920).toBeLessThanOrEqual(0.31)
    // onFace's ellipse ends at 55% down; Instagram's 4:5 feed keeps up to 85%.
    expect(chest.top / 1920).toBeGreaterThanOrEqual(0.55)
    expect((chest.top + chest.height) / 1920).toBeLessThanOrEqual(0.85)
    // TikTok zooms the video in on a tall phone, cutting the sides.
    for (const { left, width } of [top, chest]) {
      expect(left / 1080).toBeGreaterThanOrEqual(0.1)
      expect((left + width) / 1080).toBeLessThanOrEqual(0.9)
    }
  })
})

describe('layoutLineImage', () => {
  const inside = (box: { x: number; y: number; width: number; height: number }, slot: typeof LINE_IMAGE_SLOTS.top) => {
    expect(box.x).toBeGreaterThanOrEqual(slot.left)
    expect(box.y).toBeGreaterThanOrEqual(slot.top)
    expect(box.x + box.width).toBeLessThanOrEqual(slot.left + slot.width)
    expect(box.y + box.height).toBeLessThanOrEqual(slot.top + slot.height)
  }

  it('fits a wide image in the slot, keeping its shape', () => {
    const { image: box } = layoutLineImage(1280, 400, 0, LINE_IMAGE_SLOTS.top)
    inside(box, LINE_IMAGE_SLOTS.top)
    expect(box.width).toBeCloseTo(LINE_IMAGE_SLOTS.top.width)
    expect(box.width / box.height).toBeCloseTo(1280 / 400)
  })

  it('fits a tall image in the slot, keeping its shape', () => {
    const { image: box } = layoutLineImage(600, 1280, 0, LINE_IMAGE_SLOTS.chest)
    inside(box, LINE_IMAGE_SLOTS.chest)
    expect(box.width / box.height).toBeCloseTo(600 / 1280)
  })

  it('leaves room under the image for the credit, all inside the slot', () => {
    const slot = LINE_IMAGE_SLOTS.top
    const bare = layoutLineImage(800, 800, 0, slot)
    const credited = layoutLineImage(800, 800, 2, slot)
    expect(credited.image.height).toBeLessThan(bare.image.height)
    expect(credited.creditTop).toBeGreaterThanOrEqual(credited.image.y + credited.image.height)
    expect(credited.creditTop + 2 * credited.creditLineHeight).toBeLessThanOrEqual(slot.top + slot.height)
  })
})

describe('wrapCredit', () => {
  const measure = (text: string) => text.length * 10

  it('keeps a short credit on one line', () => {
    expect(wrapCredit('KKPCW / CC BY-SA 4.0', 281, measure)).toEqual(['KKPCW / CC BY-SA 4.0'])
  })

  it('breaks at spaces', () => {
    expect(wrapCredit('Somebody Long / CC BY-SA 4.0', 150, measure)).toEqual(['Somebody Long /', 'CC BY-SA 4.0'])
  })

  it('cuts one that will not fit, marking the cut', () => {
    const lines = wrapCredit('word '.repeat(40).trim(), 100, measure)
    expect(lines.length).toBeLessThanOrEqual(3)
    expect(lines[lines.length - 1].endsWith('…')).toBe(true)
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(100)
  })

  it('has nothing to wrap without a credit', () => {
    expect(wrapCredit(undefined, 100, measure)).toEqual([])
  })
})
