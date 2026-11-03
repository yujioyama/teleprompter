/**
 * The film looks a Type A/B opening can wear under its black bars
 * (2026-11-03). Shared so the inbox can carry one with a script, and the
 * subtitle step can pick one.
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
