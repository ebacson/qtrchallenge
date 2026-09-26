import { useEffect, useMemo, useState } from 'react'
import { onValue, ref, update } from 'firebase/database'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'

type Noti = {
  id: string
  title: string
  content: string
  creatorUserID: string
  createdAt: string
  read: boolean
}

export function NotificationsPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<Noti[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    const nRef = ref(db, 'notifications')
    const unsub = onValue(nRef, (snap) => {
      const val = (snap.val() ?? {}) as Record<string, Record<string, unknown>>
      const list = Object.entries(val).map(([id, row]) => {
        const readBy = (row.readBy ?? {}) as Record<string, unknown>
        return {
          id,
          title: String(row.title ?? ''),
          content: String(row.content ?? ''),
          creatorUserID: String(row.creatorUserID ?? ''),
          createdAt: String(row.createdAt ?? ''),
          read: Boolean(readBy[user.uid]),
        }
      })
      list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      setItems(list)
      setLoading(false)
    })
    return unsub
  }, [user])

  const unread = useMemo(() => items.filter((n) => !n.read).length, [items])

  async function markRead(id: string) {
    if (!user) return
    await update(ref(db, `notifications/${id}/readBy`), { [user.uid]: true })
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Thông báo</h1>
        <p className="lede">
          {unread > 0 ? `${unread} chưa đọc` : 'Đã đọc hết thông báo.'}
        </p>
      </header>

      {loading ? (
        <p className="empty">Đang tải…</p>
      ) : items.length === 0 ? (
        <p className="empty">Chưa có thông báo.</p>
      ) : (
        <ul className="noti-list">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={n.read ? 'noti-card' : 'noti-card unread'}
                onClick={() => void markRead(n.id)}
              >
                <div className="noti-top">
                  <strong>{n.title || 'Thông báo'}</strong>
                  {!n.read && <span className="dot" />}
                </div>
                <p>{n.content}</p>
                <span className="tiny muted">{n.createdAt}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
