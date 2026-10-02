import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { get, ref } from 'firebase/database'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import { useSharedValue } from '../lib/sharedValue'
import type { Activity } from '../types'

const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun'])

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

/** Parse `dd-MM-yyyy HH:mm:ss` (giờ Việt Nam, định dạng lưu từ Strava sync) thành UTC ms. */
function activityTimeMs(startDate: string): number {
  const m = startDate
    .trim()
    .match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/)
  if (!m) {
    const fallback = Date.parse(startDate)
    return Number.isNaN(fallback) ? 0 : fallback
  }
  const [, dd, mm, yyyy, hh = '0', min = '0', ss = '0'] = m
  return (
    Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss)) -
    7 * 3_600_000
  )
}

function vnDayKey(ms: number): string {
  const d = new Date(ms + 7 * 3_600_000)
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`
}

/** "Hôm nay 06:12", "Hôm qua 05:40" hoặc "dd-MM-yyyy HH:mm" như app iOS. */
function formatActivityDate(startDate: string): string {
  const ms = activityTimeMs(startDate)
  const m = startDate.match(/^(\d{2}-\d{2}-\d{4})\s+(\d{2}:\d{2})/)
  if (!ms || !m) return startDate
  const now = Date.now()
  if (vnDayKey(ms) === vnDayKey(now)) return `Hôm nay ${m[2]}`
  if (vnDayKey(ms) === vnDayKey(now - 86_400_000)) return `Hôm qua ${m[2]}`
  return `${m[1]} ${m[2]}`
}

function timeToSeconds(value: string): number {
  const parts = value.split(':').map(Number)
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0
  return parts.reduce((total, n) => total * 60 + n, 0)
}

/** "01:02:03" → "1:02:03", "00:42:10" → "42:10". */
function formatDuration(seconds: number): string {
  if (!seconds) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const mmss = `${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`
  return h ? `${h}:${mmss}` : mmss
}

function formatTotalHours(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} phút`
}

/** Số dương hoặc null (bỏ "N/A", rỗng, 0). */
function positiveNumber(value: string): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function formatPaceSeconds(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`
}

function ActivityMetrics({ a }: { a: Activity }) {
  const moving = timeToSeconds(a.movingTime)
  const elapsed = timeToSeconds(a.elapsedTime)
  const avgHr = positiveNumber(a.averageHeartrate)
  const maxHr = positiveNumber(a.maxHeartrate)
  const cadence = positiveNumber(a.averageCadence)
  const elevation = positiveNumber(a.totalElevationGain)
  const items: [string, string][] = [
    ['Quãng đường', `${a.distance} km`],
    ['Pace', a.pace && a.pace !== '00:00' ? `${a.pace} /km` : ''],
    ['Thời gian di chuyển', formatDuration(moving)],
    ['Tổng thời gian', elapsed && elapsed !== moving ? formatDuration(elapsed) : ''],
    ['Nhịp tim TB', avgHr ? `${Math.round(avgHr)} bpm` : ''],
    ['Nhịp tim tối đa', maxHr ? `${Math.round(maxHr)} bpm` : ''],
    ['Cadence', cadence ? `${Math.round(cadence)} spm` : ''],
    ['Độ cao', elevation ? `${Math.round(elevation)} m` : ''],
  ]
  return (
    <dl className="activity-detail">
      {items
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  )
}

export function ActivitiesPage() {
  const { user } = useAuth()
  const { uid: paramUid } = useParams()
  const targetUid = paramUid || user?.uid || ''
  const isSelf = !paramUid || paramUid === user?.uid

  const [typeFilter, setTypeFilter] = useState('all')
  const [owner, setOwner] = useState<{ fullName: string; avatar: string } | null>(null)
  const raw = useSharedValue<Record<string, Record<string, unknown>>>(
    targetUid ? `users/${targetUid}/strava_activities` : null,
    isSelf ? undefined : 60_000,
  )
  const loading = raw === undefined

  const activities = useMemo<Activity[]>(
    () =>
      Object.entries(raw ?? {})
        .map(([id, dict]) => mapActivity(id, dict))
        .sort((a, b) => activityTimeMs(b.startDate) - activityTimeMs(a.startDate)),
    [raw],
  )

  useEffect(() => {
    setTypeFilter('all')
  }, [targetUid])

  useEffect(() => {
    if (isSelf || !targetUid) {
      setOwner(null)
      return
    }
    let cancelled = false
    void Promise.all([
      get(ref(db, `users/${targetUid}/fullName`)),
      get(ref(db, `users/${targetUid}/avatar`)),
    ]).then(([nameSnap, avatarSnap]) => {
      if (cancelled) return
      setOwner({
        fullName: String(nameSnap.val() ?? '') || 'Runner',
        avatar: String(avatarSnap.val() ?? ''),
      })
    })
    return () => {
      cancelled = true
    }
  }, [isSelf, targetUid])

  const types = useMemo(() => {
    const set = new Set(activities.map((a) => a.type).filter(Boolean))
    return ['all', ...Array.from(set).sort()]
  }, [activities])

  const filtered = useMemo(() => {
    if (typeFilter === 'all') return activities
    return activities.filter((a) => a.type === typeFilter)
  }, [activities, typeFilter])

  const stats = useMemo(() => {
    let km = 0
    let moving = 0
    let runKm = 0
    let runMoving = 0
    for (const a of filtered) {
      const d = positiveNumber(a.distance) ?? 0
      const t = timeToSeconds(a.movingTime)
      km += d
      moving += t
      if (RUN_TYPES.has(a.type) && d > 0 && t > 0) {
        runKm += d
        runMoving += t
      }
    }
    return {
      count: filtered.length,
      km,
      moving,
      pace: runKm > 0 ? formatPaceSeconds(runMoving / runKm) : '—',
    }
  }, [filtered])

  return (
    <div className="page">
      <header className="page-header">
        {isSelf ? (
          <h1>Hoạt động</h1>
        ) : (
          <>
            <p className="eyebrow">
              <Link to="/members">← Thành viên</Link>
            </p>
            <div className="activity-owner">
              <div className="hof-avatar">
                {owner?.avatar ? (
                  <img src={owner.avatar} alt="" />
                ) : (
                  <span>{(owner?.fullName || '?').charAt(0).toUpperCase()}</span>
                )}
              </div>
              <h1>{owner?.fullName ?? 'Đang tải…'}</h1>
            </div>
          </>
        )}
      </header>

      <div className="stat-row activity-stats">
        <div className="stat">
          <strong>{stats.count}</strong>
          <span>Hoạt động</span>
        </div>
        <div className="stat">
          <strong>{stats.km.toFixed(1)}</strong>
          <span>Tổng km</span>
        </div>
        <div className="stat">
          <strong>{stats.pace}</strong>
          <span>Pace TB (chạy)</span>
        </div>
        <div className="stat">
          <strong>{stats.moving ? formatTotalHours(stats.moving) : '—'}</strong>
          <span>Thời gian</span>
        </div>
      </div>

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
        <p className="empty">
          {isSelf ? 'Chưa có hoạt động. Hãy sync Strava.' : 'Thành viên này chưa có hoạt động.'}
        </p>
      ) : (
        <ul className="activity-list">
          {filtered.map((a) => (
            <li key={a.id} className="activity-card">
              <div className="activity-card-head">
                <div className="activity-card-title">
                  <strong>{a.name}</strong>
                  <span className="tiny muted">{formatActivityDate(a.startDate)}</span>
                </div>
                {a.type && <span className="activity-type">{a.type}</span>}
              </div>
              <ActivityMetrics a={a} />
              {/^\d+$/.test(a.id) && (
                <a
                  className="activity-strava-link tiny"
                  href={`https://www.strava.com/activities/${a.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Xem trên Strava ↗
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
