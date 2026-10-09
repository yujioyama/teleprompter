import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { keyMatches } from './auth.js'
import type { InboxStore } from './inboxStore.js'

export const TOOL_NAME = 'send_to_teleprompter'

const DESCRIPTION = [
  '完成したTikTokのスクリプトとキャプションを、ユーザーのteleprompterアプリの受け取り箱に送ります。',
  'ユーザーが「teleprompterに送って」などと頼んだときに使ってください。',
  'script には読み上げる本文だけを書きます。1ショット＝1行（改行で区切る）にし、見出し・ト書き・番号・空行は入れません。',
  'caption には投稿用のキャプション（ハッシュタグ込み）を入れます。無ければ省略します。',
].join('\n')

function buildServer(getStore: () => InboxStore): McpServer {
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
        const item = await getStore().add({ title, body, caption: caption ?? '' })
        const lines = item.body.split('\n').filter(line => line.trim()).length
        return {
          content: [
            {
              type: 'text' as const,
              text: `『${item.title}』をteleprompterに送りました（${lines}行）。teleprompterのホーム画面に届いています。`,
            },
          ],
        }
      } catch (err) {
        console.error('send_to_teleprompter failed', err)
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `受け取り箱に保存できませんでした: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        }
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
export async function handleMcpRequest(request: Request, getStore: () => InboxStore): Promise<Response> {
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
  await buildServer(getStore).connect(transport)
  return transport.handleRequest(request)
}
