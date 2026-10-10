import { useState } from 'react'
import { useForegroundCheck } from '../hooks/useForegroundCheck'
import { fetchInbox, type InboxItem } from '../utils/inbox'
import styles from './ClaudeInbox.module.css'

interface Props {
  inboxKey: string
  onOpen: (item: InboxItem) => void
}

/**
 * Scripts sent from Claude chat and not yet made into a script, checked on
 * mount and whenever the app returns to the foreground. Any failure just
 * hides the section: Home must work the same without the inbox.
 */
export default function ClaudeInbox({ inboxKey, onOpen }: Props) {
  const [items, setItems] = useState<InboxItem[]>([])

  useForegroundCheck(inboxKey || null, (key, isStale) => {
    fetchInbox(key)
      .then(next => {
        if (!isStale()) setItems(next)
      })
      .catch(err => {
        if (isStale()) return
        console.error('Failed to check the Claude inbox', err)
        setItems([])
      })
  })

  if (!inboxKey || items.length === 0) return null

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
