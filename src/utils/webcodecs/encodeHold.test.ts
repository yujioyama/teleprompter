import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodesHeld, holdEncodes, whenNotHeld } from './encodeHold'

/** Lets anything waiting on the hold run. */
const settle = () => new Promise(resolve => setTimeout(resolve))

describe('holdEncodes', () => {
  const releases: (() => void)[] = []
  const hold = () => {
    const release = holdEncodes()
    releases.push(release)
    return release
  }

  afterEach(() => {
    releases.splice(0).forEach(release => release())
  })

  it('runs a frame straight through when nothing holds the encodes', () => {
    const process = vi.fn((n: number) => n + 1)
    expect(whenNotHeld(process)(1)).toBe(2)
  })

  it('keeps a frame waiting until the hold is released', async () => {
    const process = vi.fn((n: number) => n + 1)
    const release = hold()
    const made = whenNotHeld(process)(1)
    await settle()
    expect(process).not.toHaveBeenCalled()

    release()
    await expect(made).resolves.toBe(2)
  })

  it('waits for every hold, and a second release of one changes nothing', async () => {
    const process = vi.fn((n: number) => n)
    const first = hold()
    hold()
    const made = whenNotHeld(process)(1)

    first()
    first()
    await settle()
    expect(encodesHeld()).toBe(true)
    expect(process).not.toHaveBeenCalled()

    releases.splice(0).forEach(release => release())
    await made
    expect(encodesHeld()).toBe(false)
  })

  it('lets a waiting frame go when its encode is cancelled', async () => {
    const process = vi.fn((n: number) => n)
    const controller = new AbortController()
    hold()
    const made = whenNotHeld(process, controller.signal)(1)
    await settle()
    expect(process).not.toHaveBeenCalled()

    controller.abort()
    await expect(made).resolves.toBe(1)
  })
})
