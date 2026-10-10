import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest'
import { act, render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { IDBFactory } from 'fake-indexeddb'
import FinalizePage from './FinalizePage'
import { Script } from '../types'
import { saveShotVideo } from '../utils/shotVideoStore'
import * as burnModule from '../utils/burnSubtitles'
import * as mixModule from '../utils/mixMusic'
import { MUSIC_TRACKS } from '../data/musicTracks'
import { trimAndNormalizeShot, unifyNormalizeBackends } from '../utils/trimAndNormalizeShot'
import { concatVideos } from '../utils/concatVideos'
import { probeVideoDuration } from '../utils/probeVideoDuration'
import { normalizeLoudness, markLoudnessNormalized } from '../utils/normalizeLoudness'
import { prepareFinalAudio, joinVideoAndAudio } from '../utils/webcodecs/finalAudio'
import { shareOrDownload } from '../utils/shareOrDownload'
import { detectSpeech, type SpeechRegion } from '../utils/detectSpeechBounds'
import { listShotAnalyses, updateShotAnalysis } from '../utils/shotAnalysisStore'
import { loadFinalizeProgress } from '../utils/finalizeProgressStore'
import { listShotVideos } from '../utils/shotVideoStore'
import { canUseWebCodecs } from '../utils/webcodecs/support'
import { concatClipsWebCodecs } from '../utils/webcodecs/concatClips'

vi.mock('../utils/burnSubtitles')
vi.mock('../utils/mixMusic')
vi.mock('../utils/concatVideos', () => ({
  concatVideos: vi.fn(async (blobs: Blob[]) => new Blob(blobs, { type: 'video/mp4' })),
}))
vi.mock('../utils/trimAndNormalizeShot', () => ({
  trimAndNormalizeShot: vi.fn(async (blob: Blob) => blob),
  trimAndNormalizeShotFFmpeg: vi.fn(async (blob: Blob) => blob),
  normalizedBackendOf: vi.fn(() => 'ffmpeg'),
  unifyNormalizeBackends: vi.fn(async (_clips: unknown, normalized: Blob[]) => normalized),
}))
// jsdom never loads media; by default the probe never answers, so tests
// drive durations through ShotTrimmer's own loadedmetadata as before.
vi.mock('../utils/probeVideoDuration', () => ({
  probeVideoDuration: vi.fn(() => new Promise<number>(() => {})),
}))
vi.mock('../utils/shareOrDownload', () => ({
  shareOrDownload: vi.fn(async () => true),
}))
vi.mock('../utils/normalizeLoudness', () => ({
  normalizeLoudness: vi.fn(),
  markLoudnessNormalized: vi.fn(),
}))
vi.mock('../utils/webcodecs/finalAudio', () => ({
  prepareFinalAudio: vi.fn(),
  joinVideoAndAudio: vi.fn(),
}))
vi.mock('../utils/detectSpeechBounds', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/detectSpeechBounds')>()),
  detectSpeech: vi.fn(async () => null),
}))

// Speech from 1.0s to 3.0s of a 5s shot: with the default padding
// (0.3s before, 0.4s after) that's a cut from 0.7s to 3.4s.
const SPEECH_1_TO_3: SpeechRegion = { speechStart: 1, speechEnd: 3, floor: 0, ceiling: 5, duration: 5 }
// Off by default (as in jsdom itself): background encoding and per-shot
// burn-in only happen on the hardware path.
vi.mock('../utils/webcodecs/support', () => ({
  canUseWebCodecs: vi.fn(async () => false),
  disableWebCodecs: vi.fn(),
}))
vi.mock('../utils/webcodecs/concatClips', () => ({
  concatClipsWebCodecs: vi.fn(async (blobs: Blob[]) => new Blob(blobs, { type: 'video/mp4' })),
}))

const LOUDNESS_NORMALIZED = new Blob(['loudness-normalized'], { type: 'video/mp4' })

const SHOT_1 = '11111111-1111-1111-1111-111111111111'

