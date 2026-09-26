import { useEffect, useMemo, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { db } from '../lib/firebase'

type Member = {
  id: string
  fullName: string
  email: string
  avatar: string
  level: number
  member: boolean
}

export function MembersPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

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
        }))
        .filter((m) => m.email.toLowerCase() !== 'echiptime@gmail.com')
        .sort((a, b) => {
          if (b.level !== a.level) return b.level - a.level
          return a.fullName.localeCompare(b.fullName, 'vi')
        })
      setMembers(list)
      setLoading(false)
    })
    return unsub
  }, [])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return members
    return members.filter(
      (m) =>
        m.fullName.toLowerCase().includes(needle) ||
        m.email.toLowerCase().includes(needle),
    )
  }, [members, q])

  return (
    <div className="page">
      <header className="page-header">
        <h1>Thành viên</h1>
        <p className="lede">Danh sách runners trong club (theo level).</p>
      </header>

      <label className="search-field">
        Tìm kiếm
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tên hoặc email"
        />
      </label>

      {loading ? (
        <p className="empty">Đang tải…</p>
      ) : filtered.length === 0 ? (
        <p className="empty">Không có thành viên phù hợp.</p>
      ) : (
        <ul className="member-list">
          {filtered.map((m) => (
            <li key={m.id} className="member-row">
              <div className="hof-avatar">
                {m.avatar ? (
                  <img src={m.avatar} alt="" />
                ) : (
                  <span>{(m.fullName || '?').charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div className="hof-meta">
                <strong>{m.fullName || 'Runner'}</strong>
                <span className="tiny muted">{m.email}</span>
              </div>
              <div className="member-right">
                <span className="level-badge level-bronze">Lv {m.level}</span>
                {m.member && <span className="member-badge yes">Official</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
