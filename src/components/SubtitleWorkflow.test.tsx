import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import SubtitleWorkflow, { INITIAL_SUBTITLE_STATE, SubtitleState } from './SubtitleWorkflow'
import { ShotCueInput, SubtitleCue } from '../utils/subtitleCues'
import { WhisperProgress } from '../utils/transcribeSpeech'
import * as burnModule from '../utils/burnSubtitles'
import { hookOptionsOf, type HookSettings } from '../utils/subtitleHook'
import { deleteSubtitles, fetchSubtitles, subtitleRequestId } from '../utils/subtitleRequest'

vi.mock('../utils/burnSubtitles')
vi.mock('../utils/subtitleRequest', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/subtitleRequest')>()),
  fetchSubtitles: vi.fn(async () => null),
  deleteSubtitles: vi.fn(async () => {}),
}))

const BLOB = new Blob(['x'], { type: 'video/mp4' })
const SHOT_CUE_INPUTS: ShotCueInput[] = [{ text: 'Hello', duration: 2 }]

function seedBurnMock() {
  vi.mocked(burnModule.burnSubtitles).mockResolvedValue(new Blob(['out'], { type: 'video/mp4' }))
}

const DEFAULT_HOOK_SETTINGS: HookSettings = {
  hookStyleEnabled: true,
  hookPosition: 50,
  punchInEnabled: true,
  punchInZoom: 1.25,
  punchInAt: 0.4,
  impactEnabled: true,
  impactStrength: 'medium',
}

// SubtitleWorkflow is a controlled component (state/onStateChange lifted up
// to FinalizePage, so subtitle work survives the component unmounting on
// wizard back-navigation; hook settings live in useSettings there). This
// wrapper mirrors how FinalizePage drives it.
function ControlledSubtitleWorkflow({
  combinedBlob,
  shotCueInputs,
  onBurned,
  transcribe,
  onHookSettingsChange,
  inboxKey,
}: {
  combinedBlob: Blob
  shotCueInputs: ShotCueInput[]
  onBurned: (blob: Blob) => void
  transcribe?: (blob: Blob, onProgress: (p: WhisperProgress) => void, signal: AbortSignal) => Promise<SubtitleCue[]>
  onHookSettingsChange?: (patch: Partial<HookSettings>) => void
  inboxKey?: string
}) {
  const [state, setState] = useState<SubtitleState>(INITIAL_SUBTITLE_STATE)
  const [hookSettings, setHookSettings] = useState<HookSettings>(DEFAULT_HOOK_SETTINGS)
  return (
    <SubtitleWorkflow
      combinedBlob={combinedBlob}
      shotCueInputs={shotCueInputs}
      state={state}
      onStateChange={setState}
      hookSettings={hookSettings}
      onHookSettingsChange={patch => {
        setHookSettings(prev => ({ ...prev, ...patch }))
        onHookSettingsChange?.(patch)
      }}
      burn={(cues, position) =>
        burnModule.burnSubtitles(combinedBlob, cues, {
          position,
          hook: hookOptionsOf(hookSettings),
          firstShotDuration: shotCueInputs[0]?.duration ?? null,
        })
      }
      onBurned={onBurned}
      transcribe={transcribe}
      inboxKey={inboxKey}
    />
  )
}

/** The normal subtitle's 上部/中央/下部, as opposed to the hook's. */
const positionGroup = () => within(screen.getByRole('group', { name: '字幕の位置' }))

