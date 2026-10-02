import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  matchesMemberType,
  MemberTypeFilter,
  type MemberType,
} from '../components/MemberTypeFilter'
import { formatMemberSince } from '../lib/userProfile'
import { useUserProfiles } from '../lib/userWrites'

type Member = {
  id: string
  fullName: string
  email: string
  avatar: string
  level: number
  member: boolean
  memberSince: string
}

export function MembersPage() {
  const profiles = useUserProfiles()
  const loading = profiles === null
  const [q, setQ] = useState('')
  const [memberType, setMemberType] = useState<MemberType>('all')

  const members = useMemo<Member[]>(
    () =>
      Object.entries(profiles ?? {})
        .map(([id, row]) => ({
          id,
          fullName: String(row.fullName ?? ''),
          email: String(row.email ?? ''),
          avatar: String(row.avatar ?? ''),
          level: Number(row.level ?? 0) || 0,
          member: Boolean(row.member),
          memberSince: row.member ? formatMemberSince(row.memberSince) : '',
        }))
        .filter((m) => m.email.toLowerCase() !== 'echiptime@gmail.com')
        .sort((a, b) => {
          if (b.level !== a.level) return b.level - a.level
          return a.fullName.localeCompare(b.fullName, 'vi')
        }),
    [profiles],
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return members.filter((m) => {
      if (!matchesMemberType(m.member, memberType)) return false
      if (!needle) return true
      return (
        m.fullName.toLowerCase().includes(needle) ||
        m.email.toLowerCase().includes(needle)
      )
    })
  }, [members, q, memberType])

  return (
    <div className="page">
      <header className="page-header">
        <h1>Thành viên</h1>
        <p className="lede">Danh sách runners trong club (theo level). Chạm vào một thành viên để xem hoạt động.</p>
      </header>

      <MemberTypeFilter value={memberType} onChange={setMemberType} items={members} />

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
            <li key={m.id}>
              <Link to={`/activities/${m.id}`} className="member-row" title="Xem hoạt động">
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
                  {m.memberSince && (
                    <span className="tiny muted">Chính thức từ {m.memberSince}</span>
                  )}
                </div>
                <div className="member-right">
                  <span className="level-badge level-bronze">Lv {m.level}</span>
                  <span className={`member-badge ${m.member ? 'yes' : 'no'}`}>
                    {m.member ? 'Chính thức' : 'Tự do'}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
