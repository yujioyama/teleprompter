import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import CancelProcessing from './CancelProcessing'
import { STALL_HINT_MS } from '../hooks/useStallHint'

const HINT = '処理が止まっているようです。中断してやり直してください'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CancelProcessing', () => {
  it('calls onCancel when 中断する is tapped', () => {
    const onCancel = vi.fn()
    render(<CancelProcessing progress={0} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('中断する'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('suggests cancelling only after progress has stopped for 30 s', () => {
    render(<CancelProcessing progress={0.3} onCancel={() => undefined} />)
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(STALL_HINT_MS))
    expect(screen.getByText(HINT)).toBeInTheDocument()
  })
})