describe('SubtitleWorkflow position controls', () => {
  it('defaults to the bottom preset and burns in with it when advancing', async () => {
    seedBurnMock()
    const onBurned = vi.fn()
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={SHOT_CUE_INPUTS} onBurned={onBurned} />)

    await screen.findByDisplayValue('Hello')

    // Apply a Japanese translation via the paste box so the position/burn UI appears
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))

    expect(positionGroup().getByText('下部')).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => expect(onBurned).toHaveBeenCalled())
    expect(burnModule.burnSubtitles).toHaveBeenCalledWith(
      BLOB,
      expect.anything(),
      expect.objectContaining({ position: 72.2917 }),
    )
  })

  it('reveals a percent slider when the fine-tune toggle is switched on, and burns in with its value', async () => {
    seedBurnMock()
    const onBurned = vi.fn()
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={SHOT_CUE_INPUTS} onBurned={onBurned} />)

    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))

    fireEvent.click(screen.getByText('細かく調整'))
    const slider = screen.getByLabelText('字幕の上下位置')
    fireEvent.change(slider, { target: { value: '30' } })

    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => expect(onBurned).toHaveBeenCalled())
    expect(burnModule.burnSubtitles).toHaveBeenCalledWith(BLOB, expect.anything(), expect.objectContaining({ position: 30 }))
  })

  it('does not render a save button', async () => {
    seedBurnMock()
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={SHOT_CUE_INPUTS} onBurned={vi.fn()} />)
    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => expect(screen.queryByText('保存する')).not.toBeInTheDocument())
  })

  it('shows an inline error and lets the user retry burn-in after a failure, without losing cues', async () => {
    seedBurnMock()
    vi.mocked(burnModule.burnSubtitles).mockRejectedValueOnce(new Error('boom'))
    const onBurned = vi.fn()
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={SHOT_CUE_INPUTS} onBurned={onBurned} />)

    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))

    fireEvent.click(screen.getByText('次へ'))
    await screen.findByText(/エラーが発生しました/)

    // The review/position UI must still be rendered (not replaced by an
    // error-only screen), with the cues and position controls intact.
    expect(screen.getByDisplayValue('Hello')).toBeInTheDocument()
    expect(positionGroup().getByText('下部')).toBeInTheDocument()
    const nextBtn = screen.getByText('次へ')
    expect(nextBtn).not.toBeDisabled()

    // Retrying should succeed now that the mock no longer rejects.
    fireEvent.click(nextBtn)
    await waitFor(() => expect(onBurned).toHaveBeenCalled())
  })

  it('shows the burn-in progress on the button while it runs', async () => {
    let report!: (ratio: number) => void
    let finish!: (blob: Blob) => void
    function ProgressWorkflow() {
      const [state, setState] = useState<SubtitleState>(INITIAL_SUBTITLE_STATE)
      return (
        <SubtitleWorkflow
          combinedBlob={BLOB}
          shotCueInputs={SHOT_CUE_INPUTS}
          state={state}
          onStateChange={setState}
          hookSettings={DEFAULT_HOOK_SETTINGS}
          onHookSettingsChange={() => {}}
          burn={(_cues, _position, onProgress) => {
            report = onProgress
            return new Promise(resolve => (finish = resolve))
          }}
        />
      )
    }
    render(<ProgressWorkflow />)

    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))

    expect(await screen.findByText('焼き込み中... 0%')).toBeDisabled()
    act(() => report(0.42))
    expect(screen.getByText('焼き込み中... 42%')).toBeInTheDocument()
    await act(async () => finish(BLOB))
  })

  // Issue #33: a preview left playing competes with the burn's hardware
  // decode/encode on iOS, which can make it fail over to the much slower
  // ffmpeg.wasm path.
  it('pauses the preview and hides its controls while burning in', async () => {
    let finish!: (blob: Blob) => void
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    function PauseWorkflow() {
      const [state, setState] = useState<SubtitleState>(INITIAL_SUBTITLE_STATE)
      return (
        <SubtitleWorkflow
          combinedBlob={BLOB}
          shotCueInputs={SHOT_CUE_INPUTS}
          state={state}
          onStateChange={setState}
          hookSettings={DEFAULT_HOOK_SETTINGS}
          onHookSettingsChange={() => {}}
          burn={() => new Promise(resolve => (finish = resolve))}
        />
      )
    }
    const { container } = render(<PauseWorkflow />)

    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    const video = container.querySelector('video')!
    expect(video).toHaveAttribute('controls')
    fireEvent.click(screen.getByText('次へ'))

    expect(pause).toHaveBeenCalled()
    await screen.findByText('焼き込み中... 0%')
    expect(video).not.toHaveAttribute('controls')
    await act(async () => finish(BLOB))
    expect(video).toHaveAttribute('controls')
    pause.mockRestore()
  })

  it('generates a cue per shot from script text, timed by cumulative shot duration', async () => {
    seedBurnMock()
    render(
      <ControlledSubtitleWorkflow
        combinedBlob={BLOB}
        shotCueInputs={[
          { text: 'First shot line', duration: 3 },
          { text: '   ', duration: 1 },
          { text: 'Third shot line', duration: 2 },
        ]}
        onBurned={vi.fn()}
      />
    )

    await screen.findByDisplayValue('First shot line')
    // The blank-text second shot produced no cue, but its duration still
    // shifted the third shot's cue forward (asserted via the editor input
    // for the third cue existing at all — full offset math is covered by
    // cuesFromShotEntries's own unit tests).
    expect(screen.getByDisplayValue('Third shot line')).toBeInTheDocument()
    expect(screen.getAllByDisplayValue(/shot line/)).toHaveLength(2)
  })

  it('lets a stuck burn-in be cancelled, keeping the cues and position (issue #34)', async () => {
    let seen: AbortSignal | undefined
    function StuckWorkflow() {
      const [state, setState] = useState<SubtitleState>(INITIAL_SUBTITLE_STATE)
      return (
        <SubtitleWorkflow
          combinedBlob={BLOB}
          shotCueInputs={SHOT_CUE_INPUTS}
          state={state}
          onStateChange={setState}
          hookSettings={DEFAULT_HOOK_SETTINGS}
          onHookSettingsChange={() => {}}
          burn={(_cues, _position, _onProgress, signal) => {
            seen = signal
            return new Promise(() => {})
          }}
        />
      )
    }
    render(<StuckWorkflow />)

    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(positionGroup().getByText('上部'))
    fireEvent.click(screen.getByText('次へ'))
    await screen.findByText('焼き込み中... 0%')

    fireEvent.click(screen.getByText('中断する'))

    expect(await screen.findByText('中断しました')).toBeInTheDocument()
    expect(screen.queryByText(/エラーが発生しました/)).not.toBeInTheDocument()
    expect(seen?.aborted).toBe(true)
    expect(screen.getByText('次へ')).not.toBeDisabled()
    expect(screen.getByDisplayValue('Hello')).toBeInTheDocument()
    expect(screen.getByDisplayValue('こんにちは')).toBeInTheDocument()
    expect(positionGroup().getByText('上部')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('中断する')).not.toBeInTheDocument()
  })

  it('shows an error and stays on the generate button when every shot has blank text', () => {
    render(
      <ControlledSubtitleWorkflow
        combinedBlob={BLOB}
        shotCueInputs={[
          { text: '', duration: 3 },
          { text: '   ', duration: 2 },
        ]}
        onBurned={vi.fn()}
      />
    )

    expect(screen.getByText(/字幕にできるテキストがありません/)).toBeInTheDocument()
    expect(screen.queryByText('📝 英語字幕を生成')).not.toBeInTheDocument()
  })

  it('generates the English subtitles on arrival, without a button', async () => {
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={SHOT_CUE_INPUTS} onBurned={vi.fn()} />)
    expect(await screen.findByDisplayValue('Hello')).toBeInTheDocument()
    expect(screen.queryByText('📝 英語字幕を生成')).not.toBeInTheDocument()
  })
})

