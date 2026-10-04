import { useCallback, useEffect, useRef, useState } from 'react'
import type { MusicTrack } from '../data/musicTracks'

// One lazily-created Audio element shared by every 試聴 button of a component.
export function useTrackPreview() {
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // Identifies the latest play() call. Swapping src or pausing makes an earlier
  // play() promise reject (AbortError); that stale rejection must not clear the
  // state of the track that replaced it.
  const playIdRef = useRef(0)

  useEffect(() => () => audioRef.current?.pause(), [])

  const stop = useCallback(() => {
    playIdRef.current++
    audioRef.current?.pause()
    setPreviewingId(null)
  }, [])

  const toggle = useCallback(
    (track: MusicTrack) => {
      if (previewingId === track.id) {
        stop()
        return
      }
      if (!audioRef.current) {
        audioRef.current = new Audio()
        audioRef.current.addEventListener('ended', () => setPreviewingId(null))
      }
      const playId = ++playIdRef.current
      audioRef.current.src = `/${track.file}`
      // play() rejects on a missing file or the iOS autoplay policy; without
      // this the button would stay on ■ 停止 with no sound.
      audioRef.current.play().catch(() => {
        if (playIdRef.current === playId) setPreviewingId(null)
      })
      setPreviewingId(track.id)
    },
    [previewingId, stop]
  )

  return { previewingId, toggle, stop }
}
