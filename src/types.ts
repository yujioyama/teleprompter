export interface Shot {
  id: string
  text: string
  trimEnabled?: boolean  // undefined = use global setting
  trimPaddingStart?: number  // undefined = use global setting
  trimPaddingEnd?: number    // undefined = use global setting
  /** 間を残す: keep a longer silence after this shot's speech. */
  keepPause?: boolean
}

/** One script line's Japanese subtitle, as Claude sent it with the script. */
export interface LineJapanese {
  /** The English line it was written for. */
  en: string
  ja: string
}

export interface Script {
  id: string
  title: string
  shots: Shot[]
  /** TikTok caption to post with the video. */
  caption?: string
  /**
   * 一発撮り: the whole script is one shot, recorded in a single take, with
   * one line of it per subtitle (split where the pauses are).
   */
  oneTake?: boolean
  /**
   * The Japanese Claude sent with the script. The subtitle step puts each
   * on the line whose English is still `en`.
   */
  japanese?: LineJapanese[]
  createdAt: string
  updatedAt: string
}
