import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createEvent, fireEvent, render, screen } from '@testing-library/react'
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

function touch(el: Element, type: 'touchStart' | 'touchEnd', x: number, y: number) {
  const point = { clientX: x, clientY: y }
  const event = createEvent[type](el, { touches: type === 'touchStart' ? [point] : [], changedTouches: [point] })
  fireEvent(el, event)
  return event
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

  it('steps on a tap and cancels the touchend, so iOS cannot double-tap zoom', () => {
    const { onStep, onDone, button } = setup()
    for (let n = 0; n < 2; n++) {
      fireEvent.pointerDown(button, { button: 0 })
      fireEvent.pointerUp(button)
      touch(button, 'touchStart', 10, 10)
      expect(touch(button, 'touchEnd', 12, 11).defaultPrevented).toBe(true)
    }
    expect(onStep).toHaveBeenCalledTimes(2)
    expect(onDone).toHaveBeenCalledTimes(2)
  })

  it('does not step when the finger moved, since that was a scroll', () => {
    const { onStep, button } = setup()
    touch(button, 'touchStart', 10, 10)
    expect(touch(button, 'touchEnd', 10, 60).defaultPrevented).toBe(false)
    expect(onStep).not.toHaveBeenCalled()
  })

  it('does not step again when a held touch is let go', () => {
    const { onStep, onDone, button } = setup()
    fireEvent.pointerDown(button, { button: 0 })
    touch(button, 'touchStart', 10, 10)
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_REPEAT_MS))
    fireEvent.pointerUp(button)
    touch(button, 'touchEnd', 10, 10)
    expect(onStep).toHaveBeenCalledTimes(2)
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
