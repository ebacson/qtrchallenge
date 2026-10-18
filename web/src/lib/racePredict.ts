import { activityDayMs } from './challengeRules'
import { formatPaceMinutes, paceToMinutes } from './activityTrends'

const DAY_MS = 86_400_000
/** Chỉ dùng Run/Trail gần đây để ước race road */
const RACE_TYPES = new Set(['Run', 'TrailRun'])
const LOOKBACK_MS = 84 * DAY_MS
/** Nguồn cho 5K / 10K */
const SHORT_MIN_KM = 5
/** Nguồn cho HM / FM */
const LONG_MIN_KM = 10
const MAX_KM = 50
/** Peter Riegel */
const RIEGEL_EXP = 1.06

export type RaceTargetId = '5k' | '10k' | 'hm' | 'fm'

export type RaceTarget = {
  id: RaceTargetId
  label: string
  km: number
  /** short = cần buổi ≥ 5 km; long = cần buổi > 10 km */
  group: 'short' | 'long'
}

export const RACE_TARGETS: RaceTarget[] = [
  { id: '5k', label: '5 km', km: 5, group: 'short' },
  { id: '10k', label: '10 km', km: 10, group: 'short' },
  { id: 'hm', label: 'Half Marathon', km: 21.0975, group: 'long' },
  { id: 'fm', label: 'Full Marathon', km: 42.195, group: 'long' },
]

export type ActivityLike = {
  type: string
  distance: string
  pace: string
  startDate: string
}

export type RacePrediction = {
  id: RaceTargetId
  label: string
  km: number
  timeSec: number | null
  timeLabel: string
  paceLabel: string
}

export type RacePredictResult = {
  predictions: RacePrediction[]
} | null

type Cand = { km: number; timeSec: number }

function riegelTimeSec(t1Sec: number, d1Km: number, d2Km: number): number {
  if (!(t1Sec > 0) || !(d1Km > 0) || !(d2Km > 0)) return NaN
  return t1Sec * Math.pow(d2Km / d1Km, RIEGEL_EXP)
}

export function formatDuration(totalSec: number): string {
  if (!(totalSec > 0) || !Number.isFinite(totalSec)) return '—'
  const s = Math.round(totalSec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

function collectCandidates(activities: ActivityLike[], now: number): Cand[] {
  const cutoff = now - LOOKBACK_MS
  const out: Cand[] = []
  for (const a of activities) {
    if (!RACE_TYPES.has(a.type)) continue
    const dayMs = activityDayMs(a.startDate)
    if (dayMs == null || dayMs < cutoff) continue
    const km = Number(a.distance) || 0
    if (km < SHORT_MIN_KM || km > MAX_KM) continue
    const paceMin = paceToMinutes(a.pace)
    if (!(paceMin > 0) || paceMin < 2.5 || paceMin > 12) continue
    out.push({ km, timeSec: paceMin * 60 * km })
  }
  return out
}

/** Chọn buổi tốt nhất theo thời gian tương đương tại `scoreKm` (Riegel). */
function pickBest(cands: Cand[], scoreKm: number, preferKm: number): Cand | null {
  if (!cands.length) return null
  const ranked = [...cands].sort((a, b) => {
    const sa = riegelTimeSec(a.timeSec, a.km, scoreKm)
    const sb = riegelTimeSec(b.timeSec, b.km, scoreKm)
    if (sa !== sb) return sa - sb
    return Math.abs(a.km - preferKm) - Math.abs(b.km - preferKm)
  })
  return ranked[0] ?? null
}

function predictionFrom(
  target: RaceTarget,
  source: Cand | null,
): RacePrediction {
  if (!source) {
    return {
      id: target.id,
      label: target.label,
      km: target.km,
      timeSec: null,
      timeLabel: '—',
      paceLabel: '—',
    }
  }
  const timeSec = riegelTimeSec(source.timeSec, source.km, target.km)
  if (!Number.isFinite(timeSec)) {
    return {
      id: target.id,
      label: target.label,
      km: target.km,
      timeSec: null,
      timeLabel: '—',
      paceLabel: '—',
    }
  }
  return {
    id: target.id,
    label: target.label,
    km: target.km,
    timeSec,
    timeLabel: formatDuration(timeSec),
    paceLabel: formatPaceMinutes(timeSec / 60 / target.km),
  }
}

/**
 * 5K/10K: từ buổi ≥ 5 km.
 * HM/FM: từ buổi > 10 km.
 * Công thức Riegel, ~12 tuần gần đây.
 */
export function predictRaceTimes(
  activities: ActivityLike[],
  now = Date.now(),
): RacePredictResult {
  const all = collectCandidates(activities, now)
  const shortCands = all.filter((c) => c.km >= SHORT_MIN_KM)
  const longCands = all.filter((c) => c.km > LONG_MIN_KM)

  const shortSource = pickBest(shortCands, 10, 8)
  const longSource = pickBest(longCands, 21.0975, 18)

  if (!shortSource && !longSource) return null

  const predictions = RACE_TARGETS.map((t) =>
    predictionFrom(t, t.group === 'short' ? shortSource : longSource),
  )

  return { predictions }
}
