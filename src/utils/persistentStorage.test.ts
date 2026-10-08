import { describe, it, expect, vi, afterEach } from 'vitest'
import { requestPersistentStorage } from './persistentStorage'

const original = Object.getOwnPropertyDescriptor(navigator, 'storage')

function stubStorage(storage: Partial<StorageManager> | undefined) {
  Object.defineProperty(navigator, 'storage', { value: storage, configurable: true })
}

afterEach(() => {
  if (original) Object.defineProperty(navigator, 'storage', original)
  else delete (navigator as { storage?: unknown }).storage
})

describe('requestPersistentStorage', () => {
  it('asks for persistence when storage is not yet persisted', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    stubStorage({ persisted: vi.fn().mockResolvedValue(false), persist })
    await expect(requestPersistentStorage()).resolves.toBe(true)
    expect(persist).toHaveBeenCalledOnce()
  })

  it('does not ask again once storage is persisted', async () => {
    const persist = vi.fn()
    stubStorage({ persisted: vi.fn().mockResolvedValue(true), persist })
    await expect(requestPersistentStorage()).resolves.toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('reports false where the browser has no storage manager', async () => {
    stubStorage(undefined)
    await expect(requestPersistentStorage()).resolves.toBe(false)
  })

  it('reports false instead of throwing when the request fails', async () => {
    stubStorage({ persisted: vi.fn().mockRejectedValue(new Error('nope')), persist: vi.fn() })
    await expect(requestPersistentStorage()).resolves.toBe(false)
  })
})
