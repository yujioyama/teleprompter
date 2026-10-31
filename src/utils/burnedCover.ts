import { clampCoverFrameCount, insertCoverFrames, type CoverFramePlacement, type CoverFramesProgress } from './coverFrames'
import type { BurnCover, BurnedVideo } from './shotEncoding'
import { coverLeadSeconds } from './webcodecs/coverLead'
import { joinVideoAndAudio, reLeadAudio } from './webcodecs/finalAudio'

/** The cover frames the export is set to put in. */
export interface CoverChoice {
  image: Blob | null
  placement: CoverFramePlacement
  count: number
}

/** Whether two blobs hold the same bytes: a cover drawn again the same way is the same cover. */
export async function sameBytes(a: Blob, b: Blob): Promise<boolean> {
  if (a === b) return true
  if (a.size !== b.size) return false
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()])
  const u = new Uint8Array(x)
  const v = new Uint8Array(y)
  for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return false
  return true
}

/**
 * The finished video (`finished`, whose burn put `was` in ahead of the
 * first shot) with the cover frames `choice` asks for instead. The shots
 * are burned again with the new cover or none (`reburn`: only the first
 * shot is encoded again, the rest come from the cache) and the finished
 * audio is joined back on, its leading silence changed when the frames'
 * length did. Nothing is mixed or finished again. `finished` itself when
 * the choice is the cover already in.
 */
export async function swapBurnedCover(
  finished: Blob,
  was: BurnCover,
  choice: CoverChoice,
  reburn: (cover?: BurnCover) => Promise<BurnedVideo>,
  onProgress?: (progress: CoverFramesProgress) => void,
): Promise<Blob> {
  const count = clampCoverFrameCount(choice.count)
  const first = choice.placement === 'first' && choice.image ? { image: choice.image, count } : null
  if (first && first.count === was.count && (await sameBytes(first.image, was.image))) return finished
  const burned = await reburn(first ?? undefined)
  if (burned.cover !== (first !== null)) throw new Error('the cover could not go in with the first shot')
  const from = coverLeadSeconds(was.count)
  const to = first ? coverLeadSeconds(first.count) : 0
  const audio = from === to ? finished : await reLeadAudio(finished, from, to)
  const video = await joinVideoAndAudio(burned.blob, audio)
  return choice.placement === 'last' && choice.image
    ? insertCoverFrames(video, choice.image, 'last', count, onProgress)
    : video
}
