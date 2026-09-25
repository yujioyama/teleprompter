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

// Sourced from Pixabay Music (pixabay.com/music), used under the Pixabay
// Content License (free to use, no attribution required, modification
// allowed) — see https://pixabay.com/service/license-summary/.
// `credit` is not currently rendered anywhere in the UI; kept for reference.
export const MUSIC_TRACKS: MusicTrack[] = [
  {
    id: 'lofi-sunny-cafe',
    title: 'Lofi Sunny Cafe',
    genre: 'lofi',
    credit: 'alex-morgan (Pixabay)',
    file: 'music/lofi-01-sunny-cafe.mp3',
  },
  {
    id: 'summer-pop',
    title: 'Summer Pop',
    genre: 'pop',
    credit: 'The_Mountain (Pixabay)',
    file: 'music/pop-01-summer-pop.mp3',
  },
  {
    id: 'cinematic-emotional-rise',
    title: 'Cinematic Emotional Rise Score',
    genre: 'cinematic',
    credit: 'alex-morgan (Pixabay)',
    file: 'music/cinematic-01-emotional-rise.mp3',
  },
  {
    id: 'corporate-motivational-presentation',
    title: 'Corporate Motivational Presentation Music',
    genre: 'corporate',
    credit: 'alex-morgan (Pixabay)',
    file: 'music/corporate-01-presentation.mp3',
  },
]
