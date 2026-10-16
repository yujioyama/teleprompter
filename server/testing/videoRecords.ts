import type { VideoRecord } from '../../shared/videoRecord.js'

/** A record as the app sends it, for the server tests. */
export function sampleRecord(changes: Partial<VideoRecord> = {}): VideoRecord {
  return {
    scriptId: 'script-1',
    title: 'Vaseline',
    hookLine: 'I put Vaseline on my eyebrows every night.',
    savedAt: '2026-10-16T09:00:00.000Z',
    durationSec: 71.4,
    shotCount: 12,
    effects: {
      hookStyle: true,
      hookPosition: 22.5,
      zoom: { scale: 1.25, direction: 'out', at: 0.4, duration: 1.2 },
      sticker: { emoji: '🧴', placement: 'right', motion: 'random' },
      fairies: { enabled: true, cameoEmojis: ['🪞'], finale: true },
      subtitles: { burned: true, japanese: true },
      bgm: { trackId: 'lofi-tokyo', title: 'Tokyo Lo-fi', volume: 0.3 },
      voicePreset: 'natural',
      trim: { firstStart: 0.05, start: 0.1, end: 0.2, lastEnd: 0.1, pauseShots: 1 },
    },
    ...changes,
  }
}
