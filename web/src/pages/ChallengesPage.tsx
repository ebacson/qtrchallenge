import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { onValue, ref } from 'firebase/database'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import {
  parseChallenge,
  STATUS_FINISHED,
  STATUS_ONGOING,
  STATUS_UPCOMING,
} from '../lib/challengeRules'
import type { Challenge } from '../types'
import { ChallengeCard } from '../components/ChallengeCard'

type Filter = 'all' | 'joined' | 'ongoing' | 'upcoming' | 'finished'

export function ChallengesPage() {
  const { user, profile } = useAuth()
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    const challengesRef = ref(db, 'challenges')
    const unsub = onValue(challengesRef, (snap) => {
      const val = (snap.val() ?? {}) as Record<string, Record<string, unknown>>
      const list = Object.entries(val)
        .map(([id, dict]) => parseChallenge(id, dict, user.uid))
        .sort((a, b) => b.startDate.localeCompare(a.startDate))
      setChallenges(list)
      setLoading(false)
    })
    return unsub
  }, [user])

  const filtered = useMemo(() => {
    return challenges.filter((c) => {
      switch (filter) {
        case 'joined':
          return Boolean(c.userTarget)
        case 'ongoing':
          return c.status === STATUS_ONGOING
        case 'upcoming':
          return c.status === STATUS_UPCOMING
        case 'finished':
          return c.status === STATUS_FINISHED
        default:
          return true
      }
    })
  }, [challenges, filter])

  return (
    <div className="page">
      <header className="page-header">
        <h1>Thử thách</h1>
        <p className="lede">Danh sách challenge từ Firebase RTDB.</p>
        {profile?.admin && (
          <p style={{ marginTop: 12 }}>
            <Link className="btn primary" to="/admin/challenges/new">
              Tạo thử thách
            </Link>
          </p>
        )}
      </header>

      <div className="filter-row">
        {(
          [
            ['all', 'Tất cả'],
            ['joined', 'Đã tham gia'],
            ['ongoing', 'Đang diễn ra'],
            ['upcoming', 'Sắp diễn ra'],
            ['finished', 'Đã kết thúc'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={filter === key ? 'chip active' : 'chip'}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="empty">Đang tải…</p>
      ) : filtered.length === 0 ? (
        <p className="empty">Không có thử thách phù hợp.</p>
      ) : (
        <div className="challenge-list">
          {filtered.map((c) => (
            <ChallengeCard key={c.id} challenge={c} />
          ))}
        </div>
      )}
    </div>
  )
}
