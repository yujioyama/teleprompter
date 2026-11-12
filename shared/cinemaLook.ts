/**
 * The film looks the opening can wear under its black bars (2026-11-03).
 * Only the subtitle step picks one (2026-11-06): every script starts on
 * Hollywood, and Claude no longer sends a look with a script.
 */
export const CINEMA_LOOKS = ['hollywood', 'oldFilm', 'nightBlue', 'mono', 'glitch'] as const

export type CinemaLook = (typeof CINEMA_LOOKS)[number]

export const CINEMA_LOOK_LABELS: Record<CinemaLook, string> = {
  hollywood: 'ハリウッド風',
  oldFilm: '昔のフィルム',
  nightBlue: '夜の青',
  mono: '白黒',
  glitch: 'グリッチ',
}

/** What a script stores: a look picked on screen, or なし picked on screen. */
export type StoredCinemaLook = CinemaLook | 'none'

/** The film look a script wears: Hollywood until another is picked; null = the picture as shot. */
export function filmLookOf(stored: StoredCinemaLook | undefined): CinemaLook | null {
  if (stored === 'none') return null
  return stored ?? 'hollywood'
}
