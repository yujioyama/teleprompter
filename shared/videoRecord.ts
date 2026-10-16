import { z } from 'zod'

// How a saved video was made, so the weekly analysis can tell which videos
// used which opening and pacing. The app sends one on 保存する; Claude reads
// them through the connector (list_video_records).
export const videoRecordSchema = z.object({
  scriptId: z.string().min(1).max(100),
  title: z.string().max(200),
  /** Line 1 as heard: no *emphasis* markers, no emoji (the Obsidian `hook`). */
  hookLine: z.string().max(1_000),
  /** ISO timestamp of the save. */
  savedAt: z.string().max(40),
  durationSec: z.number().nonnegative(),
  shotCount: z.number().int().nonnegative(),
  effects: z.object({
    hookStyle: z.boolean(),
    /** 0-100, where the hook cues are centered. */
    hookPosition: z.number(),
    /** The first shot's zoom; null = off. */
    zoom: z
      .object({
        scale: z.number(),
        direction: z.enum(['in', 'out']),
        at: z.number(),
        duration: z.number().nullable(),
      })
      .nullable(),
    /** The first shot's sticker; null = none shown. */
    sticker: z.object({ emoji: z.string().max(40), placement: z.string().max(20), motion: z.string().max(20) }).nullable(),
    fairies: z.object({ enabled: z.boolean(), cameoEmojis: z.array(z.string().max(40)).max(20), finale: z.boolean() }),
    subtitles: z.object({ burned: z.boolean(), japanese: z.boolean() }),
    bgm: z.object({ trackId: z.string().max(100), title: z.string().max(200), volume: z.number() }).nullable(),
    voicePreset: z.string().max(20),
    /** The cuts the 結合 was made with; null for a 結合 from before they were kept. */
    trim: z
      .object({
        firstStart: z.number(),
        start: z.number(),
        end: z.number(),
        lastEnd: z.number(),
        /** How many shots had 間を残す on. */
        pauseShots: z.number().int().nonnegative(),
      })
      .nullable(),
    /** Peaks drifted in and the punchline punched in (中盤のズーム); absent on records from before it. */
    midZoom: z.boolean().optional(),
  }),
})

export type VideoRecord = z.infer<typeof videoRecordSchema>
export type TrimRecord = NonNullable<VideoRecord['effects']['trim']>

export function parseVideoRecord(value: unknown): VideoRecord | null {
  const result = videoRecordSchema.safeParse(value)
  return result.success ? result.data : null
}
