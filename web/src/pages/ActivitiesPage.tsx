import { useEffect, useMemo, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import type { Activity } from '../types'

function mapActivity(id: string, data: Record<string, unknown>): Activity {
  return {
    id,
    name: String(data.name ?? 'Activity'),
    type: String(data.type ?? ''),
    distance: String(data.distance ?? ''),
    pace: String(data.pace ?? ''),
    elapsedTime: String(data.elapsedTime ?? ''),
    movingTime: String(data.movingTime ?? ''),
    startDate: String(data.startDate ?? ''),
    averageCadence: String(data.averageCadence ?? ''),
    averageHeartrate: String(data.averageHeartrate ?? ''),
    maxHeartrate: String(data.maxHeartrate ?? ''),
    totalElevationGain: String(data.totalElevationGain ?? ''),
  }
}

/** Parse `dd-MM-yyyy HH:mm:ss` (định dạng lưu từ Strava sync). */
function activityTimeMs(startDate: string): number {
  const m = startDate
    .trim()
    .match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/)
  if (!m) {
    const fallback = Date.parse(startDate)
    return Number.isNaN(fallback) ? 0 : fallback
  }
  const [, dd, mm, yyyy, hh = '0', min = '0', ss = '0'] = m
  return new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(min),
    Number(ss),
  ).getTime()
}

/** Hiển thị `dd-MM-yyyy HH:mm:ss` (coi là giờ GMT) theo giờ Việt Nam GMT+7. */
function displayVnTime(startDate: string): string {
  const m = startDate
    .trim()
    .match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/)
  if (!m) return startDate
  const [, dd, mm, yyyy, hh, min, ss] = m.map(Number)
  const d = new Date(Date.UTC(yyyy, mm - 1, dd, hh, min, ss) + 7 * 3_600_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

export function ActivitiesPage() {
  const { user } = useAuth()
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')

  useEffect(() => {
    if (!user) return
    const actRef = ref(db, `users/${user.uid}/strava_activities`)
    const unsub = onValue(actRef, (snap) => {
      const val = (snap.val() ?? {}) as Record<string, Record<string, unknown>>
      const list = Object.entries(val)
        .map(([id, dict]) => mapActivity(id, dict))
        .sort((a, b) => activityTimeMs(b.startDate) - activityTimeMs(a.startDate))
      setActivities(list)
      setLoading(false)
    })
    return unsub
  }, [user])

  const types = useMemo(() => {
    const set = new Set(activities.map((a) => a.type).filter(Boolean))
    return ['all', ...Array.from(set).sort()]
  }, [activities])

  const filtered = useMemo(() => {
    if (typeFilter === 'all') return activities
    return activities.filter((a) => a.type === typeFilter)
  }, [activities, typeFilter])

  return (
    <div className="page">
      <header className="page-header">
        <h1>Hoạt động</h1>
      </header>

      <div className="filter-row">
        {types.map((t) => (
          <button
            key={t}
            type="button"
            className={typeFilter === t ? 'chip active' : 'chip'}
            onClick={() => setTypeFilter(t)}
          >
            {t === 'all' ? 'Tất cả' : t}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="empty">Đang tải…</p>
      ) : filtered.length === 0 ? (
        <p className="empty">Chưa có hoạt động. Hãy sync Strava.</p>
      ) : (
        <ul className="activity-list">
          {filtered.map((a) => (
            <li key={a.id} className="activity-row">
              <div>
                <strong>{a.name}</strong>
                <p className="tiny muted">
                  {a.type} · {displayVnTime(a.startDate)}
                </p>
              </div>
              <div className="activity-metrics">
                <span>{a.distance} km</span>
                <span>{a.pace}/km</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
