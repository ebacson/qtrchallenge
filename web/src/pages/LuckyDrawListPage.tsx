import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { push, ref, set } from 'firebase/database'
import { Plus } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import {
  LUCKY_DRAWS_PATH,
  LUCKY_MENU_PATH,
  LUCKY_STATUS_LABELS,
  parseLuckyDraws,
  parseLuckyMenu,
} from '../lib/luckyDraw'
import { rewardItemsSummary } from '../lib/rewardPenalty'
import { useSharedValue } from '../lib/sharedValue'

function nowMs(): number {
  return Date.now()
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    if (!name.trim()) {
      setError('Nhập tên chương trình.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const node = push(ref(db, LUCKY_DRAWS_PATH))
      await set(node, {
        name: name.trim(),
        note: note.trim() || null,
        status: 'open',
        createdAt: nowMs(),
        createdBy: user.uid,
      })
      navigate(`/lucky-draw/${node.key}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được')
      setBusy(false)
    }
  }

  return (
    <form className="auth-form panel finance-form" onSubmit={(e) => void onSubmit(e)}>
      <h2>Tạo chương trình quay số</h2>
      <label>
        Tên chương trình
        <input
          value={name}
          maxLength={100}
          placeholder="VD: Quay số Gala 2027"
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </label>
      <label>
        Ghi chú
        <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="btn-row">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Đang tạo…' : 'Tạo chương trình'}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>
          Hủy
        </button>
      </div>
    </form>
  )
}

export function LuckyDrawListPage() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.admin === true
  const raw = useSharedValue<Record<string, unknown>>(LUCKY_DRAWS_PATH)
  const menuRaw = useSharedValue(LUCKY_MENU_PATH)
  const [creating, setCreating] = useState(false)
  const publishedIds = new Set(parseLuckyMenu(menuRaw).map((d) => d.id))
  const draws = parseLuckyDraws(raw).filter((d) => isAdmin || publishedIds.has(d.id))

  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">Câu lạc bộ</p>
        <h1>Quay số may mắn</h1>
      </header>

      {isAdmin && !creating && (
        <div className="finance-toolbar gift-toolbar">
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden /> Tạo chương trình
          </button>
        </div>
      )}
      {isAdmin && creating && <CreateForm onClose={() => setCreating(false)} />}

      {raw === undefined || menuRaw === undefined ? (
        <p className="empty">Đang tải…</p>
      ) : draws.length === 0 ? (
        <p className="empty">Chưa có chương trình quay số nào.</p>
      ) : (
        <ul className="lucky-list">
          {draws.map((d) => {
            const joined = user ? d.participants.some((p) => p.uid === user.uid) : false
            const won = user ? d.winners.includes(user.uid) : false
            return (
              <li key={d.id}>
                <Link to={`/lucky-draw/${d.id}`} className="lucky-card panel">
                  <span className={`lucky-status lucky-status-${d.status}`}>
                    {LUCKY_STATUS_LABELS[d.status]}
                  </span>
                  {isAdmin && (
                    <span className="tiny muted">
                      {publishedIds.has(d.id) ? '✓ Đang hiện ở menu Câu lạc bộ' : 'Chưa hiện ở menu'}
                    </span>
                  )}
                  <strong>{d.name}</strong>
                  <span className="tiny muted">
                    {d.participants.length} người tham gia
                    {d.prizes.length ? ` · ${rewardItemsSummary(d.prizes)}` : ''}
                  </span>
                  {(joined || won) && (
                    <span className="tiny lucky-me">
                      {won ? '🎁 Bạn đã trúng thưởng' : '✓ Bạn đã tham gia'}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
