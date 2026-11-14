import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { keyMatches } from './auth.js'
import type { InboxStore } from './inboxStore.js'
import type { SubtitleStore } from './subtitleStore.js'
import type { RecordStore } from './recordStore.js'
import { JAPANESE_SUBTITLE_RULES } from '../shared/japaneseSubtitles.js'
import { captionWithCredits } from '../shared/inbox.js'

/** `value` as line numbers when it came as text ("[1,3]" or "1, 3"); anything else as it is. */
function lineNumbersFromText(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim().replace(/^\[|\]$/g, '')
  if (text === '') return []
  const parts = text.split(/[\s,]+/).filter(Boolean)
  return parts.every(part => /^\d+$/.test(part)) ? parts.map(Number) : value
}

export const TOOL_NAME = 'send_to_teleprompter'
export const SUBTITLES_TOOL_NAME = 'send_subtitles'
export const RECORDS_TOOL_NAME = 'list_video_records'

/** The stores the tools write to, created lazily so a bad key never touches Redis. */
export interface McpDeps {
  inbox: () => InboxStore
  subtitles: () => SubtitleStore
  records: () => RecordStore
}

const DESCRIPTION = [
  '完成したTikTokのスクリプトとキャプションを、ユーザーのteleprompterアプリの受け取り箱に送ります。',
  'ユーザーが「teleprompterに送って」などと頼んだときに使ってください。',
  'script には読み上げる本文だけを書きます。1ショット＝1行（改行で区切る）にし、見出し・ト書き・番号・空行は入れません。',
  '各行で要になる語句は *…* で囲みます（1行に0〜1か所。例: I *carry a torch* for him）。字幕でその語句が黄色になり、読み上げ画面では * は表示されません。',
  'その回に紹介する日本語の単語は {…} で囲みます（台本全体で1か所。例: In Japanese, we call it {ukon}.）。字幕でその単語がミント色になり（日本語字幕の対応する単語も同じ色）、読み上げ画面では { } は表示されません。',
  '1行目（最初のショット）には、その回の話題のモノや場面を表す絵文字を1つだけ入れます（例: I put *Vaseline*🧴 on my eyebrows every night.）。抽象的な英語フレーズの回は、文字どおりの意味の絵文字にします（例: carry a torch → 🔦）。この絵文字は字幕の文字には出ず、最初のショットの間、顔の横に大きなステッカーとして表示されます。途中の行（1行目と最終行以外）のうち、話の山場（話が転がる行や、オチの直前の盛り上がり）の行に、合計で最大2行まで絵文字を1つずつ入れます。モノの名前が出てくるだけの行には入れません。これも字幕の文字には出ず、そのショットで小さな妖精として一瞬横切り、その行では画面がじわっと寄ります（ただし最後の行の直前の行は寄らず、最後の行でカットの瞬間に寄ります）。最終行には絵文字を入れません（1行目の絵文字が最後のショットで自動的に戻ってきます）。',
  'type には動画の型を入れます。A＝2021年型（3〜6行の短い日常の話）、B＝表現ノート型（1つの英単語から小さな話を重ねる話）。週ごとの分析で動画を型別に比べるための記録で、演出は変わりません（型があってもなくても、冒頭は映画のような黒帯が上下に出て、1行目のあいだ映ってから開く）。どちらでもない台本は省略します。',
  'caption には投稿用のキャプション（ハッシュタグ込み）を入れます。無ければ省略します。',
  'images には、行ごとに見せる画像を入れます（任意。1行に0〜1枚。例: [{ line: 4, url: "https://….jpg", credit: "KKPCW / CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:…" }]）。line は script の何行目か（1から数える）、url は https の画像そのものの URL（幅1280px程度。SVG は不可）です。その行の字幕が出ているあいだ、頭の上に角丸の枠で表示され、その行の字幕は胸のあたりに下がります（1行目も同じ。画像のない行の字幕は上に出ます）。1行目の画像は、オチを先に見せないものを選んでください。',
  '画像を1枚でも付けた回は、絵文字のステッカーも妖精も一切出ません（1行目の絵文字はこれまでどおり書いてください。出すかどうかはアプリが決めます）。画像が無い回は今までどおりです。',
  '画像を選ぶときは、クレジットが要らない画像を優先してください（CC0、パブリックドメイン、Unsplash、Pexels）。そのときは credit と source を省略します。それで見つからないときだけ CC BY を、最後の手段として CC BY-SA を選び、credit に「作者名 / ライセンス」、source に出典ページの URL を入れます。credit は画像の下に小さく表示され、source とともにキャプションの末尾に自動で追記されるので、caption には書かないでください。',
  'heard には、会話を再現する台本で「相手のセリフ」の行番号を入れます（任意。例: 1行目と3行目が相手なら [1, 3]。script の何行目か、1から数える）。その行は、ユーザーが自分でセリフを声に出したあと黙って聞く顔を撮り、動画では聞いている顔に声だけがのります（画面の外から話しかけられている形）。heard を付けた台本は1行ずつ撮ります。相手のセリフの行は script にそのまま書き（引用符や話者名は付けない）、絵文字は入れません。語り手ひとりの台本では省略します。相手のセリフの字幕は水色の文字で吹き出しに入り、吹き出しの左上に相手のアイコン（白い丸に絵文字）が付きます。heardIcon に相手を表す絵文字を1つ入れてください。性別や役が見て分かるものにします（例: 男の人なら 👨、女の人なら 👩、子どもなら 🧒、店員なら 🧑‍🍳。性別のない 🧑 は使わない。省略すると 🗣️）。声とそろえます（low なら男の人、high なら女の人）。heardVoice で相手の声を選べます（ユーザーが自分の声で言ったセリフにかかる）: kid=子ども、high=高い声（女の人）、low=低い声（男の人）、fast=早回し（高く速く）、slow=スロー（低くゆっくり）、phone=電話、natural=そのまま（省略時）。相手が2人以上いる会話（例: 子どもとその母）では、heardCast に1人ずつ { lines: その人のセリフの行番号, icon: 絵文字, voice: 声 } を入れます（heard と heardIcon / heardVoice は省略してよく、heardCast の行が相手のセリフになります）。声は人ごとに聞き分けられるものを選んでください（例: 子ども kid、母 high）。',
  '送ったあとに直した版を送り直すときは、前と同じ title で送ってください。受け取り箱でまだ開かれていない同じタイトルの前の版が、新しい版に置き換わります。',
  'japanese には、script の各行の日本語字幕を、番号なしで1行ずつ、script と同じ順番・同じ行数で入れます。アプリの字幕画面に最初から入ります。*…* と絵文字は日本語には入れません（{…} は下のルールどおりに付けます）。日本語字幕は次のルールで作ります。',
  JAPANESE_SUBTITLE_RULES,
].join('\n')

