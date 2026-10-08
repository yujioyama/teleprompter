import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
