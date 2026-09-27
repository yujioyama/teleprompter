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
  EncodedPacket,
  AudioBufferSource,
  Quality,
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

/** Samples per AAC-LC frame. */
const AAC_FRAME_SAMPLES = 1024

export type AudioPlacement = { drop: true } | { drop: false; silenceBefore: number; timestamp: number }

/**
 * Lays joined clips' AAC frames out back to back.
 *
 * Players decode an AAC track as one continuous run of 1024-sample frames
 * and don't honor gaps or overlaps in packet timestamps, so audio has to be
 * written exactly contiguous or every join nudges it off the video, and the
 * error keeps adding up over dozens of shots. Each frame therefore goes at
 * the running end of the audio, but only if that's within half a frame of
 * where its clip wants it: frames that would land too early (the previous
 * clip's audio already covers that time — e.g. the head of the next clip's
 * encoder priming) are dropped, and where the previous clip's audio runs
 * short, silent frames fill the gap. Sync is thus re-anchored at every
 * join and never drifts by more than half a frame (~11ms).
 */
export class AudioTimeline {
  private end: number | null = null

  constructor(readonly frameDuration: number) {}

  place(intended: number): AudioPlacement {
    const half = this.frameDuration / 2
    if (this.end === null) this.end = intended
    if (intended < this.end - half) return { drop: true }
    let silenceBefore = 0
    while (intended > this.end + half) {
      silenceBefore++
      this.end += this.frameDuration
    }
    const timestamp = this.end
    this.end += this.frameDuration
    return { drop: false, silenceBefore, timestamp }
  }
}

let silentFrame: Promise<{ packet: EncodedPacket; config: AudioDecoderConfig }> | null = null

/**
 * One AAC frame of digital silence, taken from the middle of an encode of
 * zeros (the first frames carry encoder priming). Only needed when a clip's
 * audio ends short of its video by more than half a frame.
 */
function getSilentFrame(): Promise<{ packet: EncodedPacket; config: AudioDecoderConfig }> {
  if (!silentFrame) {
    silentFrame = (async () => {
      const packets: EncodedPacket[] = []
      let config: AudioDecoderConfig | undefined
      const source = new AudioBufferSource({
        codec: 'aac',
        quality: new Quality('high'),
        onEncodedPacket: (packet, meta) => {
          packets.push(packet)
          config ??= meta?.decoderConfig
        },
      })
      const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
      output.addAudioTrack(source)
      await output.start()
      await source.add(new AudioBuffer({ numberOfChannels: 2, length: 48000 / 4, sampleRate: 48000 }))
      await output.finalize()
      const packet = packets[Math.floor(packets.length / 2)]
      if (!packet || !config) throw new Error('could not encode a silent AAC frame')
      return { packet, config }
    })()
    silentFrame.catch(() => {
      silentFrame = null
    })
  }
  return silentFrame
}

/**
 * Join already-normalized clips by copying their encoded packets into one
 * MP4 back to back — no decoding or encoding, and no ffmpeg.wasm load.
 *
 * Only valid when every clip shares the same decoder config (codec string
 * and avcC/esds bytes), which the normalize step guarantees for clips from
 * the same encoder. Throws otherwise so the caller can fall back to ffmpeg.
 *
 * Each clip's video is placed at the end of the previous clip's video;
 * audio follows it as laid out by AudioTimeline.
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
  let timeline: AudioTimeline | null = null

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

        timeline ??= new AudioTimeline(AAC_FRAME_SAMPLES / audioConfig.sampleRate)
        const isLastClip = i === blobs.length - 1
        firstPacket = i === 0
        for await (const packet of new EncodedPacketSink(audioTrack).packets()) {
          const intended = packet.timestamp - videoStart + offset
          // The next clip re-anchors the audio anyway; only the last one
          // needs its tail cut where the video ends.
          if (isLastClip && intended >= videoEnd) break
          const placement = timeline.place(intended)
          if (placement.drop) continue
          if (placement.silenceBefore > 0) {
            const silence = await getSilentFrame()
            if (!sameDecoderConfig(audioConfig, silence.config)) {
              throw new Error('silent AAC frame does not match the clips\' audio config')
            }
            for (let k = placement.silenceBefore; k > 0; k--) {
              await audioSource.add(
                silence.packet.clone({ timestamp: placement.timestamp - k * timeline.frameDuration }),
              )
            }
          }
          await audioSource.add(
            packet.clone({ timestamp: placement.timestamp, duration: timeline.frameDuration }),
            firstPacket ? { decoderConfig: audioConfig } : undefined,
          )
          firstPacket = false
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
