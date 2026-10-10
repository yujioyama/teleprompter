import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { keyMatches } from './auth.js'
import type { InboxStore } from './inboxStore.js'
import type { SubtitleStore } from './subtitleStore.js'

export const TOOL_NAME = 'send_to_teleprompter'
export const SUBTITLES_TOOL_NAME = 'send_subtitles'

/** The stores the tools write to, created lazily so a bad key never touches Redis. */
export interface McpDeps {
  inbox: () => InboxStore
  subtitles: () => SubtitleStore
}

const DESCRIPTION = [
  '完成したTikTokのスクリプトとキャプションを、ユーザーのteleprompterアプリの受け取り箱に送ります。',
  'ユーザーが「teleprompterに送って」などと頼んだときに使ってください。',
  'script には読み上げる本文だけを書きます。1ショット＝1行（改行で区切る）にし、見出し・ト書き・番号・空行は入れません。',
  '各行で要になる語句は *…* で囲みます（1行に0〜1か所。例: I *carry a torch* for him）。字幕でその語句が黄色になり、読み上げ画面では * は表示されません。',
  'caption には投稿用のキャプション（ハッシュタグ込み）を入れます。無ければ省略します。',
].join('\n')

const SUBTITLES_DESCRIPTION = [
  'teleprompterアプリの「Claude用プロンプト」で頼まれた日本語字幕を、アプリに送り返します。',
  'プロンプトの【teleprompterへの送信】に書かれた request_id をそのまま使い、訳を番号なしで1行ずつ、順番どおりに lines に入れてください。',
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

function buildServer({ inbox, subtitles }: McpDeps): McpServer {
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
