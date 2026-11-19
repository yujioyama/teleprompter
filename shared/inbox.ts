
/**
 * Which of the two daily formats a script is (from 2026-11-02): 'A' is the
 * short 2021-style daily thing, 'B' the expression-note story. It only labels
 * the video for the weekly comparison: every script gets the opening bars
 * (see withOpening).
 */
export type VideoType = 'A' | 'B'

/** An image Claude picked for one line of a script. */
export interface InboxImage {
  /** Which line of `body`, counting non-empty lines from 1. */
  line: number
  url: string
  /** Shown small under the image; absent when its license asks for none. */
  credit?: string
  /** The page it came from, for the caption's credit line. */
  source?: string
}

/** The caption with a line for each image whose license asks for a credit. */
export function captionWithCredits(caption: string, images: InboxImage[]): string {
  const credits = images.flatMap(image => (image.credit ? [`画像: ${[image.credit, image.source].filter(Boolean).join(' ')}`] : []))
  return [caption, credits.join('\n')].filter(Boolean).join('\n\n')
}

// A script Claude chat sent to the teleprompter, waiting in the inbox
// until a device turns it into a script (or it expires).
export interface InboxItem {
  id: string
  title: string
  /** One shot per line. */
  body: string
  /** TikTok caption; '' when none was sent. */
  caption: string
  /** The Japanese subtitles, one per non-empty line of `body`; absent when none were sent. */
  japanese?: string[]
  /** Type A or B; absent when Claude sent none. */
  videoType?: VideoType
  /** Images for some of the lines; absent when none were sent. */
  images?: InboxImage[]
  /**
   * 相手のセリフ: which lines of `body` (non-empty lines, from 1) the other
   * person says. Each line is then its own take (no 一発撮り). Absent when
   * the script is all one voice.
   */
  heard?: number[]
  /** The emoji shown beside the other person's subtitles; absent for the usual one. */
  heardIcon?: string
  /** The voice the other person's lines are given (see HEARD_VOICES); absent for the voice as spoken. */
  heardVoice?: string
  /** The other person's role, burned small beside their icon (e.g. "Hairdresser"); absent for the icon alone. */
  heardName?: string
  /**
   * A conversation with more than one other person: each one's lines, with
   * their own icon, voice and name (in place of heardIcon / heardVoice / heardName there).
   * Every line here is also in `heard`. Absent when there is one other person.
   */
  heardCast?: HeardCastMember[]
  /** A few words on where the conversation happens, over line 1 (e.g. "a wrong number"); absent for none. */
  scene?: string
  /** The words for the cover, in place of the script's `*…*` and `{…}` (a conversation has none); absent for those. */
  cover?: CoverText
  /**
   * 挿入カード: short full-screen cards between lines where time jumps
   * ("2 days later"). Each goes after line `afterLine`; they are not lines
   * themselves, so no line number moves. Absent for none.
   */
  cards?: InboxCard[]
  /**
   * 心の声: lines thought, not said (non-empty lines, from 1). Never also in
   * `heard`. Absent for none.
   */
  thought?: number[]
  /** ISO timestamp of when it arrived. */
  createdAt: string
}

/** The cover's two rows; either may be '' when Claude sent only the other. */
export interface CoverText {
  /** The English phrase, the big yellow row. */
  en: string
  /** The Japanese word (romaji, then its kana), the mint row. */
  ja: string
}

/** One of the other people in a conversation (see InboxItem.heardCast). */
export interface HeardCastMember {
  /** Their lines in `body` (non-empty lines, from 1). */
  lines: number[]
  icon?: string
  voice?: string
  /** Their role, beside their icon (e.g. "Mom"). */
  name?: string
}

/** A 挿入カード Claude sent (see InboxItem.cards). */
export interface InboxCard {
  /** The line it comes after (non-empty lines of `body`, from 1). */
  afterLine: number
  /** One short English line, e.g. "2 days later". */
  text: string
  /** One of CARD_BACKGROUNDS, or an https image URL; absent for DEFAULT_CARD_BACKGROUND. */
  background?: string
}

/** The backgrounds the app has for a card, when no image is given. */
export const CARD_BACKGROUNDS = ['grape', 'night', 'paper', 'peach', 'mint'] as const
export type CardBackgroundName = (typeof CARD_BACKGROUNDS)[number]
/** The background a card gets when none is named. */
export const DEFAULT_CARD_BACKGROUND: CardBackgroundName = 'grape'

export function isCardBackgroundName(value: unknown): value is CardBackgroundName {
  return typeof value === 'string' && (CARD_BACKGROUNDS as readonly string[]).includes(value)
}

/** The longest card text the burn has room for on one line. */
export const CARD_TEXT_MAX_LENGTH = 28
