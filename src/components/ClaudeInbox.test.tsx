import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import ClaudeInbox from './ClaudeInbox'
import { deleteInboxItem, fetchInbox, type InboxItem } from '../utils/inbox'

vi.mock('../utils/inbox', () => ({ fetchInbox: vi.fn(), deleteInboxItem: vi.fn() }))

const ITEM: InboxItem = {
  id: 'id-1',
  title: '朝のルーティン',
  body: '一行目\n二行目',
  caption: '#朝活',
  createdAt: '2026-10-09T01:00:00.000Z',
}

const OLDER: InboxItem = { ...ITEM, id: 'id-0', title: '夜のルーティン', createdAt: '2026-10-08T01:00:00.000Z' }

beforeEach(() => {
  vi.mocked(fetchInbox).mockReset()
  vi.mocked(deleteInboxItem).mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ClaudeInbox', () => {
  it('lists what arrived and opens one when tapped', async () => {
    vi.mocked(fetchInbox).mockResolvedValue([ITEM])
    const onOpen = vi.fn()
    render(<ClaudeInbox inboxKey="secret" onOpen={onOpen} />)

    expect(await screen.findByText('Claudeから届いたスクリプト')).toBeInTheDocument()
    expect(fetchInbox).toHaveBeenCalledWith('secret')
    fireEvent.click(screen.getByRole('button', { name: /^朝のルーティン/ }))
    expect(onOpen).toHaveBeenCalledWith(ITEM)
  })

  it('throws an item away with × after asking, without opening it', async () => {
    vi.mocked(fetchInbox).mockResolvedValue([ITEM, OLDER])
    vi.mocked(deleteInboxItem).mockResolvedValue()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onOpen = vi.fn()
    render(<ClaudeInbox inboxKey="secret" onOpen={onOpen} />)

    fireEvent.click(await screen.findByRole('button', { name: '「夜のルーティン」を消す' }))

    expect(window.confirm).toHaveBeenCalledWith('「夜のルーティン」を受け取り箱から消しますか？')
    expect(deleteInboxItem).toHaveBeenCalledWith('secret', 'id-0')
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.queryByText('夜のルーティン')).not.toBeInTheDocument()
    expect(screen.getByText('朝のルーティン')).toBeInTheDocument()
  })

  it('hides the section once the last item is thrown away', async () => {
    vi.mocked(fetchInbox).mockResolvedValue([ITEM])
    vi.mocked(deleteInboxItem).mockResolvedValue()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = render(<ClaudeInbox inboxKey="secret" onOpen={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '「朝のルーティン」を消す' }))
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the item when the confirmation is cancelled', async () => {
    vi.mocked(fetchInbox).mockResolvedValue([ITEM])
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<ClaudeInbox inboxKey="secret" onOpen={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '「朝のルーティン」を消す' }))
    expect(deleteInboxItem).not.toHaveBeenCalled()
    expect(screen.getByText('朝のルーティン')).toBeInTheDocument()
  })

  it('puts the item back in place when the server could not remove it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.mocked(fetchInbox).mockResolvedValue([ITEM, OLDER])
    vi.mocked(deleteInboxItem).mockRejectedValue(new Error('offline'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ClaudeInbox inboxKey="secret" onOpen={vi.fn()} />)

    const discard = await screen.findByRole('button', { name: '「朝のルーティン」を消す' })
    await act(async () => {
      fireEvent.click(discard)
    })

    expect(window.alert).toHaveBeenCalled()
    const titles = screen.getAllByRole('button', { name: /^[朝夜]のルーティン/ }).map(b => b.textContent)
    expect(titles).toEqual([expect.stringMatching(/^朝のルーティン/), expect.stringMatching(/^夜のルーティン/)])
  })

  it('shows nothing and asks nothing without a key', () => {
    const { container } = render(<ClaudeInbox inboxKey="" onOpen={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    expect(fetchInbox).not.toHaveBeenCalled()
  })

  it('shows nothing when the inbox is empty', async () => {
    vi.mocked(fetchInbox).mockResolvedValue([])
    const { container } = render(<ClaudeInbox inboxKey="secret" onOpen={vi.fn()} />)
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing when the inbox cannot be reached', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(fetchInbox).mockRejectedValue(new Error('offline'))
    const { container } = render(<ClaudeInbox inboxKey="secret" onOpen={vi.fn()} />)
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })

  it('checks again when the app comes back to the foreground', async () => {
    vi.mocked(fetchInbox).mockResolvedValueOnce([]).mockResolvedValueOnce([ITEM])
    render(<ClaudeInbox inboxKey="secret" onOpen={vi.fn()} />)
    await act(async () => {})
    expect(screen.queryByText('Claudeから届いたスクリプト')).not.toBeInTheDocument()

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(await screen.findByText('Claudeから届いたスクリプト')).toBeInTheDocument()
  })

  it('keeps the newest answer when an older check finishes last', async () => {
    let finishFirst: (items: InboxItem[]) => void = () => {}
    vi.mocked(fetchInbox)
      .mockReturnValueOnce(new Promise(resolve => (finishFirst = resolve)))
      .mockResolvedValueOnce([])
    render(<ClaudeInbox inboxKey="secret" onOpen={vi.fn()} />)

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    // The first check, sent before the item was taken, answers late.
    await act(async () => {
      finishFirst([ITEM])
    })
    expect(screen.queryByText('Claudeから届いたスクリプト')).not.toBeInTheDocument()
  })
})
