import { describe, it, expect } from 'vitest'
import { STICKER_MAX_SCALE, STICKER_TRIPS, placeSticker, stickerPath, stickerSeed, stickerTrip, type StickerPose } from './stickerMotion'

const RIGHT = { x: 0.82, y: 0.42, rotation: 8 }
const CHEST = { x: 0.5, y: 0.66, rotation: -6 }

const samples = (path: (t: number) => StickerPose, duration: number, fps = 30) =>
  Array.from({ length: Math.floor(duration * fps) + 1 }, (_, i) => path(Math.min(duration, i / fps)))

const expectAtHome = (pose: StickerPose, home: typeof RIGHT) => {
  expect(pose.x).toBeCloseTo(home.x, 6)
  expect(pose.y).toBeCloseTo(home.y, 6)
  expect(pose.rotation % 360).toBeCloseTo(home.rotation, 6)
  expect(pose.scale).toBeCloseTo(1, 6)
}

describe('stickerPath', () => {
  it('does not move with motion none, or when the first shot is too short for a trip', () => {
    expect(stickerPath('none', 1, RIGHT, 4)).toBeNull()
    expect(stickerPath('wander', 1, RIGHT, 1)).toBeNull()
    expect(stickerPath('wander', 1, RIGHT, 1.3)).not.toBeNull()
  })

  for (const motion of STICKER_TRIPS) {
    for (const home of [RIGHT, CHEST]) {
      it(`${motion} from ${home.x},${home.y}: starts and ends at home, within the frame`, () => {
        for (const seed of [1, 42, 999, 123456]) {
          for (const duration of [1.4, 3, 6]) {
            const path = stickerPath(motion, seed, home, duration)!
            expectAtHome(path(0), home)
            expectAtHome(path(duration), home)
            for (const p of samples(path, duration)) {
              expect(p.x).toBeGreaterThanOrEqual(0.1)
              expect(p.x).toBeLessThanOrEqual(0.9)
              expect(p.y).toBeGreaterThanOrEqual(0.2)
              expect(p.y).toBeLessThanOrEqual(0.8)
              expect(p.scale).toBeGreaterThanOrEqual(0)
              expect(p.scale).toBeLessThanOrEqual(STICKER_MAX_SCALE)
            }
          }
        }
      })
    }
  }

  it('only jumps when warping: every other trip moves smoothly from frame to frame', () => {
    for (const motion of STICKER_TRIPS.filter(m => m !== 'warp')) {
      const poses = samples(stickerPath(motion, 7, RIGHT, 3)!, 3, 60)
      for (let i = 1; i < poses.length; i++) {
        expect(Math.hypot(poses[i].x - poses[i - 1].x, poses[i].y - poses[i - 1].y)).toBeLessThan(0.12)
      }
    }
  })

  it('warps while shrunk away: a jump in place happens only at scale 0', () => {
    const poses = samples(stickerPath('warp', 7, RIGHT, 3)!, 3, 600)
    for (let i = 1; i < poses.length; i++) {
      const moved = Math.hypot(poses[i].x - poses[i - 1].x, poses[i].y - poses[i - 1].y) > 1e-9
      if (moved) expect(Math.min(poses[i].scale, poses[i - 1].scale)).toBeLessThan(0.05)
    }
  })

  it('never stops on the face when warping', () => {
    for (let seed = 0; seed < 30; seed++) {
      for (const p of samples(stickerPath('warp', seed, RIGHT, 4)!, 4)) {
        if (p.scale < 1) continue
        expect(((p.x - 0.5) / 0.22) ** 2 + ((p.y - 0.4) / 0.15) ** 2).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('takes the same route for the same seed, and another for another seed', () => {
    const a = samples(stickerPath('wander', 5, RIGHT, 3)!, 3)
    expect(samples(stickerPath('wander', 5, RIGHT, 3)!, 3)).toEqual(a)
    expect(samples(stickerPath('wander', 6, RIGHT, 3)!, 3)).not.toEqual(a)
  })

  it('おまかせ is one of the trips, picked by the seed', () => {
    const picked = new Set<string>()
    for (let seed = 0; seed < 60; seed++) {
      const trip = stickerTrip('random', seed)!
      picked.add(trip)
      expect(samples(stickerPath('random', seed, RIGHT, 3)!, 3)).toEqual(samples(stickerPath(trip, seed, RIGHT, 3)!, 3))
    }
    expect([...picked].sort()).toEqual([...STICKER_TRIPS].sort())
    expect(stickerTrip('orbit', 3)).toBe('orbit')
    expect(stickerTrip('none', 3)).toBeNull()
  })
})

describe('stickerSeed', () => {
  it('is fixed per cue text and re-rolled by the route counter', () => {
    expect(stickerSeed('I put *Vaseline*🧴 on', 0)).toBe(stickerSeed('I put *Vaseline*🧴 on', 0))
    expect(stickerSeed('I put *Vaseline*🧴 on', 1)).not.toBe(stickerSeed('I put *Vaseline*🧴 on', 0))
    expect(stickerSeed('Other 🧴', 0)).not.toBe(stickerSeed('I put *Vaseline*🧴 on', 0))
  })
})

describe('placeSticker sparkles', () => {
  const CUES = [{ start: 0, end: 3, en: 'I put *Vaseline*🧴 on', ja: 'ワセリン', variant: 'hook' }]

  it("trails sparkles while travelling, bursts on landing, and all die by the first shot's end", () => {
    const s = placeSticker(CUES, { sticker: 'right', stickerMotion: 'wander', stickerRoute: 0 }, 3)!
    expect(s.sparkles.filter(p => Math.abs(p.born - (3 - 0.4)) < 1e-9)).toHaveLength(18)
    for (const p of s.sparkles) expect(p.born + p.life).toBeLessThanOrEqual(3 + 1e-9)
  })
  it('twinkles a still sticker', () => {
    const s = placeSticker(CUES, { sticker: 'right', stickerMotion: 'none', stickerRoute: 0 }, 3)!
    expect(s.sparkles.length).toBeGreaterThan(10)
    expect(s.sparkles.length).toBeLessThan(30)
  })
  it('twinkles through a first shot too short for a trip', () => {
    const s = placeSticker(CUES, { sticker: 'right', stickerMotion: 'wander', stickerRoute: 0 }, 1)!
    expect(s.path).toBeNull()
    expect(s.sparkles.length).toBeGreaterThan(0)
  })
})

describe('placeSticker behind the opening bars', () => {
  // 一発撮り: line 1 is the first shot (0-2.5), the bars are gone at 2.5, line 2 runs to 6.
  const CUES = [
    { start: 0, end: 2.5, en: 'I put *Vaseline*🧴 on', ja: 'ワセリン', variant: 'hook' },
    { start: 2.5, end: 6, en: 'every night.', ja: '毎晩', variant: 'normal' },
  ]
  const BARS = { kind: 'letterbox' as const, at: 1.7, height: 0.22, grade: null }
  const hook = { sticker: 'right' as const, stickerMotion: 'wander' as const, stickerRoute: 0, opening: BARS }

  it('shows over the whole first shot without the bars', () => {
    const s = placeSticker(CUES, { ...hook, opening: null }, 2.5, 10)!
    expect([s.start, s.end]).toEqual([0, 2.5])
  })

  it('pops in as the bars have gone and travels through line 2', () => {
    const s = placeSticker(CUES, hook, 2.5, 10)!
    expect([s.start, s.end]).toEqual([2.5, 6])
    expect(s.path).not.toBeNull()
    expect(s.path!(2.5).scale).toBeCloseTo(0)
    expect(s.path!(2.5 + 0.3).scale).toBeCloseTo(1)
    for (const p of s.sparkles) {
      expect(p.born).toBeGreaterThanOrEqual(2.5)
      expect(p.born + p.life).toBeLessThanOrEqual(6 + 1e-9)
    }
  })

  it('stays put after popping in when line 2 is too short to travel', () => {
    const short = [CUES[0], { ...CUES[1], end: 3.3 }]
    const s = placeSticker(short, hook, 2.5, 10)!
    expect([s.start, s.end]).toEqual([2.5, 3.3])
    const pose = s.path!(3)
    expect([pose.x, pose.y, pose.scale]).toEqual([s.home.x, s.home.y, 1])
  })

  it("never outlasts the clip, and falls back to the whole first shot when there's no time after the bars", () => {
    expect(placeSticker(CUES, hook, 2.5, 4)!.end).toBe(4)
    const s = placeSticker(CUES, hook, 2.5)!
    expect([s.start, s.end]).toEqual([0, 2.5])
  })
})
