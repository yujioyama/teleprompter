import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SettingsPage from './SettingsPage'

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
