import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteInboxItem, fetchInbox, type InboxItem } from './inbox'

const ITEM: InboxItem = { id: 'id-1', title: 'T', body: 'a\nb', caption: '#c', createdAt: '2026-10-09T00:00:00.000Z' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchInbox', () => {
  it('sends the key as a bearer token and returns the items', async () => {
    const fetchMock = vi.fn(async () => Response.json({ items: [ITEM] }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchInbox('secret')).toEqual([ITEM])
    expect(fetchMock).toHaveBeenCalledWith('/api/inbox', {
      headers: { Authorization: 'Bearer secret' },
      cache: 'no-store',
    })
  })

  it('returns no items when the response has no items list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})))
    expect(await fetchInbox('secret')).toEqual([])
  })

  it('throws on a rejected key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))
    await expect(fetchInbox('wrong')).rejects.toThrow('401')
  })
})

describe('deleteInboxItem', () => {
  it('deletes by id', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await deleteInboxItem('secret', 'id 1')
    expect(fetchMock).toHaveBeenCalledWith('/api/inbox?id=id%201', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer secret' },
    })
  })

  it('throws when the server fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })))
    await expect(deleteInboxItem('secret', 'id-1')).rejects.toThrow('500')
  })
})
