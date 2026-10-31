import { useEffect, useState } from 'react'
import type { CoverFramesProgress } from '../utils/coverFrames'
import { useObjectUrl } from './useObjectUrl'

export type CoverFramesState = 'idle' | 'inserting' | 'failed'

/**
 * How the cover frames go into the export's video: e.g. insertCoverFrames
 * with the chosen image, or swapBurnedCover when the burn put a cover in.
 * A new object for each new choice: the hook tells choices apart by it.
 */
export interface CoverChange {
  run: (video: Blob, onProgress: (progress: CoverFramesProgress) => void) => Promise<Blob>
}

interface Covered {
  blob: Blob | null
  state: CoverFramesState
  /** While inserting the slow way (re-encoding the whole video); null otherwise. */
  progress: CoverFramesProgress | null
}

/** What an insert was asked for, so its result is only used for those. */
interface Request {
  video: Blob
  change: CoverChange
}

const NOTHING: Covered = { blob: null, state: 'idle', progress: null }
const INSERTING: Covered = { blob: null, state: 'inserting', progress: null }

// One insert at a time: each holds a whole copy of the video, more than an
// iPhone can spare twice over when the settings are changed quickly.
let queue: Promise<unknown> = Promise.resolve()

/**
 * The export's video with the cover frames put in by `change`: `video`
 * itself when there's no change to make, so the output is then exactly
 * what it was without this step. Null while `video` is, and while the
 * frames go in. If that fails, `video` is still there to save without
 * them, and `state` says so.
 */
export function useCoverFrames(video: Blob | null, change: CoverChange | null) {
  const [inserted, setInserted] = useState<{ request: Request; covered: Covered } | null>(null)

  useEffect(() => {
    if (!video || !change) return
    const request: Request = { video, change }
    let cancelled = false
    const settle = (covered: Covered) => {
      if (!cancelled) setInserted({ request, covered })
    }
    const onProgress = (progress: CoverFramesProgress) => settle({ blob: null, state: 'inserting', progress })
    // Skipped once superseded while waiting its turn.
    const run = queue.then(() => (cancelled ? null : change.run(video, onProgress)))
    queue = run.catch(() => {})
    run.then(
      blob => {
        if (blob) settle({ blob, state: 'idle', progress: null })
      },
      err => {
        if (cancelled) return
        console.warn('[useCoverFrames] inserting the cover frames failed:', err)
        settle({ blob: video, state: 'failed', progress: null })
      },
    )
    return () => {
      cancelled = true
    }
  }, [video, change])

  // Worked out here rather than set by the effect, so no render ever
  // offers a video that isn't the one these inputs make.
  const current = inserted?.request
  const covered: Covered = !video
    ? NOTHING
    : !change
      ? { blob: video, state: 'idle', progress: null }
      : current && current.video === video && current.change === change
        ? inserted.covered
        : INSERTING
  const url = useObjectUrl(covered.blob)
  return { blob: covered.blob, url, state: covered.state, progress: covered.progress }
}
