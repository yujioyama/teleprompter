import { useEffect, useReducer, useRef, useState } from 'react'
import { unifyNormalizeBackends } from '../utils/trimAndNormalizeShot'
import { concatVideos } from '../utils/concatVideos'
import type { ShotEncodeCache } from '../utils/shotEncodeCache'
import { encodeAll, normalizeRequest, type ShotClip } from '../utils/shotEncoding'
import { raceAbort } from '../utils/cancellation'
import type { ShotCueInput } from '../utils/subtitleCues'
import type { TrimRecord } from '../../shared/videoRecord'

// What 結合 is busy with, so the button never sits at 100% while work
// remains (issue #31): encoding each shot, re-encoding some onto one
// encoder after WebCodecs broke down partway, then joining them.
export type CombinePhase = 'encoding' | 'unifying' | 'joining'

// Progress and an error only exist in the states they belong to.
export type CombineStatus =
  | { state: 'idle' }
  | { state: 'combining'; phase: CombinePhase; progress: number }
  | { state: 'done' }
  | { state: 'error'; error: string }
  | { state: 'cancelled' }

type CombineAction =
  | { type: 'start' }
  | { type: 'progress'; phase: CombinePhase; progress?: number }
  | { type: 'done' }
  | { type: 'fail'; error: string }
  | { type: 'cancel' }

export function combineReducer(status: CombineStatus, action: CombineAction): CombineStatus {
  switch (action.type) {
    case 'start':
      return { state: 'combining', phase: 'encoding', progress: 0 }
    case 'progress':
      if (status.state !== 'combining') return status
      return { state: 'combining', phase: action.phase, progress: action.progress ?? status.progress }
    case 'done':
      return { state: 'done' }
    case 'fail':
      return { state: 'error', error: action.error }
    case 'cancel':
      return { state: 'cancelled' }
  }
}

/** A finished 結合 and what it was made from. */
export interface Combined {
  blob: Blob
  url: string
  // The shots exactly as they went into `blob`, for burning subtitles shot
  // by shot (trims may change afterwards without re-combining).
  clips: ShotClip[]
  // The text each shot is subtitled with, and for how long.
  cueInputs: ShotCueInput[]
  // The cuts `blob` was made with; null for a 結合 saved before they were kept.
  trim: TrimRecord | null
}

/**
 * 結合: joining the trimmed shots into one video. `combine` runs it and
 * resolves with the joined video, or null when it was cancelled or failed
 * (the status says which); the page then hands the result to `show`,
 * which a 結合 restored from a save goes through too. A previous result
 * stays shown while a new one runs or after it fails.
 */
export function useCombine() {
  const [status, dispatch] = useReducer(combineReducer, { state: 'idle' })
  const [combined, setCombined] = useState<Combined | null>(null)
  const urlRef = useRef<string | null>(null)
  // Aborted by 中断する (issue #34) or when the page goes away mid-combine.
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  function show(result: Omit<Combined, 'url'>) {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    const url = URL.createObjectURL(result.blob)
    urlRef.current = url
    setCombined({ ...result, url })
    dispatch({ type: 'done' })
  }

  async function combine(cache: ShotEncodeCache, clips: ShotClip[]): Promise<Blob | null> {
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller
    // A cancelled run may still report in late; it must not touch the page.
    const report = (phase: CombinePhase, progress?: number) => {
      if (!signal.aborted) dispatch({ type: 'progress', phase, progress })
    }
    dispatch({ type: 'start' })
    try {
      // Raced so 中断する frees the page even if an encode never settles.
      return await raceAbort(
        (async () => {
          const encoded = await encodeAll(
            cache,
            clips.map(normalizeRequest),
            ratio => report('encoding', ratio),
            signal,
          )
          // If WebCodecs broke down partway (see trimAndNormalizeShot), some
          // clips came from the hardware encoder and some from ffmpeg; their
          // H.264 headers differ and can't be joined by packet copy, so some
          // have to be re-encoded onto the other's profile.
          const normalized = await unifyNormalizeBackends(clips, encoded, ratio => report('unifying', ratio), signal)
          report('joining')
          return concatVideos(normalized, signal)
        })(),
        signal,
      )
    } catch (err) {
      if (signal.aborted) dispatch({ type: 'cancel' })
      else dispatch({ type: 'fail', error: err instanceof Error ? err.message : String(err) })
      return null
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  function cancel() {
    abortRef.current?.abort()
  }

  return { status, combined, show, combine, cancel }
}
