import { describe, it, expect } from 'vitest'
import { mergeScripts, parseBackup, serializeBackup } from './scriptBackup'
import type { Script } from '../types'

function script(id: string, updatedAt: string, title = id): Script {
  return {
    id,
    title,
    shots: [{ id: `${id}-shot`, text: 'テキスト', trimPaddingStart: 0.5 }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  }
}

describe('serializeBackup / parseBackup', () => {
  it('round-trips the scripts', () => {
    const scripts = [script('a', '2026-01-02T00:00:00.000Z'), script('b', '2026-01-03T00:00:00.000Z')]
    const parsed = parseBackup(serializeBackup(scripts, new Date('2026-10-08T00:00:00.000Z')))
    expect(parsed).toEqual({ ok: true, scripts })
  })

  it('rejects text that is not JSON', () => {
    expect(parseBackup('not json')).toMatchObject({ ok: false })
  })

  it('rejects JSON that is not a backup from this app', () => {
    expect(parseBackup(JSON.stringify({ hello: 'world' }))).toMatchObject({ ok: false })
    expect(parseBackup(JSON.stringify([script('a', '2026-01-02T00:00:00.000Z')]))).toMatchObject({ ok: false })
  })

  it('rejects a backup holding a malformed script', () => {
    const backup = JSON.parse(serializeBackup([script('a', '2026-01-02T00:00:00.000Z')]))
    backup.scripts[0].shots = [{ id: 'x' }]
    expect(parseBackup(JSON.stringify(backup))).toMatchObject({ ok: false })
  })

  it('rejects a backup from a newer format', () => {
    const backup = JSON.parse(serializeBackup([]))
    backup.version = 99
    expect(parseBackup(JSON.stringify(backup))).toMatchObject({ ok: false })
  })

  it('round-trips a caption, and rejects one that is not text', () => {
    const withCaption = { ...script('a', '2026-01-02T00:00:00.000Z'), caption: '#朝活' }
    expect(parseBackup(serializeBackup([withCaption]))).toEqual({ ok: true, scripts: [withCaption] })

    const broken = JSON.parse(serializeBackup([withCaption]))
    broken.scripts[0].caption = 42
    expect(parseBackup(JSON.stringify(broken))).toMatchObject({ ok: false })
  })
})

describe('mergeScripts', () => {
  const older = '2026-01-02T00:00:00.000Z'
  const newer = '2026-01-05T00:00:00.000Z'

  it('adds scripts that are not on the device', () => {
    const result = mergeScripts([script('a', older)], [script('b', older)])
    expect(result.scripts.map(s => s.id)).toEqual(['a', 'b'])
    expect(result).toMatchObject({ added: 1, updated: 0, unchanged: 0 })
  })

  it('replaces a script only with a newer copy of it', () => {
    const result = mergeScripts([script('a', older, '古い')], [script('a', newer, '新しい')])
    expect(result.scripts).toEqual([script('a', newer, '新しい')])
    expect(result).toMatchObject({ added: 0, updated: 1, unchanged: 0 })
  })

  it('keeps the device copy when it is as new or newer', () => {
    const result = mergeScripts([script('a', newer, '端末')], [script('a', older, 'バックアップ')])
    expect(result.scripts).toEqual([script('a', newer, '端末')])
    expect(result).toMatchObject({ added: 0, updated: 0, unchanged: 1 })
  })
})
