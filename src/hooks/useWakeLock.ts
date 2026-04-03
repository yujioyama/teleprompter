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

    let mounted = true

    async function acquire() {
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (!mounted) {
          lock.release()
          return
        }
        lockRef.current = lock
        setActive(true)
        lock.addEventListener('release', () => { if (mounted) setActive(false) })
      } catch {
        // Not available (e.g., iOS 16.3 or lower, or background tab)
        if (mounted) setActive(false)
      }
    }

    acquire()

    function handleVisibility() {
      if (document.visibilityState === 'visible') acquire()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      mounted = false
      lockRef.current?.release()
      lockRef.current = null
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [supported])

  return { supported, active }
}
