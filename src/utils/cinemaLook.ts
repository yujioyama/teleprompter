import type { CinemaLook } from '../../shared/cinemaLook'
import { random as rng } from './seededRandom'

/**
 * The math of the film looks (2026-11-03), ported from the comparison page
 * the looks were picked on (docs/superpowers/specs/2026-11-03-cinema-looks-
 * reference.html) at full strength and vignette 0.6. Nothing here draws on a
 * canvas: the preview and the burn both call these, so they agree.
 */

type ColorLook = Exclude<CinemaLook, 'glitch'>

/** Grain laid over each look, 0 = none (the reference's `grain`). */
export const LOOK_GRAIN: Record<CinemaLook, number> = { hollywood: 0, oldFilm: 1, nightBlue: 0.25, mono: 0.5, glitch: 0 }

export const LOOK_HAS_DUST = (look: CinemaLook): boolean => look === 'oldFilm'

/** The reference's reference size; every pixel length in it is relative to this width. */
const REFERENCE_WIDTH = 540

const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const sCurve = (x: number, c: number) => x + c * (x * x * (3 - 2 * x) - x)
const saturate = (r: number, g: number, b: number, s: number): [number, number, number] => {
  const L = luma(r, g, b)
  return [L + (r - L) * s, L + (g - L) * s, L + (b - L) * s]
}

/** One color look at full strength: r, g, b in 0-1 in and out. */
export function lookColor(look: ColorLook, r: number, g: number, b: number): [number, number, number] {
  switch (look) {
    case 'hollywood': {
      ;[r, g, b] = saturate(r, g, b, 0.85)
      const L = luma(r, g, b)
      const sh = (1 - L) ** 2
      const hi = L * L
      r += -0.12 * sh + 0.11 * hi
      g += 0.03 * sh + 0.03 * hi
      b += 0.12 * sh - 0.1 * hi
      return [sCurve(clamp(r), 0.4), sCurve(clamp(g), 0.4), sCurve(clamp(b), 0.4)]
    }
    case 'oldFilm': {
      ;[r, g, b] = saturate(r, g, b, 0.55)
      const L = luma(r, g, b)
      const sh = (1 - L) ** 2
      r += 0.08
      g += 0.04 + 0.03 * sh
      b -= 0.1
      // Flatter, with the blacks lifted: old prints lost their contrast.
      const lift = 0.15
      const top = 0.9
      const f = (x: number) => lift + sCurve(clamp(x), -0.15) * (top - lift)
      return [f(r), f(g), f(b)]
    }
    case 'nightBlue': {
      ;[r, g, b] = saturate(r, g, b, 0.55)
      const L = luma(r, g, b)
      const sh = (1 - L) ** 2
      r += -0.06 - 0.03 * sh
      g += 0.005
      b += 0.07 + 0.05 * sh
      const f = (x: number) => sCurve(clamp(x), 0.45) ** 1.2
      return [f(r), f(g), f(b)]
    }
    case 'mono': {
      const m = sCurve(clamp(luma(r, g, b)), 0.5)
      return [m, m, m]
    }
  }
}

/**
 * A look baked into a 3D table, so a frame costs one lookup per pixel and
 * not the math: a grid of `size`³ colors, 0-255, r varying slowest.
 */
export interface Lut {
  size: number
  table: Float32Array
}

const LUT_SIZE = 33

const lutCache = new Map<ColorLook, Lut>()

export function buildLut(look: ColorLook): Lut {
  const cached = lutCache.get(look)
  if (cached) return cached
  const n = LUT_SIZE
  const table = new Float32Array(n * n * n * 3)
  let o = 0
  for (let ri = 0; ri < n; ri++) {
    for (let gi = 0; gi < n; gi++) {
      for (let bi = 0; bi < n; bi++) {
        const [r, g, b] = lookColor(look, ri / (n - 1), gi / (n - 1), bi / (n - 1))
        table[o++] = clamp(r) * 255
        table[o++] = clamp(g) * 255
        table[o++] = clamp(b) * 255
      }
    }
  }
  const lut = { size: n, table }
  lutCache.set(look, lut)
  return lut
}

