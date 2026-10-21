import { stripThemeEmphasis } from './subtitleEmphasis'

export interface SubtitleCue {
  id: string
  start: number
  end: number
  en: string
  ja: string | null
}

/**
 * With a `requestId` (this device can receive from the connector), Claude is
 * also asked to send the lines back with send_subtitles, so they arrive in
 * the subtitle step without pasting.
 */
export function buildClaudePrompt(cues: SubtitleCue[], requestId?: string): string {
  // The *theme* markers are for the burn-in only, not for translating. The
  // {word} ones stay: the translator marks the same word in Japanese, so
  // it is colored in both lines.
  const lines = cues.map((cue, i) => `${i + 1}. ${stripThemeEmphasis(cue.en)}`).join('\n')
  return `以下は、僕（Yuji）のショート動画の英語セリフです。動画に焼き込む日本語字幕を作ってください。

【話し手】
日本在住の30代の日本人男性で、ゲイ。英語は第二言語。視聴者には女性が多い。
落ち着いた淡々とした話し方で、自分を少し観察しすぎるタイプ。ドライなユーモアがあり、最後に静かなオチがある。

【口調】
- ふだんの行は、軽くオネエ寄りの口語（「〜したの」「〜なの」「〜なんだけど」「〜かも」）。です・ます調は使わない
- オチ・ツッコミ・本音の行では、オネエ全開で語尾を伸ばして感情を乗せる（「〜のよぉぉぉ」「〜じゃないのぉ」「〜だわぁ」）。淡々とした前振りとの落差で笑わせる
  例：I spent three hours picking a shirt. / Nobody noticed. → 「シャツ選びに3時間かけたの / 誰も気づかなかったのよぉぉぉ」
- 語尾を伸ばすのは要所だけにし、全行には付けない
- 一人称は「私」
- 「！」や絵文字は使わない
- 行末の「。」は付けない（文の途中の「。」は可）

【訳し方】
- 直訳ではなく、日本人が同じ場面で実際に言う言い方にする
- 読み切れる長さを優先する。英語の情報を全部入れなくていい。目安は1行40字以内
- オチになる言葉は、その行の最後に来るよう語順を変える
- 「つまり」「〜というわけです」「〜ということです」などの説明口調や、主語（私は／彼は）の多用を避ける
- 英語の言葉遊びが訳せない場合は、日本語で同じ笑いになる言い方を優先する

【固有名詞・伝わりにくい言葉】
優先順位は上から順に適用する。
1. 動画のテーマになっている英単語・英語フレーズは、訳さず英語のまま残す（例：「drama」を「ドラマ」にしない）
2. 英語台本の中に出てくる日本語（ローマ字表記）は、日本語表記に戻す（例：bosozoku → 暴走族、kujuu wo nameru → 苦汁をなめる）
3. 人名・作品名・ブランド名は、日本の視聴者が知っているかどうかで書き方を変える
   - 日本でも有名なもの：日本で一般的な表記にする。日本語タイトルがある作品はそれを使う（例：Mariah Carey → マライア・キャリー、Gossip Girl → ゴシップガール）
   - 日本であまり知られていないもの：名前より「それが何か」が伝わる言い方にする（例：無名の番組名 → 「オーストラリアのリアリティ番組」、海外の歌手 → 「オーストラリアの歌手」）
   - ただし、その名前自体がオチや話の中心になっている場合は、カタカナ表記の名前に短い説明を添える（例：「オーストラリアの歌手の〇〇」）
4. 日本人に通じにくい英語圏の習慣・スラング・文化的な話は、短い言い換えで意味が伝わるようにする。注釈やカッコ書きの説明は付けない

【{…} で囲まれた語句】
英語セリフの中で {…} で囲まれた語句は、その回に紹介する日本語の単語です（字幕で色が付きます）。
- その行の日本語訳でも、対応する日本語の単語を {…} で囲む（日本語表記に戻したうえで。例：In Japanese, we call it {ukon}. → 日本語だと{ウコン}って言うの）
- 囲むのはその1か所だけ。ほかの行や、ほかの語句には {…} を付けない

【出力】
- 「番号. 日本語訳」の形式のみ。番号と行数は英語と完全に一致させる
- 前置きや説明は不要
${requestId ? sendBackSection(requestId, cues.length) : ''}
【英語セリフ】
${lines}`
}

