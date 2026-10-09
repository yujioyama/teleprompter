// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleMcpRequest, TOOL_NAME } from './mcp.js'
import { createInboxStore, type InboxStore } from './inboxStore.js'
import { createFakeRedis } from './testing/fakeRedis.js'

let store: InboxStore

beforeEach(() => {
  vi.stubEnv('INBOX_SECRET', 'secret')
  store = createInboxStore(createFakeRedis().redis, () => new Date('2026-10-09T00:00:00.000Z'), () => 'id-1')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function rpc(body: unknown, key = 'secret') {
  return new Request(`https://app.test/api/mcp?key=${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  })
}

function callTool(args: Record<string, unknown>, key?: string) {
  return rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: TOOL_NAME, arguments: args } }, key)
}

describe('handleMcpRequest', () => {
  it('rejects a wrong key before touching the store', async () => {
    const getStore = vi.fn(() => store)
    const res = await handleMcpRequest(callTool({ title: 'a', script: 'b' }, 'wrong'), getStore)
    expect(res.status).toBe(401)
    expect(getStore).not.toHaveBeenCalled()
  })

  it('answers GET with 405, since it offers no event stream', async () => {
    const res = await handleMcpRequest(new Request('https://app.test/api/mcp?key=secret'), () => store)
    expect(res.status).toBe(405)
  })

  it('initializes and lists the tool, telling Claude to write one shot per line', async () => {
    const init = await handleMcpRequest(
      rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      }),
      () => store,
    )
    expect(init.status).toBe(200)

    const res = await handleMcpRequest(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), () => store)
    const { result } = await res.json()
    expect(result.tools).toHaveLength(1)
    expect(result.tools[0].name).toBe(TOOL_NAME)
    expect(result.tools[0].description).toContain('1ショット＝1行')
    expect(Object.keys(result.tools[0].inputSchema.properties)).toEqual(['title', 'script', 'caption'])
  })

  it('puts the script in the inbox, trimmed, with CRLF turned into LF', async () => {
    const res = await handleMcpRequest(
      callTool({ title: '  朝のルーティン ', script: '一行目\r\n二行目\r\n', caption: ' #朝活 ' }),
      () => store,
    )
    const { result } = await res.json()

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toBe('『朝のルーティン』をteleprompterに送りました（2行）。teleprompterのホーム画面に届いています。')
    expect(await store.list()).toEqual([
      { id: 'id-1', title: '朝のルーティン', body: '一行目\n二行目', caption: '#朝活', createdAt: '2026-10-09T00:00:00.000Z' },
    ])
  })

  it('stores an empty caption when none is sent', async () => {
    await handleMcpRequest(callTool({ title: 'A', script: 'a' }), () => store)
    expect((await store.list())[0].caption).toBe('')
  })

  it('reports out-of-range input as a tool error and stores nothing', async () => {
    const res = await handleMcpRequest(callTool({ title: '', script: 'a' }), () => store)
    const { result } = await res.json()
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/title/)

    const long = await handleMcpRequest(callTool({ title: 'A', script: 'a', caption: 'x'.repeat(4001) }), () => store)
    expect((await long.json()).result.isError).toBe(true)
    expect(await store.list()).toEqual([])
  })

  it('reports a misconfigured store as a tool error Claude can relay', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handleMcpRequest(callTool({ title: 'A', script: 'a' }), () => {
      throw new Error('Upstash Redis is not configured')
    })
    const { result } = await res.json()
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('受け取り箱に保存できませんでした')
  })
})
