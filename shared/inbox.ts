
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
  /** ISO timestamp of when it arrived. */
  createdAt: string
}