function sendBackSection(requestId: string, lineCount: number): string {
  return `
【teleprompterへの送信】
まず teleprompter コネクタの send_subtitles ツールを呼び出して、翻訳した各行を送ってください。そのあとで、上の【出力】の形式で訳を表示してください。
- request_id: ${requestId}
- lines: 翻訳した各行を番号なしで1行ずつ、英語セリフと同じ順番で（${lineCount}行）
ツールが見つからないときは、【出力】の形式で表示するだけで構いません。
`
}

interface ParseSuccess {
  ok: true
  cues: SubtitleCue[]
}

interface ParseFailure {
  ok: false
  error: string
}

const NUMBERED_LINE = /^\s*(\d+)\.\s*(.+?)\s*$/

export function parseJapanesePaste(text: string, cues: SubtitleCue[]): ParseSuccess | ParseFailure {
  const map = new Map<number, string>()
  for (const rawLine of text.split('\n')) {
    const m = NUMBERED_LINE.exec(rawLine)
    if (!m) continue
    map.set(parseInt(m[1], 10), m[2])
  }

  const missing: number[] = []
  for (let i = 1; i <= cues.length; i++) {
    if (!map.has(i)) missing.push(i)
  }
  const extra = [...map.keys()].filter(n => n < 1 || n > cues.length)

  if (missing.length > 0 || extra.length > 0) {
    const parts: string[] = []
    if (missing.length > 0) parts.push(`不足: ${missing.join(', ')}`)
    if (extra.length > 0) parts.push(`余分: ${extra.join(', ')}`)
    return {
      ok: false,
      error: `行数が一致しません（${parts.join(' / ')}）。番号を保ったまま貼り直してください。`,
    }
  }

  return withJapaneseLines(cues, cues.map((_, i) => map.get(i + 1)!))
}

/** Japanese lines onto the cues in the same positions, when the counts match. */
export function withJapaneseLines(cues: SubtitleCue[], lines: string[]): ParseSuccess | ParseFailure {
  if (lines.length !== cues.length) {
    return {
      ok: false,
      error: `行数が一致しません（英語${cues.length}行 / 日本語${lines.length}行）。`,
    }
  }
  return { ok: true, cues: cues.map((cue, i) => ({ ...cue, ja: lines[i] })) }
}

export interface ShotCueInput {
  text: string
  duration: number
  /**
   * 一発撮り: where each line after the first starts, in seconds from the
   * shot's first frame. With one start per line break, the shot is
   * subtitled line by line instead of with one cue.
   */
  lineStarts?: number[]
}

/** The lines of a 一発撮り shot's text, one subtitle each. */
export function takeLinesOf(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(line => line.length > 0)
}

/** A silence shorter than this is a breath inside a line, not a line break. */
const MIN_LINE_PAUSE_S = 0.2
/** No line is given less than this, however the pauses fall. */
const MIN_LINE_S = 0.5
/** The next line's subtitle shows a moment before its first word. */
const LINE_LEAD_S = 0.15

/**
 * Where each line after the first starts in a 一発撮り take, in seconds from
 * the clip's first frame (the clip being [clipStart, clipEnd] of the take).
 *
 * The lines are read with a pause between them, so the longest pauses in
 * the speech are taken as the line breaks — skipping any that would leave a
 * line implausibly short. When there aren't enough pauses (or none were
 * found), the clip is shared out by each line's length instead. Either way
 * the subtitle editor can move a break by hand afterwards.
 */
export function lineStartsInTake(
  lines: string[],
  clipStart: number,
  clipEnd: number,
  pauses?: { start: number; end: number }[],
): number[] {
  const breaks = lines.length - 1
  const duration = clipEnd - clipStart
  if (breaks <= 0 || duration <= 0) return []

  const inside = (pauses ?? [])
    .filter(p => p.end - p.start >= MIN_LINE_PAUSE_S && p.start > clipStart && p.end < clipEnd)
    .sort((a, b) => b.end - b.start - (a.end - a.start))
  const chosen: number[] = []
  for (const pause of inside) {
    if (chosen.length === breaks) break
    // The next line starts just before speech resumes, never inside the pause's first half.
    const at = Math.max((pause.start + pause.end) / 2, pause.end - LINE_LEAD_S) - clipStart
    // Every line keeps at least MIN_LINE_S: far enough from each break so far and both ends.
    if ([0, ...chosen, duration].every(b => Math.abs(b - at) >= MIN_LINE_S)) chosen.push(at)
  }
  if (chosen.length === breaks) return chosen.sort((a, b) => a - b)

  // By length: each line's share of the clip, from its character count.
  const weights = lines.map(line => Math.max(1, line.length))
  const total = weights.reduce((sum, w) => sum + w, 0)
  const starts: number[] = []
  let acc = 0
  for (let i = 0; i < breaks; i++) {
    acc += weights[i]
    starts.push((acc / total) * duration)
  }
  return starts
}

