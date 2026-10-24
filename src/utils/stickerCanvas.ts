import { EMOJI_FONT_FAMILY, STICKER_EMOJI_PX, STICKER_OUTLINE_PX } from './subtitleSticker'

/** A square canvas `size` px wide with a 2D context. */
export function squareCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  return { canvas, ctx }
}

/**
 * The emoji, big, with a white die-cut border, on a transparent square
 * canvas, all `resolution` times its normal size. The border is the emoji's
 * own silhouette in white, stamped in a ring around it, so it follows the
 * shape rather than being a box.
 */
export function dieCutSticker(emoji: string, resolution: number): HTMLCanvasElement {
  const outline = STICKER_OUTLINE_PX * resolution
  const size = Math.ceil(STICKER_EMOJI_PX * resolution * 1.3 + outline * 2)
  const center = size / 2

  const glyph = squareCanvas(size)
  glyph.ctx.font = `${STICKER_EMOJI_PX * resolution}px ${EMOJI_FONT_FAMILY}`
  glyph.ctx.textAlign = 'center'
  glyph.ctx.textBaseline = 'middle'
  glyph.ctx.fillText(emoji, center, center)

  const silhouette = squareCanvas(size)
  silhouette.ctx.drawImage(glyph.canvas, 0, 0)
  silhouette.ctx.globalCompositeOperation = 'source-in'
  silhouette.ctx.fillStyle = '#ffffff'
  silhouette.ctx.fillRect(0, 0, size, size)

  const sticker = squareCanvas(size)
  const steps = 24
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    sticker.ctx.drawImage(silhouette.canvas, Math.cos(a) * outline, Math.sin(a) * outline)
  }
  sticker.ctx.drawImage(glyph.canvas, 0, 0)

  for (const c of [glyph.canvas, silhouette.canvas]) {
    c.width = 0
    c.height = 0
  }
  return sticker.canvas
}
