/**
 * Which of the two daily formats a script is (from 2026-11-02): 'A' is the
 * short 2021-style daily thing, 'B' the expression-note story. Each gets its
 * own opening look (see openingLookFor).
 */
export type VideoType = 'A' | 'B'

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
  /** ISO timestamp of when it arrived. */
  createdAt: string
}
