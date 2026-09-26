import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SubtitleWorkflow from './SubtitleWorkflow'
import * as transcribeModule from '../utils/transcribeSpeech'
import * as burnModule from '../utils/burnSubtitles'

vi.mock('../utils/transcribeSpeech')
vi.mock('../utils/burnSubtitles')

const BLOB = new Blob(['x'], { type: 'video/mp4' })

function seedOneTranslatedCue() {
  vi.mocked(transcribeModule.transcribeSpeech).mockResolvedValue([
    { id: 'c1', start: 0, end: 2, en: 'Hello', ja: null },
  ])
  vi.mocked(burnModule.burnSubtitles).mockResolvedValue(new Blob(['out'], { type: 'video/mp4' }))
}

describe('SubtitleWorkflow position controls', () => {
  it('defaults to the bottom preset and burns in with it when advancing', async () => {
    seedOneTranslatedCue()
    const onBurned = vi.fn()
    render(<SubtitleWorkflow combinedBlob={BLOB} onBurned={onBurned} />)

    fireEvent.click(screen.getByText('🎤 英語字幕を生成'))
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
    seedOneTranslatedCue()
    const onBurned = vi.fn()
    render(<SubtitleWorkflow combinedBlob={BLOB} onBurned={onBurned} />)

    fireEvent.click(screen.getByText('🎤 英語字幕を生成'))
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
    seedOneTranslatedCue()
    render(<SubtitleWorkflow combinedBlob={BLOB} onBurned={vi.fn()} />)
    fireEvent.click(screen.getByText('🎤 英語字幕を生成'))
    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => expect(screen.queryByText('保存する')).not.toBeInTheDocument())
  })
})
