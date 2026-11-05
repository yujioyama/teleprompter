import { afterEach, describe, expect, it, vi } from 'vitest'
import { STALL_TIMEOUT_MS } from './stallGuard'
import { holdEncodes } from './encodeHold'

/** What the encode gave Mediabunny, and how to finish it. */
const conversion = vi.hoisted(() => ({
  videoProcess: null as ((sample: unknown) => unknown) | null,
  execute: null as Promise<void> | null,
  finish: () => {},
  cancel: vi.fn(() => Promise.resolve()),
}))

vi.mock('mediabunny', async importOriginal => ({
  ...(await importOriginal<typeof import('mediabunny')>()),
  Input: class {
    dispose() {}
  },
  Output: class {
    target = { buffer: new ArrayBuffer(2000) }
  },
  BufferTarget: class {},
  Conversion: {
    init: async (options: { video: { process: (sample: unknown) => unknown } }) => {
      conversion.videoProcess = options.video.process
      conversion.execute = new Promise<void>(resolve => {
        conversion.finish = resolve
      })
      return {
        isValid: true,
        utilizedTracks: [{ type: 'video' }, { type: 'audio' }],
        discardedTracks: [],
        execute: () => conversion.execute,
        cancel: conversion.cancel,
      }
    },
  },
}))

vi.mock('./support', async importOriginal => ({
  ...(await importOriginal<typeof import('./support')>()),
  aacEncoderDelay: async () => 0,
}))

const { normalizeShotWebCodecs } = await import('./normalizeShot')

/** Starts an encode, and resolves once Mediabunny has its settings. */
async function startEncode() {
  conversion.videoProcess = null
  const encode = normalizeShotWebCodecs(new Blob(['x']), 0, 1)
  await vi.waitFor(() => expect(conversion.videoProcess).not.toBeNull())
  return { encode }
}

describe('normalizeShotWebCodecs while the encodes are held', () => {
  const releases: (() => void)[] = []

  afterEach(() => {
    releases.splice(0).forEach(release => release())
    vi.useRealTimers()
    conversion.cancel.mockClear()
  })

  it('holds back a frame until the hold is released', async () => {
    const { encode } = await startEncode()
    const release = holdEncodes()
    releases.push(release)
    const sample = { timestamp: 0, duration: 1 / 30 }
    const made = conversion.videoProcess!(sample)
    expect(made).toBeInstanceOf(Promise)

    release()
    await expect(made).resolves.toBe(sample)
    conversion.finish()
    await expect(encode).resolves.toBeInstanceOf(Blob)
  })

  it('does not take a held encode for a stalled one', async () => {
    // Before the encode, for the guard's timer to be a fake one.
    vi.useFakeTimers()
    const { encode } = await startEncode()
    const release = holdEncodes()
    releases.push(release)

    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS * 2)
    expect(conversion.cancel).not.toHaveBeenCalled()

    release()
    conversion.finish()
    await expect(encode).resolves.toBeInstanceOf(Blob)
  })
})