/** Trilinear lookup of (r, g, b) 0-255 into `out` at `o`, 0-255 unrounded. */
function sampleLut(lut: Lut, r: number, g: number, b: number, out: Float32Array | Uint8ClampedArray, o: number, scale: number): void {
  const { size, table } = lut
  const m = size - 1
  const fr = (r / 255) * m
  const fg = (g / 255) * m
  const fb = (b / 255) * m
  const r0 = Math.min(m - 1, Math.floor(fr))
  const g0 = Math.min(m - 1, Math.floor(fg))
  const b0 = Math.min(m - 1, Math.floor(fb))
  const tr = fr - r0
  const tg = fg - g0
  const tb = fb - b0
  const base = ((r0 * size + g0) * size + b0) * 3
  const dr = size * size * 3
  const dg = size * 3
  for (let c = 0; c < 3; c++) {
    const i = base + c
    const c00 = table[i] + (table[i + 3] - table[i]) * tb
    const c01 = table[i + dg] + (table[i + dg + 3] - table[i + dg]) * tb
    const c10 = table[i + dr] + (table[i + dr + 3] - table[i + dr]) * tb
    const c11 = table[i + dr + dg] + (table[i + dr + dg + 3] - table[i + dr + dg]) * tb
    const c0 = c00 + (c01 - c00) * tg
    const c1 = c10 + (c11 - c10) * tg
    out[o + c] = (c0 + (c1 - c0) * tr) * scale
  }
}

/** The look through its table: r, g, b 0-255 in and out. */
export function lutApply(lut: Lut, r: number, g: number, b: number): [number, number, number] {
  const out = new Float32Array(3)
  sampleLut(lut, r, g, b, out, 0, 1)
  return [out[0], out[1], out[2]]
}

const vignetteCache = new Map<string, Float32Array>()
/** The preview's size and the output's; a few more is plenty. */
const VIGNETTE_CACHE_MAX = 4

/**
 * How much of the picture is kept at each pixel (row by row): 1 in the
 * middle, 1 − 0.6 × 0.75 in the far corners. The ellipse is centered a
 * little above the middle (0.45), where the face is.
 */
export function vignetteMask(width: number, height: number): Float32Array {
  const key = `${width}x${height}`
  const cached = vignetteCache.get(key)
  if (cached) return cached
  const m = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const dy = (y - height * 0.45) / (height / 2)
    for (let x = 0; x < width; x++) {
      const dx = (x - width / 2) / (width / 2)
      const d = Math.sqrt(dx * dx + dy * dy * 0.85)
      m[y * width + x] = 1 - 0.6 * 0.75 * smooth(0.35, 1.3, d)
    }
  }
  if (vignetteCache.size >= VIGNETTE_CACHE_MAX) vignetteCache.delete(vignetteCache.keys().next().value!)
  vignetteCache.set(key, m)
  return m
}

/**
 * The table gradePixels reads: the look at every 2nd value of r, g and b
 * (128³, sampled from `lut` at each cell's middle), one packed r | g << 8 |
 * b << 16 per cell. A frame is then one lookup per pixel, not a trilinear
 * blend (which cost ~33 ns a pixel); the table stays within 2/255 of the look.
 */
const FAST_BITS = 7
const FAST_SHIFT = 8 - FAST_BITS

function buildFastTable(lut: Lut): Uint32Array {
  const n = 1 << FAST_BITS
  const table = new Uint32Array(n * n * n)
  const mid = (1 << FAST_SHIFT) / 2 - 0.5
  const rgb = new Float32Array(3)
  let o = 0
  for (let r = 0; r < n; r++) {
    for (let g = 0; g < n; g++) {
      for (let b = 0; b < n; b++) {
        sampleLut(lut, (r << FAST_SHIFT) + mid, (g << FAST_SHIFT) + mid, (b << FAST_SHIFT) + mid, rgb, 0, 1)
        table[o++] = Math.round(rgb[0]) | (Math.round(rgb[1]) << 8) | (Math.round(rgb[2]) << 16)
      }
    }
  }
  return table
}

