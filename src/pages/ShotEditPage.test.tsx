import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ShotEditPage from './ShotEditPage'
import type { Script } from '../types'

const SCRIPT: Script = {
  id: 's1',
  title: 'テスト',
  shots: [
    { id: 'a', text: '一つ目' },
    { id: 'b', text: '二つ目' },
    { id: 'c', text: '三つ目' },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function storedTexts(): string[] {
  const scripts: Script[] = JSON.parse(localStorage.getItem('teleprompter_scripts') ?? '[]')
  return scripts[0].shots.map(s => s.text)
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/scripts/s1/shots']}>
      <Routes>
        <Route path="/scripts/:id/shots" element={<ShotEditPage />} />
        <Route path="/scripts/:id/edit" element={<p>edit page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function deleteButtons() {
  return screen.getAllByRole('button', { name: '削除' })
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('teleprompter_scripts', JSON.stringify([SCRIPT]))
})

describe('ShotEditPage saving', () => {
  it('saves an edited shot right away, so 戻る keeps it', () => {
    renderPage()
    fireEvent.click(screen.getByText('二つ目'))
    fireEvent.change(screen.getByDisplayValue('二つ目'), { target: { value: '書き換えた' } })
    fireEvent.click(screen.getByRole('button', { name: '完了' }))
    fireEvent.click(screen.getByRole('button', { name: '‹ 戻る' }))
    expect(storedTexts()).toEqual(['一つ目', '書き換えた', '三つ目'])
  })

  it('saves an added shot right away', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '＋ ショット追加' }))
    expect(storedTexts()).toEqual(['一つ目', '二つ目', '三つ目', '新しいショット'])
  })
})

describe('ShotEditPage delete', () => {
  it('saves a deletion and offers to undo it', () => {
    renderPage()
    fireEvent.click(deleteButtons()[1])
    expect(storedTexts()).toEqual(['一つ目', '三つ目'])
    const toast = screen.getByText('ショットを削除しました').parentElement!
    fireEvent.click(within(toast).getByRole('button', { name: '元に戻す' }))
    expect(storedTexts()).toEqual(['一つ目', '二つ目', '三つ目'])
    expect(screen.getByText('二つ目')).toBeInTheDocument()
    expect(screen.queryByText('ショットを削除しました')).not.toBeInTheDocument()
  })

  it('undoes only the latest deletion', () => {
    renderPage()
    fireEvent.click(deleteButtons()[0])
    fireEvent.click(deleteButtons()[0])
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    expect(storedTexts()).toEqual(['二つ目', '三つ目'])
  })

  it('drops the undo once something else changes', () => {
    renderPage()
    fireEvent.click(deleteButtons()[0])
    fireEvent.click(screen.getByRole('button', { name: '＋ ショット追加' }))
    expect(screen.queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument()
  })
})

describe('ShotEditPage confirming an unchanged shot', () => {
  it('keeps the undo offered', () => {
    renderPage()
    fireEvent.click(deleteButtons()[0])
    fireEvent.click(screen.getByText('二つ目'))
    fireEvent.click(screen.getByRole('button', { name: '完了' }))
    expect(screen.getByRole('button', { name: '元に戻す' })).toBeInTheDocument()
  })
})
