import { STICKER_CENTER_Y, STICKER_IMAGE_HEIGHT } from './subtitleSticker'
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildOverlayFilterGraph,
  burnShotSubtitles,
  burnSubtitles,
  cuePosition,
  ffmpegProgressRatio,
  punchInFilter,
  renderCueImage,
  renderSubtitleOverlays,
  type SubtitleLook,
} from './burnSubtitles'
import { CancelledError } from './cancellation'
import { SUBTITLE_FONT_FAMILY, layoutCue, type MeasureText } from './subtitleLayout'
import { subtitleY } from './subtitlePosition'
import type { StyledCue } from './subtitleHook'
import { burnSubtitlesWebCodecs } from './webcodecs/burnSubtitlesWebCodecs'
import { normalizeShotWebCodecs } from './webcodecs/normalizeShot'

vi.mock('./webcodecs/support', async importOriginal => ({
  ...(await importOriginal<typeof import('./webcodecs/support')>()),
  canUseWebCodecs: vi.fn(async () => true),
  disableWebCodecs: vi.fn(),
}))
vi.mock('./webcodecs/burnSubtitlesWebCodecs', () => ({
  burnSubtitlesWebCodecs: vi.fn(async () => new Blob(['burned'])),
}))

vi.mock('./webcodecs/normalizeShot', async importOriginal => ({
  ...(await importOriginal<typeof import('./webcodecs/normalizeShot')>()),
  normalizeShotWebCodecs: vi.fn(async () => new Blob(['normalized'])),
}))

// The canvas stub's text measure: every char is half its font size wide.
const measure: MeasureText = (text, font) => text.length * Number(/(\d+)px/.exec(font)![1]) / 2

/** jsdom has no canvas: record what would be drawn. */
function stubCanvas() {
  const drawn: { text: string; color: string; font: string; shadowBlur: number }[] = []
  const stroked: { text: string; lineWidth: number; shadowBlur: number; color: string }[] = []
  const boxes: unknown[] = []
  const saved: Record<string, unknown>[] = []
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
    textAlign: '',
    textBaseline: '',
    measureText(text: string) {
      return { width: measure(text, this.font) }
    },
    save() {
      saved.push({ shadowColor: this.shadowColor, shadowBlur: this.shadowBlur, shadowOffsetY: this.shadowOffsetY })
    },
    restore() {
      Object.assign(this, saved.pop())
    },
    strokeText(text: string) {
      stroked.push({ text, lineWidth: this.lineWidth, shadowBlur: this.shadowBlur, color: String(this.strokeStyle) })
    },
    fillText(text: string) {
      drawn.push({ text, color: String(this.fillStyle), font: this.font, shadowBlur: this.shadowBlur })
    },
    roundRect() {
      boxes.push(1)
    },
    beginPath() {},
    fill() {},
    translate() {},
    rotate() {},
    drawImage() {},
    fillRect() {},
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(new Blob(['png'])))
  return { drawn, stroked, boxes }
}

const LOOK: SubtitleLook = { position: 72, hook: { style: true, position: 50, punchIn: null }, firstShotDuration: 2 }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildOverlayFilterGraph', () => {
  it('chains one overlay per cue, each reading the previous stage\'s output', () => {
    const { filterGraph, outputLabel } = buildOverlayFilterGraph([1500, 1400, 1450])
    expect(filterGraph).toContain('[0:v][sub0]overlay')
    expect(filterGraph).toContain('[v0][sub1]overlay')
    expect(filterGraph).toContain('[v1][sub2]overlay')
    expect(outputLabel).toBe('[v2]')
  })

  it('uses each cue\'s own Y coordinate and centers horizontally', () => {
    const { filterGraph } = buildOverlayFilterGraph([300, 250])
    expect(filterGraph).toContain('[sub0]overlay=x=(W-w)/2:y=300')
    expect(filterGraph).toContain('[sub1]overlay=x=(W-w)/2:y=250')
  })

  it('produces a single overlay stage for one cue', () => {
    const { filterGraph, outputLabel } = buildOverlayFilterGraph([100])
    expect(filterGraph).toBe('[0:v][sub0]overlay=x=(W-w)/2:y=100[v0]')
    expect(outputLabel).toBe('[v0]')
  })

  it('handles zero cues by returning an empty filter graph with the base video as output', () => {
    const { filterGraph, outputLabel } = buildOverlayFilterGraph([])
    expect(filterGraph).toBe('')
    expect(outputLabel).toBe('[0:v]')
  })
})

