# Subtitles via Connector Implementation Plan

> Executed inline (superpowers:executing-plans), TDD per task, one commit per task.

**Goal:** Claude sends the Japanese subtitle lines back through the connector and the subtitle step applies them automatically.

**Spec:** `docs/superpowers/specs/2026-10-09-subtitles-via-connector-design.md`

## Global Constraints

- Relative imports in `api/`, `server/`, `shared/` use `.js`; server tests start with `// @vitest-environment node`.
- Redis key `subtitles:<request_id>`, expiry 1 day (`86400`).
- `request_id` regex `^[0-9a-z]{1,13}-[1-9][0-9]{0,2}$`; lines 1–300, each trimmed 1–200 chars.
- UI copy: 「Claudeの日本語訳を反映しました」, 「Claudeチャットに貼ると、訳がこの画面に自動で入ります」.
- Type check `npx tsc -b`; commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Task 1: Subtitle store and shared server plumbing
- `server/redis.ts`: `redisFromEnv(): Redis` (moved out of `inboxStoreFromEnv`).
- `server/subtitleStore.ts`: `SUBTITLES_TTL_SECONDS = 86400`; `interface SubtitleStore { put(id, lines): Promise<void>; get(id): Promise<string[] | null>; remove(id): Promise<void> }`; `createSubtitleStore(redis)`, `subtitleStoreFromEnv()`.
- `RedisLike` gains `get`; fake Redis implements it.
- `server/http.ts`: `bearer(request)`, `withAuthedJson(request, handle)` → 401 / handler / 500; `inboxApi.ts` uses it.
- Tests: `server/subtitleStore.test.ts`; existing server tests stay green.

### Task 2: `send_subtitles` MCP tool
- `handleMcpRequest(request, deps: { inbox: () => InboxStore; subtitles: () => SubtitleStore })`; `api/mcp.ts` passes both.
- Tool per spec; count suffix check; store errors → tool error.
- Tests in `server/mcp.test.ts` (tool listed, stores, count mismatch, bad id).

### Task 3: `/api/subtitles`
- `server/subtitlesApi.ts`: `handleSubtitlesRequest(request, getStore)`; `api/subtitles.ts` entry (GET, DELETE).
- Tests: auth, GET hit/404, DELETE idempotent, missing id 400.

### Task 4: App helpers
- `src/utils/subtitleRequest.ts`: `subtitleRequestId(cues)`, `fetchSubtitles(key, id): Promise<string[] | null>`, `deleteSubtitles(key, id)`.
- `src/utils/subtitleCues.ts`: `buildClaudePrompt(cues, requestId?)`; `withJapaneseLines(cues, lines)`; `parseJapanesePaste` uses it.
- `src/hooks/useForegroundCheck.ts`; `ClaudeInbox` refactored onto it.
- Tests for each.

### Task 5: Auto-apply in the subtitle step
- `SubtitleWorkflow` prop `inboxKey`; prompt gets the id when a key is set; hint line; `useForegroundCheck` → apply/notice/delete; mismatch → `pasteError`.
- `FinalizePage` passes `settings.inboxKey`.
- Tests in `SubtitleWorkflow.test.tsx`.

### Task 6: README + full verification
- README (JP + EN) short note under the Claude section.
- `npx tsc -b && npm run lint && npx vitest run && npm run build`.