// Cue timing follows the requested trim durations exactly; it does not
// correct for the few-ms encoder/frame-rounding drift that can accumulate
// across re-encoded clips — imperceptible for sentence-length cues.
export function cuesFromShotEntries(entries: ShotCueInput[]): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  let offset = 0
  entries.forEach((entry, i) => {
    const text = entry.text.trim()
    const lines = entry.lineStarts ? takeLinesOf(text) : []
    if (entry.lineStarts && lines.length > 1 && entry.lineStarts.length === lines.length - 1) {
      const bounds = [0, ...entry.lineStarts, entry.duration]
      lines.forEach((line, j) => {
        cues.push({ id: `shot-${i}-line-${j}`, start: offset + bounds[j], end: offset + bounds[j + 1], en: line, ja: null })
      })
    } else if (text) {
      cues.push({ id: `shot-${i}`, start: offset, end: offset + entry.duration, en: text, ja: null })
    }
    offset += entry.duration
  })
  return cues
}

/**
 * The cues that fall within one shot of the joined video, moved into that
 * shot's own timeline (0 = its first frame) and clipped to its length, for
 * burning subtitles into each shot separately. `shotStart` is where the
 * shot begins in the joined video. Cues touching the shot by less than a
 * rounding error are left out.
 */
export function cuesForShot<T extends SubtitleCue>(cues: T[], shotStart: number, shotDuration: number): T[] {
  const shotEnd = shotStart + shotDuration
  const out: T[] = []
  for (const cue of cues) {
    const start = Math.max(cue.start, shotStart)
    const end = Math.min(cue.end, shotEnd)
    if (end - start <= 1e-6) continue
    out.push({ ...cue, start: start - shotStart, end: end - shotStart })
  }
  return out
}

// A cue starting where a shot ends belongs to the next shot.
const CUT_EPSILON = 1e-6

/**
 * The cues of each shot of the joined video (`durations` in order), a cue
 * counted in the shot it starts in, in time order. Cues starting past the
 * last shot are left out.
 */
export function cuesByShot<T extends { start: number }>(cues: T[], durations: number[]): T[][] {
  const sorted = [...cues].sort((a, b) => a.start - b.start)
  let shotStart = 0
  return durations.map(duration => {
    const from = shotStart
    shotStart += duration
    return sorted.filter(c => c.start >= from - CUT_EPSILON && c.start < shotStart - CUT_EPSILON)
  })
}

/** Each shot's English subtitles joined, which is where its fairy's emoji is read from. */
export function shotTextsOf(cues: { start: number; en: string }[], durations: number[]): string[] {
  return cuesByShot(cues, durations).map(group => group.map(c => c.en).join(' '))
}

/** The shortest a line can be squeezed to by moving its neighbours' breaks. */
const MIN_SHIFTED_LINE_S = 0.3

/**
 * Move where cue `id` starts by `delta` seconds, the cue before it ending
 * there too, so the lines stay back to back. Neither line is squeezed
 * below MIN_SHIFTED_LINE_S; the first cue (nothing before it) can't move.
 */
export function shiftCueStart<T extends SubtitleCue>(cues: T[], id: string, delta: number): T[] {
  const i = cues.findIndex(c => c.id === id)
  if (i <= 0) return cues
  const prev = cues[i - 1]
  const cue = cues[i]
  const at = Math.min(Math.max(cue.start + delta, prev.start + MIN_SHIFTED_LINE_S), cue.end - MIN_SHIFTED_LINE_S)
  if (Math.abs(at - cue.start) < 1e-9) return cues
  return cues.map((c, j) => (j === i - 1 ? { ...c, end: at } : j === i ? { ...c, start: at } : c))
}
