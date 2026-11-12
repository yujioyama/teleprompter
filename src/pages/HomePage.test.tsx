import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { IDBFactory } from 'fake-indexeddb'
import HomePage from './HomePage'
import { listShotVideos, saveShotVideo } from '../utils/shotVideoStore'
import type { Script } from '../types'

function script(id: string, title: string, shotIds: string[]): Script {
  return {
    id,
    title,
    shots: shotIds.map(shotId => ({ id: shotId, text: shotId })),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function renderHome() {
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
})

describe('HomePage', () => {
  it('offers 仕上げ only for scripts with a stored video', async () => {
    localStorage.setItem(
      'teleprompter_scripts',
      JSON.stringify([script('s1', '撮影済み', ['a']), script('s2', '未撮影', ['b'])]),
    )
    await saveShotVideo('s1', 'a', new Blob(['a'], { type: 'video/mp4' }))
    renderHome()

    expect(await screen.findByRole('button', { name: '動画を仕上げる' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '動画を仕上げる' })).toHaveLength(1)
  })

  it('deletes the videos of shots that were removed from a script', async () => {
    localStorage.setItem('teleprompter_scripts', JSON.stringify([script('s1', '撮影済み', ['a'])]))
    await saveShotVideo('s1', 'a', new Blob(['a'], { type: 'video/mp4' }))
    await saveShotVideo('s1', 'removed', new Blob(['removed'], { type: 'video/mp4' }))
    renderHome()

    await waitFor(async () => expect((await listShotVideos('s1')).map(v => v.shotId)).toEqual(['a']))
    expect(await screen.findByRole('button', { name: '動画を仕上げる' })).toBeInTheDocument()
  })

  it('does not offer 仕上げ once a script has only removed shots\' videos', async () => {
    localStorage.setItem(
      'teleprompter_scripts',
      JSON.stringify([script('s1', '撮り直し前', ['a']), script('s2', '撮影済み', ['b'])]),
    )
    await saveShotVideo('s1', 'removed', new Blob(['removed'], { type: 'video/mp4' }))
    await saveShotVideo('s2', 'b', new Blob(['b'], { type: 'video/mp4' }))
    renderHome()

    // Once s2's button is up, the listing that decides s1's has come in too.
    await screen.findByRole('button', { name: '動画を仕上げる' })
    expect(screen.getAllByRole('button', { name: '動画を仕上げる' })).toHaveLength(1)
    expect(await listShotVideos('s1')).toHaveLength(0)
  })
})

describe('HomePage: deleting a script', () => {
  const stored = () => (JSON.parse(localStorage.getItem('teleprompter_scripts') ?? '[]') as Script[]).map(s => s.id)

  beforeEach(() => {
    localStorage.setItem(
      'teleprompter_scripts',
      JSON.stringify([script('s1', '消す台本', ['a']), script('s2', '残す台本', ['b'])]),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('takes the script off the list at once, with 元に戻す, and deletes nothing yet', async () => {
    await saveShotVideo('s1', 'a', new Blob(['a'], { type: 'video/mp4' }))
    renderHome()
    fireEvent.click(screen.getAllByRole('button', { name: '削除' })[0])

    expect(screen.queryByText('消す台本')).not.toBeInTheDocument()
    expect(screen.getByText('残す台本')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('「消す台本」を削除しました')
    expect(stored()).toEqual(['s1', 's2'])
    expect(await listShotVideos('s1')).toHaveLength(1)
  })

  it('brings the script back with 元に戻す, videos and all', async () => {
    await saveShotVideo('s1', 'a', new Blob(['a'], { type: 'video/mp4' }))
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
    renderHome()
    fireEvent.click(screen.getAllByRole('button', { name: '削除' })[0])
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))

    expect(screen.getByText('消す台本')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(stored()).toEqual(['s1', 's2'])
    expect(await listShotVideos('s1')).toHaveLength(1)
  })

  it('deletes the script and its videos once the toast runs out', async () => {
    await saveShotVideo('s1', 'a', new Blob(['a'], { type: 'video/mp4' }))
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
    renderHome()
    fireEvent.click(screen.getAllByRole('button', { name: '削除' })[0])
    act(() => {
      vi.advanceTimersByTime(6_000)
    })

    expect(stored()).toEqual(['s2'])
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await waitFor(async () => expect(await listShotVideos('s1')).toHaveLength(0))
  })

  it('deletes it when the page is left before the toast runs out', () => {
    renderHome()
    fireEvent.click(screen.getAllByRole('button', { name: '削除' })[0])
    cleanup()

    expect(stored()).toEqual(['s2'])
  })

  it('deletes the first for good when a second script is deleted, which gets its own 元に戻す', () => {
    renderHome()
    fireEvent.click(screen.getAllByRole('button', { name: '削除' })[0])
    fireEvent.click(screen.getByRole('button', { name: '削除' }))

    expect(stored()).toEqual(['s2'])
    expect(screen.getByRole('status')).toHaveTextContent('「残す台本」を削除しました')
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    expect(screen.getByText('残す台本')).toBeInTheDocument()
    expect(stored()).toEqual(['s2'])
  })
})
