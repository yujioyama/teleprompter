import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { IDBFactory } from 'fake-indexeddb'
import RecordPage from './RecordPage'
import { Script } from '../types'
import { listShotVideos } from '../utils/shotVideoStore'
import { processRecordedVideo } from '../utils/processRecordedVideo'
import { releaseFFmpeg } from '../utils/ffmpegClient'
import { shareOrDownload } from '../utils/shareOrDownload'
import { detectSpeech, type SpeechRegion } from '../utils/detectSpeechBounds'
import { listShotAnalyses } from '../utils/shotAnalysisStore'
import { makeHeardShot, NotEnoughListeningError } from '../utils/heardShot'

vi.mock('../utils/ffmpegClient', () => ({ getFFmpeg: vi.fn(), releaseFFmpeg: vi.fn() }))
vi.mock('../utils/shareOrDownload', () => ({ shareOrDownload: vi.fn(async () => true) }))
vi.mock('../utils/detectSpeechBounds', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/detectSpeechBounds')>()),
  detectSpeech: vi.fn(async () => null),
}))

vi.mock('../utils/heardShot', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/heardShot')>()),
  makeHeardShot: vi.fn(async () => new Blob(['heard'], { type: 'video/mp4' })),
}))

vi.mock('../utils/processRecordedVideo', async () => {
  const actual = await vi.importActual<typeof import('../utils/processRecordedVideo')>(
    '../utils/processRecordedVideo'
  )
  return {
    ...actual,
    processRecordedVideo: vi.fn(async (raw: Blob) => ({ blob: raw, ok: true, error: null })),
  }
})

const SHOT_1 = '11111111-1111-1111-1111-111111111111'
const SHOT_2 = '22222222-2222-2222-2222-222222222222'
const SHOT_3 = '33333333-3333-3333-3333-333333333333'

