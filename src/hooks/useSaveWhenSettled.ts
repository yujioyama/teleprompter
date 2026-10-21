import { useCallback, useEffect, useRef } from 'react'

/**
 * Calls `save` once `signature` — a string standing for what's to be saved
 * — has stayed on a new value for `delayMs`, so a drag or a burst of
 * typing is written once rather than per intermediate value. Null means
 * there's nothing to save (yet). The returned `markSaved` tells it what is
 * stored already, e.g. what was just loaded, so that isn't written back.
 */
export function useSaveWhenSettled(
  signature: string | null,
  save: () => void,
  delayMs: number,
): (signature: string | null) => void {
  const savedRef = useRef<string | null>(null)
  // The latest save, so the timer below only restarts on a new signature.
  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    if (signature === null || signature === savedRef.current) return
    const timer = setTimeout(() => {
      savedRef.current = signature
      saveRef.current()
    }, delayMs)
    return () => clearTimeout(timer)
  }, [signature, delayMs])

  return useCallback((stored: string | null) => {
    savedRef.current = stored
  }, [])
}
