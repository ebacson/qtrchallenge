import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { onValue, ref, update } from 'firebase/database'
import { db } from '../lib/firebase'
import { formatRankTime } from '../lib/prRanking'
import {
  RECORD_FIELDS as FIELDS,
  recordStatus,
  type RecordDistance as Distance,
  type RecordStatus,
} from '../lib/userRecords'

type Filter = 'pending' | 'verified' | 'all'

type RecordRow = {
  id: string
  fullName: string
  email: string
  gender: string
  avatar: string
  FM: RecordStatus
  HM: RecordStatus
}

export function AdminRecordsPage() {
  const [rows, setRows] = useState<RecordRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('pending')
  const [q, setQ] = useState('')
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const unsub = onValue(ref(db, 'users'), (snap) => {
      const val = (snap.val() ?? {}) as Record<string, Record<string, unknown>>
      const list = Object.entries(val)
        .map(([id, row]) => ({
          id,
          fullName: String(row.fullName ?? ''),
          email: String(row.email ?? ''),
          gender: String(row.gender ?? ''),
          avatar: String(row.avatar ?? ''),
          FM: recordStatus(row, 'FM'),
          HM: recordStatus(row, 'HM'),
        }))
        .filter((r) => r.FM.submitted || r.HM.submitted)
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'))
      setRows(list)
      setLoading(false)
    })
    return unsub
  }, [])

  const pendingCount = rows.filter((r) => r.FM.pending || r.HM.pending).length

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter === 'pending' && !(r.FM.pending || r.HM.pending)) return false
      if (filter === 'verified' && !(r.FM.verified || r.HM.verified)) return false
      if (!needle) return true
      return (
        r.fullName.toLowerCase().includes(needle) || r.email.toLowerCase().includes(needle)
      )
    })
  }, [rows, filter, q])

  async function setVerified(row: RecordRow, distance: Distance, value: boolean) {
    const { time, flag } = FIELDS[distance]
    const status = row[distance]
    const key = `${row.id}-${distance}`
    if (value && !status.validFormat) {
      setError(`PR ${distance} của ${row.fullName || row.email} sai định dạng hh:mm:ss.`)
      return
    }
    setBusyKey(key)
    setError('')
    setMessage('')
    try {
      // Giống app iOS: cờ ở gốc user + bản sao đã duyệt trong personalRecord (Bảng vàng đọc ở đây)
      await update(
        ref(db, `users/${row.id}`),
        value
          ? {
              [flag]: true,
              [`personalRecord/${time}`]: formatRankTime(status.submitted),
              [`personalRecord/${flag}`]: true,
            }
          : {
              [flag]: false,
              [`personalRecord/${flag}`]: false,
            },
      )
      setMessage(
        `${value ? 'Đã xác thực' : 'Đã hủy xác thực'} PR ${distance} của ${row.fullName || row.email}.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không cập nhật được')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">Admin</p>
        <h1>Xác thực thành tích</h1>
        <p className="lede">
          Duyệt PR Full Marathon / Half Marathon thành viên khai trong Profile. Chỉ PR đã
          xác thực mới lên Bảng vàng.
        </p>
      </header>

      <div className="admin-quick-links">
        <Link className="btn ghost" to="/admin/users">
          Quản lý thành viên
        </Link>
        <Link className="btn ghost" to="/hall-of-fame">
          Xem Bảng vàng
        </Link>
      </div>

      <div className="filter-row">
        {(
          [
            ['pending', `Chờ xác thực (${pendingCount})`],
            ['verified', 'Đã xác thực'],
            ['all', 'Tất cả'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={filter === value ? 'chip active' : 'chip'}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="search-field">
        Tìm kiếm
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên hoặc email" />
      </label>

      {error && <p className="form-error">{error}</p>}
      {message && <p className="form-info">{message}</p>}

      {loading ? (
        <p className="empty">Đang tải…</p>
      ) : filtered.length === 0 ? (
        <p className="empty">
          {filter === 'pending' ? 'Không có PR nào chờ xác thực.' : 'Không có thành viên phù hợp.'}
        </p>
      ) : (
        <ul className="admin-user-list">
          {filtered.map((r) => (
            <li key={r.id} className="admin-user-card">
              <div className="admin-user-top">
                <div className="hof-avatar">
                  {r.avatar ? (
                    <img src={r.avatar} alt="" />
                  ) : (
                    <span>{(r.fullName || '?').charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="hof-meta">
                  <strong>{r.fullName || 'Runner'}</strong>
                  <span className="tiny muted">
                    {r.email}
                    {r.gender ? ` · ${r.gender}` : ''}
                  </span>
                </div>
              </div>

              <div className="record-rows">
                {(['FM', 'HM'] as const).map((d) => {
                  const s = r[d]
                  if (!s.submitted) return null
                  const busy = busyKey === `${r.id}-${d}`
                  return (
                    <div key={d} className="record-row">
                      <div className="record-info">
                        <span className="tiny muted">{FIELDS[d].label}</span>
                        <strong className="record-time">
                          {s.validFormat ? formatRankTime(s.submitted) : s.submitted}
                        </strong>
                        <span className={`verify-pill ${s.verified ? 'yes' : 'no'}`}>
                          {s.verified ? 'Đã xác thực' : 'Chờ xác thực'}
                        </span>
                        {!s.validFormat && (
                          <span className="tiny form-error">Sai định dạng hh:mm:ss</span>
                        )}
                        {!s.verified && s.approved && (
                          <span className="tiny muted">
                            Đang trên Bảng vàng: {formatRankTime(s.approved)}
                          </span>
                        )}
                      </div>
                      {s.verified ? (
                        <button
                          type="button"
                          className="btn ghost compact danger"
                          disabled={busy}
                          onClick={() => void setVerified(r, d, false)}
                        >
                          Hủy xác thực
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn primary compact"
                          disabled={busy || !s.validFormat}
                          onClick={() => void setVerified(r, d, true)}
                        >
                          Xác thực
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
