import { useEffect, useRef, type MouseEvent, type PointerEvent, type TouchEvent } from 'react'

/** How long a button must be held before it starts repeating. */
export const HOLD_DELAY_MS = 400
/** The repeat rate at first, then faster once it has gone on a while. */
export const HOLD_REPEAT_MS = 100
export const HOLD_FAST_REPEAT_MS = 50
export const HOLD_FAST_AFTER_STEPS = 10

/** A finger that moved further than this was scrolling, not tapping. */
const TAP_SLOP_PX = 10

/**
 * Button handlers that step once per tap and keep stepping while held.
 * A press only starts the hold timer, so a scroll that begins on the
 * button (which cancels the pointer) never steps. `onDone` runs once the
 * tap or hold ends, from the release itself, so it may start playback.
 *
 * These buttons get tapped quickly over and over, and iOS reads two quick
 * taps as a double-tap and zooms in. Cancelling the touchend stops the
 * zoom (and the click it would fire), so a tap presses the button there
 * instead. Mouse and keyboard presses still arrive as clicks.
 */
export function useHoldRepeat(onStep: () => void, onDone?: () => void) {
  // The latest callbacks: a hold outlives the render it started in.
  const latest = useRef({ onStep, onDone })
  latest.current = { onStep, onDone }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Whether the current press has repeated, so its release doesn't step again.
  const held = useRef(false)
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  function stop() {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }

  useEffect(() => stop, [])

  function endHold() {
    const wasRepeating = timer.current !== null && held.current
    stop()
    if (wasRepeating) latest.current.onDone?.()
  }

  function press() {
    if (held.current) {
      held.current = false
      return
    }
    latest.current.onStep()
    latest.current.onDone?.()
  }

  return {
    onPointerDown(e: PointerEvent<HTMLButtonElement>) {
      // Only the main button (jsdom leaves it unset, hence not `!== 0`).
      if (e.button > 0) return
      stop()
      held.current = false
      let steps = 0
      const tick = () => {
        held.current = true
        steps++
        latest.current.onStep()
        timer.current = setTimeout(tick, steps < HOLD_FAST_AFTER_STEPS ? HOLD_REPEAT_MS : HOLD_FAST_REPEAT_MS)
      }
      timer.current = setTimeout(tick, HOLD_DELAY_MS)
    },
    onPointerUp: endHold,
    onPointerCancel: endHold,
    onPointerLeave: endHold,
    onTouchStart(e: TouchEvent<HTMLButtonElement>) {
      const t = e.touches[0]
      touchStart.current = { x: t.clientX, y: t.clientY }
    },
    onTouchEnd(e: TouchEvent<HTMLButtonElement>) {
      const start = touchStart.current
      touchStart.current = null
      const t = e.changedTouches[0]
      if (!start || Math.hypot(t.clientX - start.x, t.clientY - start.y) > TAP_SLOP_PX) return
      e.preventDefault()
      press()
    },
    onTouchCancel() {
      touchStart.current = null
    },
    onClick: press,
    // A long press would otherwise open the phone's context menu.
    onContextMenu(e: MouseEvent<HTMLButtonElement>) {
      e.preventDefault()
    },
  }
}
