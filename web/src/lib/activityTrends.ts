import { activityDayMs, parseChallengeDayStartMs } from './challengeRules'

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
/** Chênh ≥ ngưỡng này mới gọi là tăng/giảm */
const VOLUME_DELTA = 0.1
const PACE_DELTA = 0.03

export type TrendPeriod = 'week' | 'month' | 'year'
export type TrendDirection = 'up' | 'down' | 'stable' | 'unknown'

export type ActivityLike = {
  type: string
  distance: string
  pace: string
  startDate: string
}

export type PeriodBucket = {
  startMs: number
  label: string
  km: number
  sessions: number
  /** phút/km TB (0 nếu không có pace hợp lệ) */
  avgPaceMin: number
}

export type TrendSummary = {
  period: TrendPeriod
  volume: { direction: TrendDirection; label: string; detail: string }
  pace: { direction: TrendDirection; label: string; detail: string }
  sessions: { direction: TrendDirection; label: string; detail: string }
  buckets: PeriodBucket[]
  /** Số cột cuối được tô đậm (nhóm “gần đây”) */
  recentBarCount: number
  chartCaption: string
}

const STAT_TYPES = new Set(['Run', 'TrailRun', 'Walk'])

const PERIOD_META: Record<
  TrendPeriod,
  {
    unit: string
    bucketCount: number
    compareCount: number
    chartCaption: string
  }
> = {
  week: {
    unit: 'tuần',
    bucketCount: 12,
    compareCount: 4,
    chartCaption: 'Km / tuần',
  },
  month: {
    unit: 'tháng',
    bucketCount: 12,
    compareCount: 3,
    chartCaption: 'Km / tháng',
  },
  year: {
    unit: 'năm',
    bucketCount: 5,
    compareCount: 1,
    chartCaption: 'Km / năm',
  },
}

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

function vnYmdParts(ms: number): { y: number; m: number; d: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms))
  const [y, m, d] = fmt.split('-').map(Number)
  return { y, m, d }
}

function dayStartFromParts(y: number, m: number, d: number): number {
  const pad = (n: number) => String(n).padStart(2, '0')
  return parseChallengeDayStartMs(`${pad(d)}-${pad(m)}-${y}`) ?? 0
}

function todayStartMs(now: number): number {
  const { y, m, d } = vnYmdParts(now)
  return dayStartFromParts(y, m, d)
}

/** Đầu tuần Thứ 2 00:00 VN */
export function weekStartFromDayMs(dayMs: number): number {
  const vn = new Date(dayMs + 7 * 60 * 60 * 1000)
  const dow = vn.getUTCDay()
  const mondayOffset = dow === 0 ? 6 : dow - 1
  return dayMs - mondayOffset * DAY_MS
}

function monthStartFromDayMs(dayMs: number): number {
  const { y, m } = vnYmdParts(dayMs)
  return dayStartFromParts(y, m, 1)
}

function yearStartFromDayMs(dayMs: number): number {
  const { y } = vnYmdParts(dayMs)
  return dayStartFromParts(y, 1, 1)
}

function addMonths(startMs: number, delta: number): number {
  const { y, m } = vnYmdParts(startMs)
  const idx = y * 12 + (m - 1) + delta
  const ny = Math.floor(idx / 12)
  const nm = (idx % 12) + 1
  return dayStartFromParts(ny, nm, 1)
}

function addYears(startMs: number, delta: number): number {
  const { y } = vnYmdParts(startMs)
  return dayStartFromParts(y + delta, 1, 1)
}

function periodStart(dayMs: number, period: TrendPeriod): number {
  if (period === 'week') return weekStartFromDayMs(dayMs)
  if (period === 'month') return monthStartFromDayMs(dayMs)
  return yearStartFromDayMs(dayMs)
}

function shiftPeriod(startMs: number, period: TrendPeriod, delta: number): number {
  if (period === 'week') return startMs + delta * WEEK_MS
  if (period === 'month') return addMonths(startMs, delta)
  return addYears(startMs, delta)
}

function bucketLabel(startMs: number, period: TrendPeriod): string {
  const { y, m, d } = vnYmdParts(startMs)
  if (period === 'week') return `${d}/${m}`
  if (period === 'month') return `${m}/${String(y).slice(2)}`
  return String(y)
}

