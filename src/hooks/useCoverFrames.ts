import { useEffect, useState } from 'react'
import { insertCoverFrames, type CoverFramePlacement, type CoverFramesProgress } from '../utils/coverFrames'
import { useObjectUrl } from './useObjectUrl'

export type CoverFramesState = 'idle' | 'inserting' | 'failed'

interface Covered {
  blob: Blob | null
  state: CoverFramesState
  /** While inserting the slow way (re-encoding the whole video); null otherwise. */
  progress: CoverFramesProgress | null
}

/** What an insert was asked for, so its result is only used for those. */
interface Request {
  video: Blob
  image: Blob
  placement: CoverFramePlacement
  count: number
}

const NOTHING: Covered = { blob: null, state: 'idle', progress: null }
const INSERTING: Covered = { blob: null, state: 'inserting', progress: null }

// One insert at a time: each holds a whole copy of the video, more than an
// iPhone can spare twice over when the settings are changed quickly.
let queue: Promise<unknown> = Promise.resolve()

/**
 * The export's video with the cover image put in as frames of its own (see
 * insertCoverFrames): `video` itself when there's no image or the
 * placement is `none`, so the output is then exactly what it was without
 * this step. Null while `video` is, and while the frames go in. If that
 * fails, `video` is still there to save without them, and `state` says so.
 */
export function useCoverFrames(
  video: Blob | null,
  image: Blob | null,
  placement: CoverFramePlacement,
  count: number,
) {
  const [inserted, setInserted] = useState<{ request: Request; covered: Covered } | null>(null)

  useEffect(() => {
    if (!video || !image || placement === 'none') return
    const request: Request = { video, image, placement, count }
    let cancelled = false
    const settle = (covered: Covered) => {
      if (!cancelled) setInserted({ request, covered })
    }
    const onProgress = (progress: CoverFramesProgress) => settle({ blob: null, state: 'inserting', progress })
    // Skipped once superseded while waiting its turn.
    const run = queue.then(() => (cancelled ? null : insertCoverFrames(video, image, placement, count, onProgress)))
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
  }, [video, image, placement, count])

  // Worked out here rather than set by the effect, so no render ever
  // offers a video that isn't the one these inputs make.
  const current = inserted?.request
  const covered: Covered = !video
    ? NOTHING
    : !image || placement === 'none'
      ? { blob: video, state: 'idle', progress: null }
      : current &&
          current.video === video &&
          current.image === image &&
          current.placement === placement &&
          current.count === count
        ? inserted.covered
        : INSERTING
  const url = useObjectUrl(covered.blob)
  return { blob: covered.blob, url, state: covered.state, progress: covered.progress }
}
