import { useEffect, useState } from 'react'
import type { LineImage } from '../types'
import { ensureLineImages } from '../utils/lineImageDownload'
import { getLineImages } from '../utils/lineImageStore'
import type { StoredLineImage } from '../utils/lineImages'

const NONE: LineImage[] = []

/**
 * The images of a script's lines as this device has them, downloading any it
 * lacks (a restored backup, or one that failed when the script arrived).
 * `loading` is true until that has been tried.
 */
export function useLineImages(images: LineImage[] = NONE, inboxKey?: string) {
  const [state, setState] = useState<{ stored: Map<string, StoredLineImage>; loading: boolean }>({
    stored: new Map(),
    loading: images.length > 0,
  })
  // By value: the caller's array is new whenever the script is saved.
  const key = JSON.stringify(images.map(image => [image.imageId, image.url]))
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (images.length === 0) {
      setState({ stored: new Map(), loading: false })
      return
    }
    let stale = false
    setState(prev => ({ ...prev, loading: true }))
    void (async () => {
      await ensureLineImages(images, inboxKey)
      const stored = await getLineImages(images.map(image => image.imageId)).catch(err => {
        console.warn('Could not read the stored images', err)
        return new Map<string, StoredLineImage>()
      })
      if (!stale) setState({ stored, loading: false })
    })()
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, inboxKey, attempt])

  return { ...state, retry: () => setAttempt(n => n + 1) }
}
