import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { get, onValue, push, ref, remove, set, update } from 'firebase/database'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import { normalizeText, plainText, RichText } from '../components/RichText'

type Noti = {
  id: string
  title: string
  content: string
  creatorUserID: string
  createdAt: string
  updatedAt: string
  read: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Cùng định dạng app iOS ghi: "yyyy-MM-dd HH:mm:ss" theo giờ Việt Nam. */
function vnDateTimeString(ms: number): string {
  const d = new Date(ms + 7 * 60 * 60 * 1000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

function readCreatedAt(value: unknown): string {
  if (typeof value === 'number') return vnDateTimeString(value > 1e12 ? value : value * 1000)
  return String(value ?? '')
}

function formatCreatedAt(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value)
  if (!m) return value
  return `${m[4]}:${m[5]} · ${m[3]}/${m[2]}/${m[1]}`
}

type NotiDraft = { title: string; content: string }

function NotiForm({
  initial,
  submitLabel,
  busyLabel,
  onSubmit,
  onCancel,
}: {
  initial: NotiDraft
  submitLabel: string
  busyLabel: string
  onSubmit: (draft: NotiDraft) => Promise<void>
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial.title)
  const [content, setContent] = useState(initial.content)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const cleanTitle = normalizeText(title).replace(/\n+/g, ' ')
    const cleanContent = normalizeText(content)
    if (!cleanTitle || !cleanContent) {
      setError('Nhập tiêu đề và nội dung.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onSubmit({ title: cleanTitle, content: cleanContent })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được thông báo')
      setBusy(false)
    }
  }

  return (
    <form
      className="auth-form panel"
      onSubmit={(e) => void handleSubmit(e)}
      onClick={(e) => e.stopPropagation()}
    >
      <label>
        Tiêu đề
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={150}
          required
        />
      </label>
      <label>
        Nội dung
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          required
        />
      </label>
      <p className="tiny muted">
        Giữ nguyên xuống dòng; dòng bắt đầu bằng "-" hiện thành gạch đầu dòng, "-----" là đường
        kẻ, link tự bấm được.
      </p>
      {content.trim() && (
        <div className="noti-preview">
          <p className="noti-preview-label">Xem trước</p>
          <strong>{plainText(title) || 'Thông báo'}</strong>
          <RichText text={content} />
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="cta-row">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? busyLabel : submitLabel}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>
          Hủy
        </button>
      </div>
    </form>
  )
}

export function NotificationsPage() {
  const { user, profile } = useAuth()
  const isAdmin = Boolean(profile?.admin)
  const [items, setItems] = useState<Noti[]>([])
  const [loading, setLoading] = useState(true)
  const [creatorNames, setCreatorNames] = useState<Record<string, string>>({})

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!user) return
    const unsub = onValue(ref(db, 'notifications'), (snap) => {
      const val = (snap.val() ?? {}) as Record<string, Record<string, unknown>>
      const list = Object.entries(val).map(([id, row]) => {
        const readBy = (row.readBy ?? {}) as Record<string, unknown>
        return {
          id,
          title: String(row.title ?? ''),
          content: String(row.content ?? ''),
          creatorUserID: String(row.creatorUserID ?? ''),
          createdAt: readCreatedAt(row.createdAt),
          updatedAt: row.updatedAt == null ? '' : readCreatedAt(row.updatedAt),
          read: Boolean(readBy[user.uid]),
        }
      })
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      setItems(list)
      setLoading(false)
    })
    return unsub
  }, [user])

  useEffect(() => {
    const missing = [...new Set(items.map((n) => n.creatorUserID))].filter(
      (id) => id && !(id in creatorNames),
    )
    if (!missing.length) return
    void Promise.all(
      missing.map(async (id) => {
        const snap = await get(ref(db, `users/${id}/fullName`)).catch(() => null)
        return [id, String(snap?.val() ?? '')] as const
      }),
    ).then((pairs) => setCreatorNames((prev) => ({ ...prev, ...Object.fromEntries(pairs) })))
  }, [items, creatorNames])

  const unread = useMemo(() => items.filter((n) => !n.read).length, [items])

  async function markRead(id: string) {
    if (!user) return
    await update(ref(db, `notifications/${id}/readBy`), { [user.uid]: true })
  }

  async function onCreate(draft: NotiDraft) {
    if (!user) return
    await set(push(ref(db, 'notifications')), {
      ...draft,
      creatorUserID: user.uid,
      createdAt: vnDateTimeString(Date.now()),
      readBy: { [user.uid]: true },
    })
    setFormOpen(false)
    setMessage('Đã đăng thông báo.')
  }

  async function onEdit(n: Noti, draft: NotiDraft) {
    await update(ref(db, `notifications/${n.id}`), {
      ...draft,
      updatedAt: vnDateTimeString(Date.now()),
    })
    setEditingId(null)
  }

  async function onDelete(n: Noti) {
    if (!window.confirm(`Xóa thông báo "${plainText(n.title) || 'Thông báo'}"?`)) return
    try {
      await remove(ref(db, `notifications/${n.id}`))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không xóa được thông báo')
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Thông báo</h1>
        <p className="lede">
          {unread > 0 ? `${unread} chưa đọc` : 'Đã đọc hết thông báo.'}
        </p>
      </header>

      {isAdmin && (
        <section className="section">
          {formOpen ? (
            <NotiForm
              initial={{ title: '', content: '' }}
              submitLabel="Đăng thông báo"
              busyLabel="Đang đăng…"
              onSubmit={onCreate}
              onCancel={() => setFormOpen(false)}
            />
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setFormOpen(true)
                setMessage('')
              }}
            >
              Tạo thông báo
            </button>
          )}
          {message && <p className="form-info">{message}</p>}
        </section>
      )}

      {loading ? (
        <p className="empty">Đang tải…</p>
      ) : items.length === 0 ? (
        <p className="empty">Chưa có thông báo.</p>
      ) : (
        <ul className="noti-list">
          {items.map((n) => {
            const isCreator = Boolean(user && n.creatorUserID === user.uid)
            if (editingId === n.id) {
              return (
                <li key={n.id}>
                  <NotiForm
                    initial={{ title: n.title, content: n.content }}
                    submitLabel="Lưu thay đổi"
                    busyLabel="Đang lưu…"
                    onSubmit={(draft) => onEdit(n, draft)}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              )
            }
            return (
              <li key={n.id}>
                <article
                  className={n.read ? 'noti-card' : 'noti-card unread'}
                  onClick={() => {
                    if (!n.read) void markRead(n.id)
                  }}
                >
                  <div className="noti-top">
                    <strong className="noti-title">{plainText(n.title) || 'Thông báo'}</strong>
                    {!n.read && <span className="dot" />}
                  </div>
                  <p className="tiny muted noti-meta">
                    {[
                      creatorNames[n.creatorUserID],
                      formatCreatedAt(n.createdAt),
                      n.updatedAt && `đã sửa ${formatCreatedAt(n.updatedAt)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <RichText text={n.content} />
                  {(isCreator || isAdmin) && (
                    <div className="noti-actions">
                      {isCreator && (
                        <button
                          type="button"
                          className="btn ghost compact"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingId(n.id)
                          }}
                        >
                          Sửa
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          type="button"
                          className="btn ghost compact danger"
                          onClick={(e) => {
                            e.stopPropagation()
                            void onDelete(n)
                          }}
                        >
                          Xóa
                        </button>
                      )}
                    </div>
                  )}
                </article>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
