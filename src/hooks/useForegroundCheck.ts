import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * Runs `check(key, isStale)` now and every time the app returns to the
 * foreground, for as long as `key` is non-null; a new key starts over. A
 * home-screen app often resumes without remounting anything, so this is how
 * a page notices what Claude chat sent while the user was over there.
 * `isStale()` turns true once a newer check has started or the key changed,
 * so an older check answering last can't overwrite a newer answer.
 */
export function useForegroundCheck(key: string | null, check: (key: string, isStale: () => boolean) => void) {
  // Always the latest render's check, without restarting on every render.
  const checkRef = useRef(check)
  useLayoutEffect(() => {
    checkRef.current = check
  })

  useEffect(() => {
    if (key === null) return
    const current = key
    let cancelled = false
    let latest = 0
    function run() {
      const request = ++latest
      checkRef.current(current, () => cancelled || request !== latest)
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') run()
    }
    run()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [key])
}
