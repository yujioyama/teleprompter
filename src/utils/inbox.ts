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
  const data = (await res.json()) as { items?: InboxItem[] } | null
  return Array.isArray(data?.items) ? data.items : []
}

export async function deleteInboxItem(key: string, id: string): Promise<void> {
  const res = await fetch(`/api/inbox?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth(key) })
  if (!res.ok) throw new Error(`Inbox delete failed: ${res.status}`)
}
