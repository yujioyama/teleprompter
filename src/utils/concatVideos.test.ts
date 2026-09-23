import { describe, it, expect } from 'vitest'
import { buildConcatListFile } from './concatVideos'

describe('buildConcatListFile', () => {
  it('formats one "file" line per clip in order', () => {
    const result = buildConcatListFile(['clip0.mp4', 'clip1.mp4', 'clip2.mp4'])
    expect(result).toBe("file 'clip0.mp4'\nfile 'clip1.mp4'\nfile 'clip2.mp4'\n")
  })

  it('works for a single clip', () => {
    expect(buildConcatListFile(['only.mp4'])).toBe("file 'only.mp4'\n")
  })
})
