import type { TrimRecord, VideoRecord } from '../../shared/videoRecord'
import type { Script } from '../types'
import { fairiesFromSubtitles } from './fairyPlan'
import { planMidZoom } from './midZoom'
import { takeLinesOf, type SubtitleCue } from './subtitleCues'
import { stripEmphasis } from './subtitleEmphasis'
import { styleCues, type HookOptions } from './subtitleHook'
import { stickerOf, stripStickers } from './subtitleSticker'
import type { VoicePreset } from './voicePreset'

/** What the subtitle burn of the saved video was made from. */
export interface BurnInputs {
  hook: HookOptions
  cues: SubtitleCue[]
  /** 0-100, where the normal subtitles are centered. */
  position: number
  /** Each shot's length in the 結合, in order. */
  durations: number[]
}

/** The BGM mixed into the saved video. */
export interface MixInputs {
  trackId: string
  title: string
  volume: number
}

const NO_FAIRIES = { enabled: false, cameoEmojis: [], finale: false }

/**
 * The record of a saved video, from the inputs each stage actually used:
 * the settings may have changed since (e.g. after the burn), and the zoom,
 * sticker and fairies only exist when subtitles were burned.
 */
export function buildVideoRecord(input: {
  script: Script
  savedAt: string
  durationSec: number
  shotCount: number
  burn: BurnInputs | null
  mix: MixInputs | null
  voicePreset: VoicePreset
  trim: TrimRecord | null
}): VideoRecord {
  const { script, burn, mix } = input
  return {
    scriptId: script.id,
    title: script.title,
    // A 一発撮り shot holds every line; line 1 is the hook.
    hookLine: stripStickers(stripEmphasis(takeLinesOf(script.shots[0]?.text ?? '')[0] ?? '')),
    savedAt: input.savedAt,
    durationSec: input.durationSec,
    shotCount: input.shotCount,
    effects: {
      hookStyle: burn?.hook.style ?? false,
      hookPosition: burn?.hook.position ?? 0,
      zoom: burn?.hook.punchIn
        ? {
            scale: burn.hook.punchIn.zoom,
            direction: burn.hook.punchIn.direction,
            at: burn.hook.punchIn.at,
            duration: burn.hook.punchIn.duration,
          }
        : null,
      sticker: burn ? stickerRecordOf(burn) : null,
      fairies: burn ? fairiesRecordOf(burn) : NO_FAIRIES,
      subtitles: { burned: burn !== null, japanese: burn?.cues.some(c => c.ja?.trim()) ?? false },
      bgm: mix ? { trackId: mix.trackId, title: mix.title, volume: mix.volume } : null,
      voicePreset: input.voicePreset,
      trim: input.trim,
      midZoom: burn ? planMidZoom(burn.cues, burn.durations, burn.hook).length > 0 : false,
      oneTake: Boolean(script.oneTake),
    },
  }
}

function stickerRecordOf({ hook, cues, durations }: BurnInputs): VideoRecord['effects']['sticker'] {
  if (!hook.sticker || hook.sticker === 'off') return null
  const emoji = stickerOf(styleCues(cues, durations[0] ?? null, hook.style))
  return emoji ? { emoji, placement: hook.sticker, motion: hook.stickerMotion ?? 'random' } : null
}

function fairiesRecordOf({ hook, cues, durations, position }: BurnInputs): VideoRecord['effects']['fairies'] {
  if (hook.fairies === false) return NO_FAIRIES
  const plan = fairiesFromSubtitles(cues, durations, hook, position)
  return {
    enabled: true,
    cameoEmojis: plan.filter(f => f.kind === 'cameo').map(f => f.emoji),
    finale: plan.some(f => f.kind === 'finale'),
  }
}
