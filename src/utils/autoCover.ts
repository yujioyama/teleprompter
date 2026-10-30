import {
  COVER_HEIGHT,
  COVER_WIDTH,
  canvasToPng,
  coverStartTime,
  drawCover,
  type CoverWords,
  type PlacedSticker,
} from './coverImage'
import { openVideoStills } from './videoStills'

/**
 * The cover カバー画像を作る starts out with, made without opening it: the
 * words and the sticker over the frame it starts on, as a PNG. The export
 * puts this in as the cover frames until the cover is changed there.
 */
export async function makeCover(
  video: Blob,
  words: CoverWords,
  position: number,
  sticker: PlacedSticker,
): Promise<Blob> {
  const stills = await openVideoStills(video)
  const canvas = document.createElement('canvas')
  try {
    if (!(await stills.show(coverStartTime(stills.duration)))) throw new Error('no frame to make the cover from')
    canvas.width = COVER_WIDTH
    canvas.height = COVER_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    drawCover(ctx, stills.canvas, stills.canvas.width, stills.canvas.height, words, position, sticker)
    return await canvasToPng(canvas)
  } finally {
    stills.dispose()
    canvas.width = 0
    canvas.height = 0
  }
}
