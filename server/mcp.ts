import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { keyMatches } from './auth.js'
import type { InboxStore } from './inboxStore.js'
import type { SubtitleStore } from './subtitleStore.js'
import type { RecordStore } from './recordStore.js'

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
  '1行目（最初のショット）には、その回の話題のモノや場面を表す絵文字を1つだけ入れます（例: I put *Vaseline*🧴 on my eyebrows every night.）。抽象的な英語フレーズの回は、文字どおりの意味の絵文字にします（例: carry a torch → 🔦）。この絵文字は字幕の文字には出ず、最初のショットの間、顔の横に大きなステッカーとして表示されます。途中の行（1行目と最終行以外）のうち、話の山場（話が転がる行や、オチの直前の盛り上がり）の行に、合計で最大2行まで絵文字を1つずつ入れます。モノの名前が出てくるだけの行には入れません。これも字幕の文字には出ず、そのショットで小さな妖精として一瞬横切り、その行では画面がじわっと寄ります（最後の行はカットの瞬間に寄ります）。最終行には絵文字を入れません（1行目の絵文字が最後のショットで自動的に戻ってきます）。',
  'caption には投稿用のキャプション（ハッシュタグ込み）を入れます。無ければ省略します。',
].join('\n')

const SUBTITLES_DESCRIPTION = [
  'teleprompterアプリの「Claude用プロンプト」で頼まれた日本語字幕を、アプリに送り返します。',
  'プロンプトの【teleprompterへの送信】に書かれた request_id をそのまま使い、訳を番号なしで1行ずつ、順番どおりに lines に入れてください。',
].join('\n')

const RECORDS_DESCRIPTION = [
  'teleprompterアプリで「保存する」を押した完成動画の制作記録を返します（1台本につき最後の保存の1件、新しい順のJSON）。',
  'TikTokなどの動画を、hookLine（字幕の1行目。*や絵文字なし）と savedAt（保存日時。投稿はその後）で突き合わせると、その動画の作り方が分かります。',
  'effects: hookStyle/hookPosition（最初のショットのフック字幕）、zoom（最初のショットのズーム。direction=outは寄った画から始まる）、sticker（顔の横の絵文字ステッカー）、fairies（途中の妖精と最後のフィナーレ）、subtitles、bgm、voicePreset、trim（無音の余白の秒数: firstStart=最初のショットの前、start/end=各ショットの前後、lastEnd=最後のショットの後ろ、pauseShots=「間を残す」にしたショット数。nullは不明）、midZoom（中盤のズーム: 山場の行でじわっと寄り、最後の行で寄る。trueなら使った。項目が無いのは導入前の記録）。',
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
      },
    },
    async ({ title, script, caption }) => {
      try {
        const body = script.replace(/\r\n?/g, '\n')
        const item = await inbox().add({ title, body, caption: caption ?? '' })
        const lines = item.body.split('\n').filter(line => line.trim()).length
        return textResult(`『${item.title}』をteleprompterに送りました（${lines}行）。teleprompterのホーム画面に届いています。`)
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
