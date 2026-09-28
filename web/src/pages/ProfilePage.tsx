import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  onValue,
  ref,
  remove,
  set,
  update,
} from 'firebase/database'
import { StravaConnectPanel } from '../components/StravaConnectPanel'
import { useAuth } from '../context/AuthContext'
import { uploadUserAvatar } from '../lib/avatarUpload'
import { db } from '../lib/firebase'
import { levelTone } from '../lib/levelCalculator'

type HistoryEntry = {
  id: string
  content: string
  timestamp: string
  createdAt: number
}

function formatHistoryTime(entry: HistoryEntry): string {
  const ms =
    entry.createdAt > 0
      ? entry.createdAt * (entry.createdAt < 1e12 ? 1000 : 1)
      : Number(entry.timestamp) || 0
  if (!ms) return entry.timestamp || ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return entry.timestamp || ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ProfilePage() {
  const { user, profile } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [gender, setGender] = useState('')
  const [dob, setDob] = useState('')
  const [fmTime, setFmTime] = useState('')
  const [hmTime, setHmTime] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)

  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyDraft, setHistoryDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyError, setHistoryError] = useState('')

  useEffect(() => {
    if (!profile) return
    setFullName(profile.fullName)
    setPhone(profile.phone)
    setGender(profile.gender)
    setDob(profile.dob)
    setFmTime(profile.fullMarathonTime)
    setHmTime(profile.halfMarathonTime)
    setAvatarPreview(null)
  }, [profile])

  useEffect(() => {
    if (!user) return
    const histRef = ref(db, `users/${user.uid}/history`)
    const unsub = onValue(histRef, (snap) => {
      const val = (snap.val() ?? {}) as Record<string, Record<string, unknown>>
      const entries = Object.entries(val)
        .map(([id, row]) => ({
          id,
          content: String(row.content ?? ''),
          timestamp: String(row.timestamp ?? ''),
          createdAt: Number(row.createdAt ?? 0) || 0,
        }))
        .sort((a, b) => {
          const ta = a.createdAt || Number(a.id) || 0
          const tb = b.createdAt || Number(b.id) || 0
          return tb - ta
        })
      setHistory(entries)
    })
    return unsub
  }, [user])

  async function onAvatarPick(file: File | undefined) {
    if (!user || !file) return
    const looksLikeImage =
      file.type.startsWith('image/') ||
      /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name)
    if (!looksLikeImage) {
      setError('Chọn file ảnh (JPG/PNG/WEBP).')
      return
    }
    setAvatarBusy(true)
    setError('')
    setMessage('')
    try {
      const localUrl = URL.createObjectURL(file)
      setAvatarPreview(localUrl)
      const downloadUrl = await uploadUserAvatar(user.uid, file)
      await update(ref(db, `users/${user.uid}`), { avatar: downloadUrl })
      setMessage('Đã cập nhật ảnh đại diện.')
      URL.revokeObjectURL(localUrl)
      setAvatarPreview(downloadUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được avatar')
      setAvatarPreview(null)
    } finally {
      setAvatarBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!user || !profile) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const fmChanged = fmTime.trim() !== (profile.fullMarathonTime || '')
      const hmChanged = hmTime.trim() !== (profile.halfMarathonTime || '')
      const payload: Record<string, string | boolean> = {
        fullName: fullName.trim(),
        phone: phone.trim(),
        gender,
        dob: dob.trim(),
        fullMarathonTime: fmTime.trim(),
        halfMarathonTime: hmTime.trim(),
      }
      if (fmChanged) payload.isFullMarathonVerified = false
      if (hmChanged) payload.isHalfMarathonVerified = false
      await update(ref(db, `users/${user.uid}`), payload)
      setMessage(
        fmChanged || hmChanged
          ? 'Đã lưu. PR đổi sẽ cần admin xác minh lại để lên Bảng vàng.'
          : 'Đã lưu hồ sơ.',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được')
    } finally {
      setBusy(false)
    }
  }

  async function onSaveHistory(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    const content = historyDraft.trim()
    if (!content) {
      setHistoryError('Nhập nội dung lịch sử.')
      return
    }
    setHistoryBusy(true)
    setHistoryError('')
    try {
      if (editingId) {
        const existing = history.find((h) => h.id === editingId)
        await update(ref(db, `users/${user.uid}/history/${editingId}`), {
          content,
          timestamp: existing?.timestamp || editingId,
          createdAt: existing?.createdAt || Date.now() / 1000,
          updatedAt: Date.now() / 1000,
        })
      } else {
        const nowMs = Date.now()
        const key = String(nowMs)
        await set(ref(db, `users/${user.uid}/history/${key}`), {
          content,
          timestamp: key,
          createdAt: nowMs / 1000,
        })
      }
      setHistoryDraft('')
      setEditingId(null)
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Không lưu được lịch sử')
    } finally {
      setHistoryBusy(false)
    }
  }

  function startEditHistory(entry: HistoryEntry) {
    setEditingId(entry.id)
    setHistoryDraft(entry.content)
    setHistoryError('')
  }

  function cancelEditHistory() {
    setEditingId(null)
    setHistoryDraft('')
    setHistoryError('')
  }

  async function deleteHistory(id: string) {
    if (!user) return
    if (!window.confirm('Xóa mục lịch sử này?')) return
    setHistoryBusy(true)
    setHistoryError('')
    try {
      await remove(ref(db, `users/${user.uid}/history/${id}`))
      if (editingId === id) cancelEditHistory()
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Không xóa được')
    } finally {
      setHistoryBusy(false)
    }
  }

  if (!profile) {
    return (
      <div className="page">
        <p className="empty">Chưa có hồ sơ trên RTDB.</p>
      </div>
    )
  }

  const tone = levelTone(profile.level)
  const displayAvatar = avatarPreview || profile.avatar

  return (
    <div className="page">
      {profile.admin && (
        <div className="admin-banner" role="status">
          <strong>Quản trị viên (Admin)</strong>
          <span>Tài khoản của bạn có quyền quản trị club.</span>
          <div className="admin-quick-links">
            <Link className="btn primary compact" to="/admin/challenges/new">
              Tạo thử thách
            </Link>
            <Link className="btn ghost compact" to="/admin/users">
              Quản lý thành viên
            </Link>
          </div>
        </div>
      )}

      <header className="page-header profile-header">
        <div className="avatar-wrap editable">
          {displayAvatar ? (
            <img src={displayAvatar} alt="" className="avatar" />
          ) : (
            <div className="avatar placeholder">
              {(profile.fullName || 'Q').charAt(0).toUpperCase()}
            </div>
          )}
          <button
            type="button"
            className="avatar-change-btn"
            disabled={avatarBusy}
            onClick={() => fileInputRef.current?.click()}
          >
            {avatarBusy ? 'Đang tải…' : 'Đổi ảnh'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => void onAvatarPick(e.target.files?.[0])}
          />
        </div>
        <div>
          <h1>{profile.fullName || 'Hồ sơ'}</h1>
          <p className="muted">{profile.email}</p>
          <div className="profile-badges">
            {profile.admin && (
              <span className="admin-badge prominent">Admin</span>
            )}
            <span className={`level-badge level-${tone}`}>Level {profile.level}</span>
            <span className={`member-badge ${profile.member ? 'yes' : 'no'}`}>
              {profile.member ? 'Thành viên chính thức' : 'Khách'}
            </span>
          </div>
        </div>
      </header>

      <section className="section panel">
        <h2>Strava</h2>
        <StravaConnectPanel />
      </section>

      <section className="section panel">
        <h2>Thông tin & thành tích</h2>
        <form className="auth-form" onSubmit={onSave}>
          <label>
            Họ tên
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>
          <label>
            Số điện thoại
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label>
            Giới tính
            <select value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">—</option>
              <option value="Nam">Nam</option>
              <option value="Nữ">Nữ</option>
              <option value="Khác">Khác</option>
            </select>
          </label>
          <label>
            Ngày sinh
            <input
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              placeholder="dd-MM-yyyy"
            />
          </label>

          <div className="pr-edit-grid">
            <label>
              PR Full Marathon (hh:mm:ss)
              <input
                value={fmTime}
                onChange={(e) => setFmTime(e.target.value)}
                placeholder="3:45:00"
              />
              <span
                className={`verify-pill ${profile.isFullMarathonVerified ? 'yes' : 'no'}`}
              >
                {profile.isFullMarathonVerified ? 'Đã xác thực' : 'Chưa xác thực'}
              </span>
            </label>
            <label>
              PR Half Marathon (hh:mm:ss)
              <input
                value={hmTime}
                onChange={(e) => setHmTime(e.target.value)}
                placeholder="1:45:00"
              />
              <span
                className={`verify-pill ${profile.isHalfMarathonVerified ? 'yes' : 'no'}`}
              >
                {profile.isHalfMarathonVerified ? 'Đã xác thực' : 'Chưa xác thực'}
              </span>
            </label>
          </div>
          <p className="tiny muted">
            Đổi PR sẽ hủy xác thực — cần admin duyệt lại để lên Bảng vàng.
          </p>

          {error && <p className="form-error">{error}</p>}
          {message && <p className="form-info">{message}</p>}
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Đang lưu…' : 'Lưu hồ sơ'}
          </button>
        </form>
      </section>

      <section className="section panel">
        <h2>Lịch sử thành tích</h2>
        <p className="lede tiny">
          Ghi chú giải chạy, thành tích hoặc câu chuyện của bạn (giống app).
        </p>

        <form className="history-form" onSubmit={onSaveHistory}>
          <label>
            {editingId ? 'Chỉnh sửa mục' : 'Thêm mục mới'}
            <textarea
              value={historyDraft}
              onChange={(e) => setHistoryDraft(e.target.value)}
              rows={4}
              placeholder="VD: VnExpress Marathon 2025 — FM 3:42:15"
            />
          </label>
          {historyError && <p className="form-error">{historyError}</p>}
          <div className="history-form-actions">
            {editingId && (
              <button
                type="button"
                className="btn ghost"
                onClick={cancelEditHistory}
                disabled={historyBusy}
              >
                Hủy
              </button>
            )}
            <button type="submit" className="btn primary" disabled={historyBusy}>
              {historyBusy ? 'Đang lưu…' : editingId ? 'Cập nhật' : 'Thêm lịch sử'}
            </button>
          </div>
        </form>

        {history.length === 0 ? (
          <p className="muted" style={{ marginTop: 16 }}>
            Chưa có ghi chú lịch sử.
          </p>
        ) : (
          <ul className="history-list editable">
            {history.map((h) => (
              <li key={h.id} className="history-item">
                <div className="history-item-body">
                  <p>{h.content}</p>
                  <span className="tiny muted">{formatHistoryTime(h)}</span>
                </div>
                <div className="history-item-actions">
                  <button
                    type="button"
                    className="btn ghost compact"
                    onClick={() => startEditHistory(h)}
                    disabled={historyBusy}
                  >
                    Sửa
                  </button>
                  <button
                    type="button"
                    className="btn ghost compact danger"
                    onClick={() => void deleteHistory(h.id)}
                    disabled={historyBusy}
                  >
                    Xóa
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