function seedScript(): Script {
  const script: Script = {
    id: 'script-1',
    title: 'テスト動画',
    shots: [
      { id: SHOT_1, text: 'ショット1' },
      { id: SHOT_2, text: 'ショット2' },
      { id: SHOT_3, text: 'ショット3' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  localStorage.setItem('teleprompter_scripts', JSON.stringify([script]))
  return script
}

function videoFile(name: string) {
  return new File(['x'], name, { type: 'video/quicktime' })
}

function selectFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  fireEvent.change(input)
}

function renderRecordPage(scriptId: string) {
  render(
    <MemoryRouter initialEntries={[`/scripts/${scriptId}/record`]}>
      <Routes>
        <Route path="/scripts/:id/record" element={<RecordPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  vi.clearAllMocks()
  // jsdom doesn't implement Element.scrollTo; RecordPage calls it on an
  // effect-scroll ref whenever another shot comes up.
  Element.prototype.scrollTo = vi.fn()
})

describe('RecordPage bulk import from teleprompter-cam', () => {
  it('imports every matching file and shows the finish screen once all shots are covered', async () => {
    const script = seedScript()
    renderRecordPage(script.id)

    const input = screen.getByLabelText('録画した動画をインポート') as HTMLInputElement
    selectFiles(input, [
      videoFile(`TeleprompterCam-abc-shot2of3-${SHOT_2}.mov`),
      videoFile(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`),
      videoFile(`TeleprompterCam-abc-shot3of3-${SHOT_3}.mov`),
    ])

    expect(await screen.findByText('撮影完了！')).toBeInTheDocument()
    expect(screen.getByText('🎬 動画を仕上げる')).toBeInTheDocument()
  })

  it('releases the ffmpeg.wasm instance once the bulk import finishes (issue #12)', async () => {
    const script = seedScript()
    renderRecordPage(script.id)

    const input = screen.getByLabelText('録画した動画をインポート') as HTMLInputElement
    selectFiles(input, [
      videoFile(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`),
      videoFile(`TeleprompterCam-abc-shot2of3-${SHOT_2}.mov`),
    ])

    await waitFor(() => {
      expect(screen.getByText('3 / 3 ≡')).toBeInTheDocument()
    })
    expect(releaseFFmpeg).toHaveBeenCalledTimes(1)
  })

  it('imports the matching subset and lands on the next shot missing a video', async () => {
    const script = seedScript()
    renderRecordPage(script.id)

    const input = screen.getByLabelText('録画した動画をインポート') as HTMLInputElement
    selectFiles(input, [videoFile(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`)])

    await waitFor(() => {
      expect(screen.getByText('2 / 3 ≡')).toBeInTheDocument()
    })
  })

  it('shows an error and saves nothing when one of several files does not match any shot', async () => {
    const script = seedScript()
    renderRecordPage(script.id)

    const input = screen.getByLabelText('録画した動画をインポート') as HTMLInputElement
    selectFiles(input, [
      videoFile(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`),
      videoFile('IMG_1234.MOV'),
    ])

    expect(
      await screen.findByText(/一致しないファイルがあります: IMG_1234\.MOV/)
    ).toBeInTheDocument()
    expect(screen.getByText('1 / 3 ≡')).toBeInTheDocument()
    expect(await listShotVideos('script-1')).toHaveLength(0)
  })

  it('hides the import controls while a bulk import is in progress', async () => {
    const script = seedScript()
    let resolveProcessing!: (value: { blob: Blob; ok: boolean; error: string | null }) => void
    vi.mocked(processRecordedVideo).mockImplementation(
      () => new Promise(resolve => { resolveProcessing = resolve })
    )
    renderRecordPage(script.id)

    const input = screen.getByLabelText('録画した動画をインポート') as HTMLInputElement
    selectFiles(input, [videoFile(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`)])

    await waitFor(() => {
      expect(screen.getByText('インポート中 (0/1)...')).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('録画した動画をインポート')).not.toBeInTheDocument()

    resolveProcessing({ blob: new Blob(['x']), ok: true, error: null })
    await waitFor(() => {
      expect(screen.getByText('2 / 3 ≡')).toBeInTheDocument()
    })
  })

  it('still saves a shot when remux fails, and shows the warning on the finish screen', async () => {
    const script = seedScript()
    vi.mocked(processRecordedVideo).mockImplementation(async (raw: Blob) => {
      const name = (raw as File).name
      if (name.includes(SHOT_2)) {
        return { blob: raw, ok: false, error: 'remux failed' }
      }
      return { blob: raw, ok: true, error: null }
    })
    renderRecordPage(script.id)

    const input = screen.getByLabelText('録画した動画をインポート') as HTMLInputElement
    selectFiles(input, [
      videoFile(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`),
      videoFile(`TeleprompterCam-abc-shot2of3-${SHOT_2}.mov`),
      videoFile(`TeleprompterCam-abc-shot3of3-${SHOT_3}.mov`),
    ])

    expect(await screen.findByText('撮影完了！')).toBeInTheDocument()
    expect(screen.getByText(/動画の変換に失敗したため/)).toBeInTheDocument()
    expect(await listShotVideos('script-1')).toHaveLength(3)
  })
})

describe('RecordPage single import', () => {
  it('saves a take its name does not match to the shot on screen and brings up the next one', async () => {
    const script = seedScript()
    renderRecordPage(script.id)

    selectFiles(screen.getByLabelText('録画した動画をインポート') as HTMLInputElement, [videoFile('IMG_0001.MOV')])

    expect(await screen.findByText('2 / 3 ≡')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '録画を再生' })).not.toBeInTheDocument()
    expect(shareOrDownload).not.toHaveBeenCalled()
    expect((await listShotVideos(script.id)).map(v => v.shotId)).toEqual([SHOT_1])
    expect(releaseFFmpeg).toHaveBeenCalledTimes(1)
  })

  it('shows the finish screen after the last shot', async () => {
    const script = seedScript()
    renderRecordPage(script.id)
    fireEvent.click(screen.getByRole('button', { name: /≡/ }))
    fireEvent.click(screen.getByText('ショット3'))

    selectFiles(screen.getByLabelText('録画した動画をインポート') as HTMLInputElement, [videoFile('IMG_0003.MOV')])

    expect(await screen.findByText('撮影完了！')).toBeInTheDocument()
  })

  it('stays on the shot when its take cannot be processed', async () => {
    const script = seedScript()
    vi.mocked(processRecordedVideo).mockRejectedValueOnce(new Error('boom'))
    renderRecordPage(script.id)

    selectFiles(screen.getByLabelText('録画した動画をインポート') as HTMLInputElement, [videoFile('IMG_0001.MOV')])

    expect(await screen.findByText(/保存できなかったショットがあります: ショット1/)).toBeInTheDocument()
    expect(screen.getByText('1 / 3 ≡')).toBeInTheDocument()
  })
})

describe('RecordPage teleprompter text', () => {
  it('reads the script without its *emphasis* markers, in the prompt and the shot list', async () => {
    const script = seedScript()
    script.shots[0].text = 'I *carry a torch* for him'
    localStorage.setItem('teleprompter_scripts', JSON.stringify([script]))
    renderRecordPage(script.id)

    expect(await screen.findAllByText('I carry a torch for him')).not.toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /≡/ }))
    expect(screen.getAllByText('I carry a torch for him')).toHaveLength(2)
    expect(screen.queryByText(/\*/)).not.toBeInTheDocument()
  })
})

