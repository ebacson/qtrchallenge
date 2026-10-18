import { activityDayMs } from './challengeRules'
import { formatPaceMinutes, paceToMinutes } from './activityTrends'

const DAY_MS = 86_400_000
/** Chỉ dùng Run/Trail gần đây để ước race road */
const RACE_TYPES = new Set(['Run', 'TrailRun'])
const LOOKBACK_MS = 84 * DAY_MS
const MIN_KM = 3
const MAX_KM = 45
/** Peter Riegel */
const RIEGEL_EXP = 1.06

export type RaceTargetId = '5k' | '10k' | 'hm' | 'fm'

export type RaceTarget = {
  id: RaceTargetId
  label: string
  km: number
}

export const RACE_TARGETS: RaceTarget[] = [
  { id: '5k', label: '5 km', km: 5 },
  { id: '10k', label: '10 km', km: 10 },
  { id: 'hm', label: 'Half Marathon', km: 21.0975 },
  { id: 'fm', label: 'Full Marathon', km: 42.195 },
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
  timeSec: number
  timeLabel: string
  paceLabel: string
}

export type RacePredictResult = {
  predictions: RacePrediction[]
  /** Mô tả nguồn ước tính */
  sourceLabel: string
} | null

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

/**
 * Ước 5K/10K/HM/FM từ buổi Run/Trail tốt nhất (theo tương đương 10K)
 * trong ~12 tuần gần đây, công thức Riegel.
 */
export function predictRaceTimes(
  activities: ActivityLike[],
  now = Date.now(),
): RacePredictResult {
  const cutoff = now - LOOKBACK_MS
  type Cand = { km: number; timeSec: number; dayMs: number; pred10k: number }
  const cands: Cand[] = []

  for (const a of activities) {
    if (!RACE_TYPES.has(a.type)) continue
    const dayMs = activityDayMs(a.startDate)
    if (dayMs == null || dayMs < cutoff) continue
    const km = Number(a.distance) || 0
    if (km < MIN_KM || km > MAX_KM) continue
    const paceMin = paceToMinutes(a.pace)
    if (!(paceMin > 0)) continue
    // Lọc pace cực đoan (sprint / GPS lỗi)
    if (paceMin < 2.5 || paceMin > 12) continue
    const timeSec = paceMin * 60 * km
    const pred10k = riegelTimeSec(timeSec, km, 10)
    if (!Number.isFinite(pred10k)) continue
    cands.push({ km, timeSec, dayMs, pred10k })
  }

  if (!cands.length) return null

  // Ưu tiên buổi gần cự ly trung bình (5–25 km) khi điểm 10K tương đương gần nhau
  cands.sort((a, b) => {
    if (a.pred10k !== b.pred10k) return a.pred10k - b.pred10k
    const aMid = Math.abs(a.km - 12)
    const bMid = Math.abs(b.km - 12)
    return aMid - bMid
  })
  const best = cands[0]

  const predictions = RACE_TARGETS.map((t) => {
    const timeSec = riegelTimeSec(best.timeSec, best.km, t.km)
    const paceMin = timeSec / 60 / t.km
    return {
      id: t.id,
      label: t.label,
      km: t.km,
      timeSec,
      timeLabel: formatDuration(timeSec),
      paceLabel: formatPaceMinutes(paceMin),
    }
  })

  const sourcePace = formatPaceMinutes(best.timeSec / 60 / best.km)
  const sourceLabel = `Từ buổi ~${best.km.toFixed(1)} km @ ${sourcePace}/km (12 tuần gần đây)`

  return { predictions, sourceLabel }
}
