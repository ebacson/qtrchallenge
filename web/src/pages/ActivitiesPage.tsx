import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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
        .sort((a, b) => b.startDate.localeCompare(a.startDate))
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
        <h1>Activities</h1>
        <p className="lede">
          Dữ liệu từ <code>users/…/strava_activities</code>. Sync qua tab{' '}
          <Link to="/strava">Strava</Link> (OAuth web + api-v3).
        </p>
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
        <p className="empty">Chưa có activity. Hãy sync Strava trên app iOS/Android.</p>
      ) : (
        <ul className="activity-list">
          {filtered.map((a) => (
            <li key={a.id} className="activity-row">
              <div>
                <strong>{a.name}</strong>
                <p className="tiny muted">
                  {a.type} · {a.startDate}
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
