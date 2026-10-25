import { describe, it, expect, vi } from 'vitest'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import SubtitleEditor, { SHIFT_STEP_S } from './SubtitleEditor'
import { SubtitleCue } from '../utils/subtitleCues'

const cues: SubtitleCue[] = [
  { id: 'a', start: 0, end: 1, en: 'one', ja: null },
  { id: 'b', start: 1, end: 2, en: 'two', ja: null },
]

function renderEditor() {
  const onShiftStart = vi.fn()
  render(
    <SubtitleEditor cues={cues} onEditEn={() => undefined} onEditJa={() => undefined} onShiftStart={onShiftStart} />,
  )
  return { onShiftStart, later: screen.getByLabelText('2行目を遅く') }
}

function touch(el: Element, type: 'touchStart' | 'touchEnd', x: number, y: number) {
  const point = { clientX: x, clientY: y }
  const event = createEvent[type](el, { touches: type === 'touchStart' ? [point] : [], changedTouches: [point] })
  fireEvent(el, event)
  return event
}

describe('SubtitleEditor shift buttons', () => {
  it('shifts on a tap and cancels the touchend, so iOS cannot double-tap zoom', () => {
    const { onShiftStart, later } = renderEditor()
    for (let n = 0; n < 2; n++) {
      touch(later, 'touchStart', 10, 10)
      const end = touch(later, 'touchEnd', 12, 11)
      expect(end.defaultPrevented).toBe(true)
    }
    expect(onShiftStart).toHaveBeenCalledTimes(2)
    expect(onShiftStart).toHaveBeenLastCalledWith('b', SHIFT_STEP_S)
  })

  it('does not shift when the finger moved, since that was a scroll', () => {
    const { onShiftStart, later } = renderEditor()
    touch(later, 'touchStart', 10, 10)
    const end = touch(later, 'touchEnd', 10, 60)
    expect(end.defaultPrevented).toBe(false)
    expect(onShiftStart).not.toHaveBeenCalled()
  })

  it('still shifts on a mouse or keyboard click', () => {
    const { onShiftStart } = renderEditor()
    fireEvent.click(screen.getByLabelText('2行目を早める'))
    expect(onShiftStart).toHaveBeenCalledWith('b', -SHIFT_STEP_S)
  })
})
