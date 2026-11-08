import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PostToSns from './PostToSns'
import { nextFreeSlot, postStatus, postToSns, whenLabel, type PostOptions } from '../utils/postToSns'

vi.mock('../utils/postToSns', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/postToSns')>()),
  postToSns: vi.fn(),
  postStatus: vi.fn(async () => []),
  nextFreeSlot: vi.fn(),
}))

const VIDEO = new Blob(['video'], { type: 'video/mp4' })

function renderPost(onPosted = vi.fn()) {
  render(
    <PostToSns video={VIDEO} caption="hi" inboxKey="key" ready coverOffsetMs={async () => 0} onPosted={onPosted} />,
  )
  return onPosted
}

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(postToSns).mockReset()
  vi.mocked(postStatus).mockReset()
  vi.mocked(postStatus).mockResolvedValue([])
  vi.mocked(nextFreeSlot).mockReset()
})

describe('PostToSns', () => {
  it('shows each network and locks once all are sent', async () => {
    vi.mocked(postToSns).mockResolvedValue([
      { service: 'instagram', name: 'yuji', ok: true },
      { service: 'twitter', name: 'yuji', ok: true },
    ])
    const onPosted = renderPost()
    fireEvent.click(screen.getByText('今すぐ投稿する'))
    expect(await screen.findByText('X: 送りました（2分後に出ます）')).toBeInTheDocument()
    expect(screen.getByText('投稿しました')).toBeDisabled()
    expect(onPosted).toHaveBeenCalledTimes(1)
  })

  it('takes the results from the server when the answer was lost', async () => {
    vi.mocked(postToSns).mockImplementation(async (options: PostOptions) => {
      options.onUploaded?.('https://pub.r2.dev/posts/v.mp4')
      throw new Error('投稿のリクエストに失敗しました')
    })
    vi.mocked(postStatus).mockResolvedValue([{ service: 'tiktok', name: 'yuji', ok: true }])
    renderPost()
    fireEvent.click(screen.getByText('今すぐ投稿する'))
    expect(await screen.findByText('TikTok: 送りました（2分後に出ます）')).toBeInTheDocument()
    expect(screen.getByText(/結果をサーバーから取り直しました/)).toBeInTheDocument()
    expect(vi.mocked(postStatus).mock.calls[0][1]).toBe(vi.mocked(postToSns).mock.calls[0][0].postId)
  })

  it('sends again with the same post and upload, and asks again on coming back to the app', async () => {
    vi.mocked(postToSns).mockImplementation(async (options: PostOptions) => {
      options.onUploaded?.('https://pub.r2.dev/posts/v.mp4')
      throw new Error('通信エラー')
    })
    renderPost()
    fireEvent.click(screen.getByText('今すぐ投稿する'))
    await screen.findByText('もう一度試す（投稿済みのSNSには送りません）')

    // Back from YouTube: the server now knows.
    vi.mocked(postStatus).mockResolvedValue([{ service: 'instagram', name: 'yuji', ok: true }])
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(await screen.findByText('Instagram: 送りました（2分後に出ます）')).toBeInTheDocument()
    expect(screen.getByText('投稿しました')).toBeDisabled()
    expect(postToSns).toHaveBeenCalledTimes(1)
  })

  it('reuses the upload and post id on a retry after a failed network', async () => {
    vi.mocked(postToSns).mockResolvedValue([{ service: 'tiktok', name: 'yuji', ok: true }])
    vi.mocked(postToSns).mockImplementationOnce(async (options: PostOptions) => {
      options.onUploaded?.('https://pub.r2.dev/posts/v.mp4')
      return [
        { service: 'instagram', name: 'yuji', ok: true },
        { service: 'tiktok', name: 'yuji', ok: false, message: 'busy' },
      ]
    })
    renderPost()
    fireEvent.click(screen.getByText('今すぐ投稿する'))
    fireEvent.click(await screen.findByText('失敗したものだけ送り直す'))
    await waitFor(() => expect(postToSns).toHaveBeenCalledTimes(2))
    const [first, second] = vi.mocked(postToSns).mock.calls.map(c => c[0])
    expect(second.postId).toBe(first.postId)
    expect(second.uploadedUrl).toBe('https://pub.r2.dev/posts/v.mp4')
    expect(await screen.findByText('TikTok: 送りました（2分後に出ます）')).toBeInTheDocument()
  })

  it('says nothing went out when one failed and the rest were taken back, and sends to all again', async () => {
    vi.mocked(postToSns).mockResolvedValue([{ service: 'instagram', name: 'yuji', ok: true }])
    vi.mocked(postToSns).mockImplementationOnce(async (options: PostOptions) => {
      options.onUploaded?.('https://pub.r2.dev/posts/v.mp4')
      return [
        { service: 'instagram', name: 'yuji', ok: false, message: '他のSNSが失敗したので取り消しました' },
        { service: 'tiktok', name: 'yuji', ok: false, message: 'busy' },
      ]
    })
    const onPosted = renderPost()
    fireEvent.click(screen.getByText('今すぐ投稿する'))
    expect(await screen.findByText('失敗したSNSがあったので、どこにも投稿していません')).toBeInTheDocument()
    expect(screen.getByText('Instagram: 失敗（他のSNSが失敗したので取り消しました）')).toBeInTheDocument()
    expect(onPosted).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('もう一度投稿する'))
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('すべてのSNSに送ります'))
    expect(await screen.findByText('Instagram: 送りました（2分後に出ます）')).toBeInTheDocument()
  })

  it('says so when a network could not be taken back', async () => {
    vi.mocked(postToSns).mockResolvedValue([
      { service: 'twitter', name: 'yuji', ok: true, message: '他のSNSが失敗しましたが、これは取り消せませんでした（down）' },
      { service: 'tiktok', name: 'yuji', ok: false, message: 'busy' },
    ])
    renderPost()
    fireEvent.click(screen.getByText('今すぐ投稿する'))
    expect(
      await screen.findByText('X: 送りました（2分後に出ます）。他のSNSが失敗しましたが、これは取り消せませんでした（down）'),
    ).toBeInTheDocument()
    expect(screen.getByText('失敗したものだけ送り直す')).toBeEnabled()
  })

  describe('次の空き', () => {
    const SLOT = new Date(2099, 0, 5, 20, 0).toISOString()

    it('asks with the slot it found, reserves it, and says when', async () => {
      vi.mocked(nextFreeSlot).mockResolvedValue(SLOT)
      vi.mocked(postToSns).mockResolvedValue([{ service: 'instagram', name: 'yuji', ok: true }])
      const onPosted = renderPost()
      fireEvent.click(screen.getByRole('button', { name: '次の空き' }))
      fireEvent.click(screen.getByText('次の空きに予約する'))
      const label = whenLabel(new Date(SLOT))
      expect(await screen.findByText(`Instagram: ${label}に予約しました`)).toBeInTheDocument()
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(`${label}で予約しますか`))
      expect(vi.mocked(postToSns).mock.calls[0][0].when).toBe(SLOT)
      expect(onPosted).toHaveBeenCalledWith(SLOT)
    })

    it('posts nothing when every slot is taken, and says how far', async () => {
      vi.mocked(nextFreeSlot).mockResolvedValue(null)
      renderPost()
      fireEvent.click(screen.getByRole('button', { name: '次の空き' }))
      fireEvent.click(screen.getByText('次の空きに予約する'))
      expect(await screen.findByText(/5日先まで埋まっています/)).toBeInTheDocument()
      expect(postToSns).not.toHaveBeenCalled()
      expect(window.confirm).not.toHaveBeenCalled()
    })

    it('says why when the slots could not be checked, without posting', async () => {
      vi.mocked(nextFreeSlot).mockRejectedValue(new Error('Buffer API: down'))
      renderPost()
      fireEvent.click(screen.getByRole('button', { name: '次の空き' }))
      fireEvent.click(screen.getByText('次の空きに予約する'))
      expect(await screen.findByText('Buffer API: down')).toBeInTheDocument()
      expect(postToSns).not.toHaveBeenCalled()
    })

    it('goes back to waiting when the question is declined', async () => {
      vi.mocked(nextFreeSlot).mockResolvedValue(SLOT)
      vi.mocked(window.confirm).mockReturnValue(false)
      renderPost()
      fireEvent.click(screen.getByRole('button', { name: '次の空き' }))
      fireEvent.click(screen.getByText('次の空きに予約する'))
      await waitFor(() => expect(window.confirm).toHaveBeenCalled())
      await waitFor(() => expect(screen.getByText('次の空きに予約する')).toBeEnabled())
      expect(postToSns).not.toHaveBeenCalled()
    })

    it('keeps the same slot on a retry, so every network goes out together', async () => {
      vi.mocked(nextFreeSlot).mockResolvedValue(SLOT)
      vi.mocked(postToSns).mockResolvedValue([{ service: 'tiktok', name: 'yuji', ok: true }])
      vi.mocked(postToSns).mockImplementationOnce(async (options: PostOptions) => {
        options.onUploaded?.('https://pub.r2.dev/posts/v.mp4')
        return [{ service: 'tiktok', name: 'yuji', ok: false, message: 'busy' }]
      })
      renderPost()
      fireEvent.click(screen.getByRole('button', { name: '次の空き' }))
      fireEvent.click(screen.getByText('次の空きに予約する'))
      fireEvent.click(await screen.findByText('もう一度投稿する'))
      await waitFor(() => expect(postToSns).toHaveBeenCalledTimes(2))
      expect(vi.mocked(postToSns).mock.calls[1][0].when).toBe(SLOT)
      expect(nextFreeSlot).toHaveBeenCalledTimes(1)
    })
  })

  it('reserves the 12:00 or 20:00 picked, and keeps that time on a retry', async () => {
    vi.mocked(postToSns).mockResolvedValue([{ service: 'tiktok', name: 'yuji', ok: true }])
    vi.mocked(postToSns).mockImplementationOnce(async (options: PostOptions) => {
      options.onUploaded?.('https://pub.r2.dev/posts/v.mp4')
      return [{ service: 'tiktok', name: 'yuji', ok: false, message: 'busy' }]
    })
    renderPost()
    fireEvent.click(screen.getByRole('button', { name: /20:00/ }))
    fireEvent.click(screen.getByText(/20:00に予約する/))
    fireEvent.click(await screen.findByText('もう一度投稿する'))
    await waitFor(() => expect(postToSns).toHaveBeenCalledTimes(2))
    const [first, second] = vi.mocked(postToSns).mock.calls.map(c => c[0])
    expect(new Date(first.when).getHours()).toBe(20)
    expect(second.when).toBe(first.when)
    expect(nextFreeSlot).not.toHaveBeenCalled()
  })
})
