import { releaseVideo } from './releaseVideo'

/**
 * Read a video's duration from its metadata, then fully release the
 * temporary player. The finalize screen needs every shot's duration to
 * combine, but must not keep a <video> per shot alive to get it: ~20+ live
 * 1080p players exhaust iOS's media memory and every preview switches to the
 * "can't play" icon (issue #12). Callers should probe one video at a time.
 *
 * Resolves to 0 when the duration can't be read.
 */
export function probeVideoDuration(blob: Blob): Promise<number> {
  return new Promise(resolve => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(blob)

    function done(duration: number) {
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('error', onError)
      releaseVideo(video)
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 0)
    }
    function onMeta() {
      done(video.duration)
    }
    function onError() {
      done(0)
    }

    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('error', onError)
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.src = url
  })
}
