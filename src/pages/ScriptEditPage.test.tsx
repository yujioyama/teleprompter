import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ScriptEditPage from './ScriptEditPage'
import { deleteInboxItem, type InboxItem } from '../utils/inbox'
import type { Script } from '../types'

vi.mock('../utils/inbox', () => ({ deleteInboxItem: vi.fn(async () => {}) }))

const ITEM: InboxItem = {
  id: 'inbox-1',
  title: '朝のルーティン',
  body: '一行目\n二行目',
  caption: '#朝活',
  createdAt: '2026-10-09T01:00:00.000Z',
}

function stored(): Script[] {
  return JSON.parse(localStorage.getItem('teleprompter_scripts') ?? '[]')
}

function renderAt(entry: string | { pathname: string; state: unknown }) {
  render(
    <MemoryRouter initialEntries={[entry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/scripts/new" element={<ScriptEditPage />} />
        <Route path="/scripts/:id/edit" element={<ScriptEditPage />} />
        <Route path="/scripts/:id/shots" element={<p>ショット編集</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.mocked(deleteInboxItem).mockClear()
  localStorage.setItem('teleprompter_settings', JSON.stringify({ inboxKey: 'secret' }))
})

describe('ScriptEditPage from the Claude inbox', () => {
  it('opens with the title, script and caption filled in', () => {
    renderAt({ pathname: '/scripts/new', state: { inboxItem: ITEM } })
    expect(screen.getByLabelText('タイトル')).toHaveValue('朝のルーティン')
    expect(screen.getByLabelText('スクリプト全文')).toHaveValue('一行目\n二行目')
    expect(screen.getByLabelText('キャプション（任意）')).toHaveValue('#朝活')
  })

  it('prefers the arrived script over a leftover draft', () => {
    sessionStorage.setItem('teleprompter_new_script_draft', JSON.stringify({ title: '下書き', body: '古い' }))
    renderAt({ pathname: '/scripts/new', state: { inboxItem: ITEM } })
    expect(screen.getByLabelText('タイトル')).toHaveValue('朝のルーティン')
  })

  it('splits one shot per line, creates the script with its caption, and clears the item', async () => {
    renderAt({ pathname: '/scripts/new', state: { inboxItem: ITEM } })
    fireEvent.click(screen.getByText('自動分割する'))
    expect(screen.getByText('分割結果（2ショット）')).toBeInTheDocument()
    fireEvent.click(screen.getByText('編集へ進む →'))

    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()).toHaveLength(1)
    expect(stored()[0]).toMatchObject({ title: '朝のルーティン', caption: '#朝活' })
    expect(stored()[0].shots.map(s => s.text)).toEqual(['一行目', '二行目'])
    expect(deleteInboxItem).toHaveBeenCalledWith('secret', 'inbox-1')
  })

  it('still creates the script when clearing the item fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(deleteInboxItem).mockRejectedValueOnce(new Error('offline'))
    renderAt({ pathname: '/scripts/new', state: { inboxItem: ITEM } })
    fireEvent.click(screen.getByText('自動分割する'))
    fireEvent.click(screen.getByText('編集へ進む →'))
    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()).toHaveLength(1)
  })
})

describe('ScriptEditPage caption', () => {
  it('saves a typed caption on a new script, without touching the inbox', async () => {
    renderAt('/scripts/new')
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '手入力' } })
    fireEvent.change(screen.getByLabelText('スクリプト全文'), { target: { value: 'a' } })
    fireEvent.change(screen.getByLabelText('キャプション（任意）'), { target: { value: ' #手入力 ' } })
    fireEvent.click(screen.getByText('自動分割する'))
    fireEvent.click(screen.getByText('編集へ進む →'))

    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()[0].caption).toBe('#手入力')
    expect(deleteInboxItem).not.toHaveBeenCalled()
  })

  it('edits the caption of an existing script', async () => {
    const script: Script = {
      id: 's1',
      title: '既存',
      shots: [{ id: 'a', text: 'a' }],
      caption: '古いキャプション',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    localStorage.setItem('teleprompter_scripts', JSON.stringify([script]))
    renderAt('/scripts/s1/edit')

    expect(screen.getByLabelText('キャプション（任意）')).toHaveValue('古いキャプション')
    fireEvent.change(screen.getByLabelText('キャプション（任意）'), { target: { value: '新しいキャプション' } })
    fireEvent.click(screen.getByText('編集へ進む →'))

    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()[0].caption).toBe('新しいキャプション')
  })
})