const SUBTITLES_DESCRIPTION = [
  'teleprompterアプリの「Claude用プロンプト」で頼まれた日本語字幕を、アプリに送り返します。',
  'プロンプトの【teleprompterへの送信】に書かれた request_id をそのまま使い、訳を番号なしで1行ずつ、順番どおりに lines に入れてください。',
].join('\n')

const RECORDS_DESCRIPTION = [
  'teleprompterアプリで「保存する」を押した完成動画の制作記録を返します（1台本につき最後の保存の1件、新しい順のJSON）。',
  'TikTokなどの動画を、hookLine（字幕の1行目。*や絵文字なし）と savedAt（保存日時。投稿はその後。予約投稿なら postAt が投稿される日時で、数日後のことがある）で突き合わせると、その動画の作り方が分かります。',
  'effects: hookStyle/hookPosition（最初のショットのフック字幕）、zoom（最初のショットのズーム。direction=outは寄った画から始まる）、sticker（顔の横の絵文字ステッカー）、fairies（途中の妖精と最後のフィナーレ）、subtitles、bgm、voicePreset、trim（無音の余白の秒数: firstStart=最初のショットの前、start/end=各ショットの前後、lastEnd=最後のショットの後ろ、pauseShots=「間を残す」にしたショット数。nullは不明）、midZoom（中盤のズーム: 山場の行でじわっと寄り、最後の行で寄る。trueなら使った。項目が無いのは導入前の記録）、oneTake（一発撮り: 台本全体を1回で撮り、字幕を行ごとに切り替えた。trueなら一発撮り。項目が無いのは導入前の記録）、videoType（A＝2021年型、B＝表現ノート型。無いのは型なしか2026-11-02より前）、opening（冒頭の演出: letterbox＝黒帯が開く、colorPop＝1行目の語句で色づく（2026-11-03より前のType B）。atは動き始める秒、look（冒頭の色: hollywood/oldFilm/nightBlue/mono/glitch。nullは無し、項目が無いのは導入前）。openingそのものがnullなら無し、項目が無いのは導入前）、lineImages（行ごとの画像を見せた枚数。その回は sticker も fairies も出ない。項目が無いのは画像なしか導入前）。',
].join('\n')

