# Claude Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude chat send a script + caption to a server-side inbox that the teleprompter picks up on any device, pre-filling 新規スクリプト; keep the caption on the script and offer 「キャプションをコピー」 on the finalize export step.

**Architecture:** Two Vercel Functions in `api/` (a stateless MCP server for Claude, and a small REST inbox for the app) are thin wrappers over testable handlers in `server/`, backed by Upstash Redis (one key per item, 30-day TTL). The app adds a key setting, an inbox section on Home, pre-fill + caption on 新規スクリプト, and a copy button on Finalize.

**Tech Stack:** Vercel Functions (Node, Web `Request`/`Response` named exports), `@modelcontextprotocol/sdk` 1.32 (`McpServer` + `WebStandardStreamableHTTPServerTransport`, stateless, JSON responses), `zod` 4, `@upstash/redis`, React 18 + react-router 6, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-09-claude-inbox-design.md`

## Global Constraints

- Shared secret env var: `INBOX_SECRET`. Wrong/missing key → HTTP 401 on both endpoints. Compare in constant time.
- Redis env vars: `KV_REST_API_URL` / `KV_REST_API_TOKEN`, falling back to `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.
- Redis key per item: `inbox:<uuid>`, expiry 30 days (`2592000` seconds).
- Tool name `send_to_teleprompter`; inputs `title` (1–100 chars), `script` (1–10,000), `caption` (optional, 0–4,000); all trimmed.
- MCP URL: `/api/mcp?key=<INBOX_SECRET>`. Inbox URL: `/api/inbox` with `Authorization: Bearer <INBOX_SECRET>`; `GET` → `{ items }` newest first; `DELETE ?id=` → 204 (also when already gone).
- Files under `api/` each become a function: put **only** entry points there; logic and tests live in `server/`.
- `package.json` is `"type": "module"` and Vercel runs `api/` files as Node ESM without bundling: relative imports in `api/`, `server/`, `shared/` **must use the `.js` extension** (e.g. `'../server/mcp.js'`). Vite/vitest and TS (`moduleResolution: Bundler`) resolve `.js` → `.ts`.
- Server test files start with `// @vitest-environment node` (the global vitest environment is jsdom).
- UI copy (exact): section 「Claudeから届いたスクリプト」; settings label 「受け取り用キー」; caption label 「キャプション（任意）」; button 「キャプションをコピー」 → 「コピーしました」 / 「コピーできませんでした」.
- Type check with `npx tsc -b` (never `tsc --noEmit -p .`, which checks nothing here). Tests: `npx vitest run <path>`.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` exactly as written in each step.

## File Structure

| File | Responsibility |
|---|---|
| `shared/inbox.ts` | `InboxItem` type, used by server and app |
| `server/auth.ts` | `keyMatches(given)` — constant-time check against `INBOX_SECRET` |
| `server/inboxStore.ts` | `InboxStore` over Redis (`add`/`list`/`remove`), `inboxStoreFromEnv()` |
| `server/mcp.ts` | `handleMcpRequest(request, getStore)` — auth + MCP tool |
| `server/inboxApi.ts` | `handleInboxRequest(request, getStore)` — auth + GET/DELETE |
| `server/testing/fakeRedis.ts` | In-memory Redis fake for server tests |
| `api/mcp.ts`, `api/inbox.ts` | Vercel entry points (named `GET`/`POST`/`DELETE` exports) |
| `tsconfig.api.json` | Type-check `api/`, `server/`, `shared/` under `tsc -b` |
| `src/utils/inbox.ts` | App client: `fetchInbox`, `deleteInboxItem` |
| `src/components/ClaudeInbox.tsx` | Home section listing arrived items |
| `src/types.ts`, `src/hooks/useScripts.ts`, `src/utils/scriptBackup.ts` | `caption` on scripts |
| `src/hooks/useSettings.ts`, `src/pages/SettingsPage.tsx` | `inboxKey` setting |
| `src/pages/HomePage.tsx`, `src/pages/ScriptEditPage.tsx`, `src/pages/FinalizePage.tsx` | Wiring |

---

### Task 1: Inbox store, auth and server type-checking

**Files:**
- Create: `shared/inbox.ts`, `server/auth.ts`, `server/inboxStore.ts`, `server/testing/fakeRedis.ts`, `tsconfig.api.json`
- Modify: `tsconfig.json`, `package.json` (deps)
- Test: `server/auth.test.ts`, `server/inboxStore.test.ts`

**Interfaces:**
- Produces:
  - `shared/inbox.ts`: `export interface InboxItem { id: string; title: string; body: string; caption: string; createdAt: string }`
  - `server/auth.ts`: `export function keyMatches(given: string | null | undefined): boolean`
  - `server/inboxStore.ts`: `export const INBOX_TTL_SECONDS = 2_592_000`; `export interface InboxStore { add(input: { title: string; body: string; caption: string }): Promise<InboxItem>; list(): Promise<InboxItem[]>; remove(id: string): Promise<void> }`; `export type RedisLike = Pick<Redis, 'set' | 'mget' | 'scan' | 'del'>`; `export function createInboxStore(redis: RedisLike, now?: () => Date, newId?: () => string): InboxStore`; `export function inboxStoreFromEnv(): InboxStore`
  - `server/testing/fakeRedis.ts`: `export function createFakeRedis(): { redis: RedisLike; values: Map<string, unknown>; expiries: Map<string, number> }`

- [ ] **Step 1: Install dependencies**

```bash
npm install @modelcontextprotocol/sdk@^1.32.1 zod@^4.1.0 @upstash/redis@^1.35.0
```

Expected: `package.json` `dependencies` gains the three packages; `npm ls zod` shows a single 4.x.

- [ ] **Step 2: Add the shared type and the server tsconfig**

`shared/inbox.ts`:

```ts
// A script Claude chat sent to the teleprompter, waiting in the inbox
// until a device turns it into a script (or it expires).
export interface InboxItem {
  id: string
  title: string
  /** One shot per line. */
  body: string
  /** TikTok caption; '' when none was sent. */
  caption: string
  /** ISO timestamp of when it arrived. */
  createdAt: string
}
```

`tsconfig.api.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.api.tsbuildinfo",
    "target": "ES2022",
    "lib": ["ES2023", "DOM"],
    "module": "ESNext",
    "types": ["node"],
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "Bundler",
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["api", "server", "shared"]
}
```

`tsconfig.json` — add the reference:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.api.json" }
  ]
}
```

- [ ] **Step 3: Write the fake Redis**

