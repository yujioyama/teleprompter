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
  /** ISO timestamp of when it arrived. */
  createdAt: string
}
