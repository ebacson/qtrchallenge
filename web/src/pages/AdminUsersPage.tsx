import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { get, onValue, ref, remove, set } from 'firebase/database'
import { AdminUserAchievements } from '../components/AdminUserAchievements'
import {
  matchesMemberType,
  MemberTypeFilter,
  type MemberType,
} from '../components/MemberTypeFilter'
import { useAuth } from '../context/AuthContext'
import { deleteUserAvatar } from '../lib/adminOps'
import { db } from '../lib/firebase'

type AdminUser = {
  id: string
  fullName: string
  email: string
  avatar: string
  level: number
  member: boolean
  admin: boolean
  raw: Record<string, unknown>
}

export function AdminUsersPage() {
  const { user, profile } = useAuth()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [memberType, setMemberType] = useState<MemberType>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const usersRef = ref(db, 'users')
    const unsub = onValue(usersRef, (snap) => {
      const val = (snap.val() ?? {}) as Record<string, Record<string, unknown>>
      const list = Object.entries(val)
        .map(([id, row]) => ({
          id,
          fullName: String(row.fullName ?? ''),
          email: String(row.email ?? ''),
          avatar: String(row.avatar ?? ''),
          level: Number(row.level ?? 0) || 0,
          member: Boolean(row.member),
          admin: Boolean(row.admin),
          raw: row ?? {},
        }))
        .sort((a, b) => {
          if (a.admin !== b.admin) return a.admin ? -1 : 1
          if (a.member !== b.member) return a.member ? -1 : 1
          return a.fullName.localeCompare(b.fullName, 'vi')
        })
      setUsers(list)
      setLoading(false)
    })
    return unsub
  }, [])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return users.filter((u) => {
      if (!matchesMemberType(u.member, memberType)) return false
      if (!needle) return true
      return (
        u.fullName.toLowerCase().includes(needle) ||
        u.email.toLowerCase().includes(needle)
      )
    })
  }, [users, q, memberType])

  async function setFlag(target: AdminUser, field: 'admin' | 'member', value: boolean) {
    const uid = target.id
    if (!user || uid === user.uid) {
      setError('Không thể đổi quyền trên chính tài khoản đang đăng nhập.')
      return
    }
    const who = target.fullName || target.email
    const question =
      field === 'admin'
        ? value
          ? `Cấp quyền Admin cho "${who}"?\n\nAdmin có toàn quyền quản trị: tạo thử thách, quản lý thành viên, xác thực thành tích.`
          : `Hủy quyền Admin của "${who}"?`
        : value
          ? `Phê duyệt "${who}" thành thành viên Chính thức?`
          : `Chuyển "${who}" sang thành viên Tự do?`
    if (!window.confirm(question)) return
    setBusyId(uid)
    setError('')
    setMessage('')
    try {
      await set(ref(db, `users/${uid}/${field}`), value)
      setMessage(
        field === 'admin'
          ? value
            ? 'Đã cấp quyền Admin.'
            : 'Đã hủy quyền Admin.'
          : value
            ? 'Đã phê duyệt thành viên chính thức.'
            : 'Đã chuyển sang thành viên Tự do.',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không cập nhật được')
    } finally {
      setBusyId(null)
    }
  }

  async function deleteMemberCompletely(target: AdminUser) {
    if (!user) return
    if (target.id === user.uid) {
      setError('Không thể xóa chính mình.')
      return
    }
    if (target.admin) {
      setError('Không xóa tài khoản Admin. Hãy hủy quyền Admin trước.')
      return
    }
    const ok = window.confirm(
      `Xóa hoàn toàn "${target.fullName || target.email}"?\n\n` +
        'Sẽ xóa hồ sơ RTDB, avatar, và dữ liệu tham gia thử thách.\n' +
        'Tài khoản đăng nhập Firebase Auth có thể vẫn tồn tại (cần xóa trên Firebase Console).',
    )
    if (!ok) return
    const typed = window.prompt(`Gõ email "${target.email}" để xác nhận xóa:`)
    if (typed?.trim() !== target.email) {
      setError('Xác nhận email không khớp — đã hủy.')
      return
    }

    setBusyId(target.id)
    setError('')
    setMessage('')
    try {
      const challengesSnap = await get(ref(db, 'challenges'))
      const challenges = (challengesSnap.val() ?? {}) as Record<
        string,
        Record<string, unknown>
      >
      await Promise.all(
        Object.keys(challenges).map((challengeId) =>
          remove(ref(db, `challenges/${challengeId}/user_challenges/${target.id}`)),
        ),
      )
      await deleteUserAvatar(target.id)
      await remove(ref(db, `users/${target.id}`))
      setMessage(`Đã xóa thành viên ${target.fullName || target.email}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xóa được')
    } finally {
      setBusyId(null)
    }
  }

  if (!profile?.admin) {
    return (
      <div className="page">
        <p className="empty">Chỉ Admin mới truy cập được.</p>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">Admin</p>
        <h1>Quản lý thành viên</h1>
        <p className="lede">
          Cấp/hủy Admin, phê duyệt member chính thức, xem & chỉnh sửa thành tích, hoặc xóa hồ sơ.
        </p>
      </header>

      <div className="admin-quick-links">
        <Link className="btn ghost" to="/admin/records">
          Xác thực thành tích
        </Link>
      </div>

      <MemberTypeFilter value={memberType} onChange={setMemberType} items={users} />

      <label className="search-field">
        Tìm kiếm
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tên hoặc email"
        />
      </label>

      {error && <p className="form-error">{error}</p>}
      {message && <p className="form-info">{message}</p>}

      {loading ? (
        <p className="empty">Đang tải…</p>
      ) : filtered.length === 0 ? (
        <p className="empty">Không có user phù hợp.</p>
      ) : (
        <ul className="admin-user-list">
          {filtered.map((u) => {
            const busy = busyId === u.id
            const isSelf = u.id === user?.uid
            return (
              <li key={u.id} className="admin-user-card">
                <div className="admin-user-top">
                  <div className="hof-avatar">
                    {u.avatar ? (
                      <img src={u.avatar} alt="" />
                    ) : (
                      <span>{(u.fullName || '?').charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="hof-meta">
                    <strong>{u.fullName || 'Runner'}</strong>
                    <span className="tiny muted">{u.email}</span>
                    <div className="profile-badges">
                      {u.admin && (
                        <span className="admin-badge prominent">Admin</span>
                      )}
                      <span
                        className={`member-badge ${u.member ? 'yes' : 'no'}`}
                      >
                        {u.member ? 'Chính thức' : 'Tự do'}
                      </span>
                      <span className="level-badge level-bronze">
                        Lv {u.level}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="admin-user-actions">
                  <button
                    type="button"
                    className="btn ghost compact"
                    disabled={busy || isSelf}
                    onClick={() => void setFlag(u, 'admin', !u.admin)}
                  >
                    {u.admin ? 'Hủy Admin' : 'Cấp Admin'}
                  </button>
                  <button
                    type="button"
                    className="btn ghost compact"
                    disabled={busy || isSelf}
                    onClick={() => void setFlag(u, 'member', !u.member)}
                  >
                    {u.member ? 'Chuyển sang Tự do' : 'Phê duyệt Chính thức'}
                  </button>
                  <button
                    type="button"
                    className="btn ghost compact danger"
                    disabled={busy || isSelf || u.admin}
                    onClick={() => void deleteMemberCompletely(u)}
                  >
                    Xóa hoàn toàn
                  </button>
                </div>

                <AdminUserAchievements
                  uid={u.id}
                  displayName={u.fullName || u.email}
                  row={u.raw}
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
