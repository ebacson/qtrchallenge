import { activityDayMs } from './challengeRules'

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
/** Chênh ≥ ngưỡng này mới gọi là tăng/giảm */
const VOLUME_DELTA = 0.1
const PACE_DELTA = 0.03

export type TrendDirection = 'up' | 'down' | 'stable' | 'unknown'

export type ActivityLike = {
  type: string
  distance: string
  pace: string
  startDate: string
}

export type WeekBucket = {
  /** ms đầu tuần (Thứ 2 00:00 VN) */
  weekStartMs: number
  label: string
  km: number
  sessions: number
  /** phút/km TB (0 nếu không có pace hợp lệ) */
  avgPaceMin: number
}

export type TrendSummary = {
  volume: { direction: TrendDirection; label: string; detail: string }
  pace: { direction: TrendDirection; label: string; detail: string }
  sessions: { direction: TrendDirection; label: string; detail: string }
  weeks: WeekBucket[]
}

const STAT_TYPES = new Set(['Run', 'TrailRun', 'Walk'])

export function paceToMinutes(pace: string): number {
  const parts = pace.trim().split(':').map(Number)
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
    return parts[0] + parts[1] / 60
  }
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return parts[0] * 60 + parts[1] + parts[2] / 60
  }
  return -1
}

export function formatPaceMinutes(mins: number): string {
  if (!(mins > 0) || !Number.isFinite(mins)) return '—'
  const m = Math.floor(mins)
  const s = Math.round((mins - m) * 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Đầu tuần Thứ 2 00:00 VN từ một ngày activity (ms) */
export function weekStartFromDayMs(dayMs: number): number {
  const vn = new Date(dayMs + 7 * 60 * 60 * 1000)
  const dow = vn.getUTCDay()
  const mondayOffset = dow === 0 ? 6 : dow - 1
  return dayMs - mondayOffset * DAY_MS
}

function weekLabel(weekStartMs: number): string {
  const vn = new Date(weekStartMs + 7 * 60 * 60 * 1000)
  const d = vn.getUTCDate()
  const m = vn.getUTCMonth() + 1
  return `${d}/${m}`
}

function directionFromDelta(
  recent: number,
  previous: number,
  /** true = giá trị lớn hơn là “tốt/tăng” (km, buổi); false = nhỏ hơn là tốt hơn (pace) */
  higherIsUp: boolean,
): TrendDirection {
  if (!(previous > 0) && !(recent > 0)) return 'unknown'
  if (!(previous > 0)) return recent > 0 ? 'up' : 'unknown'
  const delta = (recent - previous) / previous
  const threshold = higherIsUp ? VOLUME_DELTA : PACE_DELTA
  if (Math.abs(delta) < threshold) return 'stable'
  if (higherIsUp) return delta > 0 ? 'up' : 'down'
  // pace: giảm phút = nhanh hơn → coi là "up" (cải thiện)
  return delta < 0 ? 'up' : 'down'
}

function volumeLabel(dir: TrendDirection): string {
  if (dir === 'up') return 'Đang tăng'
  if (dir === 'down') return 'Đang giảm'
  if (dir === 'stable') return 'Ổn định'
  return 'Chưa đủ dữ liệu'
}

function paceLabel(dir: TrendDirection): string {
  if (dir === 'up') return 'Đang nhanh hơn'
  if (dir === 'down') return 'Đang chậm hơn'
  if (dir === 'stable') return 'Ổn định'
  return 'Chưa đủ dữ liệu'
}

function sessionsLabel(dir: TrendDirection): string {
  if (dir === 'up') return 'Chạy nhiều buổi hơn'
  if (dir === 'down') return 'Ít buổi hơn'
  if (dir === 'stable') return 'Ổn định'
  return 'Chưa đủ dữ liệu'
}

function avg(nums: number[]): number {
  if (!nums.length) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

/** 12 tuần gần nhất + so 4 tuần gần vs 4 tuần trước */
export function buildActivityTrends(
  activities: ActivityLike[],
  now = Date.now(),
  weekCount = 12,
): TrendSummary {
  const todayStart = (() => {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(now))
    // en-CA → yyyy-MM-dd; activityDayMs expects dd-MM-yyyy
    const [y, m, d] = fmt.split('-')
    return activityDayMs(`${d}-${m}-${y}`) ?? weekStartFromDayMs(now)
  })()
  const thisWeek = weekStartFromDayMs(todayStart)

  const weeks: WeekBucket[] = []
  for (let i = weekCount - 1; i >= 0; i--) {
    const weekStartMs = thisWeek - i * WEEK_MS
    weeks.push({
      weekStartMs,
      label: weekLabel(weekStartMs),
      km: 0,
      sessions: 0,
      avgPaceMin: 0,
    })
  }
  const byStart = new Map(weeks.map((w) => [w.weekStartMs, w]))
  const paceSums = new Map<number, { sum: number; n: number }>()

  for (const a of activities) {
    if (!STAT_TYPES.has(a.type)) continue
    const dayMs = activityDayMs(a.startDate)
    if (dayMs == null) continue
    const ws = weekStartFromDayMs(dayMs)
    const bucket = byStart.get(ws)
    if (!bucket) continue
    const km = Number(a.distance) || 0
    if (km > 0) {
      bucket.km += km
      bucket.sessions += 1
    }
    const p = paceToMinutes(a.pace)
    if (p > 0 && km > 0) {
      const acc = paceSums.get(ws) ?? { sum: 0, n: 0 }
      acc.sum += p
      acc.n += 1
      paceSums.set(ws, acc)
    }
  }
  for (const w of weeks) {
    const acc = paceSums.get(w.weekStartMs)
    w.avgPaceMin = acc && acc.n > 0 ? acc.sum / acc.n : 0
    w.km = Math.round(w.km * 10) / 10
  }

  const recent = weeks.slice(-4)
  const previous = weeks.slice(-8, -4)
  const recentKm = avg(recent.map((w) => w.km))
  const prevKm = avg(previous.map((w) => w.km))
  const recentSessions = avg(recent.map((w) => w.sessions))
  const prevSessions = avg(previous.map((w) => w.sessions))
  const recentPace = avg(recent.map((w) => w.avgPaceMin).filter((p) => p > 0))
  const prevPace = avg(previous.map((w) => w.avgPaceMin).filter((p) => p > 0))

  const volDir = directionFromDelta(recentKm, prevKm, true)
  const sessDir = directionFromDelta(recentSessions, prevSessions, true)
  const paceDir = directionFromDelta(recentPace, prevPace, false)

  const pct = (a: number, b: number) => {
    if (!(b > 0)) return ''
    const d = Math.round(((a - b) / b) * 100)
    return d === 0 ? '' : ` (${d > 0 ? '+' : ''}${d}%)`
  }

  return {
    weeks,
    volume: {
      direction: volDir,
      label: volumeLabel(volDir),
      detail:
        volDir === 'unknown'
          ? 'Cần thêm hoạt động vài tuần gần đây.'
          : `${recentKm.toFixed(1)} km/tuần · trước ${prevKm.toFixed(1)}${pct(recentKm, prevKm)}`,
    },
    sessions: {
      direction: sessDir,
      label: sessionsLabel(sessDir),
      detail:
        sessDir === 'unknown'
          ? 'Cần thêm hoạt động vài tuần gần đây.'
          : `${recentSessions.toFixed(1)} buổi/tuần · trước ${prevSessions.toFixed(1)}${pct(recentSessions, prevSessions)}`,
    },
    pace: {
      direction: paceDir,
      label: paceLabel(paceDir),
      detail:
        paceDir === 'unknown'
          ? 'Cần pace hợp lệ trong vài tuần gần đây.'
          : `${formatPaceMinutes(recentPace)}/km · trước ${formatPaceMinutes(prevPace)}`,
    },
  }
}
