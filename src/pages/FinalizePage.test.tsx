import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { IDBFactory } from 'fake-indexeddb'
import FinalizePage from './FinalizePage'
import { Script } from '../types'
import { saveShotVideo } from '../utils/shotVideoStore'
import * as burnModule from '../utils/burnSubtitles'
import * as mixModule from '../utils/mixMusic'
import { MUSIC_TRACKS } from '../data/musicTracks'

vi.mock('../utils/burnSubtitles')
vi.mock('../utils/mixMusic')
vi.mock('../utils/concatVideos', () => ({
  concatVideos: vi.fn(async (blobs: Blob[]) => new Blob(blobs, { type: 'video/mp4' })),
}))
vi.mock('../utils/trimAndNormalizeShot', () => ({
  trimAndNormalizeShot: vi.fn(async (blob: Blob) => blob),
}))
vi.mock('../utils/shareOrDownload', () => ({
  shareOrDownload: vi.fn(async () => true),
}))

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
  vi.clearAllMocks()
  const script = seedScript()
  await saveShotVideo(script.id, SHOT_1, new Blob(['shot'], { type: 'video/mp4' }))

  vi.mocked(burnModule.burnSubtitles).mockResolvedValue(new Blob(['burned'], { type: 'video/mp4' }))
  vi.mocked(mixModule.mixMusic).mockResolvedValue(new Blob(['mixed'], { type: 'video/mp4' }))
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    blob: () => Promise.resolve(new Blob(['track'], { type: 'audio/mpeg' })),
  }) as unknown as typeof fetch
})

describe('FinalizePage wizard', () => {
  it('walks trim → combine → subtitle → BGM skip → export, with a single save button at the end', async () => {
    renderFinalizePage('script-1')

    // Step 1: trim/combine
    await screen.findByText('1. ショット1')
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
    fireEvent.click(await screen.findByText('📝 英語字幕を生成'))
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
    await screen.findByText('1. ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    fireEvent.click(screen.getByText('次へ'))

    // Step 2: subtitle — generate, translate, advance
    fireEvent.click(await screen.findByText('📝 英語字幕を生成'))
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
    await screen.findByText('1. ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    fireEvent.click(screen.getByText('次へ'))

    // Step 2: subtitle — generate, translate, advance (produces a burnedBlob)
    fireEvent.click(await screen.findByText('📝 英語字幕を生成'))
    await screen.findByDisplayValue('ショット1')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))

    const burnedBlob = await vi.mocked(burnModule.burnSubtitles).mock.results[0].value

    // Step 3: BGM — select a track, then change the volume to trigger a
    // second (re-)mix. Each call resolves to a distinguishable blob so we
    // can assert on the *arguments* of the second call directly.
    vi.mocked(mixModule.mixMusic)
      .mockResolvedValueOnce(new Blob(['mixed-1'], { type: 'video/mp4' }))
      .mockResolvedValueOnce(new Blob(['mixed-2'], { type: 'video/mp4' }))

    fireEvent.click(await screen.findByText(MUSIC_TRACKS[0].title))
    await waitFor(() => expect(mixModule.mixMusic).toHaveBeenCalledTimes(1), { timeout: 1000 })

    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '0.7' } })
    await waitFor(() => expect(mixModule.mixMusic).toHaveBeenCalledTimes(2), { timeout: 1000 })

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
    await screen.findByText('1. ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    fireEvent.click(screen.getByText('次へ'))

    // Step 2: subtitle — generate, translate, advance
    fireEvent.click(await screen.findByText('📝 英語字幕を生成'))
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
    await screen.findByText('1. ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    fireEvent.click(screen.getByText('次へ'))

    // Step 2: subtitle — generate, translate, then kick off burn-in but don't resolve it yet.
    fireEvent.click(await screen.findByText('📝 英語字幕を生成'))
    await screen.findByDisplayValue('ショット1')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))
    await screen.findByText('焼き込み中...')

    // While pending, the wizard indicator's completed 'trim' step must be
    // disabled, and clicking it must not navigate away.
    const trimStep = screen.getByText('トリミング').closest('button')!
    expect(trimStep).toBeDisabled()
    fireEvent.click(trimStep)
    expect(screen.queryByText('結合する')).not.toBeInTheDocument()
    expect(screen.getByText('焼き込み中...')).toBeInTheDocument()

    // The page's own back button should also be disabled while processing.
    expect(screen.getByText('‹ 戻る')).toBeDisabled()

    // Resolve the burn-in and confirm the flow completes normally, with
    // navigation re-enabled afterwards.
    resolveBurn(new Blob(['burned'], { type: 'video/mp4' }))
    await screen.findByText('BGMなしで進む')
    expect(screen.getByText('トリミング').closest('button')).not.toBeDisabled()
    expect(screen.getByText('‹ 戻る')).not.toBeDisabled()
  })

  it('shows the wizard progress indicator with 4 steps', async () => {
    renderFinalizePage('script-1')
    await screen.findByText('1. ショット1')
    expect(screen.getByText('トリミング')).toBeInTheDocument()
    expect(screen.getByText('字幕')).toBeInTheDocument()
    expect(screen.getByText('BGM')).toBeInTheDocument()
    expect(screen.getByText('書き出し')).toBeInTheDocument()
  })
})
