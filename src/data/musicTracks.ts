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
  {
    id: 'lofi-midnight-club',
    title: 'Lofi Midnight Club',
    genre: 'lofi',
    credit: 'alex-morgan (Pixabay)',
    file: 'music/lofi-02-midnight-club.mp3',
  },
  {
    id: 'lofi-restaurant',
    title: 'Lofi Restaurant',
    genre: 'lofi',
    credit: 'alex-morgan (Pixabay)',
    file: 'music/lofi-03-restaurant.mp3',
  },
  {
    id: 'lofi-coffee-shop',
    title: 'Lofi Coffee Shop',
    genre: 'lofi',
    credit: 'alex-morgan (Pixabay)',
    file: 'music/lofi-04-coffee-shop.mp3',
  },
  {
    id: 'lofi-tokyo',
    title: 'Tokyo Lofi',
    genre: 'lofi',
    credit: 'ZephiraMusic (Pixabay)',
    file: 'music/lofi-05-tokyo.mp3',
  },
  {
    id: 'pop-upbeat',
    title: 'Pop Upbeat',
    genre: 'pop',
    credit: 'JonasBlakewood (Pixabay)',
    file: 'music/pop-02-upbeat.mp3',
  },
  {
    id: 'pop-happy-upbeat-mood',
    title: 'Happy Pop Upbeat Mood',
    genre: 'pop',
    credit: 'LightBeatsMusic (Pixabay)',
    file: 'music/pop-03-happy-mood.mp3',
  },
  {
    id: 'pop-future-upbeat',
    title: 'Future Pop Upbeat',
    genre: 'pop',
    credit: 'JonasBlakewood (Pixabay)',
    file: 'music/pop-04-future-pop.mp3',
  },
  {
    id: 'pop-upbeat-music',
    title: 'Upbeat Pop Music',
    genre: 'pop',
    credit: 'ikoliks_aj (Pixabay)',
    file: 'music/pop-05-upbeat-music.mp3',
  },
  {
    id: 'cinematic-emotional',
    title: 'Cinematic Emotional',
    genre: 'cinematic',
    credit: 'leberch (Pixabay)',
    file: 'music/cinematic-02-emotional.mp3',
  },
  {
    id: 'cinematic-orchestra-piano',
    title: 'Emotional Cinematic Orchestra Piano',
    genre: 'cinematic',
    credit: 'echoes_of_lumen (Pixabay)',
    file: 'music/cinematic-03-orchestra-piano.mp3',
  },
  {
    id: 'cinematic-inspiring',
    title: 'Inspiring Cinematic Music',
    genre: 'cinematic',
    credit: 'Tunetank (Pixabay)',
    file: 'music/cinematic-04-inspiring.mp3',
  },
  {
    id: 'cinematic-piano-strings-loop',
    title: 'Piano Strings - Emotional Cinematic Music Loop',
    genre: 'cinematic',
    credit: 'Sonican (Pixabay)',
    file: 'music/cinematic-05-piano-strings-loop.mp3',
  },
  {
    id: 'corporate-motivational',
    title: 'Corporate Motivational',
    genre: 'corporate',
    credit: 'AlexGrohl (Pixabay)',
    file: 'music/corporate-02-motivational.mp3',
  },
  {
    id: 'corporate-explainer-video',
    title: 'Corporate Motivational Explainer Video',
    genre: 'corporate',
    credit: 'alex-morgan (Pixabay)',
    file: 'music/corporate-03-explainer-video.mp3',
  },
  {
    id: 'corporate-advertising',
    title: 'Corporate Motivational Advertising Music',
    genre: 'corporate',
    credit: 'alex-morgan (Pixabay)',
    file: 'music/corporate-04-advertising.mp3',
  },
  {
    id: 'corporate-vlog-theme',
    title: 'Corporate Motivational Vlog Theme',
    genre: 'corporate',
    credit: 'echoes_of_lumen (Pixabay)',
    file: 'music/corporate-05-vlog-theme.mp3',
  },
]
