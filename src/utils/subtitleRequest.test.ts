import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteSubtitles, fetchSubtitles, subtitleRequestId } from './subtitleRequest'
import type { SubtitleCue } from './subtitleCues'

function cues(en: string[], ja: (string | null)[] = []): SubtitleCue[] {
  return en.map((text, i) => ({ id: `c${i}`, start: i, end: i + 1, en: text, ja: ja[i] ?? null }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('subtitleRequestId', () => {
  it('is the same for the same English, whatever else changed', () => {
    const id = subtitleRequestId(cues(['Hello', 'I *love* it']))
    expect(subtitleRequestId(cues(['Hello', 'I *love* it']))).toBe(id)
    expect(subtitleRequestId(cues(['Hello', 'I love it']))).toBe(id)
    expect(subtitleRequestId(cues(['Hello', 'I *love* it'], ['こんにちは']))).toBe(id)
  })

  it('changes when the English changes', () => {
    expect(subtitleRequestId(cues(['Hello', 'World']))).not.toBe(subtitleRequestId(cues(['Hello', 'World!'])))
    expect(subtitleRequestId(cues(['Hello World']))).not.toBe(subtitleRequestId(cues(['Hello', 'World'])))
  })

  it('ends in the line count, in the form the server accepts', () => {
    const id = subtitleRequestId(cues(['a', 'b', 'c']))
    expect(id).toMatch(/^[0-9a-z]{1,13}-3$/)
  })
})

describe('fetchSubtitles', () => {
  it('returns the lines Claude sent, using the key as a bearer token', async () => {
    const fetchMock = vi.fn(async () => Response.json({ lines: ['一', '二'] }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchSubtitles('secret', 'k3x9-2')).toEqual(['一', '二'])
    expect(fetchMock).toHaveBeenCalledWith('/api/subtitles?id=k3x9-2', {
      headers: { Authorization: 'Bearer secret' },
      cache: 'no-store',
    })
  })

  it('returns null while nothing has been sent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    expect(await fetchSubtitles('secret', 'k3x9-2')).toBeNull()
  })

  it('throws on other failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))
    await expect(fetchSubtitles('wrong', 'k3x9-2')).rejects.toThrow('401')
  })
})

describe('deleteSubtitles', () => {
  it('deletes by request id', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await deleteSubtitles('secret', 'k3x9-2')
    expect(fetchMock).toHaveBeenCalledWith('/api/subtitles?id=k3x9-2', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer secret' },
    })
  })
})
