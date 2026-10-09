import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
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

type Entry = string | { pathname: string; state: unknown }

function GoBack() {
  const navigate = useNavigate()
  return <button onClick={() => navigate(-1)}>戻る操作</button>
}

function renderAt(entry: Entry | Entry[], initialIndex?: number) {
  return render(
    <MemoryRouter
      initialEntries={Array.isArray(entry) ? entry : [entry]}
      initialIndex={initialIndex}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <GoBack />
      <Routes>
        <Route path="/" element={<p>ホーム</p>} />
        <Route path="/scripts/new" element={<ScriptEditPage />} />
        <Route path="/scripts/:id/edit" element={<ScriptEditPage />} />
        <Route path="/scripts/:id/shots" element={<p>ショット編集</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

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

  it('leaves a hand-typed draft alone while editing and creating from an inbox item', async () => {
    const seeded = { title: '下書き', body: '古い', caption: '' }
    sessionStorage.setItem('teleprompter_new_script_draft', JSON.stringify(seeded))
    renderAt({ pathname: '/scripts/new', state: { inboxItem: ITEM } })
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '届いた台本を直した' } })
    fireEvent.click(screen.getByText('自動分割する'))
    fireEvent.click(screen.getByText('編集へ進む →'))

    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem('teleprompter_new_script_draft') ?? 'null')).toEqual(seeded)
  })

  it('still creates the script when clearing the item fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(deleteInboxItem).mockRejectedValueOnce(new Error('offline'))
    renderAt({ pathname: '/scripts/new', state: { inboxItem: ITEM } })
    fireEvent.click(screen.getByText('自動分割する'))
    fireEvent.click(screen.getByText('編集へ進む →'))
    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()).toHaveLength(1)
    expect(deleteInboxItem).toHaveBeenCalledWith('secret', 'inbox-1')
    await waitFor(() => expect(logged).toHaveBeenCalledWith('Failed to clear the inbox item', expect.any(Error)))
  })

  it('does not reopen the consumed item when going back after creating the script', async () => {
    renderAt(['/', { pathname: '/scripts/new', state: { inboxItem: ITEM } }], 1)
    fireEvent.click(screen.getByText('自動分割する'))
    fireEvent.click(screen.getByText('編集へ進む →'))
    expect(await screen.findByText('ショット編集')).toBeInTheDocument()

    fireEvent.click(screen.getByText('戻る操作'))

    expect(await screen.findByText('ホーム')).toBeInTheDocument()
    expect(screen.queryByText('新規スクリプト')).not.toBeInTheDocument()
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

  it('keeps a typed caption in the draft and restores it on remount', () => {
    const { unmount } = renderAt('/scripts/new')
    fireEvent.change(screen.getByLabelText('キャプション（任意）'), { target: { value: '#下書き' } })
    unmount()

    renderAt('/scripts/new')
    expect(screen.getByLabelText('キャプション（任意）')).toHaveValue('#下書き')
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
