import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useSharedValue } from '../lib/sharedValue'
import {
  parseChallenge,
  parseChallengeDayStartMs,
  STATUS_FINISHED,
  STATUS_ONGOING,
  STATUS_UPCOMING,
} from '../lib/challengeRules'
import type { Challenge } from '../types'
import { ChallengeCard } from '../components/ChallengeCard'

type Filter = 'all' | 'joined' | 'ongoing' | 'upcoming' | 'finished'

function startMs(c: Challenge): number {
  return parseChallengeDayStartMs(c.startDate) ?? 0
}

/** Upcoming: nearest start first. Others: newest start first. */
function sortChallenges(list: Challenge[], forUpcoming: boolean): Challenge[] {
  return [...list].sort((a, b) => {
    const da = startMs(a)
    const db = startMs(b)
    return forUpcoming ? da - db : db - da
  })
}

export function ChallengesPage() {
  const { user, profile } = useAuth()
  const [filter, setFilter] = useState<Filter>('all')
  const raw = useSharedValue<Record<string, Record<string, unknown>>>(
    user ? 'challenges' : null,
  )
  const loading = raw === undefined

  const challenges = useMemo<Challenge[]>(
    () =>
      user
        ? Object.entries(raw ?? {}).map(([id, dict]) => parseChallenge(id, dict, user.uid))
        : [],
    [raw, user],
  )

  const filtered = useMemo(() => {
    const list = challenges.filter((c) => {
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

    if (filter === 'upcoming') {
      return sortChallenges(list, true)
    }

    if (filter === 'all' || filter === 'joined') {
      const upcoming = sortChallenges(
        list.filter((c) => c.status === STATUS_UPCOMING),
        true,
      )
      const ongoing = sortChallenges(
        list.filter((c) => c.status === STATUS_ONGOING),
        false,
      )
      const finished = sortChallenges(
        list.filter((c) => c.status === STATUS_FINISHED),
        false,
      )
      const other = sortChallenges(
        list.filter(
          (c) =>
            c.status !== STATUS_ONGOING &&
            c.status !== STATUS_UPCOMING &&
            c.status !== STATUS_FINISHED,
        ),
        false,
      )
      return [...ongoing, ...upcoming, ...finished, ...other]
    }

    return sortChallenges(list, false)
  }, [challenges, filter])

  return (
    <div className="page">
      <header className="page-header">
        <h1>Thử thách</h1>
        <p className="lede">Hãy chọn tham gia một thử thách phù hợp.</p>
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
