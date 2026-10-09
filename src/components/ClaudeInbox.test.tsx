import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import ClaudeInbox from './ClaudeInbox'
import { fetchInbox, type InboxItem } from '../utils/inbox'

vi.mock('../utils/inbox', () => ({ fetchInbox: vi.fn() }))

const ITEM: InboxItem = {
  id: 'id-1',
  title: '朝のルーティン',
  body: '一行目\n二行目',
  caption: '#朝活',
  createdAt: '2026-10-09T01:00:00.000Z',
}

beforeEach(() => {
  vi.mocked(fetchInbox).mockReset()
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
    fireEvent.click(screen.getByRole('button', { name: /朝のルーティン/ }))
    expect(onOpen).toHaveBeenCalledWith(ITEM)
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
