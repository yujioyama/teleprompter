import { SubtitleCue } from '../utils/subtitleCues'

export interface SubtitleSample {
  label: string
  cue: SubtitleCue
}

// Set side by side when choosing the default subtitle position: cues grow
// up and down from the position, so it has to suit both the shortest cue
// and the tallest one (three lines in each language, the layout maximum).
export const SUBTITLE_SAMPLES: SubtitleSample[] = [
  {
    label: '短い字幕',
    cue: { id: 'sample-short', start: 0, end: 1, en: "Let's get started!", ja: 'さあ、始めましょう！' },
  },
  {
    label: '長い字幕',
    cue: {
      id: 'sample-long',
      start: 0,
      end: 1,
      en: 'Today I want to share three simple habits that completely changed my mornings.',
      ja: '今日は、私の朝をがらっと変えてくれた、シンプルな三つの習慣について紹介したいと思います。',
    },
  },
]
