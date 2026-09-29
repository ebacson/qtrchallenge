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
import { runAdminFullSync, type FullSyncSummary } from '../lib/adminSync'
import { db } from '../lib/firebase'

type AdminUser = {
  id: string
  fullName: string
  email: string
  avatar: string
  level: number
  member: boolean
  admin: boolean
  phone: string
  gender: string
  dob: string
  idStrava: string
  userStrava: string
  raw: Record<string, unknown>
}

function shortUid(uid: string): string {
  return uid.length > 6 ? uid.slice(-6) : uid
}

/** Tuổi từ chuỗi ngày sinh dd/MM/yyyy, dd-MM-yyyy hoặc yyyy-MM-dd */
function ageFromDob(dob: string): number | null {
  const s = dob.trim()
  let y: number, m: number, d: number
  let match = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (match) {
    ;[y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  } else {
    match = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
    if (!match) return null
    ;[d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])]
  }
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null
  const now = new Date()
  let age = now.getFullYear() - y
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--
  return age >= 0 && age < 120 ? age : null
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
  const [joinedCounts, setJoinedCounts] = useState<Record<string, number>>({})
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<FullSyncSummary | null>(null)

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
          phone: String(row.phone ?? ''),
          gender: String(row.gender ?? ''),
          dob: String(row.dob ?? ''),
          idStrava: String(row.id_strava ?? ''),
          userStrava: String(row.user_strava ?? ''),
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

  useEffect(() => {
    const unsub = onValue(ref(db, 'challenges'), (snap) => {
      const val = (snap.val() ?? {}) as Record<string, Record<string, unknown>>
      const counts: Record<string, number> = {}
      for (const challenge of Object.values(val)) {
        const participants = challenge?.user_challenges
        if (!participants || typeof participants !== 'object') continue
        for (const uid of Object.keys(participants)) {
          counts[uid] = (counts[uid] ?? 0) + 1
        }
      }
      setJoinedCounts(counts)
    })
    return unsub
  }, [])

  async function syncEveryone() {
    if (!user) return
    const ok = window.confirm(
      'Đồng bộ toàn bộ?\n\n' +
        'Lấy hoạt động Strava mới của mọi thành viên đã kết nối, tính lại tiến độ các thử thách ' +
        'đang diễn ra (và vừa kết thúc trong 2 ngày) và cập nhật level. Có thể mất vài phút.',
    )
    if (!ok) return
    setSyncing(true)
    setError('')
    setMessage('')
    setSyncResult(null)
    try {
      const summary = await runAdminFullSync(await user.getIdToken())
      setSyncResult(summary)
      setMessage('Đồng bộ toàn bộ hoàn tất.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đồng bộ thất bại')
    } finally {
      setSyncing(false)
    }
  }

  async function copyUid(uid: string) {
    try {
      await navigator.clipboard.writeText(uid)
      setMessage(`Đã sao chép UID ${uid}`)
    } catch {
      window.prompt('UID đầy đủ:', uid)
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return users.filter((u) => {
      if (!matchesMemberType(u.member, memberType)) return false
      if (!needle) return true
      return (
        u.fullName.toLowerCase().includes(needle) ||
        u.email.toLowerCase().includes(needle) ||
        u.id.toLowerCase().includes(needle) ||
        u.phone.replace(/\s/g, '').includes(needle.replace(/\s/g, ''))
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
        <button
          type="button"
          className="btn primary"
          disabled={syncing}
          onClick={() => void syncEveryone()}
        >
          {syncing ? 'Đang đồng bộ… (vài phút)' : 'Đồng bộ toàn bộ'}
        </button>
      </div>

      {syncResult && (
        <div className="admin-sync-result">
          <p>
            <strong>Strava:</strong> {syncResult.stravaSynced}/{syncResult.usersWithStrava} thành
            viên, {syncResult.activitiesFetched} hoạt động
            {syncResult.stravaSkipped > 0 && ` · bỏ qua ${syncResult.stravaSkipped}`}
            {syncResult.rateLimited && ' (Strava giới hạn lượt gọi, thử lại sau 15 phút)'}
          </p>
          <p>
            <strong>Thử thách:</strong> {syncResult.challengesProcessed} thử thách, cập nhật{' '}
            {syncResult.progressRowsUpdated} tiến độ · <strong>Level:</strong> cập nhật{' '}
            {syncResult.levelsUpdated} thành viên · {Math.round(syncResult.durationMs / 1000)} giây
          </p>
          {syncResult.stravaFailed.length > 0 && (
            <details>
              <summary>{syncResult.stravaFailed.length} thành viên lỗi Strava</summary>
              <ul>
                {syncResult.stravaFailed.map((f) => (
                  <li key={f.uid}>
                    {f.name || `…${shortUid(f.uid)}`}: {f.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <MemberTypeFilter value={memberType} onChange={setMemberType} items={users} />

      <label className="search-field">
        Tìm kiếm
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tên, email, UID hoặc số điện thoại"
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

                <dl className="admin-user-info">
                  <div>
                    <dt>UID</dt>
                    <dd>
                      <button
                        type="button"
                        className="admin-uid"
                        title={`${u.id} — nhấn để sao chép`}
                        onClick={() => void copyUid(u.id)}
                      >
                        …{shortUid(u.id)}
                      </button>
                    </dd>
                  </div>
                  <div>
                    <dt>Điện thoại</dt>
                    <dd>
                      {u.phone ? (
                        <a href={`tel:${u.phone.replace(/\s/g, '')}`}>{u.phone}</a>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Giới tính</dt>
                    <dd>{u.gender || <span className="muted">—</span>}</dd>
                  </div>
                  <div>
                    <dt>Ngày sinh</dt>
                    <dd>
                      {u.dob ? (
                        <>
                          {u.dob}
                          {ageFromDob(u.dob) !== null && (
                            <span className="muted"> ({ageFromDob(u.dob)} tuổi)</span>
                          )}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Strava</dt>
                    <dd>
                      {u.idStrava ? (
                        <a
                          href={`https://www.strava.com/athletes/${u.idStrava}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {u.userStrava || u.idStrava}
                        </a>
                      ) : u.userStrava ? (
                        u.userStrava
                      ) : (
                        <span className="muted">Chưa kết nối</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Thử thách đã tham gia</dt>
                    <dd>{joinedCounts[u.id] ?? 0}</dd>
                  </div>
                </dl>

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
