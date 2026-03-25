import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { useScripts } from './useScripts'

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
})
