import type { SubtitleCue } from './subtitleCues'
import { stripEmphasis } from './subtitleEmphasis'

// Claude sends the Japanese lines back through the connector under an id
// the app can work out again from the English alone (api/subtitles.ts).

/**
 * FNV-1a over the English lines (emphasis stripped, as the prompt shows
 * them), plus the line count the server checks Claude's lines against. The
 * same English always gives the same id, so the lines are still found after
 * the page reloads; edited English gives a new one, so they never land on
 * lines they weren't written for.
 */
export function subtitleRequestId(cues: SubtitleCue[]): string {
  const text = cues.map(cue => stripEmphasis(cue.en)).join('\n')
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${(hash >>> 0).toString(36)}-${cues.length}`
}

function auth(key: string) {
  return { Authorization: `Bearer ${key}` }
}

function url(requestId: string) {
  return `/api/subtitles?id=${encodeURIComponent(requestId)}`
}

/** The lines Claude sent for the request, or null while none have arrived. */
export async function fetchSubtitles(key: string, requestId: string): Promise<string[] | null> {
  const res = await fetch(url(requestId), { headers: auth(key), cache: 'no-store' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Subtitles request failed: ${res.status}`)
  const data = (await res.json()) as { lines?: unknown } | null
  return Array.isArray(data?.lines) ? (data.lines as string[]) : null
}

export async function deleteSubtitles(key: string, requestId: string): Promise<void> {
  const res = await fetch(url(requestId), { method: 'DELETE', headers: auth(key) })
  if (!res.ok) throw new Error(`Subtitles delete failed: ${res.status}`)
}