function seedScript(): Script {
  const script: Script = {
    id: 'script-1',
    title: 'テスト動画',
    shots: [{ id: SHOT_1, text: 'ショット1' }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  localStorage.setItem('teleprompter_scripts', JSON.stringify([script]))
  return script
}

function renderFinalizePage(scriptId: string) {
  render(
    <MemoryRouter initialEntries={[`/scripts/${scriptId}/finalize`]}>
      <Routes>
        <Route path="/scripts/:id/finalize" element={<FinalizePage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  // The tests below predate the usual BGM; they walk the BGM step by hand.
  // They also predate the first shot's own lead-in, so it is the usual 0.3s.
  localStorage.setItem('teleprompter_settings', JSON.stringify({ defaultBgmId: null, firstShotPaddingStart: 0.3 }))
  vi.clearAllMocks()
  // mixForExport reports which way it added the BGM.
  vi.spyOn(console, 'info').mockImplementation(() => {})
  const script = seedScript()
  await saveShotVideo(script.id, SHOT_1, new Blob(['shot'], { type: 'video/mp4' }))

  vi.mocked(burnModule.burnSubtitles).mockResolvedValue(new Blob(['burned'], { type: 'video/mp4' }))
  vi.mocked(mixModule.mixMusic).mockResolvedValue(new Blob(['mixed'], { type: 'video/mp4' }))
  vi.mocked(normalizeLoudness).mockResolvedValue(LOUDNESS_NORMALIZED)
  vi.mocked(canUseWebCodecs).mockResolvedValue(false)
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    blob: () => Promise.resolve(new Blob(['track'], { type: 'audio/mpeg' })),
  }) as unknown as typeof fetch
})

describe('FinalizePage trim step: one player for the selected shot', () => {
  const SHOT_2 = '22222222-2222-2222-2222-222222222222'

  async function seedTwoShots() {
    const script: Script = {
      id: 'script-1',
      title: 'テスト動画',
      shots: [
        { id: SHOT_1, text: 'ショット1' },
        { id: SHOT_2, text: 'ショット2' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    localStorage.setItem('teleprompter_scripts', JSON.stringify([script]))
    await saveShotVideo(script.id, SHOT_2, new Blob(['shot2'], { type: 'video/mp4' }))
  }

  it('keeps a single <video> no matter how many shots there are (issue #12)', async () => {
    await seedTwoShots()
    renderFinalizePage('script-1')

    await screen.findByText('ショット1')
    expect(document.querySelectorAll('video')).toHaveLength(1)
  })

  function shotSelect() {
    return screen.getByRole('combobox', { name: 'ショットを選ぶ' }) as HTMLSelectElement
  }

  it('switches the player to a shot picked in the select, keeping each shot\'s own trim', async () => {
    await seedTwoShots()
    let n = 0
    const urlSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:shot-${++n}`)
    onTestFinished(() => urlSpy.mockRestore())
    vi.mocked(probeVideoDuration).mockResolvedValueOnce(5).mockResolvedValueOnce(8)
    renderFinalizePage('script-1')

    await screen.findByText('ショット1')
    await screen.findByText('終了 5.0秒')
    const firstSrc = document.querySelector('video')!.getAttribute('src')

    fireEvent.change(shotSelect(), { target: { value: SHOT_2 } })

    expect(shotSelect().value).toBe(SHOT_2)
    expect(screen.getByText('ショット2')).toBeInTheDocument()
    expect(screen.getByText('終了 8.0秒')).toBeInTheDocument()
    expect(document.querySelectorAll('video')).toHaveLength(1)
    expect(document.querySelector('video')!.getAttribute('src')).not.toBe(firstSrc)
  })

  it('shows a shot\'s text without its *emphasis* markers', async () => {
    await seedTwoShots()
    const script = JSON.parse(localStorage.getItem('teleprompter_scripts')!)[0] as Script
    script.shots[0].text = 'これは*大事*な話'
    localStorage.setItem('teleprompter_scripts', JSON.stringify([script]))
    renderFinalizePage('script-1')

    expect(await screen.findByText('これは大事な話')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /これは大事な話/ })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('*大事*')
  })

  it('steps through shots with the prev/next buttons (issue #18)', async () => {
    await seedTwoShots()
    renderFinalizePage('script-1')

    await screen.findByText('ショット1')
    const prev = screen.getByRole('button', { name: '前のショット' })
    const next = screen.getByRole('button', { name: '次のショット' })
    expect(prev).toBeDisabled()

    fireEvent.click(next)
    expect(shotSelect().value).toBe(SHOT_2)
    expect(next).toBeDisabled()

    fireEvent.click(prev)
    expect(shotSelect().value).toBe(SHOT_1)
  })

  it('skips shots without a saved video', async () => {
    const SHOT_3 = '33333333-3333-3333-3333-333333333333'
    await seedTwoShots()
    const script = JSON.parse(localStorage.getItem('teleprompter_scripts')!)[0] as Script
    script.shots = [script.shots[0], { id: SHOT_3, text: 'ショット3' }, script.shots[1]]
    localStorage.setItem('teleprompter_scripts', JSON.stringify([script]))
    renderFinalizePage('script-1')

    await screen.findByText('ショット1')
    expect(screen.getByRole('option', { name: /ショット3/ })).toBeDisabled()
    expect(screen.getByRole('option', { name: /ショット3/ })).toHaveTextContent('動画なし')

    fireEvent.click(screen.getByRole('button', { name: '次のショット' }))
    expect(shotSelect().value).toBe(SHOT_2)
  })

  it('shows each shot\'s kept length in the select', async () => {
    await seedTwoShots()
    vi.mocked(probeVideoDuration).mockResolvedValueOnce(5).mockResolvedValueOnce(8)
    renderFinalizePage('script-1')

    await waitFor(() => expect(screen.getByRole('option', { name: /ショット2/ })).toHaveTextContent('8.0秒'))
    expect(screen.getByRole('option', { name: /ショット1/ })).toHaveTextContent('5.0秒')
  })
})

// jsdom has no layout, so give the trim bar a width the handles can be dragged across.
function dragEndHandleTo(clientX: number) {
  const timeline = document.querySelector('[class*="timeline"]') as HTMLElement
  timeline.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect
  const endHandle = document.querySelectorAll('[class*="handle"]')[1]
  fireEvent.pointerDown(endHandle)
  // jsdom has no PointerEvent, and fireEvent.pointerMove would drop clientX.
  fireEvent(timeline, new MouseEvent('pointermove', { bubbles: true, clientX }))
  fireEvent.pointerUp(timeline)
}

describe('FinalizePage trim step: auto-cut around the speech (issue #21)', () => {
  it('opens each shot already trimmed to its speech, and combines that cut', async () => {
    vi.mocked(probeVideoDuration).mockResolvedValueOnce(5)
    vi.mocked(detectSpeech).mockResolvedValueOnce(SPEECH_1_TO_3)
    renderFinalizePage('script-1')

    await screen.findByText('開始 0.7秒')
    expect(screen.getByText('終了 3.4秒')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByText('結合する')).not.toBeDisabled())
    fireEvent.click(screen.getByText('結合する'))
    await waitFor(() => expect(trimAndNormalizeShot).toHaveBeenCalled())
    const [, start, end] = vi.mocked(trimAndNormalizeShot).mock.calls[0]
    expect(start).toBeCloseTo(0.7)
    expect(end).toBeCloseTo(3.4)
  })

  it('uses a shot\'s own padding, and skips detection when its auto-trim is off', async () => {
    const SHOT_2 = '22222222-2222-2222-2222-222222222222'
    const script = seedScript()
    script.shots = [
      { id: SHOT_1, text: 'ショット1', trimPaddingStart: 1, trimPaddingEnd: 1.5 },
      { id: SHOT_2, text: 'ショット2', trimEnabled: false },
    ]
    localStorage.setItem('teleprompter_scripts', JSON.stringify([script]))
    await saveShotVideo(script.id, SHOT_2, new Blob(['shot2'], { type: 'video/mp4' }))
    vi.mocked(probeVideoDuration).mockResolvedValueOnce(5)
    vi.mocked(detectSpeech).mockResolvedValueOnce(SPEECH_1_TO_3)
    renderFinalizePage('script-1')

    // 1.0s - 1s and 3.0s + 1.5s.
    await screen.findByText('終了 4.5秒')
    expect(screen.getByText('開始 0.0秒')).toBeInTheDocument()
    expect(detectSpeech).toHaveBeenCalledTimes(1)
  })

  it('holds 結合 until every shot has been checked for speech', async () => {
    vi.mocked(probeVideoDuration).mockResolvedValueOnce(5)
    let finish!: (b: null) => void
    vi.mocked(detectSpeech).mockReturnValueOnce(new Promise(r => (finish = r)))
    renderFinalizePage('script-1')

    const button = await screen.findByText(/前後の無音を検出中/)
    expect(button).toBeDisabled()

    finish(null)
    await waitFor(() => expect(screen.getByText('結合する')).not.toBeDisabled())
    expect(screen.getByText('開始 0.0秒')).toBeInTheDocument()
    expect(screen.getByText('終了 5.0秒')).toBeInTheDocument()
  })

  it('lets a hand-adjusted cut go back to the detected one', async () => {
    vi.mocked(probeVideoDuration).mockResolvedValueOnce(5)
    vi.mocked(detectSpeech).mockResolvedValueOnce(SPEECH_1_TO_3)
    renderFinalizePage('script-1')
    await screen.findByText('終了 3.4秒')
    expect(screen.queryByText('自動カットに戻す')).not.toBeInTheDocument()

    dragEndHandleTo(90)
    expect(screen.getByText('終了 4.5秒')).toBeInTheDocument()

    fireEvent.click(screen.getByText('自動カットに戻す'))
    expect(screen.getByText('終了 3.4秒')).toBeInTheDocument()
    expect(screen.queryByText('自動カットに戻す')).not.toBeInTheDocument()
  })

  it('never moves a handle the user already dragged when detection finishes late', async () => {
    let finish!: (region: SpeechRegion) => void
    vi.mocked(detectSpeech).mockReturnValueOnce(new Promise(r => (finish = r)))
    vi.mocked(probeVideoDuration).mockResolvedValueOnce(5)
    renderFinalizePage('script-1')
    await screen.findByText('終了 5.0秒')

    dragEndHandleTo(80)
    expect(screen.getByText('終了 4.0秒')).toBeInTheDocument()

    finish(SPEECH_1_TO_3)
    await screen.findByText('自動カットに戻す')
    expect(screen.getByText('終了 4.0秒')).toBeInTheDocument()
  })

  async function currentTakes() {
    return new Map((await listShotVideos('script-1')).map(v => [v.shotId, v.updatedAt]))
  }

  it('remembers each shot\'s duration and speech for the next visit', async () => {
    vi.mocked(probeVideoDuration).mockResolvedValueOnce(5)
    vi.mocked(detectSpeech).mockResolvedValueOnce(SPEECH_1_TO_3)
    renderFinalizePage('script-1')
    await screen.findByText('終了 3.4秒')

    const takes = await currentTakes()
    await waitFor(async () =>
      expect((await listShotAnalyses('script-1', takes)).get(SHOT_1)).toEqual({ duration: 5, speech: SPEECH_1_TO_3 }),
    )
  })

  it('opens an already analysed take cut at once, without decoding it again', async () => {
    const takes = await currentTakes()
    await updateShotAnalysis('script-1', SHOT_1, takes.get(SHOT_1)!, { duration: 5, speech: SPEECH_1_TO_3 })
    renderFinalizePage('script-1')

    await screen.findByText('終了 3.4秒')
    expect(screen.getByText('開始 0.7秒')).toBeInTheDocument()
    expect(screen.getByText('結合する')).not.toBeDisabled()
    expect(probeVideoDuration).not.toHaveBeenCalled()
    expect(detectSpeech).not.toHaveBeenCalled()
  })

  it('opens the first shot with its own, shorter lead-in', async () => {
    localStorage.setItem('teleprompter_settings', JSON.stringify({ defaultBgmId: null, firstShotPaddingStart: 0.1 }))
    vi.mocked(probeVideoDuration).mockResolvedValueOnce(5)
    vi.mocked(detectSpeech).mockResolvedValueOnce(SPEECH_1_TO_3)
    renderFinalizePage('script-1')

    // 1.0s - 0.1s, rather than the usual 0.3s before.
    await screen.findByText('開始 0.9秒')
    expect(screen.getByText('終了 3.4秒')).toBeInTheDocument()
  })
})

describe('FinalizePage trim step: picks up where it was left', () => {
  // The only player reports its duration, as it would once loaded.
  function loadShotDuration(duration: number) {
    const video = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { value: duration, configurable: true })
    fireEvent(video, new Event('loadedmetadata'))
  }

  async function combineOnce() {
    renderFinalizePage('script-1')
    await screen.findByText('ショット1')
    loadShotDuration(5)
    fireEvent.click(await screen.findByText('結合する'))
    await screen.findByText('結合結果')
    await waitFor(async () => expect((await loadFinalizeProgress('script-1')).combined).not.toBeNull())
    cleanup()
    vi.mocked(trimAndNormalizeShot).mockClear()
  }

  it('reopens a hand-set cut after leaving the page', async () => {
    renderFinalizePage('script-1')
    await screen.findByText('ショット1')
    loadShotDuration(5)
    await screen.findByText('終了 5.0秒')
    dragEndHandleTo(80)
    await waitFor(async () => expect((await loadFinalizeProgress('script-1')).trims[SHOT_1]).toBeDefined())
    cleanup()

    renderFinalizePage('script-1')
    await screen.findByText('ショット1')
    // The player loading again must not reset the cut to the whole shot.
    loadShotDuration(5)
    expect(await screen.findByText('終了 4.0秒')).toBeInTheDocument()
  })

  it('reopens the 結合 result without combining again, ready for 次へ', async () => {
    await combineOnce()

    renderFinalizePage('script-1')
    expect(await screen.findByText('結合結果')).toBeInTheDocument()
    fireEvent.click(screen.getByText('次へ'))
    expect(await screen.findByDisplayValue('ショット1')).toBeInTheDocument()
    expect(trimAndNormalizeShot).not.toHaveBeenCalled()
  })

  it('drops the saved 結合 once a shot has been retaken', async () => {
    await combineOnce()
    // A later take gets a later updatedAt.
    await new Promise(r => setTimeout(r, 5))
    await saveShotVideo('script-1', SHOT_1, new Blob(['retake'], { type: 'video/mp4' }))

    renderFinalizePage('script-1')
    await screen.findByText('結合する')
    expect(screen.queryByText('結合結果')).not.toBeInTheDocument()
  })
})

describe('FinalizePage subtitle step: picks up where it was left', () => {
  async function combineAndTranslate() {
    renderFinalizePage('script-1')
    await screen.findByText('ショット1')
    const video = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { value: 5, configurable: true })
    fireEvent(video, new Event('loadedmetadata'))
    fireEvent.click(await screen.findByText('結合する'))
    fireEvent.click(await screen.findByText('次へ'))
    fireEvent.change(await screen.findByLabelText('英語字幕 1'), { target: { value: 'Hello there' } })
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(within(screen.getByRole('group', { name: '字幕の位置' })).getByRole('button', { name: '上部' }))
    await waitFor(async () =>
      expect((await loadFinalizeProgress('script-1')).subtitles?.cues[0]).toMatchObject({
        en: 'Hello there',
        ja: 'こんにちは',
      }),
    )
  }

  it('reopens on the subtitle step with the edits, translation and position kept', async () => {
    await combineAndTranslate()
    cleanup()
    vi.mocked(trimAndNormalizeShot).mockClear()

    renderFinalizePage('script-1')
    expect(await screen.findByLabelText('英語字幕 1')).toHaveValue('Hello there')
    expect(screen.getByLabelText('日本語字幕 1')).toHaveValue('こんにちは')
    expect(within(screen.getByRole('group', { name: '字幕の位置' })).getByRole('button', { name: '上部' })).toHaveAttribute('aria-pressed', 'true')
    expect(trimAndNormalizeShot).not.toHaveBeenCalled()
  })

  it('forgets the subtitles once the video is combined again', async () => {
    await combineAndTranslate()
    fireEvent.click(screen.getByRole('button', { name: /トリミング/ }))
    fireEvent.click(await screen.findByText('結合する'))
    await screen.findByText('結合結果')
    await waitFor(async () => expect((await loadFinalizeProgress('script-1')).subtitles?.cues ?? []).toEqual([]))
    cleanup()

    renderFinalizePage('script-1')
    expect(await screen.findByText('結合結果')).toBeInTheDocument()
    expect(screen.queryByLabelText('日本語字幕 1')).not.toBeInTheDocument()
  })

  it('does not bring back subtitles for a shot retaken since', async () => {
    await combineAndTranslate()
    cleanup()
    await new Promise(r => setTimeout(r, 5))
    await saveShotVideo('script-1', SHOT_1, new Blob(['retake'], { type: 'video/mp4' }))

    renderFinalizePage('script-1')
    await screen.findByText('結合する')
    expect(screen.queryByLabelText('英語字幕 1')).not.toBeInTheDocument()
  })
})

describe('FinalizePage wizard', () => {
  it('enables 結合 from probed durations, without any shot player reporting one (issue #12)', async () => {
    vi.mocked(probeVideoDuration).mockResolvedValueOnce(5)
    renderFinalizePage('script-1')

    await screen.findByText('ショット1')
    await waitFor(() => expect(screen.getByText('結合する')).not.toBeDisabled())
    expect(screen.getByText('終了 5.0秒')).toBeInTheDocument()
  })

  it('ignores a second duration report, so a player remounting after scrolling never resets the trim', async () => {
    renderFinalizePage('script-1')

    await screen.findByText('ショット1')
    const video = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { value: 5, configurable: true })
    fireEvent(video, new Event('loadedmetadata'))
    await screen.findByText('終了 5.0秒')

    // Any later report (a remount, or the probe finishing late) must not
    // re-initialize trimEnd, which would wipe out the user's trim.
    Object.defineProperty(video, 'duration', { value: 7, configurable: true })
    fireEvent(video, new Event('loadedmetadata'))
    expect(screen.getByText('終了 5.0秒')).toBeInTheDocument()
  })

  it('does not encode in the background when only ffmpeg.wasm is available (issue #12)', async () => {
    renderFinalizePage('script-1')

    await screen.findByText('ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))

    // ffmpeg.wasm's memory use made iOS drop the <video> previews, so on
    // that path encoding must wait for the 結合 press.
    await new Promise(resolve => setTimeout(resolve, 1200))
    expect(vi.mocked(trimAndNormalizeShot)).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    expect(vi.mocked(trimAndNormalizeShot)).toHaveBeenCalledTimes(1)
  })

  async function loadShot() {
    await screen.findByText('ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    await waitFor(() => expect(screen.getByText('結合する')).not.toBeDisabled())
  }

  it('only shows 100% once every shot is actually encoded (issue #31)', async () => {
    vi.mocked(trimAndNormalizeShot).mockImplementationOnce((_blob, _start, _end, onProgress) => {
      onProgress?.(0.996)
      return new Promise<Blob>(() => {})
    })
    renderFinalizePage('script-1')
    await loadShot()

    fireEvent.click(screen.getByText('結合する'))
    expect(await screen.findByText('結合中... 99%')).toBeDisabled()
  })

  it('reports progress while re-encoding shots onto one encoder, instead of sitting at 100% (issue #31)', async () => {
    vi.mocked(unifyNormalizeBackends).mockImplementationOnce((_clips, _normalized, onProgress) => {
      onProgress?.(0.4)
      return new Promise<Blob[]>(() => {})
    })
    renderFinalizePage('script-1')
    await loadShot()

    fireEvent.click(screen.getByText('結合する'))
    expect(await screen.findByText('再変換中... 40%')).toBeDisabled()
  })

  it('says it is finishing up while the shots are joined (issue #31)', async () => {
    vi.mocked(concatVideos).mockReturnValueOnce(new Promise<Blob>(() => {}))
    renderFinalizePage('script-1')
    await loadShot()

    fireEvent.click(screen.getByText('結合する'))
    expect(await screen.findByText('仕上げ中...')).toBeDisabled()
  })

  it('lets a stuck 結合 be cancelled and retried with the same trims (issue #34)', async () => {
    vi.mocked(trimAndNormalizeShot).mockImplementationOnce(() => new Promise<Blob>(() => {}))
    renderFinalizePage('script-1')
    await loadShot()

    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText(/^結合中\.\.\./)
    fireEvent.click(screen.getByText('中断する'))

    expect(await screen.findByText('中断しました')).toBeInTheDocument()
    expect(screen.queryByText('中断する')).not.toBeInTheDocument()
    const combineBtn = screen.getByText('結合する')
    expect(combineBtn).not.toBeDisabled()

    fireEvent.click(combineBtn)
    await screen.findByText('次へ')
    const [first, retry] = vi.mocked(trimAndNormalizeShot).mock.calls
    expect(retry.slice(1, 3)).toEqual(first.slice(1, 3))
  })

  it('lets 結合 be cancelled while the shots are being joined (issue #34)', async () => {
    vi.mocked(concatVideos).mockReturnValueOnce(new Promise<Blob>(() => {}))
    renderFinalizePage('script-1')
    await loadShot()

    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('仕上げ中...')
    fireEvent.click(screen.getByText('中断する'))

    expect(await screen.findByText('中断しました')).toBeInTheDocument()
    expect(vi.mocked(concatVideos).mock.calls[0][1]).toBeInstanceOf(AbortSignal)
    expect(vi.mocked(concatVideos).mock.calls[0][1]?.aborted).toBe(true)
  })

  it('encodes shots in the background once the trims settle, and 結合 reuses them', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    renderFinalizePage('script-1')

    await screen.findByText('ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))

    await waitFor(() => expect(vi.mocked(trimAndNormalizeShot)).toHaveBeenCalledTimes(1), { timeout: 2000 })
    const [, start, end] = vi.mocked(trimAndNormalizeShot).mock.calls[0]
    expect([start, end]).toEqual([0, 5])

    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    expect(vi.mocked(trimAndNormalizeShot)).toHaveBeenCalledTimes(1)
  })

  it('burns subtitles shot by shot in the background, and 次へ just joins them', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    const burnedShot = new Blob(['burned-shot'], { type: 'video/mp4' })
    vi.mocked(burnModule.burnShotSubtitles).mockResolvedValue(burnedShot)
    renderFinalizePage('script-1')

    await screen.findByText('ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    fireEvent.click(screen.getByText('次へ'))

    await screen.findByDisplayValue('ショット1')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))

    // Started before 次へ, while the preview is up.
    await waitFor(() => expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(1), { timeout: 2000 })
    const [, start, end, cues] = vi.mocked(burnModule.burnShotSubtitles).mock.calls[0]
    expect([start, end]).toEqual([0, 5])
    expect(cues).toEqual([expect.objectContaining({ start: 0, end: 5, en: 'ショット1', ja: 'こんにちは' })])

    fireEvent.click(screen.getByText('次へ'))
    await screen.findByText('BGMなしで進む')
    expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(1)
    expect(vi.mocked(concatClipsWebCodecs).mock.calls[0][0]).toEqual([burnedShot])
    expect(burnModule.burnSubtitles).not.toHaveBeenCalled()
  })

  it('walks trim → combine → subtitle → BGM skip → export, with a single save button at the end', async () => {
    renderFinalizePage('script-1')

    // Step 1: trim/combine
    await screen.findByText('ショット1')
    // jsdom never loads real media, so ShotTrimmer's <video onLoadedMetadata>
    // never fires on its own; without a known duration, canCombine stays
    // false and 結合する stays disabled. Stub the one shot's duration and
    // fire the event manually, the same thing a real video load would do.
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    fireEvent.click(screen.getByText('次へ'))

    // Step 2: subtitle — generate, translate, advance without changing position
    await screen.findByDisplayValue('ショット1')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))

    // Step 3: BGM — skip
    fireEvent.click(await screen.findByText('BGMなしで進む'))

    // Step 4: export — exactly one save button, wired to the burned (BGM-less) blob
    expect(await screen.findByText('保存する')).toBeInTheDocument()
    expect(screen.queryAllByText('保存する')).toHaveLength(1)
  })

  it('clicking a completed step in the indicator invalidates later steps', async () => {
    renderFinalizePage('script-1')

    // Step 1: trim/combine
    await screen.findByText('ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    fireEvent.click(screen.getByText('次へ'))

    // Step 2: subtitle — generate, translate, advance
    await screen.findByDisplayValue('ショット1')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))

    // Now on the BGM step, with 'trim' and 'subtitle' both marked completed.
    await screen.findByText('BGMなしで進む')

    // Navigate back to the (now completed) trim step via the indicator.
    fireEvent.click(screen.getByText('トリミング'))

    // We're back on the trim step: the shot list and combine button reappear.
    expect(await screen.findByText('結合する')).toBeInTheDocument()

    // The real assertion: goToStep must have truncated completedSteps so
    // that 'subtitle' is no longer completed. WizardSteps disables a step's
    // button unless it's in `completed`, so the 字幕 step button must now be
    // disabled. This is false (test fails) if goToStep were gutted to a
    // no-op `setStep(target)`, since 'subtitle' would remain in the old
    // completedSteps and the button would stay enabled.
    expect(screen.getByText('字幕').closest('button')).toBeDisabled()
    expect(screen.getByText('BGM').closest('button')).toBeDisabled()
  })

  it('never feeds MusicMixer its own previously-mixed output (no BGM stacking)', async () => {
    renderFinalizePage('script-1')

    // Step 1: trim/combine
    await screen.findByText('ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    fireEvent.click(screen.getByText('次へ'))

    // Step 2: subtitle — generate, translate, advance (produces a burnedBlob)
    await screen.findByDisplayValue('ショット1')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))

    await waitFor(() => expect(burnModule.burnSubtitles).toHaveBeenCalled())
    const burnedBlob = await vi.mocked(burnModule.burnSubtitles).mock.results[0].value

    // Step 3: BGM — mix a track, then come back to the BGM step and mix
    // again at another volume. Each call resolves to a distinguishable blob
    // so we can assert on the *arguments* of the second call directly.
    vi.mocked(mixModule.mixMusic)
      .mockResolvedValueOnce(new Blob(['mixed-1'], { type: 'video/mp4' }))
      .mockResolvedValueOnce(new Blob(['mixed-2'], { type: 'video/mp4' }))

    fireEvent.click(await screen.findByText(MUSIC_TRACKS[0].title))
    fireEvent.click(screen.getByText('次へ'))
    await screen.findByText('保存する')
    expect(mixModule.mixMusic).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('BGM').closest('button')!)
    fireEvent.click(await screen.findByText(MUSIC_TRACKS[0].title))
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.7' } })
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => expect(mixModule.mixMusic).toHaveBeenCalledTimes(2))

    // Both calls must be fed the pre-BGM (burned) blob...
    expect(vi.mocked(mixModule.mixMusic).mock.calls[0][0]).toBe(burnedBlob)
    expect(vi.mocked(mixModule.mixMusic).mock.calls[1][0]).toBe(burnedBlob)
    // ...and critically, the second call must NOT have been fed the first
    // call's resolved (already-mixed) output.
    const firstMixOutput = await vi.mocked(mixModule.mixMusic).mock.results[0].value
    expect(vi.mocked(mixModule.mixMusic).mock.calls[1][0]).not.toBe(firstMixOutput)
  })

  it('preserves subtitle work (cues) when navigating back from BGM to subtitle', async () => {
    renderFinalizePage('script-1')

    // Step 1: trim/combine
    await screen.findByText('ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    fireEvent.click(screen.getByText('次へ'))

    // Step 2: subtitle — generate, translate, advance
    await screen.findByDisplayValue('ショット1')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))

    // Now on the BGM step. Navigate back to subtitle via the wizard indicator.
    await screen.findByText('BGMなしで進む')
    fireEvent.click(screen.getByText('字幕'))

    // The previously generated English cue text must still be visible —
    // SubtitleWorkflow must NOT have reset to its initial idle
    // "📝 英語字幕を生成" state, which would mean the generated cues and
    // translation work were lost.
    expect(await screen.findByDisplayValue('ショット1')).toBeInTheDocument()
    expect(screen.queryByText('📝 英語字幕を生成')).not.toBeInTheDocument()

    // The real regression check: the subtitle step must be completable again,
    // not stuck showing the disabled "焼き込み中..." burning state left over
    // from the first successful burn-in (stage lifted to the parent survives
    // unmount, so a stale 'burning' stage would never reset on its own).
    const nextButton = screen.getByText('次へ')
    expect(nextButton).not.toBeDisabled()
    fireEvent.click(nextButton)

    // Advancing past 'subtitle' a second time must reach the BGM step again.
    expect(await screen.findByText('BGMなしで進む')).toBeInTheDocument()
  })

  it('blocks wizard step navigation while a burn-in is in flight', async () => {
    let resolveBurn: (blob: Blob) => void = () => {}
    vi.mocked(burnModule.burnSubtitles).mockReturnValue(
      new Promise(resolve => {
        resolveBurn = resolve
      })
    )

    renderFinalizePage('script-1')

    // Step 1: trim/combine
    await screen.findByText('ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    fireEvent.click(screen.getByText('次へ'))

    // Step 2: subtitle — generate, translate, then kick off burn-in but don't resolve it yet.
    await screen.findByDisplayValue('ショット1')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))
    await screen.findByText(/^焼き込み中\.\.\./)

    // While pending, the wizard indicator's completed 'trim' step must be
    // disabled, and clicking it must not navigate away.
    const trimStep = screen.getByText('トリミング').closest('button')!
    expect(trimStep).toBeDisabled()
    fireEvent.click(trimStep)
    expect(screen.queryByText('結合する')).not.toBeInTheDocument()
    expect(screen.getByText(/^焼き込み中\.\.\./)).toBeInTheDocument()

    // The page's own back button should also be disabled while processing.
    expect(screen.getByText('‹ 戻る')).toBeDisabled()

    // Resolve the burn-in and confirm the flow completes normally, with
    // navigation re-enabled afterwards.
    resolveBurn(new Blob(['burned'], { type: 'video/mp4' }))
    await screen.findByText('BGMなしで進む')
    expect(screen.getByText('トリミング').closest('button')).not.toBeDisabled()
    expect(screen.getByText('‹ 戻る')).not.toBeDisabled()
  })

  it('unlocks navigation when a stuck burn-in is cancelled (issue #34)', async () => {
    vi.mocked(burnModule.burnSubtitles).mockReturnValue(new Promise(() => {}))
    renderFinalizePage('script-1')

    await screen.findByText('ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    fireEvent.click(screen.getByText('次へ'))

    await screen.findByDisplayValue('ショット1')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))
    await screen.findByText(/^焼き込み中\.\.\./)
    expect(screen.getByText('‹ 戻る')).toBeDisabled()

    fireEvent.click(screen.getByText('中断する'))

    expect(await screen.findByText('中断しました')).toBeInTheDocument()
    expect(screen.getByText('‹ 戻る')).not.toBeDisabled()
    expect(screen.getByText('トリミング').closest('button')).not.toBeDisabled()
    expect(screen.getByDisplayValue('こんにちは')).toBeInTheDocument()
    const burnCall = vi.mocked(burnModule.burnSubtitles).mock.calls[0]
    expect(burnCall[4]).toBeInstanceOf(AbortSignal)
    expect(burnCall[4]?.aborted).toBe(true)
  })

  it('shows the wizard progress indicator with 4 steps', async () => {
    renderFinalizePage('script-1')
    await screen.findByText('ショット1')
    expect(screen.getByText('トリミング')).toBeInTheDocument()
    expect(screen.getByText('字幕')).toBeInTheDocument()
    expect(screen.getByText('BGM')).toBeInTheDocument()
    expect(screen.getByText('書き出し')).toBeInTheDocument()
  })
})

describe('FinalizePage export step: loudness normalization', () => {
  const BURNED = new Blob(['burned'], { type: 'video/mp4' })

  beforeEach(() => {
    vi.mocked(burnModule.burnSubtitles).mockResolvedValue(BURNED)
  })

  // jsdom has no navigator.clipboard; the caption tests define a stub, so
  // remove it again rather than let it leak into later tests.
  afterEach(() => {
    delete (navigator as { clipboard?: unknown }).clipboard
  })

  // Trim/combine → subtitle → skip BGM, landing on the export step.
  async function walkToExport() {
    renderFinalizePage('script-1')
    await screen.findByText('ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    fireEvent.click(screen.getByText('次へ'))
    await screen.findByDisplayValue('ショット1')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))
    fireEvent.click(await screen.findByText('BGMなしで進む'))
  }

  it('normalizes the finished video and saves that version', async () => {
    await walkToExport()
    fireEvent.click(await screen.findByText('保存する'))

    expect(normalizeLoudness).toHaveBeenCalledWith(BURNED)
    await waitFor(() => expect(shareOrDownload).toHaveBeenCalledWith(LOUDNESS_NORMALIZED, 'テスト動画-final'))
  })

  it('shows progress while normalizing, and no save button until it is done', async () => {
    let finish: (blob: Blob) => void = () => {}
    vi.mocked(normalizeLoudness).mockReturnValue(new Promise(resolve => (finish = resolve)))
    await walkToExport()

    expect(await screen.findByText('音量を調整中...')).toBeInTheDocument()
    expect(screen.queryByText('保存する')).not.toBeInTheDocument()
    finish(LOUDNESS_NORMALIZED)
    expect(await screen.findByText('保存する')).toBeInTheDocument()
  })

  it('saves the original video, with a note, when normalizing fails', async () => {
    vi.mocked(normalizeLoudness).mockRejectedValue(new Error('decode failed'))
    await walkToExport()

    fireEvent.click(await screen.findByText('保存する'))
    expect(screen.getByText(/音量の自動調整に失敗したため/)).toBeInTheDocument()
    await waitFor(() => expect(shareOrDownload).toHaveBeenCalledWith(BURNED, 'テスト動画-final'))
  })

  it('shows no BGM row when the video has no BGM', async () => {
    await walkToExport()

    expect(await screen.findByText('保存する')).toBeInTheDocument()
    expect(screen.queryByText('BGMを外す')).not.toBeInTheDocument()
  })

  it('skips it when 音量の自動調整 is turned off in settings', async () => {
    localStorage.setItem('teleprompter_settings', JSON.stringify({ defaultBgmId: null, normalizeAudio: false }))
    await walkToExport()

    fireEvent.click(await screen.findByText('保存する'))
    expect(normalizeLoudness).not.toHaveBeenCalled()
    await waitFor(() => expect(shareOrDownload).toHaveBeenCalledWith(BURNED, 'テスト動画-final'))
  })

  it('copies the caption from the export step', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    localStorage.setItem('teleprompter_scripts', JSON.stringify([{ ...seedScript(), caption: '#朝活 おはよう' }]))
    await walkToExport()

    fireEvent.click(await screen.findByText('キャプションをコピー'))
    expect(writeText).toHaveBeenCalledWith('#朝活 おはよう')
    expect(await screen.findByText('コピーしました')).toBeInTheDocument()
  })

  it('shows コピーしました for 2 seconds after the latest copy, even when tapped twice', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true })
    localStorage.setItem('teleprompter_scripts', JSON.stringify([{ ...seedScript(), caption: '#朝活' }]))
    await walkToExport()
    const button = await screen.findByText('キャプションをコピー')

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await act(async () => {
        fireEvent.click(button)
      })
      await act(async () => {
        vi.advanceTimersByTime(1500)
      })
      await act(async () => {
        fireEvent.click(screen.getByText('コピーしました'))
      })
      // 2.5s after the first tap, but only 1s after the second.
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      expect(screen.getByText('コピーしました')).toBeInTheDocument()

      await act(async () => {
        vi.advanceTimersByTime(1100)
      })
      expect(screen.getByText('キャプションをコピー')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says so when the caption cannot be copied', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => { throw new Error('denied') }) },
      configurable: true,
    })
    localStorage.setItem('teleprompter_scripts', JSON.stringify([{ ...seedScript(), caption: '#朝活' }]))
    await walkToExport()

    fireEvent.click(await screen.findByText('キャプションをコピー'))
    expect(await screen.findByText('コピーできませんでした')).toBeInTheDocument()
  })

  it('offers no caption copy when the script has no caption', async () => {
    await walkToExport()
    expect(await screen.findByText('保存する')).toBeInTheDocument()
    expect(screen.queryByText('キャプションをコピー')).not.toBeInTheDocument()
  })
})

describe('FinalizePage with a usual BGM', () => {
  const BURNED = new Blob(['burned'], { type: 'video/mp4' })

  function useSettingsOf(settings: object) {
    localStorage.setItem('teleprompter_settings', JSON.stringify(settings))
  }

  // Trim/combine → subtitle (translated) → 次へ.
  async function walkThroughSubtitles() {
    renderFinalizePage('script-1')
    await screen.findByText('ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    fireEvent.click(screen.getByText('次へ'))
    await screen.findByDisplayValue('ショット1')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))
  }

  beforeEach(() => {
    vi.mocked(burnModule.burnSubtitles).mockResolvedValue(BURNED)
  })

  it('adds the usual BGM after the burn and goes straight to export', async () => {
    useSettingsOf({ defaultBgmId: 'lofi-tokyo', bgmVolume: 0.45 })
    await walkThroughSubtitles()

    expect(await screen.findByText('保存する')).toBeInTheDocument()
    expect(mixModule.mixMusic).toHaveBeenCalledTimes(1)
    const [video, , volume] = vi.mocked(mixModule.mixMusic).mock.calls[0]
    expect(video).toBe(BURNED)
    expect(volume).toBe(0.45)
    expect(screen.getByText('BGM').closest('button')).not.toBeDisabled()
  })

  it('lets BGMを外す drop the BGM on the export step and save the video without it', async () => {
    const mixed = new Blob(['mixed-usual'], { type: 'video/mp4' })
    vi.mocked(mixModule.mixMusic).mockResolvedValue(mixed)
    vi.mocked(normalizeLoudness).mockImplementation(async blob => blob)
    useSettingsOf({ defaultBgmId: 'lofi-tokyo' })
    await walkThroughSubtitles()
    await screen.findByText('保存する')

    expect(screen.getByText('BGM: Tokyo Lofi')).toBeInTheDocument()
    fireEvent.click(screen.getByText('BGMを外す'))

    await waitFor(() => expect(normalizeLoudness).toHaveBeenLastCalledWith(BURNED))
    expect(screen.queryByText('BGM: Tokyo Lofi')).not.toBeInTheDocument()
    expect(screen.queryByText('BGMを外す')).not.toBeInTheDocument()
    expect(screen.getByText('BGM').closest('button')).not.toBeDisabled()
    fireEvent.click(await screen.findByText('保存する'))
    await waitFor(() => expect(shareOrDownload).toHaveBeenCalledWith(BURNED, 'テスト動画-final'))
  })

  it('opens the BGM step on the usual BGM when going back to it, without mixing again', async () => {
    useSettingsOf({ defaultBgmId: 'lofi-tokyo' })
    await walkThroughSubtitles()
    await screen.findByText('保存する')

    fireEvent.click(screen.getByText('BGM').closest('button')!)
    expect(await screen.findByText('BGMなしで進む')).toBeInTheDocument()
    expect(screen.getByText('Tokyo Lofi').closest('div')?.className).toMatch(/trackRowSelected/)
    expect(mixModule.mixMusic).toHaveBeenCalledTimes(1)
  })

  it('stops on the BGM step as before when the usual BGM is なし', async () => {
    useSettingsOf({ defaultBgmId: null })
    await walkThroughSubtitles()
    expect(await screen.findByText('BGMなしで進む')).toBeInTheDocument()
    expect(mixModule.mixMusic).not.toHaveBeenCalled()
  })

  it('opens the subtitle step at the usual position, and burns with it', async () => {
    useSettingsOf({ defaultBgmId: null, subtitlePosition: 64 })
    await walkThroughSubtitles()
    await waitFor(() => expect(burnModule.burnSubtitles).toHaveBeenCalled())
    expect(vi.mocked(burnModule.burnSubtitles).mock.calls[0][2]).toMatchObject({ position: 64 })
  })

  it('joins the burned video with audio prepared during the subtitle step', async () => {
    useSettingsOf({ defaultBgmId: 'lofi-tokyo', bgmVolume: 0.3, normalizeAudio: true })
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    vi.mocked(burnModule.burnShotSubtitles).mockResolvedValue(new Blob(['burned-shot'], { type: 'video/mp4' }))
    const prepared = new Blob(['prepared'], { type: 'audio/mp4' })
    const joined = new Blob(['joined'], { type: 'video/mp4' })
    vi.mocked(prepareFinalAudio).mockResolvedValue(prepared)
    vi.mocked(joinVideoAndAudio).mockResolvedValue(joined)
    vi.mocked(normalizeLoudness).mockImplementation(async blob => blob)

    await walkThroughSubtitles()
    expect(await screen.findByText('保存する')).toBeInTheDocument()

    const combined = await vi.mocked(concatVideos).mock.results[0].value
    const burned = await vi.mocked(concatClipsWebCodecs).mock.results[0].value
    expect(prepareFinalAudio).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prepareFinalAudio).mock.calls[0][0]).toBe(combined)
    expect(vi.mocked(prepareFinalAudio).mock.calls[0].slice(2)).toEqual([0.3, true])
    expect(joinVideoAndAudio).toHaveBeenCalledWith(burned, prepared)
    expect(markLoudnessNormalized).toHaveBeenCalledWith(joined)
    expect(mixModule.mixMusic).not.toHaveBeenCalled()
  })

  it('lets 別のBGMを選ぶ escape a prepared-audio job that never settles', async () => {
    useSettingsOf({ defaultBgmId: 'lofi-tokyo', bgmVolume: 0.3, normalizeAudio: true })
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    vi.mocked(burnModule.burnShotSubtitles).mockResolvedValue(new Blob(['burned-shot'], { type: 'video/mp4' }))
    vi.mocked(prepareFinalAudio).mockReturnValueOnce(new Promise<Blob>(() => {}))
    vi.mocked(normalizeLoudness).mockImplementation(async blob => blob)

    await walkThroughSubtitles()
    expect(await screen.findByText(/いつものBGM（Tokyo Lofi）を合成中/)).toBeInTheDocument()
    expect(mixModule.mixMusic).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('別のBGMを選ぶ'))
    fireEvent.click(await screen.findByText('次へ'))

    expect(await screen.findByText('保存する')).toBeInTheDocument()
    expect(mixModule.mixMusic).toHaveBeenCalledTimes(1)
    expect(joinVideoAndAudio).not.toHaveBeenCalled()
  })
})

describe('FinalizePage subtitle step: hook on the first shot', () => {
  it('burns the first shot in hook style, and remembers switching it off', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    vi.mocked(burnModule.burnShotSubtitles).mockResolvedValue(new Blob(['burned-shot'], { type: 'video/mp4' }))
    renderFinalizePage('script-1')

    await screen.findByText('ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    fireEvent.click(await screen.findByText('次へ'))
    await screen.findByDisplayValue('ショット1')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))

    await waitFor(() => expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(1), { timeout: 2000 })
    const [, , , cues, look] = vi.mocked(burnModule.burnShotSubtitles).mock.calls[0]
    expect(cues).toEqual([expect.objectContaining({ variant: 'hook', start: 0 })])
    expect(look).toMatchObject({ hook: { style: true, position: 22.5 }, firstShotDuration: 5 })

    fireEvent.click(screen.getByLabelText('フック字幕'))
    await waitFor(() => expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(2), { timeout: 2000 })
    expect(vi.mocked(burnModule.burnShotSubtitles).mock.calls[1][3]).toEqual([
      expect.objectContaining({ variant: 'normal' }),
    ])
    expect(JSON.parse(localStorage.getItem('teleprompter_settings')!).hookStyleEnabled).toBe(false)
  })

  it('burns the punch-in into the first shot', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    vi.mocked(burnModule.burnShotSubtitles).mockResolvedValue(new Blob(['burned-shot'], { type: 'video/mp4' }))
    renderFinalizePage('script-1')

    await screen.findByText('ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    fireEvent.click(await screen.findByText('次へ'))
    await screen.findByDisplayValue('ショット1')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))

    await waitFor(() => {
      const looks = vi.mocked(burnModule.burnShotSubtitles).mock.calls.map(c => c[4])
      expect(looks[looks.length - 1]).toMatchObject({ hook: { punchIn: { zoom: 1.25, at: 0.4, impact: 'medium' } }, firstShotDuration: 5 })
    }, { timeout: 3000 })
  })
})