describe('SubtitleWorkflow subtitles from speech', () => {
  const SPOKEN: SubtitleCue[] = [
    { id: 'speech-0', start: 0, end: 1.5, en: 'Thanks for the comment.', ja: null },
    { id: 'speech-1', start: 1.5, end: 3, en: 'I mean, it was not planned.', ja: null },
  ]

  it('starts from the script, and replaces it with what was said when asked', async () => {
    const transcribe = vi.fn().mockResolvedValue(SPOKEN)
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={SHOT_CUE_INPUTS} onBurned={vi.fn()} transcribe={transcribe} />)
    expect(await screen.findByDisplayValue('Hello')).toBeInTheDocument()
    expect(screen.getByText('台本から')).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByText('話した音声から'))

    expect(await screen.findByDisplayValue('I mean, it was not planned.')).toBeInTheDocument()
    expect(transcribe).toHaveBeenCalledWith(BLOB, expect.any(Function), expect.any(AbortSignal))
    expect(screen.queryByDisplayValue('Hello')).not.toBeInTheDocument()
    expect(screen.getByText('話した音声から')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/聞き取り違いがあれば直してください/)).toBeInTheDocument()
  })

  it('works when the script has no text at all', async () => {
    const transcribe = vi.fn().mockResolvedValue(SPOKEN)
    render(
      <ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={[{ text: '', duration: 3 }]} onBurned={vi.fn()} transcribe={transcribe} />
    )
    expect(screen.getByText(/字幕にできるテキストがありません/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('話した音声から'))

    expect(await screen.findByDisplayValue('Thanks for the comment.')).toBeInTheDocument()
    expect(screen.queryByText(/字幕にできるテキストがありません/)).not.toBeInTheDocument()
  })

  it('shows the model download, then recognition, while it runs', async () => {
    let report: (p: WhisperProgress) => void = () => undefined
    let finish: (cues: SubtitleCue[]) => void = () => undefined
    const transcribe = vi.fn((_blob: Blob, onProgress: (p: WhisperProgress) => void) => {
      report = onProgress
      return new Promise<SubtitleCue[]>(resolve => { finish = resolve })
    })
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={SHOT_CUE_INPUTS} onBurned={vi.fn()} transcribe={transcribe} />)
    fireEvent.click(await screen.findByText('話した音声から'))

    act(() => report({ phase: 'download', ratio: 0.42 }))
    expect(screen.getByText('音声認識モデルをダウンロード中... 42%')).toBeInTheDocument()
    expect(screen.queryByText('台本から')).not.toBeInTheDocument()

    act(() => report({ phase: 'recognize', tokens: 3 }))
    expect(screen.getByText('話した音声から字幕を作成中...')).toBeInTheDocument()

    await act(async () => finish(SPOKEN))
    expect(screen.getByDisplayValue('Thanks for the comment.')).toBeInTheDocument()
  })

  it('can be cancelled, keeping the script cues it started from', async () => {
    const transcribe = vi.fn(() => new Promise<SubtitleCue[]>(() => undefined))
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={SHOT_CUE_INPUTS} onBurned={vi.fn()} transcribe={transcribe} />)
    fireEvent.click(await screen.findByText('話した音声から'))

    fireEvent.click(screen.getByText('中断する'))

    expect(await screen.findByText('中断しました')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Hello')).toBeInTheDocument()
    expect(screen.getByText('台本から')).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows a failure and keeps the script cues', async () => {
    const transcribe = vi.fn().mockRejectedValue(new Error('model failed to load'))
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={SHOT_CUE_INPUTS} onBurned={vi.fn()} transcribe={transcribe} />)
    fireEvent.click(await screen.findByText('話した音声から'))

    expect(await screen.findByText(/model failed to load/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('Hello')).toBeInTheDocument()
  })

  it('puts the script\'s *emphasis* back on what was said', async () => {
    const transcribe = vi.fn().mockResolvedValue([
      { id: 'speech-0', start: 0, end: 2, en: 'I really, really mean it.', ja: null },
    ])
    render(
      <ControlledSubtitleWorkflow
        combinedBlob={BLOB}
        shotCueInputs={[{ text: 'I *really* mean it', duration: 2 }]}
        onBurned={vi.fn()}
        transcribe={transcribe}
      />,
    )
    await screen.findByDisplayValue('I *really* mean it')
    fireEvent.click(screen.getByText('話した音声から'))
    expect(await screen.findByDisplayValue('I *really*, really mean it.')).toBeInTheDocument()
  })

  it('asks before throwing away a translation, and keeps it if declined', async () => {
    const transcribe = vi.fn().mockResolvedValue(SPOKEN)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={SHOT_CUE_INPUTS} onBurned={vi.fn()} transcribe={transcribe} />)
    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), { target: { value: '1. こんにちは' } })
    fireEvent.click(screen.getByText('日本語を反映'))
    expect(screen.getByDisplayValue('こんにちは')).toBeInTheDocument()

    fireEvent.click(screen.getByText('話した音声から'))

    expect(confirm).toHaveBeenCalled()
    expect(transcribe).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('こんにちは')).toBeInTheDocument()
    confirm.mockRestore()
  })
})