/** 8 MB each, and a video wears one look: keep the latest two. */
const fastTables = new Map<Lut, Uint32Array>()

function fastTableFor(lut: Lut): Uint32Array {
  const cached = fastTables.get(lut)
  if (cached) return cached
  if (fastTables.size >= 2) fastTables.delete(fastTables.keys().next().value!)
  const table = buildFastTable(lut)
  fastTables.set(lut, table)
  return table
}

/** In place: each pixel through the look, then darkened by the vignette. Alpha is left alone. */
export function gradePixels(data: Uint8ClampedArray, width: number, height: number, lut: Lut, mask: Float32Array): void {
  const table = fastTableFor(lut)
  const count = width * height
  const gShift = FAST_BITS
  const rShift = 2 * FAST_BITS
  for (let p = 0, i = 0; p < count; p++, i += 4) {
    const v = table[((data[i] >> FAST_SHIFT) << rShift) | ((data[i + 1] >> FAST_SHIFT) << gShift) | (data[i + 2] >> FAST_SHIFT)]
    const m = mask[p]
    data[i] = (v & 255) * m
    data[i + 1] = ((v >> 8) & 255) * m
    data[i + 2] = ((v >> 16) & 255) * m
  }
}

export interface GlitchBand {
  /** First row, and how many rows the band tears. */
  y0: number
  h: number
  /** Pixels it is shifted sideways. */
  dx: number
  /** 0: none, 1: magenta, 2: cyan. */
  tint: 0 | 1 | 2
}

/** What a step's glitch tears, rolled once per step so only the tearing jumps. */
export interface GlitchParams {
  /** Pixels red and blue are pulled apart. */
  split: number
  bands: GlitchBand[]
}

/** Glitch lengths are the reference's at 540 wide, scaled to `width`. */
export function glitchParams(step: number, width: number, height: number): GlitchParams {
  const scale = width / REFERENCE_WIDTH
  const rand = rng(1000 + step)
  const split = Math.round((6 + rand() * 10) * scale)
  const count = 3 + Math.floor(rand() * 4)
  const bands: GlitchBand[] = []
  for (let i = 0; i < count; i++) {
    const y0 = Math.floor(rand() * height)
    const h = Math.round((6 + Math.floor(rand() * 70)) * scale)
    const dx = Math.round((rand() - 0.5) * 120 * scale)
    const tint = Math.floor(rand() * 3) as 0 | 1 | 2
    bands.push({ y0, h, dx, tint })
  }
  return { split, bands }
}

/**
 * The broken-TV look drawn from `src` (RGBA) into `out`: red and blue pulled
 * apart, bands torn sideways and tinted, colors pushed, scanlines, and the
 * vignette. `params` come from glitchParams, but `src` can be any frame.
 */