describe('RecordPage import: finds the speech ahead of the finalize step', () => {
  const SPEECH: SpeechRegion = { speechStart: 1, speechEnd: 3, floor: 0, ceiling: 5, duration: 5 }

  async function importShot1() {
    const input = screen.getByLabelText('録画した動画をインポート') as HTMLInputElement
    selectFiles(input, [videoFile(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`)])
    await waitFor(() => expect(screen.getByText('2 / 3 ≡')).toBeInTheDocument())
  }

  async function storedAnalyses() {
    const takes = new Map((await listShotVideos('script-1')).map(v => [v.shotId, v.updatedAt]))
    return listShotAnalyses('script-1', takes)
  }

  beforeEach(() => {
    vi.mocked(processRecordedVideo).mockImplementation(async (raw: Blob) => ({ blob: raw, ok: true, error: null }))
    vi.mocked(detectSpeech).mockReset().mockResolvedValue(SPEECH)
  })

  it('keeps where the speech is with the imported take', async () => {
    renderRecordPage(seedScript().id)
    await importShot1()

    expect((await storedAnalyses()).get(SHOT_1)).toEqual({ duration: undefined, speech: SPEECH })
  })

  it('remembers a take with no speech too', async () => {
    vi.mocked(detectSpeech).mockResolvedValue(null)
    renderRecordPage(seedScript().id)
    await importShot1()

    expect((await storedAnalyses()).get(SHOT_1)?.speech).toBeNull()
  })

  it('leaves a shot with auto-trim off alone, as the finalize step does', async () => {
    const script = seedScript()
    script.shots[0].trimEnabled = false
    localStorage.setItem('teleprompter_scripts', JSON.stringify([script]))
    renderRecordPage(script.id)
    await importShot1()

    expect(detectSpeech).not.toHaveBeenCalled()
  })

  it('still looks for the speech of a 一発撮り take with auto-trim off', async () => {
    const script = { ...seedScript(), oneTake: true }
    script.shots[0].trimEnabled = false
    localStorage.setItem('teleprompter_scripts', JSON.stringify([script]))
    renderRecordPage(script.id)
    await importShot1()

    expect((await storedAnalyses()).get(SHOT_1)?.speech).toEqual(SPEECH)
  })

  it('still imports the take when its speech cannot be found', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(detectSpeech).mockRejectedValue(new Error('cannot decode'))
    renderRecordPage(seedScript().id)
    await importShot1()

    expect(await listShotVideos('script-1')).toHaveLength(1)
    // Not remembered: the finalize step tries again.
    expect((await storedAnalyses()).has(SHOT_1)).toBe(false)
  })
})

describe('RecordPage 相手のセリフ', () => {
  function seedHeard(over: Partial<Script> = {}) {
    const script = { ...seedScript(), ...over }
    script.shots = script.shots.map(shot => (shot.id === SHOT_1 ? { ...shot, heard: true } : shot))
    localStorage.setItem('teleprompter_scripts', JSON.stringify([script]))
    return script
  }

  async function importShot1() {
    const input = screen.getByLabelText('録画した動画をインポート') as HTMLInputElement
    selectFiles(input, [videoFile(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`)])
    await waitFor(() => expect(screen.getByText('2 / 3 ≡')).toBeInTheDocument())
  }

  const HEARD = new Blob(['heard'], { type: 'video/mp4' })

  /** The take that was saved: the one the import then looks for the speech in. */
  function savedTake() {
    return vi.mocked(detectSpeech).mock.calls[0][0]
  }

  beforeEach(() => {
    vi.mocked(processRecordedVideo).mockImplementation(async (raw: Blob) => ({ blob: raw, ok: true, error: null }))
    vi.mocked(detectSpeech).mockReset().mockResolvedValue(null)
    vi.mocked(makeHeardShot).mockReset().mockResolvedValue(HEARD)
  })

  it('turns the shot on and off in its settings', () => {
    renderRecordPage(seedScript().id)
    fireEvent.click(screen.getByText(/このショットの設定/))
    fireEvent.click(screen.getByLabelText('相手のセリフ'))
    const stored = () => (JSON.parse(localStorage.getItem('teleprompter_scripts')!) as Script[])[0].shots[0]
    expect(stored().heard).toBe(true)
    fireEvent.click(screen.getByLabelText('相手のセリフ'))
    expect(stored().heard).toBeUndefined()
  })

  it('saves the voice over the listening for such a shot, and the take as it is for the others', async () => {
    renderRecordPage(seedHeard().id)
    await importShot1()
    expect(makeHeardShot).toHaveBeenCalledTimes(1)
    expect(savedTake()).toBe(HEARD)
    expect(await listShotVideos('script-1')).toHaveLength(1)

    selectFiles(screen.getByLabelText('録画した動画をインポート') as HTMLInputElement, [
      videoFile(`TeleprompterCam-abc-shot2of3-${SHOT_2}.mov`),
    ])
    await waitFor(() => expect(screen.getByText('3 / 3 ≡')).toBeInTheDocument())
    expect(makeHeardShot).toHaveBeenCalledTimes(1)
  })

  it('keeps the take and says why when the listening is too short', async () => {
    vi.mocked(makeHeardShot).mockRejectedValue(new NotEnoughListeningError(1.2))
    renderRecordPage(seedHeard().id)
    await importShot1()
    expect((savedTake() as File).name).toContain(SHOT_1)
    expect(await listShotVideos('script-1')).toHaveLength(1)
    expect(screen.getAllByText(/相手のセリフにできず、撮ったまま保存しました: ショット1\(セリフのあと、あと約1.2秒長く黙って撮ってください\)/).length).toBeGreaterThan(0)
  })

  it('has no such setting for a 一発撮り script', () => {
    renderRecordPage(seedHeard({ oneTake: true, shots: [{ id: SHOT_1, text: 'ショット1' }] }).id)
    fireEvent.click(screen.getByText(/このショットの設定/))
    expect(screen.queryByLabelText('相手のセリフ')).not.toBeInTheDocument()
  })
})