`server/testing/fakeRedis.ts` (only the subset `createInboxStore` uses; Upstash serializes objects to JSON, so store clones to mimic that):

```ts
import type { RedisLike } from '../inboxStore.js'

// In-memory stand-in for the Upstash client, covering only what the inbox
// store calls. Values are cloned like Upstash's JSON round-trip would.
export function createFakeRedis() {
  const values = new Map<string, unknown>()
  const expiries = new Map<string, number>()

  const fake = {
    async set(key: string, value: unknown, opts?: { ex?: number }) {
      values.set(key, structuredClone(value))
      if (opts?.ex !== undefined) expiries.set(key, opts.ex)
      return 'OK'
    },
    async mget(...keys: string[]) {
      return keys.map(k => (values.has(k) ? structuredClone(values.get(k)) : null))
    },
    async scan(_cursor: string | number, opts?: { match?: string }) {
      const prefix = (opts?.match ?? '*').replace(/\*$/, '')
      return ['0', [...values.keys()].filter(k => k.startsWith(prefix))]
    },
    async del(...keys: string[]) {
      let n = 0
      for (const k of keys) {
        if (values.delete(k)) n++
        expiries.delete(k)
      }
      return n
    },
  }

  return { redis: fake as unknown as RedisLike, values, expiries }
}
```

- [ ] **Step 4: Write the failing tests**

`server/auth.test.ts`:

```ts
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keyMatches } from './auth.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('keyMatches', () => {
  it('accepts the configured secret', () => {
    vi.stubEnv('INBOX_SECRET', 'correct-horse')
    expect(keyMatches('correct-horse')).toBe(true)
  })

  it('rejects a wrong, empty or missing key', () => {
    vi.stubEnv('INBOX_SECRET', 'correct-horse')
    expect(keyMatches('correct-hors')).toBe(false)
    expect(keyMatches('')).toBe(false)
    expect(keyMatches(null)).toBe(false)
    expect(keyMatches(undefined)).toBe(false)
  })

  it('rejects everything when no secret is configured', () => {
    vi.stubEnv('INBOX_SECRET', '')
    expect(keyMatches('')).toBe(false)
    expect(keyMatches('anything')).toBe(false)
  })
})
```

`server/inboxStore.test.ts`:

```ts
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInboxStore, inboxStoreFromEnv, INBOX_TTL_SECONDS } from './inboxStore.js'
import { createFakeRedis } from './testing/fakeRedis.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

function storeAt(times: string[], ids: string[]) {
  const fake = createFakeRedis()
  const store = createInboxStore(
    fake.redis,
    () => new Date(times.shift() ?? '2026-10-09T00:00:00.000Z'),
    () => ids.shift() ?? 'extra-id',
  )
  return { ...fake, store }
}

describe('createInboxStore', () => {
  it('stores an item under inbox:<id> for 30 days and returns it', async () => {
    const { store, values, expiries } = storeAt(['2026-10-09T01:00:00.000Z'], ['id-1'])
    const item = await store.add({ title: '朝のルーティン', body: '一行目\n二行目', caption: '#朝活' })

    expect(item).toEqual({
      id: 'id-1',
      title: '朝のルーティン',
      body: '一行目\n二行目',
      caption: '#朝活',
      createdAt: '2026-10-09T01:00:00.000Z',
    })
    expect(values.get('inbox:id-1')).toEqual(item)
    expect(expiries.get('inbox:id-1')).toBe(INBOX_TTL_SECONDS)
    expect(INBOX_TTL_SECONDS).toBe(30 * 24 * 60 * 60)
  })

  it('lists items newest first', async () => {
    const { store } = storeAt(
      ['2026-10-09T01:00:00.000Z', '2026-10-09T03:00:00.000Z', '2026-10-09T02:00:00.000Z'],
      ['a', 'b', 'c'],
    )
    await store.add({ title: 'A', body: 'a', caption: '' })
    await store.add({ title: 'B', body: 'b', caption: '' })
    await store.add({ title: 'C', body: 'c', caption: '' })

    expect((await store.list()).map(i => i.id)).toEqual(['b', 'c', 'a'])
  })

  it('lists nothing when the inbox is empty', async () => {
    const { store } = storeAt([], [])
    expect(await store.list()).toEqual([])
  })

  it('ignores keys outside the inbox', async () => {
    const { store, redis } = storeAt([], ['a'])
    await redis.set('other:x', { id: 'x' })
    await store.add({ title: 'A', body: 'a', caption: '' })
    expect((await store.list()).map(i => i.id)).toEqual(['a'])
  })

  it('removes an item, and removing it again is fine', async () => {
    const { store } = storeAt([], ['a'])
    await store.add({ title: 'A', body: 'a', caption: '' })
    await store.remove('a')
    await store.remove('a')
    expect(await store.list()).toEqual([])
  })
})

describe('inboxStoreFromEnv', () => {
  it('explains what is missing when Redis is not configured', () => {
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
    expect(() => inboxStoreFromEnv()).toThrow(/KV_REST_API_URL/)
  })

  it('builds a store from either set of variable names', () => {
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token')
    expect(inboxStoreFromEnv()).toHaveProperty('add')
  })
})
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx vitest run server/`
Expected: FAIL — cannot resolve `./auth.js` / `./inboxStore.js`.

- [ ] **Step 6: Implement**

`server/auth.ts`:

```ts
import { createHash, timingSafeEqual } from 'node:crypto'

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/**
 * Whether `given` is the inbox secret. Both sides are hashed first so the
 * comparison is constant-time regardless of length. With no secret
 * configured nothing matches, so a missing env var never opens the inbox.
 */
export function keyMatches(given: string | null | undefined): boolean {
  const secret = process.env.INBOX_SECRET
  if (!secret || !given) return false
  return timingSafeEqual(digest(given), digest(secret))
}
```

`server/inboxStore.ts`:

