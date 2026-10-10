// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleMcpRequest, SUBTITLES_TOOL_NAME, TOOL_NAME, type McpDeps } from './mcp.js'
import { createInboxStore, type InboxStore } from './inboxStore.js'
import { createSubtitleStore, type SubtitleStore } from './subtitleStore.js'
import { createFakeRedis } from './testing/fakeRedis.js'

let store: InboxStore
let subtitles: SubtitleStore
let deps: McpDeps

beforeEach(() => {
  vi.stubEnv('INBOX_SECRET', 'secret')
  const { redis } = createFakeRedis()
  store = createInboxStore(redis, () => new Date('2026-10-09T00:00:00.000Z'), () => 'id-1')
  subtitles = createSubtitleStore(redis)
  deps = { inbox: () => store, subtitles: () => subtitles }
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function rpc(body: unknown, key = 'secret') {
  return new Request(`https://app.test/api/mcp?key=${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  })
}

function callTool(args: Record<string, unknown>, key?: string, name = TOOL_NAME) {
  return rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, key)
}

describe('handleMcpRequest', () => {
  it('rejects a wrong key before touching the store', async () => {
    const getStore = vi.fn(() => store)
    const res = await handleMcpRequest(callTool({ title: 'a', script: 'b' }, 'wrong'), { ...deps, inbox: getStore })
    expect(res.status).toBe(401)
    expect(getStore).not.toHaveBeenCalled()
  })

  it('rejects a request with no key', async () => {
    const getStore = vi.fn(() => store)
    const req = new Request('https://app.test/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    const res = await handleMcpRequest(req, { ...deps, inbox: getStore })
    expect(res.status).toBe(401)
    expect(getStore).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated GET with 401, not 405', async () => {
    const res = await handleMcpRequest(new Request('https://app.test/api/mcp'), deps)
    expect(res.status).toBe(401)
  })

  it('answers GET with 405, since it offers no event stream', async () => {
    const res = await handleMcpRequest(new Request('https://app.test/api/mcp?key=secret'), deps)
    expect(res.status).toBe(405)
  })

  it('initializes and lists the tools, telling Claude to write one shot per line', async () => {
    const init = await handleMcpRequest(
      rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      }),
      deps,
    )
    expect(init.status).toBe(200)

    const res = await handleMcpRequest(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), deps)
    const { result } = await res.json()
    expect(result.tools.map((t: { name: string }) => t.name)).toEqual([TOOL_NAME, SUBTITLES_TOOL_NAME])
    expect(result.tools[0].description).toContain('1ショット＝1行')
    expect(result.tools[0].description).toContain('*…*')
    expect(Object.keys(result.tools[0].inputSchema.properties)).toEqual(['title', 'script', 'caption'])
    expect(result.tools[1].description).toContain('request_id')
    expect(Object.keys(result.tools[1].inputSchema.properties)).toEqual(['request_id', 'lines'])
  })

  it('puts the script in the inbox, trimmed, with CRLF turned into LF', async () => {
    const res = await handleMcpRequest(
      callTool({ title: '  朝のルーティン ', script: '一行目\r\n二行目\r\n', caption: ' #朝活 ' }),
      deps,
    )
    const { result } = await res.json()

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toBe('『朝のルーティン』をteleprompterに送りました（2行）。teleprompterのホーム画面に届いています。')
    expect(await store.list()).toEqual([
      { id: 'id-1', title: '朝のルーティン', body: '一行目\n二行目', caption: '#朝活', createdAt: '2026-10-09T00:00:00.000Z' },
    ])
  })

  it('stores an empty caption when none is sent', async () => {
    await handleMcpRequest(callTool({ title: 'A', script: 'a' }), deps)
    expect((await store.list())[0].caption).toBe('')
  })

  it('reports out-of-range input as a tool error and stores nothing', async () => {
    const res = await handleMcpRequest(callTool({ title: '', script: 'a' }), deps)
    const { result } = await res.json()
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/title/)

    const long = await handleMcpRequest(callTool({ title: 'A', script: 'a', caption: 'x'.repeat(4001) }), deps)
    expect((await long.json()).result.isError).toBe(true)
    expect(await store.list()).toEqual([])
  })

  it('reports a misconfigured store as a tool error Claude can relay', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handleMcpRequest(callTool({ title: 'A', script: 'a' }), {
      ...deps,
      inbox: () => {
        throw new Error('Upstash Redis is not configured')
      },
    })
    const { result } = await res.json()
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('受け取り箱に保存できませんでした')
  })
})

describe('send_subtitles', () => {
  function sendSubtitles(args: Record<string, unknown>) {
    return handleMcpRequest(callTool(args, undefined, SUBTITLES_TOOL_NAME), deps)
  }

  it('keeps the lines for the app under their request id', async () => {
    const res = await sendSubtitles({ request_id: 'k3x9-2', lines: [' 一行目 ', '二行目'] })
    const { result } = await res.json()

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toBe('日本語字幕2行をteleprompterに送りました。teleprompterの字幕画面に戻ると反映されます。')
    expect(await subtitles.get('k3x9-2')).toEqual(['一行目', '二行目'])
  })

  it('asks for the right number of lines when the count is off, and keeps nothing', async () => {
    const res = await sendSubtitles({ request_id: 'k3x9-3', lines: ['一行目', '二行目'] })
    const { result } = await res.json()

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('3行')
    expect(await subtitles.get('k3x9-3')).toBeNull()
  })

  it('rejects a malformed request id or an empty line', async () => {
    const badId = await (await sendSubtitles({ request_id: 'Not An Id', lines: ['一行目'] })).json()
    expect(badId.result.isError).toBe(true)

    const emptyLine = await (await sendSubtitles({ request_id: 'k3x9-2', lines: ['一行目', '  '] })).json()
    expect(emptyLine.result.isError).toBe(true)
    expect(await subtitles.get('k3x9-2')).toBeNull()
  })

  it('asks for the lines again without numbers when they are numbered', async () => {
    const res = await sendSubtitles({ request_id: 'k3x9-2', lines: ['1. 一行目', '2. 二行目'] })
    const { result } = await res.json()

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('番号')
    expect(await subtitles.get('k3x9-2')).toBeNull()
  })

  it('reports a misconfigured store as a tool error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handleMcpRequest(callTool({ request_id: 'k3x9-1', lines: ['一行'] }, undefined, SUBTITLES_TOOL_NAME), {
      ...deps,
      subtitles: () => {
        throw new Error('Upstash Redis is not configured')
      },
    })
    const { result } = await res.json()
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('字幕を保存できませんでした')
  })
})