describe('ffmpegProgressRatio', () => {
  it('is the output time (microseconds) over the video duration', () => {
    expect(ffmpegProgressRatio(45_000_000, 90)).toBe(0.5)
  })

  it('stays within 0–1, including ffmpeg\'s bogus early/late timestamps', () => {
    expect(ffmpegProgressRatio(-1_000, 90)).toBe(0)
    expect(ffmpegProgressRatio(95_000_000, 90)).toBe(1)
    expect(ffmpegProgressRatio(NaN, 90)).toBe(0)
  })

  it('is 0 when the duration is unknown', () => {
    expect(ffmpegProgressRatio(45_000_000, 0)).toBe(0)
  })
})

describe('cuePosition', () => {
  it('centers hook cues at the hook position and the rest at the subtitle position', () => {
    const cue: StyledCue = { id: 'a', start: 0, end: 1, en: 'a', ja: 'あ', variant: 'hook' }
    expect(cuePosition(cue, LOOK)).toBe(50)
    expect(cuePosition({ ...cue, variant: 'normal' }, LOOK)).toBe(72)
  })
})

describe('renderCueImage', () => {
  it('draws an emphasized word in yellow, without its asterisks', async () => {
    const { drawn } = stubCanvas()
    await renderCueImage({ id: 'a', start: 0, end: 1, en: 'I *love* it', ja: 'すき' })
    expect(drawn).toContainEqual(expect.objectContaining({ text: 'love', color: '#FFD60A' }))
    expect(drawn.some(d => d.text.includes('*'))).toBe(false)
  })

  it('outlines each run in black under a soft shadow, then fills it white without one, on no box', async () => {
    const { drawn, stroked, boxes } = stubCanvas()
    await renderCueImage({ id: 'a', start: 0, end: 1, en: 'Hi', ja: 'やあ' })
    expect(boxes).toHaveLength(0)
    expect(stroked[0]).toEqual({ text: 'Hi', lineWidth: 7, shadowBlur: expect.closeTo(9), color: '#000' })
    expect(drawn[0]).toMatchObject({ text: 'Hi', color: '#ffffff', shadowBlur: 0, font: `800 60px ${SUBTITLE_FONT_FAMILY}` })
    expect(drawn[1]).toMatchObject({ text: 'やあ', color: '#ffffff' })
  })

})

describe('renderSubtitleOverlays', () => {
  it('places each cue at its variant\'s position, skipping untranslated ones', async () => {
    stubCanvas()
    const hook: StyledCue = { id: 'a', start: 0, end: 1, en: 'Hi', ja: 'やあ', variant: 'hook' }
    const normal: StyledCue = { id: 'b', start: 2, end: 3, en: 'Bye', ja: 'じゃあ', variant: 'normal' }
    const untranslated: StyledCue = { id: 'c', start: 3, end: 4, en: 'Hm', ja: null, variant: 'normal' }
    const overlays = await renderSubtitleOverlays([hook, normal, untranslated], LOOK)
    expect(overlays.map(o => [o.start, o.end, o.y])).toEqual([
      [0, 1, subtitleY(50, 1920, layoutCue(hook, measure).height)],
      [2, 3, subtitleY(72, 1920, layoutCue(normal, measure).height)],
    ])
  })

  it('turns a hook cue\'s emoji into a sticker for the whole first shot, not drawn in its text', async () => {
    const { drawn } = stubCanvas()
    const hook: StyledCue = { id: 'a', start: 0, end: 1, en: 'I put *Vaseline*🧴 on', ja: 'ワセリン', variant: 'hook' }
    const overlays = await renderSubtitleOverlays([hook], LOOK)
    expect(overlays.map(o => [o.start, o.end])).toEqual([[0, 1], [0, 2]])
    expect(overlays[1].y).toBe(subtitleY(STICKER_CENTER_Y, 1920, STICKER_IMAGE_HEIGHT))
    expect(drawn.map(d => d.text)).toContain('🧴')
    expect(drawn.some(d => d.text !== '🧴' && d.text.includes('🧴'))).toBe(false)
  })

  it('makes no sticker from a normal cue or an untranslated hook cue', async () => {
    stubCanvas()
    const normal: StyledCue = { id: 'b', start: 2, end: 3, en: 'Bye 👋', ja: 'じゃあ', variant: 'normal' }
    const untranslated: StyledCue = { id: 'a', start: 0, end: 1, en: 'Hi 🧴', ja: null, variant: 'hook' }
    const overlays = await renderSubtitleOverlays([untranslated, normal], LOOK)
    expect(overlays.map(o => [o.start, o.end])).toEqual([[2, 3]])
  })
})

