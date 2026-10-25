import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

/** How long a button must be held before it starts repeating. */
export const HOLD_DELAY_MS = 400
/** The repeat rate at first, then faster once it has gone on a while. */
export const HOLD_REPEAT_MS = 100
export const HOLD_FAST_REPEAT_MS = 50
export const HOLD_FAST_AFTER_STEPS = 10

/**
 * Button handlers that step once per tap and keep stepping while held.
 * A press only starts the hold timer, so a scroll that begins on the
 * button (which cancels the pointer) never steps. `onDone` runs once the
 * tap or hold ends, from the release itself, so it may start playback.
 */
export function useHoldRepeat(onStep: () => void, onDone?: () => void) {
  // The latest callbacks: a hold outlives the render it started in.
  const latest = useRef({ onStep, onDone })
  latest.current = { onStep, onDone }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Whether the current press has repeated, so its click doesn't step again.
  const held = useRef(false)

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
    onClick() {
      if (held.current) {
        held.current = false
        return
      }
      latest.current.onStep()
      latest.current.onDone?.()
    },
    // A long press would otherwise open the phone's context menu.
    onContextMenu(e: MouseEvent<HTMLButtonElement>) {
      e.preventDefault()
    },
  }
}