// The app's request id ends in its English line count (e.g. "1x9kq2c-6").
const REQUEST_ID = /^[0-9a-z]{1,13}-([1-9][0-9]{0,2})$/
// "1. 訳" — the prompt's numbered output, which would end up on screen. The
// space is required so a line like "3.5倍" or "3、4回" still goes through.
const NUMBERED = /^\d+[.．]\s/

function textResult(text: string, isError = false) {
  return { ...(isError ? { isError: true } : {}), content: [{ type: 'text' as const, text }] }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function buildServer({ inbox, subtitles, records }: McpDeps): McpServer {
  const server = new McpServer({ name: 'teleprompter', version: '1.0.0' })
  server.registerTool(
    TOOL_NAME,
    {
      title: 'teleprompterに送る',
      description: DESCRIPTION,
      inputSchema: {
        title: z.string().trim().min(1).max(100).describe('動画のタイトル（スクリプト一覧に出る名前）'),
        script: z.string().trim().min(1).max(10_000).describe('読み上げる本文。1ショット＝1行'),
        caption: z.string().trim().max(4_000).optional().describe('TikTokに投稿するキャプション（ハッシュタグ込み）'),
        type: z.enum(['A', 'B']).optional().describe('動画の型（分析用の記録）。A＝2021年型（短い日常）、B＝表現ノート型'),
        japanese: z
          .array(z.string().trim().min(1).max(200))
          .max(300)
          .optional()
          .describe('日本語字幕。番号なしで1行ずつ、script と同じ順番・同じ行数'),
        images: z
          .array(
            z.object({
              line: z.number().int().min(1).describe('script の何行目か（1から数える）'),
              url: z.string().url().max(2_000).startsWith('https://').describe('画像そのものの https の URL'),
              credit: z.string().trim().min(1).max(120).optional().describe('「作者名 / ライセンス」。クレジットが要らない画像は省略'),
              source: z.string().url().max(2_000).optional().describe('出典ページの URL。クレジットが要らない画像は省略'),
            }),
          )
          .max(300)
          .optional()
          .describe('行ごとに見せる画像。1枚でもあるとステッカーと妖精は出ない'),
        heard: z
          // A client still holding the tool's older schema sends the numbers as text ("[1,3]" or "1, 3").
          .preprocess(lineNumbersFromText, z.array(z.number().int().min(1)).max(300))
          .optional()
          .describe('相手のセリフの行番号（script の何行目か、1から数える）。会話を再現する台本だけ'),
        heardIcon: z
          .string()
          .trim()
          .min(1)
          .max(16)
          .optional()
          .describe('相手を表す絵文字1つ（相手のセリフの字幕の横に出る）。heard があるときだけ'),
        heardVoice: z
          .enum(['natural', 'kid', 'high', 'low', 'fast', 'slow', 'phone'])
          .optional()
          .describe('相手の声。kid=子ども / high=高い声 / low=低い声 / fast=早回し / slow=スロー / phone=電話 / natural=そのまま。heard があるときだけ'),
        heardCast: z
          .array(
            z.object({
              lines: z.preprocess(lineNumbersFromText, z.array(z.number().int().min(1)).min(1).max(300)).describe('その人のセリフの行番号'),
              icon: z.string().trim().min(1).max(16).optional().describe('その人を表す絵文字1つ'),
              voice: z.enum(['natural', 'kid', 'high', 'low', 'fast', 'slow', 'phone']).optional().describe('その人の声'),
            }),
          )
          .max(6)
          .optional()
          .describe('相手が2人以上の会話: 1人ずつ、その人のセリフの行番号・絵文字・声'),
      },
    },
    async ({ title, script, caption, japanese, type, images, heard, heardIcon, heardVoice, heardCast }) => {
      const body = script.replace(/\r\n?/g, '\n')
      const lines = body.split('\n').filter(line => line.trim()).length
      if (japanese) {
        if (japanese.some(line => NUMBERED.test(line))) {
          return textResult('japanese には番号を付けず、訳だけを1行ずつ入れて送り直してください。', true)
        }
        if (japanese.length !== lines) {
          return textResult(
            `japanese の行数が合いません。script は${lines}行、japanese は${japanese.length}行です。${lines}行で送り直してください。`,
            true,
          )
        }
      }
      for (const [i, image] of (images ?? []).entries()) {
        if (image.line > lines) {
          return textResult(`images の ${image.line}行目がありません。script は${lines}行です。`, true)
        }
        if (images!.findIndex(other => other.line === image.line) !== i) {
          return textResult(`images の ${image.line}行目に画像が2枚あります。1行に1枚で送り直してください。`, true)
        }
      }
      const cast = (heardCast ?? []).map(member => ({
        lines: [...new Set(member.lines)].sort((a, b) => a - b),
        ...(member.icon ? { icon: member.icon } : {}),
        ...(member.voice && member.voice !== 'natural' ? { voice: member.voice } : {}),
      }))
      const twice = cast.flatMap(m => m.lines).find((line, i, all) => all.indexOf(line) !== i)
      if (twice !== undefined) {
        return textResult(`heardCast で ${twice}行目が2人に入っています。1行は1人で送り直してください。`, true)
      }
      const heardLines = [...new Set([...(heard ?? []), ...cast.flatMap(m => m.lines)])].sort((a, b) => a - b)
      const missing = heardLines.find(line => line > lines)
      if (missing !== undefined) {
        return textResult(`heard の ${missing}行目がありません。script は${lines}行です。`, true)
      }
      try {
        const { item, replaced } = await inbox().add({
          title,
          body,
          caption: captionWithCredits(caption ?? '', images ?? []),
          japanese,
          images,
          ...(heardLines.length ? { heard: heardLines, ...(heardIcon ? { heardIcon } : {}), ...(heardVoice && heardVoice !== 'natural' ? { heardVoice } : {}), ...(cast.length ? { heardCast: cast } : {}) } : {}),
          ...(type ? { videoType: type } : {}),
        })
        const note = replaced > 0 ? '受け取り箱にあった同じタイトルの前の版は置き換えました。' : ''
        const withJapanese = (japanese ? '・日本語訳つき' : '') + (type ? `・Type ${type}` : '') +
          (images?.length ? `・画像${images.length}枚つき` : '') +
          (heardLines.length ? `・相手のセリフ${heardLines.length}行` : '')
        return textResult(
          `『${item.title}』をteleprompterに送りました（${lines}行${withJapanese}）。${note}teleprompterのホーム画面に届いています。`,
        )
      } catch (err) {
        console.error('send_to_teleprompter failed', err)
        return textResult(`受け取り箱に保存できませんでした: ${errorText(err)}`, true)
      }
    },
  )
  server.registerTool(
    SUBTITLES_TOOL_NAME,
    {
      title: 'teleprompterに日本語字幕を送る',
      description: SUBTITLES_DESCRIPTION,
      inputSchema: {
        request_id: z.string().regex(REQUEST_ID).describe('プロンプトに書かれた request_id'),
        lines: z
          .array(z.string().trim().min(1).max(200))
          .min(1)
          .max(300)
          .describe('日本語訳。番号なしで1行ずつ、英語セリフと同じ順番・同じ行数'),
      },
    },
    async ({ request_id, lines }) => {
      if (lines.some(line => NUMBERED.test(line))) {
        return textResult('lines には番号を付けず、訳だけを1行ずつ入れて送り直してください。', true)
      }
      const expected = Number(REQUEST_ID.exec(request_id)![1])
      if (lines.length !== expected) {
        return textResult(
          `行数が合いません。英語セリフは${expected}行、送られた訳は${lines.length}行です。${expected}行で送り直してください。`,
          true,
        )
      }
      try {
        await subtitles().put(request_id, lines)
        return textResult(`日本語字幕${lines.length}行をteleprompterに送りました。teleprompterの字幕画面に戻ると反映されます。`)
      } catch (err) {
        console.error('send_subtitles failed', err)
        return textResult(`字幕を保存できませんでした: ${errorText(err)}`, true)
      }
    },
  )
  server.registerTool(
    RECORDS_TOOL_NAME,
    {
      title: 'teleprompterの制作記録を読む',
      description: RECORDS_DESCRIPTION,
      inputSchema: {
        since: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}/)
          .optional()
          .describe('この日付（YYYY-MM-DD）以降に保存された記録だけを返す'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ since }) => {
      try {
        const found = await records().list(since)
        return textResult(found.length === 0 ? '記録はまだありません' : JSON.stringify(found, null, 2))
      } catch (err) {
        console.error('list_video_records failed', err)
        return textResult(`記録を読めませんでした: ${errorText(err)}`, true)
      }
    },
  )
  return server
}

/**
 * The MCP endpoint Claude chat calls as a custom connector. Stateless: every
 * POST gets a fresh server and transport, and replies with plain JSON, so it
 * runs as an ordinary short-lived function. The key rides in the URL because
 * that is all a custom connector without OAuth can send.
 */
export async function handleMcpRequest(request: Request, deps: McpDeps): Promise<Response> {
  if (!keyMatches(new URL(request.url).searchParams.get('key'))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await buildServer(deps).connect(transport)
  return transport.handleRequest(request)
}
