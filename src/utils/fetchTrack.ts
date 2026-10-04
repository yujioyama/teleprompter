import { MusicTrack } from '../data/musicTracks'

// Each track's file, fetched once per session and shared by the live
// preview, the real mix and the audio prepared ahead of it.
const trackBlobs = new Map<string, Promise<Blob>>()

export function fetchTrack(track: MusicTrack): Promise<Blob> {
  let blob = trackBlobs.get(track.id)
  if (!blob) {
    blob = fetch(`/${track.file}`).then(response => {
      if (!response.ok) throw new Error(`「${track.title}」の読み込みに失敗しました`)
      return response.blob()
    })
    trackBlobs.set(track.id, blob)
    blob.catch(() => trackBlobs.delete(track.id))
  }
  return blob
}
