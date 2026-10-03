import { useState, type FormEvent } from 'react'
import { ref, set } from 'firebase/database'
import { ExternalLink, MessageCircle, Phone } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import { useSharedValue } from '../lib/sharedValue'

const ZALO_PATH = 'settings/support/zaloGroupUrl'

type Contact = { name: string; role?: string; phone: string }

const groups: { title: string; contacts: Contact[] }[] = [
  {
    title: 'Ban chủ nhiệm',
    contacts: [
      { name: 'Hoàng Minh An', role: 'Chủ nhiệm', phone: '0973.234.555' },
      { name: 'Nguyễn Ngọc Chiến', role: 'PCN TT', phone: '0914.185.285' },
      { name: 'Trần Mạnh Thường', role: 'PCN Đối ngoại', phone: '0914.145.575' },
      { name: 'Trương Công Tuyên', role: 'PCN Hậu cần', phone: '0907.779.995' },
      { name: 'Lê Thị Đoài', role: 'Thủ quỹ', phone: '0918.190.555' },
    ],
  },
  {
    title: 'CNTT - Quản lý Web app',
    contacts: [{ name: 'Tạ Bắc Sơn', phone: '0913.485.889' }],
  },
]

function initials(name: string): string {
  return name.split(' ').pop()?.charAt(0).toUpperCase() ?? '?'
}

function ZaloGroupSection() {
  const { profile } = useAuth()
  const isAdmin = Boolean(profile?.admin)
  const value = useSharedValue<string>(ZALO_PATH)
  const url = typeof value === 'string' ? value.trim() : ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function startEdit() {
    setDraft(url)
    setError('')
    setEditing(true)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const next = draft.trim()
    if (next && !/^https?:\/\/\S+$/i.test(next)) {
      setError('Link phải bắt đầu bằng https:// (VD: https://zalo.me/g/…)')
      return
    }
    setBusy(true)
    setError('')
    try {
      await set(ref(db, ZALO_PATH), next || null)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được link')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="section panel">
      <h2>Nhóm Zalo câu lạc bộ</h2>
      {value === undefined ? (
        <p className="empty">Đang tải…</p>
      ) : editing ? (
        <form className="auth-form" onSubmit={(e) => void save(e)}>
          <label>
            Link nhóm Zalo
            <input
              type="url"
              inputMode="url"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="https://zalo.me/g/…"
              autoFocus
            />
          </label>
          <p className="tiny muted">Để trống rồi Lưu để gỡ link.</p>
          {error && <p className="form-error">{error}</p>}
          <div className="cta-row">
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Đang lưu…' : 'Lưu'}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Hủy
            </button>
          </div>
        </form>
      ) : (
        <>
          {url ? (
            <a className="btn primary support-zalo" href={url} target="_blank" rel="noreferrer">
              <MessageCircle size={18} aria-hidden />
              Tham gia nhóm Zalo
              <ExternalLink size={14} aria-hidden />
            </a>
          ) : (
            <p className="empty">Chưa có link nhóm Zalo.</p>
          )}
          {isAdmin && (
            <div className="cta-row support-zalo-admin">
              <button type="button" className="btn ghost compact" onClick={startEdit}>
                {url ? 'Sửa link' : 'Thêm link'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export function SupportPage() {
  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">Câu lạc bộ</p>
        <h1>☎ Liên hệ hỗ trợ</h1>
      </header>

      {groups.map((g) => (
        <section key={g.title} className="section panel">
          <h2>{g.title}</h2>
          <ul className="participant-list support-list">
            {g.contacts.map((c) => (
              <li key={c.phone} className="participant-row">
                <div className="hof-avatar">
                  <span>{initials(c.name)}</span>
                </div>
                <div className="participant-meta">
                  <strong>{c.name}</strong>
                  {c.role && <span className="tiny muted">{c.role}</span>}
                </div>
                <a
                  className="btn ghost compact support-call"
                  href={`tel:${c.phone.replace(/\D/g, '')}`}
                  aria-label={`Gọi ${c.name}`}
                >
                  <Phone size={16} aria-hidden />
                  {c.phone}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <ZaloGroupSection />
    </div>
  )
}