export function glitchPixels(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  params: GlitchParams,
  mask: Float32Array,
): void {
  const scale = width / REFERENCE_WIDTH
  const shift = new Int32Array(height)
  const tint = new Uint8Array(height)
  for (const { y0, h, dx, tint: t } of params.bands) {
    for (let y = Math.max(0, y0); y < Math.min(height, y0 + h); y++) {
      shift[y] = dx
      tint[y] = t
    }
  }
  const { split } = params
  const lastX = width - 1
  const px = (x: number) => (x < 0 ? 0 : x > lastX ? lastX : x)
  // Inlined, with no per-pixel arrays: this runs on every pixel of every frame.
  const inv = 1 / 255
  const sat = 1.6
  for (let y = 0; y < height; y++) {
    const row = y * width
    // Every other 2 px (at 540 wide) line is dimmed.
    const line = Math.floor(y / (2 * scale)) & 1 ? 1 - 0.22 : 1
    const addR = tint[y] === 1 ? 0.25 : 0
    const addG = tint[y] === 2 ? 0.25 : 0
    const addB = tint[y] === 0 ? 0 : 0.3
    const dx = shift[y]
    for (let x = 0; x < width; x++) {
      const sx = x + dx
      const r0 = src[(row + px(sx + split)) * 4] * inv
      const g0 = src[(row + px(sx)) * 4 + 1] * inv
      const b0 = src[(row + px(sx - split)) * 4 + 2] * inv
      const L = 0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0
      // L + (c - L) × 1.6, folded
      const lum = L * (1 - sat)
      let r = r0 * sat + lum + addR
      let g = g0 * sat + lum + addG
      let b = b0 * sat + lum + addB
      r = r < 0 ? 0 : r > 1 ? 1 : r
      g = g < 0 ? 0 : g > 1 ? 1 : g
      b = b < 0 ? 0 : b > 1 ? 1 : b
      const v = mask[row + x] * line * 255
      const i = (row + x) * 4
      // sCurve(x, 0.3) as a polynomial; it stays within 0-1, so only the vignette scales it.
      out[i] = r * (0.7 + r * (0.9 - 0.6 * r)) * v
      out[i + 1] = g * (0.7 + g * (0.9 - 0.6 * g)) * v
      out[i + 2] = b * (0.7 + b * (0.9 - 0.6 * b)) * v
      out[i + 3] = 255
    }
  }
}

export const GRAIN_WIDTH = 270
export const GRAIN_HEIGHT = 480

/**
 * Film grain: mid-gray noise, always 270×480 whatever the frame's size, so
 * it clumps like film's when scaled up. The same noise for the same `frame`.
 */
export function grainNoise(frame: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(GRAIN_WIDTH * GRAIN_HEIGHT * 4)
  const rand = rng(100 + frame)
  for (let i = 0; i < out.length; i += 4) {
    const v = 128 + (rand() + rand() + rand() - 1.5) * 150
    out[i] = out[i + 1] = out[i + 2] = v
    out[i + 3] = 255
  }
  return out
}

/** One bit of dust on the old film; `style` is a CSS color. */
export type DustSpec =
  | { kind: 'speck'; x: number; y: number; rx: number; ry: number; rotation: number; style: string }
  | { kind: 'hair'; x: number; y: number; /** Size of the curl, 1 at 540 wide. */ size: number; lineWidth: number; style: string }
  | { kind: 'scratch'; x: number; /** Where it ends at the bottom. */ x2: number; lineWidth: number; style: string }

/** The dust of one frame: dark and pale specks, two hairs, and a scratch or two. */
export function dustSpecs(frame: number, width: number, height: number): DustSpec[] {
  const scale = width / REFERENCE_WIDTH
  const rand = rng(500 + frame)
  const specs: DustSpec[] = []
  for (let i = 0; i < 26; i++) {
    const style = rand() < 0.7 ? `rgba(20,14,8,${0.35 + rand() * 0.4})` : `rgba(255,250,235,${0.3 + rand() * 0.4})`
    const x = rand() * width
    const y = rand() * height
    const rx = (0.8 + rand() * 2.6) * scale
    const ry = (0.8 + rand() * 2.2) * scale
    specs.push({ kind: 'speck', x, y, rx, ry, rotation: rand() * 3, style })
  }
  for (let i = 0; i < 2; i++) {
    const style = `rgba(20,14,8,${0.25 + rand() * 0.3})`
    specs.push({ kind: 'hair', x: rand() * width, y: rand() * height, size: scale, lineWidth: 0.8 * scale, style })
  }
  for (let i = 0, n = 1 + Math.floor(rand() * 2); i < n; i++) {
    const style = `rgba(245,240,225,${0.25 + rand() * 0.25})`
    const lineWidth = (1 + rand()) * scale
    const x = rand() * width
    specs.push({ kind: 'scratch', x, x2: x + (rand() - 0.5) * 8 * scale, lineWidth, style })
  }
  return specs
}

/** Grain and glitch change about 12 times a second, as on film. */
export function lookStep(t: number): number {
  return Math.floor(t * 12)
}
