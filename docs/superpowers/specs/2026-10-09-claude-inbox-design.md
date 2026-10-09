# Sending Scripts from Claude Chat (受け取り箱)

**Date:** 2026-10-09
**Status:** Approved (brainstorming)

## Problem

The user writes TikTok scripts and captions with Claude chat, then copies the
script into 新規スクリプト by hand. Later, when posting, they scroll back
through the chat to find the caption. Both steps are tedious.

They use different devices on different days (Claude on Mac or iPhone; the
teleprompter as a home-screen PWA on iPhone, or on Mac), so a link-based
hand-off does not work: on iOS a link opens in Safari, whose storage is
separate from the home-screen PWA's.

## Goal

In Claude chat, "teleprompterに送って" delivers the title, script and caption
to a server-side inbox. Opening the teleprompter on any device shows the item;
tapping it opens 新規スクリプト pre-filled, so the user goes straight to
自動分割する. The caption is kept with the script and can be copied from the
export step of the finalize page.

Running cost stays at zero beyond the user's Claude Pro plan: Claude calls the
app (no Claude API use), Vercel Hobby functions and the Upstash Redis free
tier cover the traffic.

## Non-goals

- Sending scripts from anywhere other than Claude chat.
- Syncing existing scripts between devices (the inbox only hands off new ones).
- Auto-splitting or skipping 新規スクリプト: the user still presses
  自動分割する and 編集へ進む.
- A UI to discard inbox items; unclaimed items expire after 30 days.

## Architecture

```
Claude chat ──tool call──▶ /api/mcp?key=…  (Vercel Function, MCP server)
                                │ SET inbox:<id>  EX 30d
                                ▼
                          Upstash Redis
                                ▲
teleprompter (any device) ──GET/DELETE /api/inbox (Bearer key)
```

### Server (Vercel Functions, `api/`)

**Shared secret.** One env var, `INBOX_SECRET`. Both endpoints reject any
request whose key does not match (constant-time comparison) with 401.

**Storage.** Upstash Redis, created from the Vercel Marketplace (free plan).
Client built from the env vars that integration injects
(`KV_REST_API_URL` / `KV_REST_API_TOKEN`, falling back to
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`). Each item is its own
key `inbox:<uuid>` holding JSON, with a 30-day expiry:

```ts
interface InboxItem {
  id: string
  title: string
  body: string      // one shot per line
  caption: string   // may be ''
  createdAt: string // ISO
}
```

Listing scans `inbox:*`; the inbox only ever holds a handful of items.

**`/api/mcp?key=<INBOX_SECRET>`** — a stateless remote MCP server
(Streamable HTTP), added to claude.ai as a custom connector with this URL. One
tool:

- `send_to_teleprompter({ title, script, caption? })`
  - Description (Japanese) tells Claude: use when the user asks to send a
    finished script to the teleprompter; write `script` as spoken lines only,
    **one shot per line**, no headings, stage directions or numbering;
    put the TikTok caption (with hashtags) in `caption`.
  - Limits: title 1–100 chars, script 1–10,000, caption 0–4,000. Trimmed.
  - Returns a short Japanese confirmation, e.g.
    「『<title>』をteleprompterに送りました（N行）」.

**`/api/inbox`** (`Authorization: Bearer <INBOX_SECRET>`)

- `GET` → `{ items: InboxItem[] }`, newest first.
- `DELETE ?id=<uuid>` → 204 (also 204 if already gone).

**Routing.** `vercel.json`'s SPA rewrite becomes `/((?!api/).*)` so it can
never shadow the functions. The existing COOP/COEP/CORP headers are harmless
on same-origin API responses.

### App

**Settings.** `AppSettings` gains `inboxKey: string` (default `''`). Settings
page gets a 「受け取り用キー」 field with a one-line explanation. Entered once
per device.

**Inbox client** (`src/utils/inbox.ts`): `fetchInbox(key)` and
`deleteInboxItem(key, id)` against the same origin. No key → no request.

**Home.** When `inboxKey` is set, fetch on mount. If items exist, show a
「Claudeから届いたスクリプト」 section above the list: title and received date
per item. Any failure (offline, 401, server error) hides the section and logs
to the console; Home otherwise behaves exactly as today. Tapping an item
navigates to `/scripts/new` with the item in router state.

**新規スクリプト.** If router state carries an inbox item, it pre-fills
title, body and caption, taking precedence over the session draft. Split
options stay at the new-script default (newline only), matching Claude's one
line per shot. 編集へ進む creates the script (with its caption) and then
deletes the inbox item fire-and-forget; if that delete fails the item simply
stays in the inbox until it expires.

**Caption.**
- `Script` gains `caption?: string`. `createScript` takes it;
  `updateScript` may change it.
- 新規スクリプト and スクリプト編集 show an optional 「キャプション」
  textarea under the script body; it does not affect splitting.
- Finalize export step: when the script has a non-empty caption, a
  「キャプションをコピー」 button sits below 保存する. It writes with
  `navigator.clipboard.writeText` and shows 「コピーしました」 briefly; on
  failure it shows 「コピーできませんでした」.
- Backups: `isScript` in `scriptBackup.ts` accepts an optional string
  `caption`, so captions survive backup/restore.

## Error handling

| Situation | Behaviour |
|---|---|
| Wrong/missing key on either endpoint | 401; Home hides the inbox section |
| Redis env vars missing | 500 with a clear log line; MCP tool returns an error message Claude can relay |
| Tool input out of limits | MCP tool error explaining which field |
| Offline on Home | Inbox section hidden |
| Delete after create fails | Item stays; expires in 30 days |
| Clipboard write rejected | 「コピーできませんでした」 |

## One-time setup (user)

1. Vercel dashboard → Storage → create Upstash Redis (free plan, no card),
   connect it to the teleprompter project.
2. Add env var `INBOX_SECRET` (a long random string) and redeploy.
3. claude.ai → Settings → Connectors → Add custom connector:
   `https://<app>/api/mcp?key=<INBOX_SECRET>`.
4. On each device: teleprompter 設定 → 受け取り用キー → paste the secret.

## Testing

- **Server (vitest, in-memory Redis fake):** tool stores a well-formed item
  with TTL; rejects bad key; enforces limits; `GET` lists newest first;
  `DELETE` removes and is idempotent; bad bearer → 401.
- **App (vitest + Testing Library):** settings persist `inboxKey`; Home shows
  items from a mocked fetch and hides on failure / no key; 新規スクリプト
  pre-fills from router state and deletes the item after 編集へ進む; caption
  saved on create and edit; finalize copy button present only with a caption
  and calls the clipboard; backup round-trips `caption`.
- **End to end:** after the user's setup, send a real script from Claude chat
  and walk it through Home → 自動分割 → 編集へ進む, then copy the caption on
  the finalize page.
