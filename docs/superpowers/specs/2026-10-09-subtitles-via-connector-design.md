# Japanese Subtitles Back Through the Connector

**Date:** 2026-10-09
**Status:** Approved (brainstorming)
**Builds on:** `2026-10-09-claude-inbox-design.md` (connector, `INBOX_SECRET`, Upstash)

## Problem

On the subtitle step the user copies the Claude prompt, pastes it into Claude
chat, then copies Claude's numbered reply back, pastes it and taps
日本語を反映. The return trip (copy, switch apps, paste, tap) is the tedious
part.

## Goal

Keep 📋 Claude用プロンプトをコピー → paste into Claude chat as today. Claude
then translates **and** sends the lines back through the connector; when the
user returns to the teleprompter the Japanese is already applied
(「Claudeの日本語訳を反映しました」). The numbered reply still appears in chat,
so manual paste keeps working as a fallback.

## Non-goals

- Fetching the prompt from Claude's side (the user rejected a "translation
  request box": it saves nothing over copying the prompt).
- Changing the translation rules in the prompt.
- Auto-applying when the cue already has any Japanese (the translation
  section is only shown before any Japanese exists, as today).

## Design

### Request id

`subtitleRequestId(cues)` = FNV-1a 32-bit hash (base36) of the cues' English
lines with `*emphasis*` stripped, joined by `\n`, plus `-<line count>`, e.g.
`1x9kq2c-6`. Deterministic, so a reload (common on iPhone after switching
apps) or a later visit computes the same id; editing the English changes it,
so a stale translation can never be applied to different lines.

### Prompt

`buildClaudePrompt(cues, requestId?)`. When a request id is given (only when
this device has a 受け取り用キー), a section is appended after 【出力】:

```
【teleprompterへの送信】
send_subtitles ツールが使えるときは、訳を出力したあとに必ず呼び出してteleprompterに送ってください。
- request_id: <id>
- lines: 上の訳を番号なしで1行ずつ、順番どおりに（<n>行）
```

Without a key the prompt is unchanged.

### Server

- **Tool `send_subtitles({ request_id, lines })`** on the existing MCP server.
  `request_id` must match `^[0-9a-z]{1,13}-[1-9][0-9]{0,2}$`; `lines` is 1–300
  trimmed non-empty strings of ≤200 chars. If `lines.length` differs from the
  id's count suffix the tool returns an error asking Claude to resend that
  many lines. Otherwise it stores `subtitles:<request_id>` →
  `{ lines, createdAt }` for 1 day and replies
  「日本語字幕N行をteleprompterに送りました。teleprompterの字幕画面に戻ると反映されます。」
- **`/api/subtitles?id=<request_id>`** (Bearer `INBOX_SECRET`): `GET` →
  `{ lines }` or 404; `DELETE` → 204 (also when gone); missing id → 400.
- Shared plumbing: one `redisFromEnv()`; the inbox and subtitles REST
  handlers share a bearer-auth + 500 wrapper; the MCP handler takes both
  stores.

### App

- `useForegroundCheck(key, check)`: runs `check` now and whenever the app
  returns to the foreground while `key` is non-null, passing `isStale()` so
  only the latest check may act. Home's `ClaudeInbox` moves onto it.
- `SubtitleWorkflow` gets `inboxKey`. While reviewing with no Japanese yet and
  a key set, it checks `/api/subtitles` for the current request id. On a hit
  it applies the lines (`withJapaneseLines`, which shares the line-count
  check with the paste path), shows 「Claudeの日本語訳を反映しました」 and
  deletes the result. A count mismatch shows the paste-style error.
  Failures only log.
- Under the copy button, when a key is set: 「Claudeチャットに貼ると、訳がこの画面に自動で入ります」.

## Testing

Server: tool stores with TTL, count/format errors, auth; REST get/404/delete.
App: request id stability and sensitivity, prompt section only with an id,
`withJapaneseLines`, auto-apply on mount and on return, no apply when
Japanese exists or no key, mismatch error. End to end on the device.
