import { useEffect, useRef, useState } from 'react'

interface UseWakeLockResult {
  supported: boolean
  active: boolean
}

export function useWakeLock(): UseWakeLockResult {
  const [active, setActive] = useState(false)
  const lockRef = useRef<WakeLockSentinel | null>(null)
  const supported = 'wakeLock' in navigator

  useEffect(() => {
    if (!supported) return

    async function acquire() {
      try {
        lockRef.current = await navigator.wakeLock.request('screen')
        setActive(true)
        lockRef.current.addEventListener('release', () => setActive(false))
      } catch {
        // Not available (e.g., iOS 16.3 or lower, or background tab)
        setActive(false)
      }
    }

    acquire()

    // Re-acquire when tab becomes visible again
    function handleVisibility() {
      if (document.visibilityState === 'visible') acquire()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      lockRef.current?.release()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [supported])

  return { supported, active }
}