```ts
import { Redis } from '@upstash/redis'
import type { InboxItem } from '../shared/inbox.js'

const PREFIX = 'inbox:'
/** Unclaimed items disappear after 30 days. */
export const INBOX_TTL_SECONDS = 30 * 24 * 60 * 60

export type RedisLike = Pick<Redis, 'set' | 'mget' | 'scan' | 'del'>

export interface InboxStore {
  add(input: { title: string; body: string; caption: string }): Promise<InboxItem>
  /** Newest first. */
  list(): Promise<InboxItem[]>
  /** Succeeds when the item is already gone. */
  remove(id: string): Promise<void>
}

// One key per item, so each expires on its own. The inbox only ever holds
// a handful of items, so listing by SCAN is fine.
export function createInboxStore(
  redis: RedisLike,
  now: () => Date = () => new Date(),
  newId: () => string = () => crypto.randomUUID(),
): InboxStore {
  return {
    async add({ title, body, caption }) {
      const item: InboxItem = { id: newId(), title, body, caption, createdAt: now().toISOString() }
      await redis.set(PREFIX + item.id, item, { ex: INBOX_TTL_SECONDS })
      return item
    },

    async list() {
      const keys: string[] = []
      let cursor: string | number = 0
      do {
        const [next, batch]: [string | number, string[]] = await redis.scan(cursor, { match: `${PREFIX}*`, count: 100 })
        keys.push(...batch)
        cursor = next
      } while (String(cursor) !== '0')
      if (keys.length === 0) return []
      const items = await redis.mget<(InboxItem | null)[]>(...keys)
      return items
        .filter((item): item is InboxItem => item !== null)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },

    async remove(id) {
      await redis.del(PREFIX + id)
    },
  }
}

/** The store for the Upstash database connected to the Vercel project. */
export function inboxStoreFromEnv(): InboxStore {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    throw new Error(
      'Upstash Redis is not configured: set KV_REST_API_URL and KV_REST_API_TOKEN ' +
        '(connect the Upstash for Redis integration to the Vercel project).',
    )
  }
  return createInboxStore(new Redis({ url, token }))
}
```

If `tsc -b` rejects the `redis.scan(...)` destructuring type (Upstash types the cursor as `string`), annotate as `const [next, batch] = await redis.scan(...)` and keep `cursor` typed `string | number`.

- [ ] **Step 7: Run tests and type check**

Run: `npx vitest run server/ && npx tsc -b`
Expected: all server tests PASS; `tsc -b` exits 0.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.api.json shared server
git commit -m "feat: add the inbox store and its shared-secret check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: MCP endpoint for Claude

**Files:**
- Create: `server/mcp.ts`, `api/mcp.ts`
- Test: `server/mcp.test.ts`

**Interfaces:**
- Consumes: `keyMatches` (`server/auth.ts`); `InboxStore`, `inboxStoreFromEnv`, `createInboxStore` (`server/inboxStore.ts`); `createFakeRedis` (`server/testing/fakeRedis.ts`)
- Produces: `server/mcp.ts`: `export const TOOL_NAME = 'send_to_teleprompter'`; `export async function handleMcpRequest(request: Request, getStore: () => InboxStore): Promise<Response>`

- [ ] **Step 1: Write the failing tests**

`server/mcp.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/mcp.test.ts`
Expected: FAIL — cannot resolve `./mcp.js`.

- [ ] **Step 3: Implement `server/mcp.ts`**

```ts
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
```

- [ ] **Step 4: Add the entry point `api/mcp.ts`**

```ts
import { handleMcpRequest } from '../server/mcp.js'
import { inboxStoreFromEnv } from '../server/inboxStore.js'

// Claude chat's custom connector: https://<app>/api/mcp?key=<INBOX_SECRET>
export function POST(request: Request) {
  return handleMcpRequest(request, inboxStoreFromEnv)
}

export function GET(request: Request) {
  return handleMcpRequest(request, inboxStoreFromEnv)
}

export function DELETE(request: Request) {
  return handleMcpRequest(request, inboxStoreFromEnv)
}
```

- [ ] **Step 5: Run tests and type check**

Run: `npx vitest run server/ && npx tsc -b`
Expected: PASS; exit 0. If the `inputSchema.properties` key order assertion fails only on order, keep the assertion on the set of keys (`.sort()` both sides) rather than reordering the schema.

- [ ] **Step 6: Commit**

```bash
git add server/mcp.ts server/mcp.test.ts api/mcp.ts
git commit -m "feat: let Claude chat send a script to the inbox over MCP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Inbox endpoint for the app, and routing

**Files:**
- Create: `server/inboxApi.ts`, `api/inbox.ts`
- Modify: `vercel.json`
- Test: `server/inboxApi.test.ts`

**Interfaces:**
- Consumes: `keyMatches`, `InboxStore`, `createInboxStore`, `inboxStoreFromEnv`, `createFakeRedis`
- Produces: `server/inboxApi.ts`: `export async function handleInboxRequest(request: Request, getStore: () => InboxStore): Promise<Response>`

- [ ] **Step 1: Write the failing tests**

`server/inboxApi.test.ts`:

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleInboxRequest } from './inboxApi.js'
import { createInboxStore, type InboxStore } from './inboxStore.js'
import { createFakeRedis } from './testing/fakeRedis.js'

let store: InboxStore

beforeEach(async () => {
  vi.stubEnv('INBOX_SECRET', 'secret')
  const times = ['2026-10-09T01:00:00.000Z', '2026-10-09T02:00:00.000Z']
  const ids = ['old', 'new']
  store = createInboxStore(createFakeRedis().redis, () => new Date(times.shift()!), () => ids.shift()!)
  await store.add({ title: '古い', body: 'a', caption: '' })
  await store.add({ title: '新しい', body: 'b', caption: '#c' })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function req(method: string, path = '/api/inbox', key: string | null = 'secret') {
  return new Request(`https://app.test${path}`, {
    method,
    headers: key === null ? {} : { Authorization: `Bearer ${key}` },
  })
}

describe('handleInboxRequest', () => {
  it('rejects a wrong or missing key', async () => {
    expect((await handleInboxRequest(req('GET', '/api/inbox', 'wrong'), () => store)).status).toBe(401)
    expect((await handleInboxRequest(req('GET', '/api/inbox', null), () => store)).status).toBe(401)
  })

  it('lists the items newest first, uncached', async () => {
    const res = await handleInboxRequest(req('GET'), () => store)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const { items } = await res.json()
    expect(items.map((i: { id: string }) => i.id)).toEqual(['new', 'old'])
  })

  it('deletes an item, and deleting it again still succeeds', async () => {
    expect((await handleInboxRequest(req('DELETE', '/api/inbox?id=new'), () => store)).status).toBe(204)
    expect((await handleInboxRequest(req('DELETE', '/api/inbox?id=new'), () => store)).status).toBe(204)
    expect((await store.list()).map(i => i.id)).toEqual(['old'])
  })

  it('needs an id to delete', async () => {
    expect((await handleInboxRequest(req('DELETE'), () => store)).status).toBe(400)
  })

  it('refuses other methods', async () => {
    expect((await handleInboxRequest(req('PUT'), () => store)).status).toBe(405)
  })

  it('answers 500 when the store fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handleInboxRequest(req('GET'), () => {
      throw new Error('Upstash Redis is not configured')
    })
    expect(res.status).toBe(500)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/inboxApi.test.ts`
Expected: FAIL — cannot resolve `./inboxApi.js`.

- [ ] **Step 3: Implement `server/inboxApi.ts`**

```ts
import { keyMatches } from './auth.js'
import type { InboxStore } from './inboxStore.js'

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization')
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
}

