import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useScripts } from './useScripts'

// deleteScript fire-and-forgets a real IndexedDB cleanup call, which jsdom
// (this file's test environment) doesn't implement. Mock it so this hook's
// localStorage-only behavior can be tested in isolation.
vi.mock('../utils/shotVideoStore', () => ({
  clearShotVideos: vi.fn().mockResolvedValue(undefined),
}))

beforeEach(() => {
  localStorage.clear()
})

describe('useScripts', () => {
  it('returns empty list initially', () => {
    const { result } = renderHook(() => useScripts())
    expect(result.current.scripts).toEqual([])
  })

  it('creates a new script', () => {
    const { result } = renderHook(() => useScripts())
    act(() => {
      result.current.createScript('テスト動画', [
        { id: '1', text: 'ショット1' },
      ])
    })
    expect(result.current.scripts).toHaveLength(1)
    expect(result.current.scripts[0].title).toBe('テスト動画')
    expect(result.current.scripts[0].shots).toHaveLength(1)
  })

  it('updates a script', () => {
    const { result } = renderHook(() => useScripts())
    act(() => {
      result.current.createScript('元タイトル', [])
    })
    const id = result.current.scripts[0].id
    act(() => {
      result.current.updateScript(id, { title: '新タイトル' })
    })
    expect(result.current.scripts[0].title).toBe('新タイトル')
  })

  it('deletes a script', () => {
    const { result } = renderHook(() => useScripts())
    act(() => {
      result.current.createScript('消すやつ', [])
    })
    const id = result.current.scripts[0].id
    act(() => {
      result.current.deleteScript(id)
    })
    expect(result.current.scripts).toHaveLength(0)
  })

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useScripts())
    act(() => {
      result.current.createScript('保存テスト', [])
    })
    const raw = localStorage.getItem('teleprompter_scripts')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed[0].title).toBe('保存テスト')
  })

  it('gets a script by id', () => {
    const { result } = renderHook(() => useScripts())
    act(() => {
      result.current.createScript('検索テスト', [{ id: '1', text: 'テスト' }])
    })
    const id = result.current.scripts[0].id
    const found = result.current.getScript(id)
    expect(found).toBeDefined()
    expect(found!.title).toBe('検索テスト')
    const missing = result.current.getScript('nonexistent')
    expect(missing).toBeUndefined()
  })

  it('imports a backup, adding new scripts and keeping the newer copy of each', () => {
    localStorage.setItem('teleprompter_scripts', JSON.stringify([
      { id: 'a', title: '端末', shots: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z' },
    ]))
    const { result } = renderHook(() => useScripts())

    let counts: ReturnType<typeof result.current.importScripts> | undefined
    act(() => {
      counts = result.current.importScripts([
        { id: 'a', title: '古い', shots: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
        { id: 'b', title: '追加', shots: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
      ])
    })

    expect(counts).toEqual({ added: 1, updated: 0, unchanged: 1 })
    expect(result.current.scripts.map(s => s.title)).toEqual(['端末', '追加'])
    expect(JSON.parse(localStorage.getItem('teleprompter_scripts')!).map((s: { title: string }) => s.title)).toEqual(['端末', '追加'])
  })

  it('keeps a caption given when the script is created', () => {
    const { result } = renderHook(() => useScripts())
    act(() => {
      result.current.createScript('キャプション付き', [{ id: '1', text: 'a' }], '#朝活 おはよう')
    })
    expect(result.current.scripts[0].caption).toBe('#朝活 おはよう')
    expect(JSON.parse(localStorage.getItem('teleprompter_scripts')!)[0].caption).toBe('#朝活 おはよう')
  })

  it('leaves the caption off when none is given', () => {
    const { result } = renderHook(() => useScripts())
    act(() => {
      result.current.createScript('なし', [], '')
    })
    expect(result.current.scripts[0]).not.toHaveProperty('caption')
  })

  it('updates a caption', () => {
    const { result } = renderHook(() => useScripts())
    act(() => {
      result.current.createScript('元', [])
    })
    const id = result.current.scripts[0].id
    act(() => {
      result.current.updateScript(id, { caption: '新しいキャプション' })
    })
    expect(result.current.scripts[0].caption).toBe('新しいキャプション')
  })
})
