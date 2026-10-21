import { useEffect, useState } from 'react'

/**
 * An object URL for `blob`, revoked once the blob changes or the component
 * goes away; null without a blob, and for the render before the URL exists.
 *
 * Created and revoked in the same effect, not via useMemo: under StrictMode's
 * dev-only mount→unmount→remount, an effect's cleanup always reruns before
 * its body on the same deps, so the URL handed out is never one already
 * revoked — useMemo would cache across the remount and keep returning it.
 */
export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])

  return url
}