describe('SubtitleWorkflow hook controls', () => {
  async function renderTranslated(onHookSettingsChange = vi.fn()) {
    seedBurnMock()
    render(
      <ControlledSubtitleWorkflow
        combinedBlob={BLOB}
        shotCueInputs={SHOT_CUE_INPUTS}
        onBurned={vi.fn()}
        onHookSettingsChange={onHookSettingsChange}
      />,
    )
    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    return onHookSettingsChange
  }

  const hookGroup = () => within(screen.getByRole('group', { name: 'フック字幕の位置' }))

  it('previews the first shot in hook style at the hook position', async () => {
    await renderTranslated()
    const box = screen.getByTestId('subtitle-overlay-box')
    expect(box).toHaveAttribute('data-variant', 'hook')
    expect(box.style.top).toBe('50%')
    expect(hookGroup().getByText('中央')).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches the hook style off, reporting it to be saved', async () => {
    const onChange = await renderTranslated()
    fireEvent.click(screen.getByLabelText('フック字幕'))
    expect(onChange).toHaveBeenCalledWith({ hookStyleEnabled: false })
    expect(screen.getByTestId('subtitle-overlay-box')).toHaveAttribute('data-variant', 'normal')
    for (const button of hookGroup().getAllByRole('button')) expect(button).toBeDisabled()
  })

  it('moves the hook subtitle with its own presets and slider', async () => {
    const onChange = await renderTranslated()
    fireEvent.click(hookGroup().getByText('上部'))
    expect(onChange).toHaveBeenCalledWith({ hookPosition: 22.5 })
    expect(screen.getByTestId('subtitle-overlay-box').style.top).toBe('22.5%')

    fireEvent.click(screen.getByText('細かく調整'))
    fireEvent.change(screen.getByLabelText('フック字幕の上下位置'), { target: { value: '40' } })
    expect(onChange).toHaveBeenLastCalledWith({ hookPosition: 40 })
  })

  it('burns with the hook settings and the first shot\'s length', async () => {
    await renderTranslated()
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => expect(burnModule.burnSubtitles).toHaveBeenCalled())
    expect(burnModule.burnSubtitles).toHaveBeenLastCalledWith(
      BLOB,
      expect.anything(),
      expect.objectContaining({ hook: { style: true, position: 50, punchIn: { zoom: 1.25, at: 0.4, impact: 'medium' } }, firstShotDuration: 2 }),
    )
  })

  it('explains *emphasis* under the English subtitles', async () => {
    await renderTranslated()
    expect(screen.getByText(/で囲んだ語は黄色/)).toBeInTheDocument()
  })
})