describe('burnSubtitles', () => {
  it('rejects a cancelled burn before doing any work (issue #34)', async () => {
    const controller = new AbortController()
    controller.abort()
    const cues = [{ id: 'c0', start: 0, end: 1, en: 'Hi', ja: 'やあ' }]
    await expect(
      burnSubtitles(new Blob(['x']), cues, LOOK, undefined, controller.signal),
    ).rejects.toBeInstanceOf(CancelledError)
  })

  it('shows the first shot\'s first cue from 0s on the whole joined video', async () => {
    stubCanvas()
    const cues = [
      { id: 'speech-0', start: 0.3, end: 1.5, en: 'one', ja: 'いち' },
      { id: 'speech-1', start: 2.4, end: 3, en: 'two', ja: 'に' },
    ]
    await burnSubtitles(new Blob(['x']), cues, LOOK)
    const overlays = vi.mocked(burnSubtitlesWebCodecs).mock.calls[0][1]
    expect(overlays.map(o => [o.start, o.end])).toEqual([[0, 1.5], [2.4, 3]])
  })

  it('returns the video unchanged when nothing is translated', async () => {
    const video = new Blob(['x'])
    expect(await burnSubtitles(video, [{ id: 'c0', start: 0, end: 1, en: 'Hi', ja: null }], LOOK)).toBe(video)
  })
})

describe('buildOverlayFilterGraph with a punch-in', () => {
  it('feeds the overlays from the zoomed base video', () => {
    expect(buildOverlayFilterGraph([100], 'zoompan=Z')).toEqual({
      filterGraph: '[0:v]zoompan=Z[base];[base][sub0]overlay=x=(W-w)/2:y=100[v0]',
      outputLabel: '[v0]',
    })
  })

  it('outputs the zoomed video when there is nothing to overlay', () => {
    expect(buildOverlayFilterGraph([], 'zoompan=Z')).toEqual({ filterGraph: '[0:v]zoompan=Z[base]', outputLabel: '[base]' })
  })
})

describe('punchInFilter', () => {
  it('pushes in about (50%, 40%) from `at` to `until`, then drops back, at the output size and rate', () => {
    const plan = { punchIn: { zoom: 1.25 as const, direction: 'in' as const, at: 0.4, impact: 'medium' as const }, until: 2 }
    expect(punchInFilter(plan)).toBe(
      "zoompan=z='if(lt((in+0.5)/30,0.400),1,if(lt((in+0.5)/30,2.000),1+0.25*((in+0.5)/30-0.400)/1.600,1))'"
        + ":x='iw/2-iw/zoom/2':y='ih*0.4-ih*0.4/zoom':d=1:s=1080x1920:fps=30",
    )
  })
})

describe('punchInFilter zooming out', () => {
  it('holds the zoom until `at`, then pulls back to 1x at `until`', () => {
    const plan = { punchIn: { zoom: 1.25 as const, direction: 'out' as const, at: 0.4, impact: null }, until: 2 }
    expect(punchInFilter(plan)).toBe(
      "zoompan=z='if(lt((in+0.5)/30,0.400),1.25,if(lt((in+0.5)/30,2.000),1.25-0.25*((in+0.5)/30-0.400)/1.600,1))'"
        + ":x='iw/2-iw/zoom/2':y='ih*0.4-ih*0.4/zoom':d=1:s=1080x1920:fps=30",
    )
  })
})

const PUNCH_IN = { zoom: 1.25 as const, direction: 'in' as const, at: 0.4, impact: 'medium' as const }

describe('burnSubtitles punch-in', () => {
  it('zooms the whole video\'s first shot on the hardware path', async () => {
    stubCanvas()
    const look: SubtitleLook = { position: 72, hook: { style: true, position: 50, punchIn: PUNCH_IN }, firstShotDuration: 2 }
    await burnSubtitles(new Blob(['x']), [{ id: 'c0', start: 0, end: 1, en: 'Hi', ja: 'やあ' }], look)
    expect(vi.mocked(burnSubtitlesWebCodecs).mock.calls[0][4]).toEqual({ punchIn: { punchIn: PUNCH_IN, until: 2 } })
  })
})

describe('burnShotSubtitles', () => {
  it('forwards the punch-in plan to the shot encode', async () => {
    stubCanvas()
    const hookCue: StyledCue = { id: 'a', start: 0, end: 1, en: 'Hi', ja: 'やあ', variant: 'hook' }
    const look: SubtitleLook = { position: 72, hook: { style: true, position: 50, punchIn: PUNCH_IN }, firstShotDuration: 2 }
    await burnShotSubtitles(new Blob(['shot']), 0, 2, [hookCue], look)
    expect(vi.mocked(normalizeShotWebCodecs).mock.calls[0][6]).toEqual({ punchIn: { punchIn: PUNCH_IN, until: 2 } })
  })
})
