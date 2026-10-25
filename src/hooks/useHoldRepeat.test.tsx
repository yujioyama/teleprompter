import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { HOLD_DELAY_MS, HOLD_FAST_AFTER_STEPS, HOLD_FAST_REPEAT_MS, HOLD_REPEAT_MS, useHoldRepeat } from './useHoldRepeat'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function StepButton({ onStep, onDone }: { onStep: () => void; onDone?: () => void }) {
  return <button {...useHoldRepeat(onStep, onDone)}>step</button>
}

function setup() {
  const onStep = vi.fn()
  const onDone = vi.fn()
  render(<StepButton onStep={onStep} onDone={onDone} />)
  return { onStep, onDone, button: screen.getByRole('button') }
}

describe('useHoldRepeat', () => {
  it('steps once per tap', () => {
    const { onStep, onDone, button } = setup()
    fireEvent.pointerDown(button, { button: 0 })
    fireEvent.pointerUp(button)
    fireEvent.click(button)
    expect(onStep).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('steps from the keyboard too', () => {
    const { onStep, button } = setup()
    fireEvent.click(button)
    expect(onStep).toHaveBeenCalledTimes(1)
  })

  it('keeps stepping while held, faster after a while, without a step for the click', () => {
    const { onStep, onDone, button } = setup()
    fireEvent.pointerDown(button, { button: 0 })
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS - 1))
    expect(onStep).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1 + HOLD_REPEAT_MS * (HOLD_FAST_AFTER_STEPS - 1)))
    expect(onStep).toHaveBeenCalledTimes(HOLD_FAST_AFTER_STEPS)
    act(() => vi.advanceTimersByTime(HOLD_FAST_REPEAT_MS * 2))
    expect(onStep).toHaveBeenCalledTimes(HOLD_FAST_AFTER_STEPS + 2)

    fireEvent.pointerUp(button)
    expect(onDone).toHaveBeenCalledTimes(1)
    fireEvent.click(button)
    act(() => vi.advanceTimersByTime(1000))
    expect(onStep).toHaveBeenCalledTimes(HOLD_FAST_AFTER_STEPS + 2)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('never steps when the press turns into a scroll', () => {
    const { onStep, onDone, button } = setup()
    fireEvent.pointerDown(button, { button: 0 })
    fireEvent.pointerCancel(button)
    act(() => vi.advanceTimersByTime(1000))
    expect(onStep).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('uses the latest callback during a hold', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<StepButton onStep={first} />)
    fireEvent.pointerDown(screen.getByRole('button'), { button: 0 })
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS))
    rerender(<StepButton onStep={second} />)
    act(() => vi.advanceTimersByTime(HOLD_REPEAT_MS))
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })
})
