import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny'

/** A video's frames, decoded one at a time on request. */
export interface VideoStills {
  /** Seconds. */
  duration: number
  /** At the video's size, holding the frame last shown. */
  canvas: HTMLCanvasElement
  /** Draw the frame at `time` onto `canvas`; false when there is none there. */
  show(time: number): Promise<boolean>
  dispose(): void
}

/**
 * Open `video` for still frames without a <video> player: each frame is
 * decoded on request (WebCodecs) and the decoder goes away with it, so the
 * page's own preview can keep playing next to it — iOS stops decoding once
 * a few players are live at once (issue #12).
 */
export async function openVideoStills(video: Blob): Promise<VideoStills> {
  const input = new Input({ source: new BlobSource(video), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('the video has no picture')
    const duration = await track.computeDuration()
    const sink = new VideoSampleSink(track)
    const canvas = document.createElement('canvas')
    canvas.width = track.displayWidth
    canvas.height = track.displayHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    return {
      duration,
      canvas,
      async show(time) {
        const sample = await sink.getSample(time)
        if (!sample) return false
        try {
          sample.draw(ctx, 0, 0, canvas.width, canvas.height)
        } finally {
          sample.close()
        }
        return true
      },
      dispose() {
        input.dispose()
        canvas.width = 0
        canvas.height = 0
      },
    }
  } catch (err) {
    input.dispose()
    throw err
  }
}
