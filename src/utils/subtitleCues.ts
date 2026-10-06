export interface SubtitleCue {
  id: string
  start: number
  end: number
  en: string
  ja: string | null
}

export function buildClaudePrompt(cues: SubtitleCue[]): string {
  const lines = cues.map((cue, i) => `${i + 1}. ${cue.en}`).join('\n')
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

【出力】
- 「番号. 日本語訳」の形式のみ。番号と行数は英語と完全に一致させる
- 前置きや説明は不要

【英語セリフ】
${lines}`
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

  return {
    ok: true,
    cues: cues.map((cue, i) => ({ ...cue, ja: map.get(i + 1)! })),
  }
}

export interface ShotCueInput {
  text: string
  duration: number
}

// Cue timing follows the requested trim durations exactly; it does not
// correct for the few-ms encoder/frame-rounding drift that can accumulate
// across re-encoded clips — imperceptible for sentence-length cues.
export function cuesFromShotEntries(entries: ShotCueInput[]): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  let offset = 0
  entries.forEach((entry, i) => {
    const text = entry.text.trim()
    if (text) {
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
export function cuesForShot(cues: SubtitleCue[], shotStart: number, shotDuration: number): SubtitleCue[] {
  const shotEnd = shotStart + shotDuration
  const out: SubtitleCue[] = []
  for (const cue of cues) {
    const start = Math.max(cue.start, shotStart)
    const end = Math.min(cue.end, shotEnd)
    if (end - start <= 1e-6) continue
    out.push({ ...cue, start: start - shotStart, end: end - shotStart })
  }
  return out
}
