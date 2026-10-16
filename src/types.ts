export interface Shot {
  id: string
  text: string
  trimEnabled?: boolean  // undefined = use global setting
  trimPaddingStart?: number  // undefined = use global setting
  trimPaddingEnd?: number    // undefined = use global setting
  /** 間を残す: keep a longer silence after this shot's speech. */
  keepPause?: boolean
}

export interface Script {
  id: string
  title: string
  shots: Shot[]
  /** TikTok caption to post with the video. */
  caption?: string
  createdAt: string
  updatedAt: string
}
