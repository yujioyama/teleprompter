import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
} from 'mediabunny'

type DecoderConfig = VideoDecoderConfig | AudioDecoderConfig

function descriptionBytes(config: DecoderConfig): Uint8Array | null {
  const d = config.description
  if (!d) return null
  if (d instanceof ArrayBuffer) return new Uint8Array(d)
  if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
  return new Uint8Array(d as ArrayBuffer)
}

/** Whether packets encoded under `b` can be decoded with `a`'s config. */
export function sameDecoderConfig(a: DecoderConfig, b: DecoderConfig): boolean {
  if (a.codec !== b.codec) return false
  const da = descriptionBytes(a)
  const db = descriptionBytes(b)
  if (!da || !db) return da === db
  return da.length === db.length && da.every((byte, i) => byte === db[i])
}

/**
 * Join already-normalized clips by copying their encoded packets into one
 * MP4 back to back — no decoding or encoding, and no ffmpeg.wasm load.
 *
 * Only valid when every clip shares the same decoder config (codec string
 * and avcC/esds bytes), which the normalize step guarantees for clips from
 * the same encoder. Throws otherwise so the caller can fall back to ffmpeg.
 *
 * Each clip is placed at the end of the previous clip's video. Audio packets
 * that would overlap the previous clip's audio (e.g. AAC priming at the
 * head of each clip) are dropped, so audio never drifts from video across
 * many clips — at most one ~21ms AAC frame per join.
 */
export async function concatClipsWebCodecs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 0) throw new Error('concatClipsWebCodecs: no clips')

  const videoSource = new EncodedVideoPacketSource('avc')
  const audioSource = new EncodedAudioPacketSource('aac')
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  })
  output.addVideoTrack(videoSource, { frameRate: 30 })
  output.addAudioTrack(audioSource)

  let started = false
  let firstVideoConfig: VideoDecoderConfig | null = null
  let firstAudioConfig: AudioDecoderConfig | null = null
  let offset = 0
  let audioEnd = -Infinity

  try {
    for (let i = 0; i < blobs.length; i++) {
      const input = new Input({ source: new BlobSource(blobs[i]), formats: ALL_FORMATS })
      try {
        const videoTrack = await input.getPrimaryVideoTrack()
        const audioTrack = await input.getPrimaryAudioTrack()
        if (!videoTrack || !audioTrack) throw new Error(`clip ${i} is missing a video or audio track`)
        if (videoTrack.codec !== 'avc' || audioTrack.codec !== 'aac') {
          throw new Error(`clip ${i} is ${videoTrack.codec}/${audioTrack.codec}, expected avc/aac`)
        }
        if ((await videoTrack.getRotation()) !== 0) throw new Error(`clip ${i} carries rotation metadata`)

        const videoConfig = await videoTrack.getDecoderConfig()
        const audioConfig = await audioTrack.getDecoderConfig()
        if (!videoConfig || !audioConfig) throw new Error(`clip ${i} has no decoder config`)
        if (!firstVideoConfig || !firstAudioConfig) {
          firstVideoConfig = videoConfig
          firstAudioConfig = audioConfig
          await output.start()
          started = true
        } else if (
          !sameDecoderConfig(firstVideoConfig, videoConfig) ||
          !sameDecoderConfig(firstAudioConfig, audioConfig)
        ) {
          throw new Error(`clip ${i} was encoded with different parameters than clip 0`)
        }

        // Rebase each clip so its first frame lands exactly at `offset`.
        const videoStart = await videoTrack.getFirstTimestamp()
        let videoEnd = offset
        let firstPacket = i === 0
        for await (const packet of new EncodedPacketSink(videoTrack).packets()) {
          const timestamp = packet.timestamp - videoStart + offset
          videoEnd = Math.max(videoEnd, timestamp + packet.duration)
          await videoSource.add(
            packet.clone({ timestamp }),
            firstPacket ? { decoderConfig: videoConfig } : undefined,
          )
          firstPacket = false
        }

        firstPacket = i === 0
        for await (const packet of new EncodedPacketSink(audioTrack).packets()) {
          const timestamp = packet.timestamp - videoStart + offset
          // Tolerate float noise; drop anything genuinely overlapping.
          if (timestamp < audioEnd - 1e-6 || timestamp + packet.duration > videoEnd + 0.05) continue
          await audioSource.add(
            packet.clone({ timestamp }),
            firstPacket ? { decoderConfig: audioConfig } : undefined,
          )
          firstPacket = false
          audioEnd = timestamp + packet.duration
        }

        offset = videoEnd
      } finally {
        input.dispose()
      }
    }

    await output.finalize()
    const buffer = output.target.buffer
    if (!buffer) throw new Error('concatClipsWebCodecs: no output')
    return new Blob([buffer], { type: 'video/mp4' })
  } catch (err) {
    if (started) await output.cancel().catch(() => undefined)
    throw err
  }
}