/** The app's side of the inbox: list what arrived, and remove what was taken. */
export async function handleInboxRequest(request: Request, getStore: () => InboxStore): Promise<Response> {
  if (!keyMatches(bearer(request))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    if (request.method === 'GET') {
      const items = await getStore().list()
      return Response.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (request.method === 'DELETE') {
      const id = new URL(request.url).searchParams.get('id')
      if (!id) return Response.json({ error: 'id is required' }, { status: 400 })
      await getStore().remove(id)
      return new Response(null, { status: 204 })
    }
    return new Response(null, { status: 405, headers: { Allow: 'GET, DELETE' } })
  } catch (err) {
    console.error('inbox request failed', err)
    return Response.json({ error: 'inbox unavailable' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Add the entry point `api/inbox.ts`**

```ts
import { handleInboxRequest } from '../server/inboxApi.js'
import { inboxStoreFromEnv } from '../server/inboxStore.js'

export function GET(request: Request) {
  return handleInboxRequest(request, inboxStoreFromEnv)
}

export function DELETE(request: Request) {
  return handleInboxRequest(request, inboxStoreFromEnv)
}
```

- [ ] **Step 5: Keep the SPA rewrite off `/api/`**

In `vercel.json`, change the rewrite to:

```json
  "rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }],
```

- [ ] **Step 6: Run tests and type check**

Run: `npx vitest run server/ && npx tsc -b`
Expected: PASS; exit 0.

- [ ] **Step 7: Commit**

```bash
git add server/inboxApi.ts server/inboxApi.test.ts api/inbox.ts vercel.json
git commit -m "feat: let the app list and clear the inbox

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Prove the functions run on Vercel (controller task, not a subagent)

No Redis or secret exists yet, so this checks routing and ESM module loading only: with `INBOX_SECRET` unset, both endpoints must answer **401 JSON from the function** (not the SPA's HTML, and not a 500 `ERR_MODULE_NOT_FOUND`).

- [ ] **Step 1: Deploy a preview**

Run: `vercel deploy --yes` (from the worktree; `.vercel/project.json` is copied from the main checkout)
Expected: prints a preview URL.

- [ ] **Step 2: Hit both endpoints through deployment protection**

```bash
vercel curl /api/inbox --deployment <preview-url> -- -s -i
vercel curl "/api/mcp?key=x" --deployment <preview-url> -- -s -i -X POST -H 'content-type: application/json' -d '{}'
```

Expected: both `HTTP/2 401` with body `{"error":"unauthorized"}`. If either returns HTML, the rewrite is shadowing the function; if 500, read `vercel logs <preview-url>` — an `ERR_MODULE_NOT_FOUND` means a relative import is missing its `.js` extension.

- [ ] **Step 3: Fix and re-deploy until both pass.** Commit any fix with a `fix:` message ending in the Co-Authored-By line.

---

### Task 5: Caption on scripts (data, hook, backup)

**Files:**
- Modify: `src/types.ts`, `src/hooks/useScripts.ts`, `src/utils/scriptBackup.ts`
- Test: `src/hooks/useScripts.test.ts`, `src/utils/scriptBackup.test.ts`

**Interfaces:**
- Produces: `Script.caption?: string`; `createScript(title: string, shots: Shot[], caption?: string): Script` (stores `caption` only when non-empty); `updateScript(id, changes: Partial<Pick<Script, 'title' | 'shots' | 'caption'>>)`

- [ ] **Step 1: Write the failing tests**

Append inside `describe('useScripts', …)` in `src/hooks/useScripts.test.ts`:

```ts
  it('keeps a caption given when the script is created', () => {
    const { result } = renderHook(() => useScripts())
    act(() => {
      result.current.createScript('キャプション付き', [{ id: '1', text: 'a' }], '#朝活 おはよう')
    })
    expect(result.current.scripts[0].caption).toBe('#朝活 おはよう')
    expect(JSON.parse(localStorage.getItem('teleprompter_scripts')!)[0].caption).toBe('#朝活 おはよう')
  })

  it('leaves the caption off when none is given', () => {
    const { result } = renderHook(() => useScripts())
    act(() => {
      result.current.createScript('なし', [], '')
    })
    expect(result.current.scripts[0]).not.toHaveProperty('caption')
  })

  it('updates a caption', () => {
    const { result } = renderHook(() => useScripts())
    act(() => {
      result.current.createScript('元', [])
    })
    const id = result.current.scripts[0].id
    act(() => {
      result.current.updateScript(id, { caption: '新しいキャプション' })
    })
    expect(result.current.scripts[0].caption).toBe('新しいキャプション')
  })
```

Append inside `describe('serializeBackup / parseBackup', …)` in `src/utils/scriptBackup.test.ts`:

```ts
  it('round-trips a caption, and rejects one that is not text', () => {
    const withCaption = { ...script('a', '2026-01-02T00:00:00.000Z'), caption: '#朝活' }
    expect(parseBackup(serializeBackup([withCaption]))).toEqual({ ok: true, scripts: [withCaption] })

    const broken = JSON.parse(serializeBackup([withCaption]))
    broken.scripts[0].caption = 42
    expect(parseBackup(JSON.stringify(broken))).toMatchObject({ ok: false })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hooks/useScripts.test.ts src/utils/scriptBackup.test.ts`
Expected: FAIL — caption is undefined / `42` accepted.

- [ ] **Step 3: Implement**

`src/types.ts` — in `Script`, after `shots: Shot[]`:

```ts
  /** TikTok caption to post with the video. */
  caption?: string
```

`src/hooks/useScripts.ts`:

```ts
  function createScript(title: string, shots: Shot[], caption?: string): Script {
    const now = new Date().toISOString()
    const script: Script = {
      id: generateId(),
      title,
      shots,
      ...(caption ? { caption } : {}),
      createdAt: now,
      updatedAt: now,
    }
```

and change `updateScript`'s parameter type to `Partial<Pick<Script, 'title' | 'shots' | 'caption'>>`.

`src/utils/scriptBackup.ts` — widen `isOptional` and check the caption:

```ts
function isOptional(value: unknown, type: 'boolean' | 'number' | 'string'): boolean {
  return value === undefined || typeof value === type
}
```

and in `isScript`, add `isOptional(script.caption, 'string') &&` before `Array.isArray(script.shots)`.

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run src/hooks/useScripts.test.ts src/utils/scriptBackup.test.ts && npx tsc -b`
Expected: PASS; exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/hooks/useScripts.ts src/hooks/useScripts.test.ts src/utils/scriptBackup.ts src/utils/scriptBackup.test.ts
git commit -m "feat: keep a TikTok caption with each script, backups included

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Inbox key setting and app client

**Files:**
- Create: `src/utils/inbox.ts`
- Modify: `src/hooks/useSettings.ts`, `src/pages/SettingsPage.tsx`
- Test: `src/utils/inbox.test.ts`, `src/hooks/useSettings.test.ts`, `src/pages/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: `InboxItem` (`shared/inbox.ts`)
- Produces: `AppSettings.inboxKey: string` (default `''`); `src/utils/inbox.ts`: `export type { InboxItem }`, `export async function fetchInbox(key: string): Promise<InboxItem[]>` (throws on non-2xx), `export async function deleteInboxItem(key: string, id: string): Promise<void>` (throws on non-2xx)

- [ ] **Step 1: Write the failing tests**

`src/utils/inbox.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteInboxItem, fetchInbox, type InboxItem } from './inbox'

const ITEM: InboxItem = { id: 'id-1', title: 'T', body: 'a\nb', caption: '#c', createdAt: '2026-10-09T00:00:00.000Z' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchInbox', () => {
  it('sends the key as a bearer token and returns the items', async () => {
    const fetchMock = vi.fn(async () => Response.json({ items: [ITEM] }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchInbox('secret')).toEqual([ITEM])
    expect(fetchMock).toHaveBeenCalledWith('/api/inbox', {
      headers: { Authorization: 'Bearer secret' },
      cache: 'no-store',
    })
  })

  it('throws on a rejected key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))
    await expect(fetchInbox('wrong')).rejects.toThrow('401')
  })
})

describe('deleteInboxItem', () => {
  it('deletes by id', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await deleteInboxItem('secret', 'id 1')
    expect(fetchMock).toHaveBeenCalledWith('/api/inbox?id=id%201', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer secret' },
    })
  })

  it('throws when the server fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })))
    await expect(deleteInboxItem('secret', 'id-1')).rejects.toThrow('500')
  })
})
```

In `src/hooks/useSettings.test.ts`, add `inboxKey: '',` as the last field of the `DEFAULTS` object at the top of the file.

Append to `src/pages/SettingsPage.test.tsx`:

```tsx
describe('SettingsPage inbox key', () => {
  it('saves the key for receiving scripts from Claude', () => {
    renderSettings()
    fireEvent.change(screen.getByLabelText('受け取り用キー'), { target: { value: ' abc123 ' } })
    expect(stored().inboxKey).toBe('abc123')
    expect(screen.getByLabelText('受け取り用キー')).toHaveValue('abc123')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/utils/inbox.test.ts src/hooks/useSettings.test.ts src/pages/SettingsPage.test.tsx`
Expected: FAIL — `./inbox` missing; defaults lack `inboxKey`; no 受け取り用キー field.

- [ ] **Step 3: Implement**

`src/utils/inbox.ts`:

```ts
import type { InboxItem } from '../../shared/inbox'

export type { InboxItem }

// Scripts sent from Claude chat wait in a server-side inbox (api/inbox.ts)
// so any device can pick them up.

function auth(key: string) {
  return { Authorization: `Bearer ${key}` }
}

export async function fetchInbox(key: string): Promise<InboxItem[]> {
  const res = await fetch('/api/inbox', { headers: auth(key), cache: 'no-store' })
  if (!res.ok) throw new Error(`Inbox request failed: ${res.status}`)
  const data = (await res.json()) as { items: InboxItem[] }
  return data.items
}

export async function deleteInboxItem(key: string, id: string): Promise<void> {
  const res = await fetch(`/api/inbox?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth(key) })
  if (!res.ok) throw new Error(`Inbox delete failed: ${res.status}`)
}
```

`src/hooks/useSettings.ts` — add to `AppSettings` (last field):

```ts
  /** Shared secret for the Claude inbox (INBOX_SECRET); '' = not set up. */
  inboxKey: string
```

and to `DEFAULTS`: `inboxKey: '',`.

`src/pages/SettingsPage.tsx` — add this section between the 自動トリミング section and the バックアップ section:

```tsx
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Claudeから受け取る</div>
        <div className={styles.row}>
          <div>
            <label className={styles.rowLabel} htmlFor="inbox-key">受け取り用キー</label>
            <div className={styles.rowSub}>Claudeチャットから送ったスクリプトを受け取るための合言葉です。Vercelに設定したINBOX_SECRETと同じものを入れてください</div>
          </div>
        </div>
        <input
          id="inbox-key"
          className={styles.keyInput}
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={settings.inboxKey}
          onChange={e => updateSettings({ inboxKey: e.target.value.trim() })}
        />
      </div>
```

`src/pages/SettingsPage.module.css` — append:

```css
.keyInput {
  width: 100%;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  padding: 10px 12px;
  font-size: 0.95rem;
  font-family: ui-monospace, monospace;
}

.keyInput:focus {
  border-color: var(--accent);
}
```

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run src/utils/inbox.test.ts src/hooks/useSettings.test.ts src/pages/SettingsPage.test.tsx && npx tsc -b`
Expected: PASS; exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/utils/inbox.ts src/utils/inbox.test.ts src/hooks/useSettings.ts src/hooks/useSettings.test.ts src/pages/SettingsPage.tsx src/pages/SettingsPage.module.css src/pages/SettingsPage.test.tsx
git commit -m "feat: add the inbox key setting and the app's inbox client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Home shows what arrived

**Files:**
- Create: `src/components/ClaudeInbox.tsx`, `src/components/ClaudeInbox.module.css`
- Modify: `src/pages/HomePage.tsx`
- Test: `src/components/ClaudeInbox.test.tsx`

**Interfaces:**
- Consumes: `fetchInbox`, `InboxItem` (`src/utils/inbox.ts`); `useSettings().inboxKey`
- Produces: `export default function ClaudeInbox(props: { inboxKey: string; onOpen: (item: InboxItem) => void })`; Home navigates to `/scripts/new` with router state `{ inboxItem: InboxItem }`

- [ ] **Step 1: Write the failing tests**

`src/components/ClaudeInbox.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import ClaudeInbox from './ClaudeInbox'
import { fetchInbox, type InboxItem } from '../utils/inbox'

vi.mock('../utils/inbox', () => ({ fetchInbox: vi.fn() }))

const ITEM: InboxItem = {
  id: 'id-1',
  title: '朝のルーティン',
  body: '一行目\n二行目',
  caption: '#朝活',
  createdAt: '2026-10-09T01:00:00.000Z',
}

beforeEach(() => {
  vi.mocked(fetchInbox).mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ClaudeInbox', () => {
  it('lists what arrived and opens one when tapped', async () => {
    vi.mocked(fetchInbox).mockResolvedValue([ITEM])
    const onOpen = vi.fn()
    render(<ClaudeInbox inboxKey="secret" onOpen={onOpen} />)

    expect(await screen.findByText('Claudeから届いたスクリプト')).toBeInTheDocument()
    expect(fetchInbox).toHaveBeenCalledWith('secret')
    fireEvent.click(screen.getByRole('button', { name: /朝のルーティン/ }))
    expect(onOpen).toHaveBeenCalledWith(ITEM)
  })

  it('shows nothing and asks nothing without a key', () => {
    const { container } = render(<ClaudeInbox inboxKey="" onOpen={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    expect(fetchInbox).not.toHaveBeenCalled()
  })

  it('shows nothing when the inbox is empty', async () => {
    vi.mocked(fetchInbox).mockResolvedValue([])
    const { container } = render(<ClaudeInbox inboxKey="secret" onOpen={vi.fn()} />)
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing when the inbox cannot be reached', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(fetchInbox).mockRejectedValue(new Error('offline'))
    const { container } = render(<ClaudeInbox inboxKey="secret" onOpen={vi.fn()} />)
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })

  it('checks again when the app comes back to the foreground', async () => {
    vi.mocked(fetchInbox).mockResolvedValueOnce([]).mockResolvedValueOnce([ITEM])
    render(<ClaudeInbox inboxKey="secret" onOpen={vi.fn()} />)
    await act(async () => {})
    expect(screen.queryByText('Claudeから届いたスクリプト')).not.toBeInTheDocument()

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(await screen.findByText('Claudeから届いたスクリプト')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/ClaudeInbox.test.tsx`
Expected: FAIL — cannot resolve `./ClaudeInbox`.

- [ ] **Step 3: Implement**

`src/components/ClaudeInbox.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { fetchInbox, type InboxItem } from '../utils/inbox'
import styles from './ClaudeInbox.module.css'

interface Props {
  inboxKey: string
  onOpen: (item: InboxItem) => void
}

/**
 * Scripts sent from Claude chat and not yet made into a script. Checked on
 * mount and whenever the app returns to the foreground, since a home-screen
 * app often resumes on Home without remounting it. Any failure just hides
 * the section: Home must work the same without the inbox.
 */
export default function ClaudeInbox({ inboxKey, onOpen }: Props) {
  const [items, setItems] = useState<InboxItem[]>([])

  useEffect(() => {
    if (!inboxKey) {
      setItems([])
      return
    }
    let cancelled = false
    function load() {
      fetchInbox(inboxKey)
        .then(next => {
          if (!cancelled) setItems(next)
        })
        .catch(err => {
          if (cancelled) return
          console.error('Failed to check the Claude inbox', err)
          setItems([])
        })
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') load()
    }
    load()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [inboxKey])

  if (items.length === 0) return null

  return (
    <section className={styles.inbox}>
      <h2 className={styles.heading}>Claudeから届いたスクリプト</h2>
      <ul className={styles.list}>
        {items.map(item => (
          <li key={item.id}>
            <button className={styles.item} onClick={() => onOpen(item)}>
              <span className={styles.title}>{item.title}</span>
              <span className={styles.meta}>
                {new Date(item.createdAt).toLocaleString('ja-JP', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

`src/components/ClaudeInbox.module.css`:

```css
.inbox {
  margin: 12px 16px 0;
  padding: 12px;
  border-radius: 12px;
  background: var(--surface2);
  border: 1px solid var(--accent);
}

.heading {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--accent);
  margin-bottom: 8px;
}

.list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.item {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface);
  text-align: left;
}

.title {
  font-weight: 600;
  color: var(--text);
}

.meta {
  flex: none;
  font-size: 0.8rem;
  color: var(--text-muted);
}
```

`src/pages/HomePage.tsx`:
- imports: `import { useSettings } from '../hooks/useSettings'` and `import ClaudeInbox from '../components/ClaudeInbox'`
- in the component: `const [settings] = useSettings()`
- directly after the closing `</header>`:

```tsx
      <ClaudeInbox
        inboxKey={settings.inboxKey}
        onOpen={item => navigate('/scripts/new', { state: { inboxItem: item } })}
      />
```

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run src/components/ClaudeInbox.test.tsx src/pages/HomePage.test.tsx && npx tsc -b`
Expected: PASS; exit 0. (`HomePage.test.tsx` has no key set, so the inbox stays silent.)

- [ ] **Step 5: Commit**

```bash
git add src/components/ClaudeInbox.tsx src/components/ClaudeInbox.module.css src/components/ClaudeInbox.test.tsx src/pages/HomePage.tsx
git commit -m "feat: show scripts sent from Claude on Home

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 新規スクリプト pre-fill, caption field, and claiming the item

**Files:**
- Modify: `src/pages/ScriptEditPage.tsx`, `src/pages/ScriptEditPage.module.css`
- Test: `src/pages/ScriptEditPage.test.tsx` (new)

**Interfaces:**
- Consumes: router state `{ inboxItem: InboxItem }` (Task 7); `deleteInboxItem` (Task 6); `useSettings().inboxKey`; `createScript(title, shots, caption)` / `updateScript(id, { caption })` (Task 5)

- [ ] **Step 1: Write the failing tests**

`src/pages/ScriptEditPage.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ScriptEditPage from './ScriptEditPage'
import { deleteInboxItem, type InboxItem } from '../utils/inbox'
import type { Script } from '../types'

vi.mock('../utils/inbox', () => ({ deleteInboxItem: vi.fn(async () => {}) }))

const ITEM: InboxItem = {
  id: 'inbox-1',
  title: '朝のルーティン',
  body: '一行目\n二行目',
  caption: '#朝活',
  createdAt: '2026-10-09T01:00:00.000Z',
}

function stored(): Script[] {
  return JSON.parse(localStorage.getItem('teleprompter_scripts') ?? '[]')
}

function renderAt(entry: string | { pathname: string; state: unknown }) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/scripts/new" element={<ScriptEditPage />} />
        <Route path="/scripts/:id/edit" element={<ScriptEditPage />} />
        <Route path="/scripts/:id/shots" element={<p>ショット編集</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.mocked(deleteInboxItem).mockClear()
  localStorage.setItem('teleprompter_settings', JSON.stringify({ inboxKey: 'secret' }))
})

describe('ScriptEditPage from the Claude inbox', () => {
  it('opens with the title, script and caption filled in', () => {
    renderAt({ pathname: '/scripts/new', state: { inboxItem: ITEM } })
    expect(screen.getByLabelText('タイトル')).toHaveValue('朝のルーティン')
    expect(screen.getByLabelText('スクリプト全文')).toHaveValue('一行目\n二行目')
    expect(screen.getByLabelText('キャプション（任意）')).toHaveValue('#朝活')
  })

  it('prefers the arrived script over a leftover draft', () => {
    sessionStorage.setItem('teleprompter_new_script_draft', JSON.stringify({ title: '下書き', body: '古い' }))
    renderAt({ pathname: '/scripts/new', state: { inboxItem: ITEM } })
    expect(screen.getByLabelText('タイトル')).toHaveValue('朝のルーティン')
  })

  it('splits one shot per line, creates the script with its caption, and clears the item', async () => {
    renderAt({ pathname: '/scripts/new', state: { inboxItem: ITEM } })
    fireEvent.click(screen.getByText('自動分割する'))
    expect(screen.getByText('分割結果（2ショット）')).toBeInTheDocument()
    fireEvent.click(screen.getByText('編集へ進む →'))

    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()).toHaveLength(1)
    expect(stored()[0]).toMatchObject({ title: '朝のルーティン', caption: '#朝活' })
    expect(stored()[0].shots.map(s => s.text)).toEqual(['一行目', '二行目'])
    expect(deleteInboxItem).toHaveBeenCalledWith('secret', 'inbox-1')
  })

  it('still creates the script when clearing the item fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(deleteInboxItem).mockRejectedValueOnce(new Error('offline'))
    renderAt({ pathname: '/scripts/new', state: { inboxItem: ITEM } })
    fireEvent.click(screen.getByText('自動分割する'))
    fireEvent.click(screen.getByText('編集へ進む →'))
    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()).toHaveLength(1)
  })
})

describe('ScriptEditPage caption', () => {
  it('saves a typed caption on a new script, without touching the inbox', async () => {
    renderAt('/scripts/new')
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '手入力' } })
    fireEvent.change(screen.getByLabelText('スクリプト全文'), { target: { value: 'a' } })
    fireEvent.change(screen.getByLabelText('キャプション（任意）'), { target: { value: ' #手入力 ' } })
    fireEvent.click(screen.getByText('自動分割する'))
    fireEvent.click(screen.getByText('編集へ進む →'))

    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()[0].caption).toBe('#手入力')
    expect(deleteInboxItem).not.toHaveBeenCalled()
  })

  it('edits the caption of an existing script', async () => {
    const script: Script = {
      id: 's1',
      title: '既存',
      shots: [{ id: 'a', text: 'a' }],
      caption: '古いキャプション',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    localStorage.setItem('teleprompter_scripts', JSON.stringify([script]))
    renderAt('/scripts/s1/edit')

    expect(screen.getByLabelText('キャプション（任意）')).toHaveValue('古いキャプション')
    fireEvent.change(screen.getByLabelText('キャプション（任意）'), { target: { value: '新しいキャプション' } })
    fireEvent.click(screen.getByText('編集へ進む →'))

    expect(await screen.findByText('ショット編集')).toBeInTheDocument()
    expect(stored()[0].caption).toBe('新しいキャプション')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pages/ScriptEditPage.test.tsx`
Expected: FAIL — no pre-fill, no キャプション（任意） field.

- [ ] **Step 3: Implement in `src/pages/ScriptEditPage.tsx`**

Imports — replace the router import and add:

```tsx
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useSettings } from '../hooks/useSettings'
import { deleteInboxItem, type InboxItem } from '../utils/inbox'
```

Replace the start of the component up to (and including) `const [preview, …` with this — the draft is read once, and an arrived inbox item takes precedence over it:

```tsx
interface Draft {
  title?: string
  body?: string
  caption?: string
}

function loadDraft(): Draft {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') } catch { return {} }
}

export default function ScriptEditPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams<{ id: string }>()
  const { createScript, updateScript, getScript } = useScripts()
  const [settings] = useSettings()

  const existingScript = id ? getScript(id) : undefined
  const isEdit = Boolean(existingScript)
  // A script sent from Claude chat, opened from Home's inbox section.
  const inboxItem = isEdit ? undefined : (location.state as { inboxItem?: InboxItem } | null)?.inboxItem

  const [initial] = useState(() => {
    if (existingScript) {
      return {
        title: existingScript.title,
        body: existingScript.shots.map(s => s.text).join('\n'),
        caption: existingScript.caption ?? '',
      }
    }
    if (inboxItem) return { title: inboxItem.title, body: inboxItem.body, caption: inboxItem.caption }
    const draft = loadDraft()
    return { title: draft.title ?? '', body: draft.body ?? '', caption: draft.caption ?? '' }
  })
  const [title, setTitle] = useState(initial.title)
  const [body, setBody] = useState(initial.body)
  const [caption, setCaption] = useState(initial.caption)
  const [preview, setPreview] = useState<string[]>(
    () => existingScript ? existingScript.shots.map(s => s.text) : []
  )
```

Replace `saveDraft` with one that saves all three fields:

```tsx
  function saveDraft(next: Partial<Draft>) {
    if (!isEdit) {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title, body, caption, ...next }))
    }
  }
```

and update its callers: the title input's `onChange` → `saveDraft({ title: e.target.value })`; the body textarea's `onChange` → `saveDraft({ body: e.target.value })`.

In `handleNext`, replace the two branches:

```tsx
    if (existingScript) {
      const shots = reconcileShots(existingScript.shots, preview, generateId)
      updateScript(existingScript.id, { title: title.trim(), shots, caption: caption.trim() })
      navigate(`/scripts/${existingScript.id}/shots`)
    } else {
      const shots: Shot[] = preview.map(text => ({ id: generateId(), text }))
      const script = createScript(title.trim(), shots, caption.trim())
      clearDraft()
      if (inboxItem && settings.inboxKey) {
        // Taken: clear it from the inbox so no device offers it again. If
        // this fails the item just lingers until it expires.
        deleteInboxItem(settings.inboxKey, inboxItem.id)
          .catch(err => console.error('Failed to clear the inbox item', err))
      }
      navigate(`/scripts/${script.id}/shots`)
    }
```

Add the caption field after the split preview block (the `{preview.length > 0 && (…)}` block), still inside `.body`:

```tsx
        <label className={styles.label} htmlFor="script-caption">キャプション（任意）</label>
        <textarea
          id="script-caption"
          className={`${styles.textarea} ${styles.captionTextarea}`}
          placeholder="TikTokに投稿するときのキャプション"
          value={caption}
          onChange={e => {
            setCaption(e.target.value)
            saveDraft({ caption: e.target.value })
          }}
          rows={4}
        />
```

`src/pages/ScriptEditPage.module.css` — append:

```css
.captionTextarea {
  margin-top: 4px;
}
```

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run src/pages/ScriptEditPage.test.tsx && npx tsc -b`
Expected: PASS; exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ScriptEditPage.tsx src/pages/ScriptEditPage.module.css src/pages/ScriptEditPage.test.tsx
git commit -m "feat: open a script sent from Claude pre-filled, with its caption

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 「キャプションをコピー」 on the export step

**Files:**
- Modify: `src/pages/FinalizePage.tsx`, `src/pages/FinalizePage.module.css`
- Test: `src/pages/FinalizePage.test.tsx`

**Interfaces:**
- Consumes: `Script.caption` (Task 5)

- [ ] **Step 1: Write the failing tests**

In `src/pages/FinalizePage.test.tsx`, inside `describe('FinalizePage export step: loudness normalization', …)` after the last `it(…)`, add:

```tsx
  it('copies the caption from the export step', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    localStorage.setItem('teleprompter_scripts', JSON.stringify([{ ...seedScript(), caption: '#朝活 おはよう' }]))
    await walkToExport()

    fireEvent.click(await screen.findByText('キャプションをコピー'))
    expect(writeText).toHaveBeenCalledWith('#朝活 おはよう')
    expect(await screen.findByText('コピーしました')).toBeInTheDocument()
  })

  it('says so when the caption cannot be copied', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => { throw new Error('denied') }) },
      configurable: true,
    })
    localStorage.setItem('teleprompter_scripts', JSON.stringify([{ ...seedScript(), caption: '#朝活' }]))
    await walkToExport()

    fireEvent.click(await screen.findByText('キャプションをコピー'))
    expect(await screen.findByText('コピーできませんでした')).toBeInTheDocument()
  })

  it('offers no caption copy when the script has no caption', async () => {
    await walkToExport()
    expect(await screen.findByText('保存する')).toBeInTheDocument()
    expect(screen.queryByText('キャプションをコピー')).not.toBeInTheDocument()
  })
```

(`seedScript()` writes the plain script and returns it; overwriting `teleprompter_scripts` right after adds the caption. If the file's `beforeEach` already calls `seedScript()`, this still works — the later write wins before `walkToExport()` renders.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pages/FinalizePage.test.tsx -t "caption"`
Expected: FAIL — no キャプションをコピー button.

- [ ] **Step 3: Implement in `src/pages/FinalizePage.tsx`**

Near the other export-step state (after `const [exportBlob, setExportBlob] = …`):

```tsx
  const [captionCopy, setCaptionCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
```

After `handleSaveFinal`:

```tsx
  // The caption Claude wrote with the script, ready to paste into TikTok.
  async function handleCopyCaption() {
    if (!script?.caption) return
    try {
      await navigator.clipboard.writeText(script.caption)
      setCaptionCopy('copied')
    } catch {
      setCaptionCopy('failed')
    }
    setTimeout(() => setCaptionCopy('idle'), 2000)
  }
```

In the export step, directly after the 保存する button:

```tsx
              {script.caption && (
                <button className={styles.copyCaptionBtn} onClick={handleCopyCaption}>
                  {captionCopy === 'copied'
                    ? 'コピーしました'
                    : captionCopy === 'failed'
                      ? 'コピーできませんでした'
                      : 'キャプションをコピー'}
                </button>
              )}
```

`src/pages/FinalizePage.module.css` — append:

```css
.copyCaptionBtn {
  background: var(--surface2);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 12px 24px;
  border-radius: 12px;
  font-size: 0.95rem;
  font-weight: 600;
  margin-top: 12px;
}
```

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run src/pages/FinalizePage.test.tsx && npx tsc -b`
Expected: PASS (whole file, to catch regressions); exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/pages/FinalizePage.tsx src/pages/FinalizePage.module.css src/pages/FinalizePage.test.tsx
git commit -m "feat: copy the script's caption from the export step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: README setup guide and full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a section to `README.md`** (place it after the existing feature/usage sections; match their heading level):

```markdown
## Claudeチャットからスクリプトを受け取る

Claudeチャットで「teleprompterに送って」と頼むと、タイトル・本文・キャプションがサーバー側の受け取り箱に届き、どの端末のホーム画面にも「Claudeから届いたスクリプト」として出ます。タップすると新規スクリプトが入力済みで開きます（作成すると受け取り箱から消えます。取らなかったものは30日で消えます）。

### 初回だけの設定

1. Vercel ダッシュボード → Storage → **Upstash for Redis** を無料プランで作成し、このプロジェクトに接続する（`KV_REST_API_URL` / `KV_REST_API_TOKEN` が自動で入る）
2. Vercel の環境変数に `INBOX_SECRET`（長いランダムな文字列）を追加して再デプロイ
3. claude.ai → 設定 → コネクタ → カスタムコネクタを追加 → URL に `https://<アプリのドメイン>/api/mcp?key=<INBOX_SECRET>`
4. 各端末の teleprompter → 設定 → 受け取り用キー に同じ `INBOX_SECRET` を入れる

サーバー側: `api/`（Vercel Functions の入口）、`server/`（処理とテスト）。ローカルの `npm run dev` では `/api` は動かないので、受け取り箱は表示されません。
```

- [ ] **Step 2: Full verification**

Run (from the worktree): `npx tsc -b && npm run lint && npx vitest run && npm run build`
Expected: tsc exit 0; lint no errors; all tests PASS; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: explain how to receive scripts from Claude chat

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### After the tasks (controller, with the user)

1. Open the PR (`feat/claude-inbox` → `main`).
2. Walk the user through the one-time setup (Upstash + `INBOX_SECRET` — offer to generate the secret and add it with `vercel env add` after they confirm).
3. Once merged and deployed, the user adds the connector; send a real script from Claude chat and verify: Home shows it → pre-filled 新規スクリプト → 自動分割 → 編集へ進む → item gone from Home on another device → caption copy on the export step.
