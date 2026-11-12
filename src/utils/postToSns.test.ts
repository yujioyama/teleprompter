import { describe, expect, it } from 'vitest'
import { coverOffsetMs, diagnose, fullNetworks, nextSlot, OTHER_HOURS, postTimeLabel, roomLabel, upcomingSlots, whenLabel, youtubeScheduleHint } from './postToSns'

describe('nextSlot', () => {
  it('is today when the hour is still ahead, tomorrow when it has passed', () => {
    const morning = new Date(2026, 10, 7, 8, 30)
    expect(nextSlot(12, morning)).toEqual(new Date(2026, 10, 7, 12, 0))
    const evening = new Date(2026, 10, 7, 20, 0)
    expect(nextSlot(20, evening)).toEqual(new Date(2026, 10, 8, 20, 0))
    expect(nextSlot(12, evening)).toEqual(new Date(2026, 10, 8, 12, 0))
  })
})

describe('postTimeLabel', () => {
  it('says today or tomorrow', () => {
    const afternoon = new Date(2026, 10, 7, 13, 0)
    expect(postTimeLabel('now', afternoon)).toBe('今すぐ')
    expect(postTimeLabel(12, afternoon)).toBe('明日 12:00')
    expect(postTimeLabel(20, afternoon)).toBe('今日 20:00')
  })
})

describe('upcomingSlots', () => {
  it('walks every 12:00 and 20:00 from now, five days of them', () => {
    const slots = upcomingSlots(new Date(2026, 10, 7, 13, 0))
    expect(slots).toHaveLength(10)
    expect(slots[0]).toEqual(new Date(2026, 10, 7, 20, 0))
    expect(slots[1]).toEqual(new Date(2026, 10, 8, 12, 0))
    expect(slots[9]).toEqual(new Date(2026, 10, 12, 12, 0))
  })

  it('leaves out a slot too close for the upload to finish', () => {
    expect(upcomingSlots(new Date(2026, 10, 7, 11, 55))[0]).toEqual(new Date(2026, 10, 7, 20, 0))
    expect(upcomingSlots(new Date(2026, 10, 7, 11, 45))[0]).toEqual(new Date(2026, 10, 7, 12, 0))
  })

  it('crosses a month end', () => {
    expect(upcomingSlots(new Date(2026, 10, 30, 21, 0))[0]).toEqual(new Date(2026, 11, 1, 12, 0))
  })
})

describe('whenLabel', () => {
  it('says today, tomorrow, or the date with its day of the week', () => {
    const now = new Date(2026, 10, 7, 13, 0)
    expect(whenLabel(new Date(2026, 10, 7, 20, 0), now)).toBe('今日 20:00')
    expect(whenLabel(new Date(2026, 10, 8, 12, 0), now)).toBe('明日 12:00')
    expect(whenLabel(new Date(2026, 10, 12, 20, 0), now)).toBe('11/12(木) 20:00')
    // Same day of another month is not today.
    expect(whenLabel(new Date(2026, 11, 7, 12, 0), now)).toBe('12/7(月) 12:00')
  })

  it('names the free slot choice', () => {
    expect(postTimeLabel('free')).toBe('次の空き')
  })
})

describe('youtubeScheduleHint', () => {
  it('names the time to pick in YouTube', () => {
    const at = new Date(2026, 10, 12, 20, 0).toISOString()
    expect(youtubeScheduleHint(at, new Date(2026, 10, 7, 13, 0))).toContain('11/12(木) 20:00')
  })
})

describe('coverOffsetMs', () => {
  it('points at the cover frames, or leaves the default', () => {
    expect(coverOffsetMs('first', 1, 20)).toBe(0)
    expect(coverOffsetMs('last', 2, 20)).toBe(19967)
    expect(coverOffsetMs('last', 1, 0)).toBeUndefined()
    expect(coverOffsetMs('none', 1, 20)).toBeUndefined()
  })
})

describe('diagnose', () => {
  it('points at the setting to fix', () => {
    const bad = { ok: false, detail: 'HTTP 403 InvalidAccessKeyId' }
    const good = { ok: true, detail: 'HTTP 200' }
    expect(diagnose({ upload: bad, publicRead: bad })).toContain('R2_ACCESS_KEY_ID')
    expect(diagnose({ upload: good, publicRead: { ok: false, detail: 'HTTP 401' } })).toContain('R2_PUBLIC_URL')
    expect(diagnose({ upload: good, publicRead: good })).toContain('CORS')
  })
})

describe('OTHER_HOURS', () => {
  it('is every hour but the daily 12:00 and 20:00', () => {
    expect(OTHER_HOURS).toHaveLength(22)
    expect(OTHER_HOURS).toContain(13)
    expect(OTHER_HOURS).not.toContain(12)
    expect(OTHER_HOURS).not.toContain(20)
  })

  it('reads as today or tomorrow like the slots', () => {
    const noon = new Date(2026, 10, 7, 12, 30)
    expect(postTimeLabel(13, noon)).toBe('今日 13:00')
    expect(postTimeLabel(11, noon)).toBe('明日 11:00')
  })
})

describe('roomLabel and fullNetworks', () => {
  const networks = [
    { service: 'instagram', reserved: 7, left: 3 },
    { service: 'tiktok', reserved: 10, left: 0 },
    { service: 'twitter', reserved: 8, left: 2 },
  ]

  it('says how many more fit by the fullest network, and each count', () => {
    expect(roomLabel(networks)).toBe('Bufferの予約: あと0本（Instagram 7・TikTok 10・X 8 / 10本）')
  })

  it('names the full networks, or none', () => {
    expect(fullNetworks(networks)).toBe('TikTok')
    expect(fullNetworks([networks[0]])).toBe('')
  })
})
