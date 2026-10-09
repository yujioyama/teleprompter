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
import { layoutCue, layoutHeadline, type MeasureText } from './subtitleLayout'
import { clampedSubtitleY, subtitleY } from './subtitlePosition'
import { headlineY, type StyledCue } from './subtitleHook'
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
  const drawn: { text: string; color: string; font: string }[] = []
  const bands: string[] = []
  const ctx = {
    font: '',
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
    measureText(text: string) {
      return { width: measure(text, this.font) }
    },
    fillText(text: string) {
      drawn.push({ text, color: String(this.fillStyle), font: this.font })
    },
    beginPath() {},
    roundRect() {},
    fill() {
      bands.push(String(this.fillStyle))
    },
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(new Blob(['png'])))
  return { drawn, bands }
}

const LOOK: SubtitleLook = { position: 72, hook: { style: true, position: 50, headline: '', punchIn: false }, firstShotDuration: 2 }

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

  it('draws a hook cue bigger, on a darker band', async () => {
    const { drawn, bands } = stubCanvas()
    await renderCueImage({ id: 'a', start: 0, end: 1, en: 'Hi', ja: 'やあ' }, 'hook')
    expect(bands).toEqual(['rgba(0, 0, 0, 0.8)'])
    expect(drawn[0].font).toBe('bold 100px sans-serif')
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
      [0, 1, subtitleY(50, 1920, layoutCue(hook, measure, 'hook').height)],
      [2, 3, subtitleY(72, 1920, layoutCue(normal, measure).height)],
    ])
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
  it('zooms the first seconds in about the center, at the output size and rate', () => {
    expect(punchInFilter(2)).toBe(
      "zoompan=z='if(lt(in/30,2.000),1+0.08*in/30/2.000,1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30",
    )
  })
})

describe('the hook headline', () => {
  const headlineLook = (headline: string, firstShotDuration: number | null = 2): SubtitleLook => ({
    position: 72,
    hook: { style: true, position: 50, headline, punchIn: false },
    firstShotDuration,
  })
  const hookCue: StyledCue = { id: 'a', start: 0, end: 1, en: 'Hi', ja: 'やあ', variant: 'hook' }
  const laterCue: StyledCue = { id: 'b', start: 2.5, end: 3, en: 'Bye', ja: 'じゃあ', variant: 'normal' }

  it('shows over the first shot, just above its subtitle, emphasis in yellow', async () => {
    const { drawn } = stubCanvas()
    const overlays = await renderSubtitleOverlays([hookCue, laterCue], headlineLook('Wait *what*'))
    const cueHeight = layoutCue(hookCue, measure, 'hook').height
    const cueTop = clampedSubtitleY(50, cueHeight)
    const headline = layoutHeadline('Wait *what*', measure)
    expect(overlays).toHaveLength(3)
    expect(overlays[2]).toMatchObject({
      start: 0,
      end: 2,
      y: headlineY([{ top: cueTop, bottom: cueTop + cueHeight }], headline.height, 50),
    })
    expect(drawn).toContainEqual(expect.objectContaining({ text: 'what', color: '#FFD60A' }))
  })

  it('goes below the subtitle when the hook position leaves no room above it', async () => {
    stubCanvas()
    const look = { ...headlineLook('Wait'), hook: { style: true, position: 13.75, headline: 'Wait', punchIn: false } }
    const overlays = await renderSubtitleOverlays([hookCue], look)
    const cueHeight = layoutCue(hookCue, measure, 'hook').height
    expect(overlays[1].y).toBeGreaterThanOrEqual(overlays[0].y + cueHeight)
  })

  it('centers at the hook position when the first shot has no subtitle', async () => {
    stubCanvas()
    const overlays = await renderSubtitleOverlays([laterCue], headlineLook('Wait'))
    const headline = layoutHeadline('Wait', measure)
    expect(overlays[1]).toMatchObject({ start: 0, end: 2, y: clampedSubtitleY(50, headline.height) })
  })

  it('is left out of any clip but the first shot\'s', async () => {
    stubCanvas()
    expect(await renderSubtitleOverlays([laterCue], headlineLook('Wait', null))).toHaveLength(1)
  })

  it('is burned even when no cue is translated', async () => {
    stubCanvas()
    await burnSubtitles(new Blob(['x']), [{ id: 'c0', start: 0, end: 1, en: 'Hi', ja: null }], headlineLook('Wait'))
    expect(vi.mocked(burnSubtitlesWebCodecs).mock.calls[0][1]).toHaveLength(1)
  })
})

describe('burnSubtitles punch-in', () => {
  it('zooms the whole video\'s first shot on the hardware path', async () => {
    stubCanvas()
    const look: SubtitleLook = { position: 72, hook: { style: true, position: 50, headline: '', punchIn: true }, firstShotDuration: 2 }
    await burnSubtitles(new Blob(['x']), [{ id: 'c0', start: 0, end: 1, en: 'Hi', ja: 'やあ' }], look)
    expect(vi.mocked(burnSubtitlesWebCodecs).mock.calls[0][4]).toEqual({ punchInUntil: 2 })
  })
})

describe('burnShotSubtitles', () => {
  it('forwards the punch-in to the shot encode as punchInUntil', async () => {
    stubCanvas()
    const hookCue: StyledCue = { id: 'a', start: 0, end: 1, en: 'Hi', ja: 'やあ', variant: 'hook' }
    const look: SubtitleLook = {
      position: 72,
      hook: { style: true, position: 50, headline: '', punchIn: true },
      firstShotDuration: 2,
    }
    await burnShotSubtitles(new Blob(['shot']), 0, 2, [hookCue], look)
    expect(vi.mocked(normalizeShotWebCodecs).mock.calls[0][6]).toEqual({ punchInUntil: 2 })
  })
})
