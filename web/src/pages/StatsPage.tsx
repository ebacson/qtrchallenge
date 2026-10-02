import { useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSharedValue } from '../lib/sharedValue'
import { timeToSeconds } from '../lib/prRanking'

type Act = {
  type: string
  distance: string
  pace: string
  startDate: string
}

const STAT_TYPES = new Set(['Run', 'TrailRun', 'Walk'])

function paceToMinutes(pace: string): number {
  const sec = timeToSeconds(pace.length === 5 ? `0:${pace}` : pace)
  return sec === Number.POSITIVE_INFINITY ? -1 : sec / 60
}

export function StatsPage() {
  const { user, profile } = useAuth()
  const raw = useSharedValue<Record<string, Record<string, unknown>>>(
    user ? `users/${user.uid}/strava_activities` : null,
  )
  const loading = raw === undefined

  const acts = useMemo<Act[]>(
    () =>
      Object.values(raw ?? {}).map((row) => ({
        type: String(row.type ?? ''),
        distance: String(row.distance ?? ''),
        pace: String(row.pace ?? ''),
        startDate: String(row.startDate ?? ''),
      })),
    [raw],
  )

  const stats = useMemo(() => {
    const eligible = acts.filter((a) => STAT_TYPES.has(a.type))
    let totalKm = 0
    let bestPace = Number.POSITIVE_INFINITY
    let longest = 0
    for (const a of eligible) {
      const km = Number(a.distance) || 0
      totalKm += km
      if (km > longest) longest = km
      const p = paceToMinutes(a.pace)
      if (p > 0 && p < bestPace) bestPace = p
    }
    const avgPace =
      eligible.length === 0
        ? 0
        : eligible.reduce((s, a) => {
            const p = paceToMinutes(a.pace)
            return s + (p > 0 ? p : 0)
          }, 0) / Math.max(1, eligible.filter((a) => paceToMinutes(a.pace) > 0).length)

    const formatPace = (mins: number) => {
      if (!mins || !Number.isFinite(mins) || mins === Number.POSITIVE_INFINITY) {
        return '—'
      }
      const m = Math.floor(mins)
      const s = Math.round((mins - m) * 60)
      return `${m}:${String(s).padStart(2, '0')}`
    }

    return {
      count: eligible.length,
      totalKm: totalKm.toFixed(1),
      longest: longest.toFixed(1),
      bestPace: formatPace(bestPace),
      avgPace: formatPace(avgPace),
    }
  }, [acts])

  return (
    <div className="page">
      <header className="page-header">
        <h1>Thống kê</h1>
        <p className="lede">
          Tổng hợp Run / TrailRun / Walk từ activities đã sync.
        </p>
      </header>

      {loading ? (
        <p className="empty">Đang tải…</p>
      ) : (
        <>
          <div className="stat-row">
            <div className="stat">
              <strong>{stats.count}</strong>
              <span>Hoạt động</span>
            </div>
            <div className="stat">
              <strong>{stats.totalKm}</strong>
              <span>Km</span>
            </div>
            <div className="stat">
              <strong>{stats.longest}</strong>
              <span>Longest</span>
            </div>
          </div>
          <div className="stat-row">
            <div className="stat">
              <strong>{stats.bestPace}</strong>
              <span>Best pace</span>
            </div>
            <div className="stat">
              <strong>{stats.avgPace}</strong>
              <span>Avg pace</span>
            </div>
            <div className="stat">
              <strong>{profile?.level ?? 0}</strong>
              <span>Level</span>
            </div>
          </div>

          <section className="section panel">
            <h2>Marathon PR (hồ sơ)</h2>
            <p>
              FM: <strong>{profile?.fullMarathonTime || '—'}</strong>{' '}
              {profile?.isFullMarathonVerified ? '✓' : '(chưa xác minh)'}
            </p>
            <p>
              HM: <strong>{profile?.halfMarathonTime || '—'}</strong>{' '}
              {profile?.isHalfMarathonVerified ? '✓' : '(chưa xác minh)'}
            </p>
          </section>
        </>
      )}
    </div>
  )
}
