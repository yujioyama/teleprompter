import type { VideoType } from '../shared/inbox'
import type { StoredCinemaLook } from '../shared/cinemaLook'

export type { VideoType }

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

/** The image of one script line. The bytes are on the device (lineImageStore). */
export interface LineImage {
  /** The line it goes with, by its text. */
  en: string
  /** Its key on the device: `url`, or a new id for a picture chosen there. */
  imageId: string
  /** Where to get it again (a restored backup); absent for a picture chosen on the device. */
  url?: string
  /** Shown small under the image; absent when its license asks for none. */
  credit?: string
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
  /**
   * Type A (short daily thing) or B (expression-note story). Only labels the
   * video for the weekly comparison; every script gets the opening bars.
   */
  videoType?: VideoType
  /** The film look picked on screen; see filmLookOf for what it means. */
  look?: StoredCinemaLook
  /** Images for some of the lines. With any, the video has no emoji stickers. */
  lineImages?: LineImage[]
  createdAt: string
  updatedAt: string
}
