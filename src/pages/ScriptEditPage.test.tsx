import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import ScriptEditPage from './ScriptEditPage'
import { deleteInboxItem, type InboxItem } from '../utils/inbox'
import type { Script } from '../types'

vi.mock('../utils/inbox', () => ({ deleteInboxItem: vi.fn(async () => {}) }))
// jsdom has no IndexedDB or decoding: these only reach the device's image store.
vi.mock('../utils/lineImageDownload', () => ({
  ensureLineImages: vi.fn(async () => []),
  saveChosenImage: vi.fn(async () => 'chosen-id'),
}))
vi.mock('../utils/lineImageStore', () => ({
  getLineImages: vi.fn(async () => new Map()),
  pruneLineImages: vi.fn(async () => {}),
}))

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

describe('ScriptEditPage line images', () => {
  const URL_A = 'https://x.test/a.jpg'
  const WITH_IMAGE: InboxItem = { ...ITEM, images: [{ line: 2, url: URL_A, credit: 'Ann / CC BY 4.0' }] }

  async function submit() {
    fireEvent.click(screen.getByRole('button', { name: '編集へ進む →' }))
    await screen.findByText('ショット編集')
    return stored()[0]
  }

  beforeEach(() => {
    localStorage.clear()
  })

  it('keeps the images Claude sent, each on its line', async () => {
    renderAt({ pathname: '/scripts/new', state: { inboxItem: WITH_IMAGE } })
    fireEvent.click(screen.getByRole('button', { name: '行に分ける' }))
    expect(screen.getByLabelText('二行目 のクレジット')).toHaveValue('Ann / CC BY 4.0')
    expect(screen.queryByLabelText('一行目 のクレジット')).not.toBeInTheDocument()
    expect(screen.getByText(/ステッカーと妖精は出ません/)).toBeInTheDocument()
    expect((await submit()).lineImages).toEqual([{ en: '二行目', imageId: URL_A, url: URL_A, credit: 'Ann / CC BY 4.0' }])
  })

  it('stores none when none was sent, and says nothing about stickers', async () => {
    renderAt({ pathname: '/scripts/new', state: { inboxItem: ITEM } })
    fireEvent.click(screen.getByRole('button', { name: '行に分ける' }))
    expect(screen.queryByText(/ステッカーと妖精は出ません/)).not.toBeInTheDocument()
    expect(await submit()).not.toHaveProperty('lineImages')
  })

  it('deletes an image', async () => {
    renderAt({ pathname: '/scripts/new', state: { inboxItem: WITH_IMAGE } })
    fireEvent.click(screen.getByRole('button', { name: '行に分ける' }))
    fireEvent.click(screen.getByRole('button', { name: '画像を削除' }))
    expect(await submit()).not.toHaveProperty('lineImages')
  })

  it('replaces an image from a URL, dropping the old credit', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('https://x.test/b.jpg')
    renderAt({ pathname: '/scripts/new', state: { inboxItem: WITH_IMAGE } })
    fireEvent.click(screen.getByRole('button', { name: '行に分ける' }))
    fireEvent.click(screen.getByRole('button', { name: 'URLで差し替え' }))
    expect((await submit()).lineImages).toEqual([{ en: '二行目', imageId: 'https://x.test/b.jpg', url: 'https://x.test/b.jpg' }])
  })

  it('adds a picture chosen on the device to a line without one', async () => {
    renderAt({ pathname: '/scripts/new', state: { inboxItem: WITH_IMAGE } })
    fireEvent.click(screen.getByRole('button', { name: '行に分ける' }))
    fireEvent.change(screen.getByLabelText('一行目 の画像を選ぶ'), { target: { files: [new File(['x'], 'x.png', { type: 'image/png' })] } })
    await screen.findByLabelText('一行目 のクレジット')
    const { lineImages } = await submit()
    expect(lineImages).toContainEqual({ en: '一行目', imageId: 'chosen-id' })
    expect(lineImages).toHaveLength(2)
  })

  it('keeps an image with its line when the line is edited', async () => {
    const item: InboxItem = { ...ITEM, body: 'First line of it\nI ate toast this morning', images: [{ line: 2, url: URL_A }] }
    renderAt({ pathname: '/scripts/new', state: { inboxItem: item } })
    fireEvent.change(screen.getByLabelText('スクリプト全文'), { target: { value: 'A new opening line\nFirst line of it\nI ate a toast this morning' } })
    fireEvent.click(screen.getByRole('button', { name: '行に分ける' }))
    expect((await submit()).lineImages).toEqual([{ en: 'I ate a toast this morning', imageId: URL_A, url: URL_A }])
  })
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

  it('makes a one-take script by default, one shot holding every line, and clears the item', async () => {
    renderAt({ pathname: '/scripts/new', state: { inboxItem: ITEM } })
    fireEvent.click(screen.getByText('行に分ける'))
    expect(screen.getByText('一発撮り（字幕2行）')).toBeInTheDocument()
    fireEvent.click(screen.getByText('編集へ進む →'))

    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()).toHaveLength(1)
    expect(stored()[0]).toMatchObject({ title: '朝のルーティン', caption: '#朝活', oneTake: true })
    expect(stored()[0].shots.map(s => s.text)).toEqual(['一行目\n二行目'])
    expect(deleteInboxItem).toHaveBeenCalledWith('secret', 'inbox-1')
  })

  it('keeps the Japanese Claude sent with the script, each with its English line', async () => {
    renderAt({ pathname: '/scripts/new', state: { inboxItem: { ...ITEM, japanese: ['いちぎょうめ', 'にぎょうめ'] } } })
    fireEvent.click(screen.getByText('行に分ける'))
    fireEvent.click(screen.getByText('編集へ進む →'))

    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()[0].japanese).toEqual([
      { en: '一行目', ja: 'いちぎょうめ' },
      { en: '二行目', ja: 'にぎょうめ' },
    ])
  })

  it('films a script with 相手のセリフ line by line, with those lines marked', async () => {
    const item: InboxItem = { ...ITEM, body: 'Hi. What can I get you?\nA latte.\nSorry?', heard: [1, 3] }
    renderAt({ pathname: '/scripts/new', state: { inboxItem: item } })
    expect(screen.getByLabelText(/一発撮り/)).not.toBeChecked()
    fireEvent.click(screen.getByText('自動分割する'))
    fireEvent.click(screen.getByText('編集へ進む →'))

    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()[0].oneTake).toBeFalsy()
    expect(stored()[0].shots.map(shot => [shot.text, shot.heard])).toEqual([
      ['Hi. What can I get you?', true],
      ['A latte.', undefined],
      ['Sorry?', true],
    ])
  })

  it('keeps the marks on their lines when the script was edited before splitting', async () => {
    const item: InboxItem = { ...ITEM, body: 'Hi there\nA latte\nSorry?', heard: [1, 3] }
    renderAt({ pathname: '/scripts/new', state: { inboxItem: item } })
    fireEvent.change(screen.getByDisplayValue(/Hi there/), { target: { value: 'Well\nHi there\nA latte\nSorry?' } })
    fireEvent.click(screen.getByText('自動分割する'))
    fireEvent.click(screen.getByText('編集へ進む →'))

    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()[0].shots.map(shot => Boolean(shot.heard))).toEqual([false, true, false, true])
  })

  it('keeps the type Claude sent, and lets it be changed or cleared', async () => {
    renderAt({ pathname: '/scripts/new', state: { inboxItem: { ...ITEM, videoType: 'B' } } })
    expect(screen.getByLabelText('B: 表現ノート型')).toBeChecked()
    fireEvent.click(screen.getByLabelText('A: 2021年型'))
    fireEvent.click(screen.getByText('行に分ける'))
    fireEvent.click(screen.getByText('編集へ進む →'))
    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()[0].videoType).toBe('A')
  })

  it('ignores a film look on an item that was waiting in the inbox', async () => {
    const waiting = { ...ITEM, videoType: 'A', look: 'glitch' } as InboxItem
    renderAt({ pathname: '/scripts/new', state: { inboxItem: waiting } })
    fireEvent.click(screen.getByText('行に分ける'))
    fireEvent.click(screen.getByText('編集へ進む →'))
    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()[0]).toMatchObject({ videoType: 'A' })
    expect(stored()[0]).not.toHaveProperty('look')
  })

  it('stores no type when none was picked', async () => {
    renderAt({ pathname: '/scripts/new', state: { inboxItem: ITEM } })
    expect(within(screen.getByRole('group', { name: '動画の型' })).getByLabelText('なし')).toBeChecked()
    expect(screen.getByText('動画の型（分析用の記録です。冒頭の演出は変わりません）')).toBeInTheDocument()
    fireEvent.click(screen.getByText('行に分ける'))
    fireEvent.click(screen.getByText('編集へ進む →'))
    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()[0]).not.toHaveProperty('videoType')
  })

  it('stores no Japanese when none was sent', async () => {
    renderAt({ pathname: '/scripts/new', state: { inboxItem: ITEM } })
    fireEvent.click(screen.getByText('行に分ける'))
    fireEvent.click(screen.getByText('編集へ進む →'))

    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()[0]).not.toHaveProperty('japanese')
  })

  it('splits one shot per line with 一発撮り switched off', async () => {
    renderAt({ pathname: '/scripts/new', state: { inboxItem: ITEM } })
    fireEvent.click(screen.getByRole('checkbox', { name: /一発撮り/ }))
    fireEvent.click(screen.getByText('自動分割する'))
    expect(screen.getByText('分割結果（2ショット）')).toBeInTheDocument()
    fireEvent.click(screen.getByText('編集へ進む →'))

    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()[0].oneTake).toBeUndefined()
    expect(stored()[0].shots.map(s => s.text)).toEqual(['一行目', '二行目'])
  })

  it('leaves a hand-typed draft alone while editing and creating from an inbox item', async () => {
    const seeded = { title: '下書き', body: '古い', caption: '' }
    sessionStorage.setItem('teleprompter_new_script_draft', JSON.stringify(seeded))
    renderAt({ pathname: '/scripts/new', state: { inboxItem: ITEM } })
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '届いた台本を直した' } })
    fireEvent.click(screen.getByText('行に分ける'))
    fireEvent.click(screen.getByText('編集へ進む →'))

    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem('teleprompter_new_script_draft') ?? 'null')).toEqual(seeded)
  })

  it('still creates the script when clearing the item fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(deleteInboxItem).mockRejectedValueOnce(new Error('offline'))
    renderAt({ pathname: '/scripts/new', state: { inboxItem: ITEM } })
    fireEvent.click(screen.getByText('行に分ける'))
    fireEvent.click(screen.getByText('編集へ進む →'))
    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()).toHaveLength(1)
    expect(deleteInboxItem).toHaveBeenCalledWith('secret', 'inbox-1')
    await waitFor(() => expect(logged).toHaveBeenCalledWith('Failed to clear the inbox item', expect.any(Error)))
  })

  it('does not reopen the consumed item when going back after creating the script', async () => {
    renderAt(['/', { pathname: '/scripts/new', state: { inboxItem: ITEM } }], 1)
    fireEvent.click(screen.getByText('行に分ける'))
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
    fireEvent.click(screen.getByText('行に分ける'))
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

  it('keeps the film look of an existing script when it is edited', async () => {
    const script: Script = {
      id: 's1',
      title: '既存',
      shots: [{ id: 'a', text: 'a' }],
      videoType: 'B',
      look: 'nightBlue',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    localStorage.setItem('teleprompter_scripts', JSON.stringify([script]))
    renderAt('/scripts/s1/edit')
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '直した' } })
    fireEvent.click(screen.getByText('編集へ進む →'))

    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()[0]).toMatchObject({ title: '直した', videoType: 'B', look: 'nightBlue' })
  })
})