function directionFromDelta(
  recent: number,
  previous: number,
  higherIsUp: boolean,
): TrendDirection {
  if (!(previous > 0) && !(recent > 0)) return 'unknown'
  if (!(previous > 0)) return recent > 0 ? 'up' : 'unknown'
  const delta = (recent - previous) / previous
  const threshold = higherIsUp ? VOLUME_DELTA : PACE_DELTA
  if (Math.abs(delta) < threshold) return 'stable'
  if (higherIsUp) return delta > 0 ? 'up' : 'down'
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

export function buildActivityTrends(
  activities: ActivityLike[],
  period: TrendPeriod = 'week',
  now = Date.now(),
): TrendSummary {
  const meta = PERIOD_META[period]
  const today = todayStartMs(now)
  const current = periodStart(today, period)

  const buckets: PeriodBucket[] = []
  for (let i = meta.bucketCount - 1; i >= 0; i--) {
    const startMs = shiftPeriod(current, period, -i)
    buckets.push({
      startMs,
      label: bucketLabel(startMs, period),
      km: 0,
      sessions: 0,
      avgPaceMin: 0,
    })
  }

  const byStart = new Map(buckets.map((b) => [b.startMs, b]))
  const paceSums = new Map<number, { sum: number; n: number }>()

  for (const a of activities) {
    if (!STAT_TYPES.has(a.type)) continue
    const dayMs = activityDayMs(a.startDate)
    if (dayMs == null) continue
    const key = periodStart(dayMs, period)
    const bucket = byStart.get(key)
    if (!bucket) continue
    const km = Number(a.distance) || 0
    if (km > 0) {
      bucket.km += km
      bucket.sessions += 1
    }
    const p = paceToMinutes(a.pace)
    if (p > 0 && km > 0) {
      const acc = paceSums.get(key) ?? { sum: 0, n: 0 }
      acc.sum += p
      acc.n += 1
      paceSums.set(key, acc)
    }
  }

  for (const b of buckets) {
    const acc = paceSums.get(b.startMs)
    b.avgPaceMin = acc && acc.n > 0 ? acc.sum / acc.n : 0
    b.km = Math.round(b.km * 10) / 10
  }

  const n = meta.compareCount
  const recent = buckets.slice(-n)
  const previous = buckets.slice(-2 * n, -n)
  const recentKm = avg(recent.map((b) => b.km))
  const prevKm = avg(previous.map((b) => b.km))
  const recentSessions = avg(recent.map((b) => b.sessions))
  const prevSessions = avg(previous.map((b) => b.sessions))
  const recentPace = avg(recent.map((b) => b.avgPaceMin).filter((p) => p > 0))
  const prevPace = avg(previous.map((b) => b.avgPaceMin).filter((p) => p > 0))

  const volDir = directionFromDelta(recentKm, prevKm, true)
  const sessDir = directionFromDelta(recentSessions, prevSessions, true)
  const paceDir = directionFromDelta(recentPace, prevPace, false)

  const pct = (a: number, b: number) => {
    if (!(b > 0)) return ''
    const d = Math.round(((a - b) / b) * 100)
    return d === 0 ? '' : ` (${d > 0 ? '+' : ''}${d}%)`
  }

  const unit = meta.unit
  const needMore = `Cần thêm hoạt động vài ${unit} gần đây.`

  return {
    period,
    buckets,
    recentBarCount: n,
    chartCaption: meta.chartCaption,
    volume: {
      direction: volDir,
      label: volumeLabel(volDir),
      detail:
        volDir === 'unknown'
          ? needMore
          : `${recentKm.toFixed(1)} km/${unit} · trước ${prevKm.toFixed(1)}${pct(recentKm, prevKm)}`,
    },
    sessions: {
      direction: sessDir,
      label: sessionsLabel(sessDir),
      detail:
        sessDir === 'unknown'
          ? needMore
          : `${recentSessions.toFixed(1)} buổi/${unit} · trước ${prevSessions.toFixed(1)}${pct(recentSessions, prevSessions)}`,
    },
    pace: {
      direction: paceDir,
      label: paceLabel(paceDir),
      detail:
        paceDir === 'unknown'
          ? `Cần pace hợp lệ trong vài ${unit} gần đây.`
          : `${formatPaceMinutes(recentPace)}/km · trước ${formatPaceMinutes(prevPace)}`,
    },
  }
}
