export type MusicGenre = 'lofi' | 'pop' | 'cinematic' | 'corporate'

export interface MusicTrack {
  id: string
  title: string
  genre: MusicGenre
  credit: string
  /** Path under public/, e.g. 'music/lofi-01.mp3' */
  file: string
}

export const GENRE_LABELS: Record<MusicGenre, string> = {
  lofi: 'Lo-fi / チル',
  pop: 'ポップ / アップビート',
  cinematic: '感動 / シネマチック',
  corporate: 'コーポレート / モチベーション',
}

// Populated in a follow-up once royalty-free tracks have been sourced and
// added under public/music/ — see docs/superpowers/specs/2026-09-23-video-finalize-design.md.
// The BGM section in FinalizePage does not render while this is empty.
export const MUSIC_TRACKS: MusicTrack[] = []