describe('SubtitleWorkflow punch-in', () => {
  async function renderTranslated(onHookSettingsChange = vi.fn()) {
    seedBurnMock()
    render(
      <ControlledSubtitleWorkflow
        combinedBlob={BLOB}
        shotCueInputs={SHOT_CUE_INPUTS}
        onBurned={vi.fn()}
        onHookSettingsChange={onHookSettingsChange}
      />,
    )
    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    return onHookSettingsChange
  }

  function setTime(video: HTMLVideoElement, t: number) {
    Object.defineProperty(video, 'currentTime', { value: t, configurable: true })
  }

  it('zooms the preview video in about (50%, 40%) during the first shot while playing, unless the zoom is off', async () => {
    const onChange = await renderTranslated()
    const video = document.querySelector('video') as HTMLVideoElement
    setTime(video, 1.2)
    fireEvent.play(video)
    fireEvent.timeUpdate(video)
    expect(video.style.transform).toBe('scale(1.125)')
    expect(video.style.transformOrigin).toBe('50% 40%')

    fireEvent.click(screen.getByLabelText('ズームイン'))
    expect(onChange).toHaveBeenCalledWith({ punchInEnabled: false })
    expect(video.style.transform).toBe('')
  })

  it('shows the preview at 1x when paused, even inside the zoom, so the controls stay reachable', async () => {
    await renderTranslated()
    const video = document.querySelector('video') as HTMLVideoElement
    setTime(video, 1.2)
    fireEvent.timeUpdate(video)
    expect(video.style.transform).toBe('')

    fireEvent.play(video)
    expect(video.style.transform).toBe('scale(1.125)')
    fireEvent.pause(video)
    expect(video.style.transform).toBe('')

    fireEvent.play(video)
    fireEvent.ended(video)
    expect(video.style.transform).toBe('')
  })

  describe('frame following', () => {
    let frames: FrameRequestCallback[] = []
    beforeEach(() => {
      frames = []
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
      vi.stubGlobal('cancelAnimationFrame', vi.fn())
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('follows frames within the first shot, but ignores them once it is over', async () => {
      await renderTranslated()
      const video = document.querySelector('video') as HTMLVideoElement
      setTime(video, 0.1)
      fireEvent.play(video)
      expect(video.style.transform).toBe('')

      setTime(video, 1.2)
      act(() => frames.shift()!(0))
      expect(video.style.transform).toBe('scale(1.125)')

      // Past the first shot (2s) plus the short tail: the frame is ignored,
      // so the last update (inside the zoom) still stands.
      setTime(video, 5)
      act(() => frames.shift()!(0))
      expect(video.style.transform).toBe('scale(1.125)')
      // The slower timeupdate still moves the preview on.
      fireEvent.timeUpdate(video)
      expect(video.style.transform).toBe('')
    })
  })

  it('sets the zoom and when it starts, reporting them to be saved', async () => {
    const onChange = await renderTranslated()
    const zoomGroup = within(screen.getByRole('group', { name: 'ズーム倍率' }))
    expect(zoomGroup.getByText('1.25倍')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(zoomGroup.getByText('1.35倍'))
    expect(onChange).toHaveBeenCalledWith({ punchInZoom: 1.35 })

    fireEvent.change(screen.getByLabelText('寄るタイミング'), { target: { value: '0.8' } })
    expect(onChange).toHaveBeenLastCalledWith({ punchInAt: 0.8 })
  })

  it('sets the impact effect, which needs the zoom on', async () => {
    const onChange = await renderTranslated()
    const strength = () => within(screen.getByRole('group', { name: 'インパクトの強さ' }))
    expect(strength().getByText('中')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(strength().getByText('強'))
    expect(onChange).toHaveBeenCalledWith({ impactStrength: 'strong' })

    fireEvent.click(screen.getByLabelText('インパクト効果'))
    expect(onChange).toHaveBeenCalledWith({ impactEnabled: false })
    for (const button of strength().getAllByRole('button')) expect(button).toBeDisabled()

    fireEvent.click(screen.getByLabelText('ズームイン'))
    expect(screen.getByLabelText('インパクト効果')).toBeDisabled()
    expect(screen.queryByRole('group', { name: 'ズーム倍率' })).not.toBeInTheDocument()
  })
})

describe('SubtitleWorkflow Japanese sent back by Claude', () => {
  const INPUTS: ShotCueInput[] = [{ text: 'Hello', duration: 2 }, { text: 'World', duration: 2 }]
  const REQUEST_ID = subtitleRequestId([
    { id: 'a', start: 0, end: 2, en: 'Hello', ja: null },
    { id: 'b', start: 2, end: 4, en: 'World', ja: null },
  ])

  beforeEach(() => {
    vi.mocked(fetchSubtitles).mockReset().mockResolvedValue(null)
    vi.mocked(deleteSubtitles).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderWith(inboxKey?: string) {
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={INPUTS} onBurned={vi.fn()} inboxKey={inboxKey} />)
  }

  it('applies the lines Claude already sent for these subtitles, then clears them', async () => {
    vi.mocked(fetchSubtitles).mockResolvedValue(['こんにちは', '世界'])
    renderWith('secret')

    expect(await screen.findByDisplayValue('こんにちは')).toBeInTheDocument()
    expect(screen.getByDisplayValue('世界')).toBeInTheDocument()
    expect(screen.getByText('Claudeの日本語訳を反映しました')).toBeInTheDocument()
    expect(fetchSubtitles).toHaveBeenCalledWith('secret', REQUEST_ID)
    await waitFor(() => expect(deleteSubtitles).toHaveBeenCalledWith('secret', REQUEST_ID))
  })

  it('checks again when the app comes back from Claude', async () => {
    renderWith('secret')
    await screen.findByDisplayValue('Hello')
    expect(screen.queryByDisplayValue('こんにちは')).not.toBeInTheDocument()

    vi.mocked(fetchSubtitles).mockResolvedValue(['こんにちは', '世界'])
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(await screen.findByDisplayValue('こんにちは')).toBeInTheDocument()
  })

  it('puts the request id in the copied prompt, and says the lines will come back', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderWith('secret')
    await screen.findByDisplayValue('Hello')

    expect(screen.getByText('Claudeチャットに貼ると、訳がこの画面に自動で入ります')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByText('📋 Claude用プロンプトをコピー'))
    })
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`request_id: ${REQUEST_ID}`))
  })

  it('keeps today\'s prompt and never asks the server without a key', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderWith()
    await screen.findByDisplayValue('Hello')

    await act(async () => {
      fireEvent.click(screen.getByText('📋 Claude用プロンプトをコピー'))
    })
    expect(writeText).toHaveBeenCalledWith(expect.not.stringContaining('send_subtitles'))
    expect(screen.queryByText('Claudeチャットに貼ると、訳がこの画面に自動で入ります')).not.toBeInTheDocument()
    expect(fetchSubtitles).not.toHaveBeenCalled()
  })

  it('stops looking once the Japanese is in', async () => {
    renderWith('secret')
    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは\n2. 世界' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    vi.mocked(fetchSubtitles).mockClear()

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(fetchSubtitles).not.toHaveBeenCalled()
  })

  it('waits for the English to settle before asking about edited lines', async () => {
    renderWith('secret')
    const english = await screen.findByDisplayValue('Hello')
    await waitFor(() => expect(fetchSubtitles).toHaveBeenCalledTimes(1))

    fireEvent.change(english, { target: { value: 'Hell' } })
    fireEvent.change(english, { target: { value: 'Hel' } })
    fireEvent.change(english, { target: { value: 'Help' } })
    expect(fetchSubtitles).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(fetchSubtitles).toHaveBeenCalledTimes(2))
    const edited = subtitleRequestId([
      { id: 'a', start: 0, end: 2, en: 'Help', ja: null },
      { id: 'b', start: 2, end: 4, en: 'World', ja: null },
    ])
    expect(fetchSubtitles).toHaveBeenLastCalledWith('secret', edited)
  })

  it('shows the paste error instead of applying lines that do not line up', async () => {
    vi.mocked(fetchSubtitles).mockResolvedValue(['こんにちは'])
    renderWith('secret')

    expect(await screen.findByText(/行数が一致しません/)).toBeInTheDocument()
    expect(screen.queryByDisplayValue('こんにちは')).not.toBeInTheDocument()
    expect(deleteSubtitles).not.toHaveBeenCalled()
  })
})
