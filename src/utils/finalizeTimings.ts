/**
 * How long each part of finishing a video took this session, to find out
 * where the time actually goes on a phone (2026-11-19). Kept in memory only
 * and shown on the finalize page, where it can be copied out.
 *
 * Two kinds of entry: an encode the cache ran (in the background or while
 * someone waited), and a wait the user sat through (e.g. 焼き込む until the
 * burned video was ready).
 */

export interface EncodeTiming {
  type: 'encode'
  /** normalize, burn or burn-cover. */
  kind: string
  shotId: string
  /** Ran ahead in the background rather than while someone waited. */
  background: boolean
  /** Wall time from start to finish, held time included. */
  ms: number
  /** Of `ms`, how long the preview held it back (see encodeHold). */
  heldMs: number
  /** The clip's length in seconds, when known. */
  seconds: number | null
  ok: boolean
  at: number
}

export interface StepTiming {
  type: 'step'
  label: string
  ms: number
  /** Anything worth knowing next to the time, e.g. how many shots were already done. */
  note: string | null
  ok: boolean
  at: number
}

export type Timing = EncodeTiming | StepTiming

const MAX_ENTRIES = 300

let entries: Timing[] = []
const listeners = new Set<() => void>()

function add(entry: Timing): void {
  entries = [...entries, entry].slice(-MAX_ENTRIES)
  listeners.forEach(listener => listener())
}

export function recordEncode(entry: Omit<EncodeTiming, 'type' | 'at'>): void {
  add({ type: 'encode', at: Date.now(), ...entry })
}

/**
 * Run `work`, recording how long it took under `label`. `note` may be a
 * function, read once the work is done (e.g. which path it took).
 */
export async function timeStep<T>(label: string, work: () => Promise<T>, note?: string | (() => string | null)): Promise<T> {
  const start = performance.now()
  let ok = false
  try {
    const result = await work()
    ok = true
    return result
  } finally {
    add({
      type: 'step',
      label,
      ms: performance.now() - start,
      note: typeof note === 'function' ? note() : (note ?? null),
      ok,
      at: Date.now(),
    })
  }
}

export function getTimings(): Timing[] {
  return entries
}

export function subscribeTimings(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function clearTimings(): void {
  entries = []
  listeners.forEach(listener => listener())
}

function sec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function clock(at: number): string {
  const d = new Date(at)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
}

/** One line per entry, oldest first. */
export function formatTiming(t: Timing): string {
  const failed = t.ok ? '' : ' ✕失敗/中断'
  if (t.type === 'step') {
    return `${clock(t.at)} ${t.label} ${sec(t.ms)}${t.note ? ` (${t.note})` : ''}${failed}`
  }
  const working = t.ms - t.heldMs
  const speed = t.seconds && working > 0 ? ` 等速の${(t.seconds / (working / 1000)).toFixed(1)}倍` : ''
  const held = t.heldMs >= 50 ? ` うち停止${sec(t.heldMs)}` : ''
  const length = t.seconds !== null ? ` 長さ${t.seconds.toFixed(1)}s` : ''
  return `${clock(t.at)} エンコード[${t.kind}] ${t.shotId} ${t.background ? '先回り' : '待ち'} ${sec(t.ms)}${held}${length}${speed}${failed}`
}

/** Totals, then every entry: what the copy button puts on the clipboard. */
export function formatTimings(list: Timing[]): string {
  const encodes = list.filter((t): t is EncodeTiming => t.type === 'encode' && t.ok)
  const total = (pick: (t: EncodeTiming) => boolean) => encodes.filter(pick).reduce((sum, t) => sum + t.ms - t.heldMs, 0)
  const held = encodes.reduce((sum, t) => sum + t.heldMs, 0)
  const summary = [
    `エンコード合計 ${encodes.length}本: 実働${sec(total(() => true))}`,
    `(先回り${sec(total(t => t.background))} / 待ち${sec(total(t => !t.background))}, プレビューで停止${sec(held)})`,
  ].join(' ')
  return [summary, ...list.map(formatTiming)].join('\n')
}
