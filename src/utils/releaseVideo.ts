/**
 * Drop the media player (decoder + frame buffers) behind a <video> right
 * away. Just removing the element from the DOM leaves it alive until GC, and
 * on iOS those leftovers pile up until new players fail to decode (issue #12).
 */
export function releaseVideo(video: HTMLVideoElement) {
  video.pause()
  video.removeAttribute('src')
  video.load()
}
