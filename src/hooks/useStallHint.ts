import { useEffect, useState } from 'react'

/** How long progress may stand still before 中断する is suggested (issue #34). */
export const STALL_HINT_MS = 30_000

const TICK_MS = 1000

/**
 * Whether `signature` (a job's progress, or anything that changes when it
 * moves on) has stayed the same for STALL_HINT_MS. Only time the page is
 * visible counts, like guardAgainstStall: a backgrounded page is suspended
 * with its codecs, and waking up from that is not a stall.
 */
export function useStallHint(signature: unknown): boolean {
  const [stalled, setStalled] = useState(false)

  useEffect(() => {
    setStalled(false)
    let idle = 0
    let last = Date.now()
    const timer = setInterval(() => {
      const now = Date.now()
      // A long gap between ticks means the page was asleep; count it as at
      // most a couple of ticks.
      if (!document.hidden) idle += Math.min(now - last, TICK_MS * 2)
      last = now
      if (idle < STALL_HINT_MS) return
      clearInterval(timer)
      setStalled(true)
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [signature])

  return stalled
}
