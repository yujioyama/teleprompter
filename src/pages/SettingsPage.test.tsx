import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SettingsPage from './SettingsPage'
import { shareOrDownload } from '../utils/shareOrDownload'

vi.mock('../utils/shareOrDownload', () => ({ shareOrDownload: vi.fn(async () => true) }))

function stored() {
  return JSON.parse(localStorage.getItem('teleprompter_settings') ?? '{}')
}

function renderSettings() {
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('SettingsPage BGM', () => {
  it('starts on Tokyo Lofi at 30%', () => {
    renderSettings()
    expect(screen.getByRole('combobox', { name: 'いつものBGM' })).toHaveValue('lofi-tokyo')
    expect(screen.getByRole('slider', { name: 'BGMの音量' })).toHaveValue('0.3')
    expect(screen.getByText('30%')).toBeInTheDocument()
  })

  it('saves the usual BGM and its volume', () => {
    renderSettings()
    fireEvent.change(screen.getByRole('combobox', { name: 'いつものBGM' }), { target: { value: 'summer-pop' } })
    fireEvent.change(screen.getByRole('slider', { name: 'BGMの音量' }), { target: { value: '0.5' } })
    expect(stored()).toMatchObject({ defaultBgmId: 'summer-pop', bgmVolume: 0.5 })
  })

  it('saves なし as no BGM, and disables the volume and preview', () => {
    renderSettings()
    fireEvent.change(screen.getByRole('combobox', { name: 'いつものBGM' }), { target: { value: '' } })
    expect(stored().defaultBgmId).toBeNull()
    expect(screen.getByRole('slider', { name: 'BGMの音量' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '▶ 試聴' })).toBeDisabled()
  })
})

describe('SettingsPage subtitle position', () => {
  it('shows the short and long samples together, both languages', () => {
    renderSettings()
    expect(screen.getByText('短い字幕')).toBeInTheDocument()
    expect(screen.getByText('長い字幕')).toBeInTheDocument()
    expect(screen.getAllByTestId('subtitle-overlay-box')).toHaveLength(2)
    expect(screen.getByText('さあ、始めましょう！')).toBeInTheDocument()
  })

  it('moves both samples and saves the position from the slider', () => {
    renderSettings()
    fireEvent.change(screen.getByRole('slider', { name: '字幕の上下位置' }), { target: { value: '64' } })
    expect(stored().subtitlePosition).toBe(64)
    for (const box of screen.getAllByTestId('subtitle-overlay-box')) expect(box.style.top).toBe('64%')
  })

  it('sets a preset position with one tap', () => {
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: '上部' }))
    expect(stored().subtitlePosition).toBe(13.75)
    expect(screen.getByRole('button', { name: '上部' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('SettingsPage backup', () => {
  const SCRIPT = {
    id: 'a',
    title: '端末のスクリプト',
    shots: [{ id: 'a-1', text: 'こんにちは' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  }

  function backupFile(scripts: unknown[]) {
    const text = JSON.stringify({ app: 'teleprompter', version: 1, exportedAt: '2026-10-08T00:00:00.000Z', scripts })
    return new File([text], 'backup.json', { type: 'application/json' })
  }

  function chooseFile(file: File) {
    const input = screen.getByLabelText('バックアップファイルを選ぶ') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)
  }

  it('exports every script as a JSON backup', async () => {
    localStorage.setItem('teleprompter_scripts', JSON.stringify([SCRIPT]))
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: 'スクリプトを書き出す' }))

    await waitFor(() => expect(shareOrDownload).toHaveBeenCalledTimes(1))
    const [blob, name] = vi.mocked(shareOrDownload).mock.calls[0]
    expect(blob.type).toBe('application/json')
    expect(name).toMatch(/^teleprompter-scripts-\d{4}-\d{2}-\d{2}$/)
    expect(JSON.parse(await blob.text()).scripts).toEqual([SCRIPT])
  })

  it('cannot export with no scripts', () => {
    renderSettings()
    expect(screen.getByRole('button', { name: 'スクリプトを書き出す' })).toBeDisabled()
  })

  it('imports a backup and says what it brought in', async () => {
    localStorage.setItem('teleprompter_scripts', JSON.stringify([SCRIPT]))
    renderSettings()
    chooseFile(backupFile([{ ...SCRIPT, id: 'b', title: 'バックアップのスクリプト' }]))

    expect(await screen.findByText('1件を追加しました')).toBeInTheDocument()
    const titles = JSON.parse(localStorage.getItem('teleprompter_scripts')!).map((s: { title: string }) => s.title)
    expect(titles).toEqual(['端末のスクリプト', 'バックアップのスクリプト'])
  })

  it('says so when the device already has everything in the backup', async () => {
    localStorage.setItem('teleprompter_scripts', JSON.stringify([SCRIPT]))
    renderSettings()
    chooseFile(backupFile([SCRIPT]))
    expect(await screen.findByText('新しいスクリプトはありませんでした')).toBeInTheDocument()
  })

  it('shows an error for a file that is not a backup, changing nothing', async () => {
    localStorage.setItem('teleprompter_scripts', JSON.stringify([SCRIPT]))
    renderSettings()
    chooseFile(new File(['{"hello":1}'], 'other.json', { type: 'application/json' }))

    expect(await screen.findByText('このアプリのバックアップファイルではありません。')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('teleprompter_scripts')!)).toEqual([SCRIPT])
  })
})

describe('SettingsPage auto-trim', () => {
  it('saves the first shot\'s lead-in', () => {
    renderSettings()
    expect(screen.getByText('0.05秒')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('slider', { name: '最初のショットの前に残す時間' }), { target: { value: '0.2' } })
    expect(stored().firstShotPaddingStart).toBe(0.2)
  })
})
