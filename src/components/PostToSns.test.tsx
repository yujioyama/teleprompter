import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PostToSns from './PostToSns'
import { postStatus, postToSns, type PostOptions } from '../utils/postToSns'

vi.mock('../utils/postToSns', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/postToSns')>()),
  postToSns: vi.fn(),
  postStatus: vi.fn(async () => []),
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
})

describe('PostToSns', () => {
  it('shows each network and locks once all are sent', async () => {
    vi.mocked(postToSns).mockResolvedValue([
      { service: 'instagram', name: 'yuji', ok: true },
      { service: 'twitter', name: 'yuji', ok: true },
    ])
    const onPosted = renderPost()
    fireEvent.click(screen.getByText('今すぐ投稿する'))
    expect(await screen.findByText('X: 送りました')).toBeInTheDocument()
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
    expect(await screen.findByText('TikTok: 送りました')).toBeInTheDocument()
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
    expect(await screen.findByText('Instagram: 送りました')).toBeInTheDocument()
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
    expect(await screen.findByText('TikTok: 送りました')).toBeInTheDocument()
  })
})
