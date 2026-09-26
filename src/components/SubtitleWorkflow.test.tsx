import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SubtitleWorkflow, { INITIAL_SUBTITLE_STATE, SubtitleState } from './SubtitleWorkflow'
import { ShotCueInput } from '../utils/subtitleCues'
import * as burnModule from '../utils/burnSubtitles'

vi.mock('../utils/burnSubtitles')

const BLOB = new Blob(['x'], { type: 'video/mp4' })
const SHOT_CUE_INPUTS: ShotCueInput[] = [{ text: 'Hello', duration: 2 }]

function seedBurnMock() {
  vi.mocked(burnModule.burnSubtitles).mockResolvedValue(new Blob(['out'], { type: 'video/mp4' }))
}

// SubtitleWorkflow is a controlled component (state/onStateChange lifted up
// to FinalizePage, so subtitle work survives the component unmounting on
// wizard back-navigation). This wrapper mirrors how FinalizePage drives it.
function ControlledSubtitleWorkflow({
  combinedBlob,
  shotCueInputs,
  onBurned,
}: {
  combinedBlob: Blob
  shotCueInputs: ShotCueInput[]
  onBurned: (blob: Blob) => void
}) {
  const [state, setState] = useState<SubtitleState>(INITIAL_SUBTITLE_STATE)
  return (
    <SubtitleWorkflow
      combinedBlob={combinedBlob}
      shotCueInputs={shotCueInputs}
      state={state}
      onStateChange={setState}
      onBurned={onBurned}
    />
  )
}

describe('SubtitleWorkflow position controls', () => {
  it('defaults to the bottom preset and burns in with it when advancing', async () => {
    seedBurnMock()
    const onBurned = vi.fn()
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={SHOT_CUE_INPUTS} onBurned={onBurned} />)

    fireEvent.click(screen.getByText('📝 英語字幕を生成'))
    await screen.findByDisplayValue('Hello')

    // Apply a Japanese translation via the paste box so the position/burn UI appears
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))

    expect(screen.getByText('下部')).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => expect(onBurned).toHaveBeenCalled())
    expect(burnModule.burnSubtitles).toHaveBeenCalledWith(
      BLOB,
      expect.anything(),
      72.2917,
    )
  })

  it('reveals a percent slider when the fine-tune toggle is switched on, and burns in with its value', async () => {
    seedBurnMock()
    const onBurned = vi.fn()
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={SHOT_CUE_INPUTS} onBurned={onBurned} />)

    fireEvent.click(screen.getByText('📝 英語字幕を生成'))
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
    expect(burnModule.burnSubtitles).toHaveBeenCalledWith(BLOB, expect.anything(), 30)
  })

  it('does not render a save button', async () => {
    seedBurnMock()
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={SHOT_CUE_INPUTS} onBurned={vi.fn()} />)
    fireEvent.click(screen.getByText('📝 英語字幕を生成'))
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

    fireEvent.click(screen.getByText('📝 英語字幕を生成'))
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
    expect(screen.getByText('下部')).toBeInTheDocument()
    const nextBtn = screen.getByText('次へ')
    expect(nextBtn).not.toBeDisabled()

    // Retrying should succeed now that the mock no longer rejects.
    fireEvent.click(nextBtn)
    await waitFor(() => expect(onBurned).toHaveBeenCalled())
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

    fireEvent.click(screen.getByText('📝 英語字幕を生成'))
    await screen.findByDisplayValue('First shot line')
    // The blank-text second shot produced no cue, but its duration still
    // shifted the third shot's cue forward (asserted via the editor input
    // for the third cue existing at all — full offset math is covered by
    // cuesFromShotEntries's own unit tests).
    expect(screen.getByDisplayValue('Third shot line')).toBeInTheDocument()
    expect(screen.getAllByDisplayValue(/shot line/)).toHaveLength(2)
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

    fireEvent.click(screen.getByText('📝 英語字幕を生成'))

    expect(screen.getByText(/字幕にできるテキストがありません/)).toBeInTheDocument()
    expect(screen.getByText('📝 英語字幕を生成')).toBeInTheDocument()
  })
})
