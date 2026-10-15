import { useEffect, useMemo, useState } from 'react'
import {
  activityDayMs,
  convertPaceToMinutesPerKm,
  ELIGIBLE_ACTIVITY_TYPES,
  formatPaceMinutes,
  MAX_PACE,
  MIN_DISTANCE_KM,
  MIN_PACE,
  parseChallengeDayEndInclusiveMs,
  parseChallengeDayStartMs,
} from './challengeRules'
import { formatVnd } from './rewardPenalty'
import { subscribeShared } from './sharedValue'

/**
 * `duels/{id}`: thách đấu do thành viên chính thức tạo, Admin duyệt. Tách hẳn khỏi `challenges`
 * nên không tính phạt không tham gia, thưởng phạt CLB, level hay sổ quỹ.
 * `duel_secrets/{id}/password`: mật khẩu tham gia, chỉ người tạo và Admin đọc được.
 * `duel_join_keys/{id}/{uid}`: mật khẩu người tham gia nhập, quy tắc Firebase so khớp khi ghi.
 */
export const DUELS_PATH = 'duels'
export const DUEL_SECRETS_PATH = 'duel_secrets'
export const DUEL_JOIN_KEYS_PATH = 'duel_join_keys'

export const MAX_ACTIVE_DUELS = 3
export const MAX_DUEL_DAYS = 31
export const MAX_DUEL_PARTICIPANTS = 50
export const MAX_DUEL_FUND = 500_000
export const DAY_MS = 86_400_000

export type DuelMetric = 'distance' | 'pace' | 'count' | 'best_effort'
export type DuelKind = 'target' | 'ranking'
export type DuelApprovalStatus = 'pending' | 'approved' | 'rejected'
/** expired: quá ngày bắt đầu mà chưa được duyệt */
export type DuelPhase = 'pending' | 'rejected' | 'expired' | 'upcoming' | 'ongoing' | 'finished'

export type DuelResultRow = { name: string; value: number | null; at: number | null; rank: number; won: boolean }

export type Duel = {
  id: string
  title: string
  description: string
  createdBy: string
  createdByName: string
  createdAt: number
  metric: DuelMetric
  kind: DuelKind
  /** Cự ly (và cự ly + pace): chỉ tính hoạt động dài nhất thay vì cộng dồn các hoạt động */
  single: boolean
  /** km (cự ly, pace), số hoạt động (đếm hoạt động), pace phút/km (hoạt động nhanh nhất + đạt mục tiêu) */
  target: number
  /** Cự ly tối thiểu mỗi hoạt động; với "hoạt động nhanh nhất" là cự ly hoạt động phải đạt */
  minKm: number
  paceMin?: number
  paceMax?: number
  winnerCount: number
  startDate: string
  endDate: string
  startAt: number
  endAt: number
  joinUntil: number
  joinDays: number
  stakeText: string
  fundAmount: number
  /** Có mật khẩu tham gia (mật khẩu nằm ở `duel_secrets`) */
  hasPassword: boolean
  invited: string[]
  approval: { status: DuelApprovalStatus; by?: string; at?: number; reason?: string }
  participants: Record<string, { name: string; joinedAt: number }>
  declined: Record<string, number>
  withdrawRequests: Record<string, { at: number; reason: string }>
  result: { lockedAt: number; lockedBy: string; size: number; rows: Record<string, DuelResultRow> } | null
  stakeDone: Record<string, { at: number; by: string }>
  fundPayments: Record<string, { amount: number; code: string; confirmedAt: number; confirmedBy: string }>
}

function asDict(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function dictOf<T>(raw: unknown, map: (v: Record<string, unknown> | unknown) => T | null): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(asDict(raw) ?? {})) {
    const parsed = map(v)
    if (parsed != null) out[k] = parsed
  }
  return out
}

const METRICS: DuelMetric[] = ['distance', 'pace', 'count', 'best_effort']

export function parseDuel(id: string, raw: unknown): Duel | null {
  const row = asDict(raw)
  if (!row) return null
  const metric = METRICS.includes(row.metric as DuelMetric) ? (row.metric as DuelMetric) : 'distance'
  const approvalRow = asDict(row.approval)
  const status = text(approvalRow?.status)
  const resultRow = asDict(row.result)
  return {
    id,
    title: text(row.title) || 'Thách đấu',
    description: text(row.description),
    createdBy: text(row.createdBy),
    createdByName: text(row.createdByName),
    createdAt: num(row.createdAt),
    metric,
    kind: row.kind === 'ranking' ? 'ranking' : 'target',
    single: row.single === true,
    target: num(row.target),
    minKm: num(row.minKm),
    paceMin: num(row.paceMin) > 0 ? num(row.paceMin) : undefined,
    paceMax: num(row.paceMax) > 0 ? num(row.paceMax) : undefined,
    winnerCount: Math.max(1, Math.floor(num(row.winnerCount, 1))),
    startDate: text(row.startDate),
    endDate: text(row.endDate),
    startAt: num(row.startAt),
    endAt: num(row.endAt),
    joinUntil: num(row.joinUntil),
    joinDays: num(row.joinDays),
    stakeText: text(row.stakeText),
    fundAmount: Math.max(0, num(row.fundAmount)),
    hasPassword: row.hasPassword === true,
    invited: Object.entries(asDict(row.invited) ?? {})
      .filter(([, v]) => v === true)
      .map(([uid]) => uid),
    approval: {
      status: status === 'approved' || status === 'rejected' ? status : 'pending',
      by: text(approvalRow?.by) || undefined,
      at: num(approvalRow?.at) || undefined,
      reason: text(approvalRow?.reason) || undefined,
    },
    participants: dictOf(row.participants, (v) => {
      const p = asDict(v)
      return p ? { name: text(p.name), joinedAt: num(p.joinedAt) } : null
    }),
    declined: dictOf(row.declined, (v) => (Number.isFinite(Number(v)) ? Number(v) : null)),
    withdrawRequests: dictOf(row.withdrawRequests, (v) => {
      const w = asDict(v)
      return w ? { at: num(w.at), reason: text(w.reason) } : null
    }),
    result: resultRow
      ? {
          lockedAt: num(resultRow.lockedAt),
          lockedBy: text(resultRow.lockedBy),
          size: num(resultRow.size),
          rows: dictOf(resultRow.rows, (v) => {
            const r = asDict(v)
            if (!r) return null
            const value = r.value == null ? null : num(r.value)
            const at = r.at == null ? null : num(r.at)
            return { name: text(r.name), value, at, rank: num(r.rank), won: r.won === true }
          }),
        }
      : null,
    stakeDone: dictOf(row.stakeDone, (v) => {
      const s = asDict(v)
      return s ? { at: num(s.at), by: text(s.by) } : null
    }),
    fundPayments: dictOf(row.fundPayments, (v) => {
      const f = asDict(v)
      return f
        ? {
            amount: num(f.amount),
            code: text(f.code),
            confirmedAt: num(f.confirmedAt),
            confirmedBy: text(f.confirmedBy),
          }
        : null
    }),
  }
}

export function parseDuels(raw: unknown): Duel[] {
  return Object.entries(asDict(raw) ?? {})
    .flatMap(([id, v]) => {
      const duel = parseDuel(id, v)
      return duel ? [duel] : []
    })
    .sort((a, b) => b.startAt - a.startAt || b.createdAt - a.createdAt)
}

export function duelPhase(duel: Duel, now = Date.now()): DuelPhase {
  if (duel.approval.status === 'rejected') return 'rejected'
  if (duel.approval.status === 'pending') return now >= duel.startAt ? 'expired' : 'pending'
  if (now < duel.startAt) return 'upcoming'
  if (now < duel.endAt) return 'ongoing'
  return 'finished'
}

export const DUEL_PHASE_LABELS: Record<DuelPhase, string> = {
  pending: 'Chờ duyệt',
  rejected: 'Bị từ chối',
  expired: 'Hết hạn duyệt',
  upcoming: 'Sắp diễn ra',
  ongoing: 'Đang diễn ra',
  finished: 'Đã kết thúc',
}

export const DUEL_METRIC_LABELS: Record<DuelMetric, string> = {
  distance: 'Cự ly',
  pace: 'Cự ly + pace',
  count: 'Số hoạt động',
  best_effort: 'Hoạt động nhanh nhất',
}

export function isJoinOpen(duel: Duel, now = Date.now()): boolean {
  return duel.approval.status === 'approved' && now < duel.joinUntil
}

/** Thời điểm hết hạn tham gia: 0 = trước khi bắt đầu; n = hết ngày thứ n của thách đấu */
export function joinUntilFor(startAt: number, endAt: number, joinDays: number): number {
  return joinDays > 0 ? Math.min(endAt, startAt + joinDays * DAY_MS) : startAt
}

/** Khoảng thời gian dd-mm-yyyy → mốc ms (giờ VN) để quy tắc Firebase so với `now` */
export function duelTimes(startDate: string, endDate: string): { startAt: number; endAt: number } | null {
  const startAt = parseChallengeDayStartMs(startDate)
  const endAt = parseChallengeDayEndInclusiveMs(endDate)
  return startAt != null && endAt != null && endAt > startAt ? { startAt, endAt } : null
}

export function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(ms)
}

/** Giờ hoàn thành: "06:42:10" (thách đấu 1 ngày) hoặc "06:42:10 17/10" */
export function formatDuelTime(duel: Pick<Duel, 'startDate' | 'endDate'>, ms: number): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...(duel.startDate === duel.endDate ? {} : { day: '2-digit', month: '2-digit' }),
  }).format(ms)
}

/** `joinUntil` là mốc 00:00 ngày kế tiếp (không tính), hiển thị thành 23:59 ngày cuối được tham gia */
export function formatJoinDeadline(joinUntil: number): string {
  return formatDateTime(joinUntil - 60_000)
}

/** "16-10-2026" (thách đấu 1 ngày) hoặc "16-10-2026 → 20-10-2026" */
export function duelDateText(duel: Pick<Duel, 'startDate' | 'endDate'>): string {
  return duel.startDate === duel.endDate ? duel.startDate : `${duel.startDate} → ${duel.endDate}`
}

function km(n: number): string {
  return `${Number(n.toFixed(2))} km`
}

/** Khoảng pace (phút/km) được tính; mặc định 03:30–15:00 như thử thách CLB */
export function duelPaceRange(duel: Pick<Duel, 'paceMin' | 'paceMax'>): [number, number] {
  return [duel.paceMin ?? MIN_PACE, duel.paceMax ?? MAX_PACE]
}

/** Một dòng tóm tắt mục tiêu: "Đạt 100 km" / "Ai chạy nhiều km nhất" */
export function duelGoalText(duel: Duel): string {
  const [paceMin, paceMax] = duelPaceRange(duel)
  const paceRange =
    paceMin !== MIN_PACE || paceMax !== MAX_PACE
      ? ` (pace ${formatPaceMinutes(paceMin)}–${formatPaceMinutes(paceMax)})`
      : ''
  const singleRun = duel.single && (duel.metric === 'distance' || duel.metric === 'pace')
  const span = duel.startDate === duel.endDate ? ' trong ngày' : ' tích lũy'
  if (duel.kind === 'target') {
    if (singleRun) return `Một hoạt động ≥ ${km(duel.target)}${paceRange}`
    switch (duel.metric) {
      case 'distance':
        return `Chạy tổng ${km(duel.target)}${span}`
      case 'pace':
        return `Chạy tổng ${km(duel.target)}${span}${paceRange}`
      case 'count':
        return `${duel.target} hoạt động, mỗi hoạt động ≥ ${km(duel.minKm)}`
      case 'best_effort':
        return `Một hoạt động ≥ ${km(duel.minKm)} với pace ≤ ${formatPaceMinutes(duel.target)}`
    }
  }
  const top = duel.winnerCount > 1 ? `${duel.winnerCount} người` : 'Ai'
  if (singleRun) return `${top} có hoạt động dài nhất${paceRange}`
  switch (duel.metric) {
    case 'distance':
      return `${top} chạy nhiều km nhất`
    case 'pace':
      return `${top} chạy nhiều km nhất${paceRange}`
    case 'count':
      return `${top} có nhiều hoạt động nhất (mỗi hoạt động ≥ ${km(duel.minKm)})`
    case 'best_effort':
      return `${top} có hoạt động ≥ ${km(duel.minKm)} nhanh nhất${paceRange}`
  }
}

/** Cách xác định người thắng, dùng cho luật chơi và gợi ý trên form */
export function duelWinRule(duel: Pick<Duel, 'kind' | 'metric' | 'winnerCount'>): string {
  const who = duel.winnerCount > 1 ? `${duel.winnerCount} người` : 'người'
  if (duel.metric === 'best_effort') {
    return duel.kind === 'target'
      ? `Trong những người đạt mục tiêu, ${who} nhanh nhất thắng; cùng pace thì ai chạy xong sớm hơn xếp trên.`
      : `Hết ngày xếp hạng theo pace, ${who} nhanh nhất thắng; cùng pace thì ai chạy xong sớm hơn xếp trên.`
  }
  return duel.kind === 'target'
    ? `${who.charAt(0).toUpperCase()}${who.slice(1)} đạt mục tiêu sớm nhất thắng.`
    : `Hết ngày xếp hạng, ${who} đứng đầu thắng; bằng thành tích thì ai đạt sớm hơn xếp trên.`
}

export function duelRules(duel: Duel): string[] {
  const rules = [
    duel.startDate === duel.endDate
      ? `Ngày diễn ra: ${duel.startDate} (00:00–23:59).`
      : `Thời gian: ${duel.startDate} → ${duel.endDate}.`,
    duelWinRule(duel),
    'Thời điểm hoàn thành = giờ bắt đầu + tổng thời gian của hoạt động trên Strava.',
    'Chỉ tính hoạt động chạy/đi bộ đồng bộ từ Strava trong thời gian thách đấu.',
  ]
  const [paceMin, paceMax] = duelPaceRange(duel)
  rules.push(
    `Chỉ tính hoạt động có pace trung bình từ ${formatPaceMinutes(paceMin)} đến ${formatPaceMinutes(paceMax)} phút/km.`,
  )
  if (duel.metric === 'best_effort') {
    rules.push('Pace tính theo pace trung bình của cả hoạt động.')
  } else if (duel.single && duel.metric !== 'count') {
    rules.push('Chỉ tính một hoạt động dài nhất, không cộng dồn các hoạt động.')
  } else if (duel.minKm > 0) {
    rules.push(`Mỗi hoạt động phải ≥ ${km(duel.minKm)} mới được tính.`)
  }
  rules.push(`Hạn tham gia: ${formatJoinDeadline(duel.joinUntil)}.`)
  rules.push('Người tham gia muốn rút lui phải được người tạo đồng ý.')
  return rules
}

/**
 * Thành tích và thời điểm đạt được (ms, giờ kết thúc hoạt động). `at` là lúc đạt mục tiêu
 * (kiểu đạt mục tiêu, khi đã đạt), còn lại là lúc đạt thành tích hiện tại.
 * `value` null khi chưa có hoạt động hợp lệ (hoạt động nhanh nhất).
 */
export type DuelScore = { value: number | null; at: number | null }

function clockSeconds(value: string): number {
  const parts = value.trim().split(':').map(Number)
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return 0
  return parts.reduce((total, n) => total * 60 + n, 0)
}

/** `startDate` "dd-mm-yyyy HH:MM:SS" (giờ VN) + thời gian trôi qua (elapsed, thiếu thì moving) */
function activityEndMs(activity: Record<string, unknown>): number | null {
  const [day = '', time = ''] = String(activity.startDate ?? '').trim().split(' ')
  const dayMs = parseChallengeDayStartMs(day)
  if (dayMs == null) return null
  const duration = clockSeconds(String(activity.elapsedTime ?? '')) || clockSeconds(String(activity.movingTime ?? ''))
  return dayMs + (clockSeconds(time) + duration) * 1000
}

type DuelActivity = { distance: number; pace: number; endMs: number }

/** Hoạt động hợp lệ trong thời gian thách đấu, sắp theo giờ kết thúc */
function duelActivities(duel: Duel, activities: Record<string, unknown>[], minKm: number): DuelActivity[] {
  const start = parseChallengeDayStartMs(duel.startDate)
  const end = parseChallengeDayStartMs(duel.endDate)
  if (start == null || end == null) return []
  const [paceMin, paceMax] = duelPaceRange(duel)
  const out: DuelActivity[] = []
  for (const a of activities) {
    if (!ELIGIBLE_ACTIVITY_TYPES.has(String(a.type ?? ''))) continue
    const distance = Number(a.distance)
    if (!(distance > 0 && distance >= minKm)) continue
    const dayMs = activityDayMs(String(a.startDate ?? ''))
    if (dayMs == null || dayMs < start || dayMs > end) continue
    const pace = convertPaceToMinutesPerKm(String(a.pace ?? ''))
    if (pace < paceMin || pace > paceMax) continue
    const endMs = activityEndMs(a)
    if (endMs != null) out.push({ distance, pace, endMs })
  }
  return out.sort((a, b) => a.endMs - b.endMs)
}

function round2(n: number): number {
  return Number(n.toFixed(2))
}

/** Đạt mục tiêu của kiểu "đạt mục tiêu" (hoạt động nhanh nhất: pace ≤ mục tiêu) */
export function duelReached(duel: Duel, value: number | null | undefined): boolean {
  if (duel.kind !== 'target' || value == null) return false
  return duel.metric === 'best_effort' ? value <= duel.target + 1e-9 : value >= duel.target - 1e-9
}

export function computeDuelScore(duel: Duel, activities: Record<string, unknown>[]): DuelScore {
  if (duel.metric === 'best_effort') {
    let best: DuelActivity | null = null
    for (const a of duelActivities(duel, activities, duel.minKm)) {
      if (!best || a.pace < best.pace) best = a
    }
    return best ? { value: best.pace, at: best.endMs } : { value: null, at: null }
  }
  if (duel.single && duel.metric !== 'count') {
    const list = duelActivities(duel, activities, 0)
    let longest: DuelActivity | null = null
    for (const a of list) {
      if (!longest || a.distance > longest.distance) longest = a
    }
    if (!longest) return { value: 0, at: null }
    const value = round2(longest.distance)
    const done = duelReached(duel, value) ? list.find((a) => duelReached(duel, round2(a.distance))) : undefined
    return { value, at: (done ?? longest).endMs }
  }
  let total = 0
  let at: number | null = null
  let doneAt: number | null = null
  for (const a of duelActivities(duel, activities, duel.minKm > 0 ? duel.minKm : MIN_DISTANCE_KM)) {
    total += duel.metric === 'count' ? 1 : a.distance
    at = a.endMs
    if (doneAt == null && duelReached(duel, round2(total))) doneAt = a.endMs
  }
  return { value: round2(total), at: doneAt ?? at }
}

export function formatDuelValue(duel: Duel, value: number | null | undefined): string {
  if (value === undefined) return '…'
  if (duel.metric === 'best_effort') return value == null ? 'Chưa có' : `${formatPaceMinutes(value)}/km`
  if (duel.metric === 'count') return `${value ?? 0} hoạt động`
  return km(value ?? 0)
}

/** % hoàn thành mục tiêu (chỉ kiểu đạt mục tiêu) */
export function duelPercent(duel: Duel, value: number | null | undefined): number {
  if (duel.kind !== 'target' || value == null || !(duel.target > 0)) return 0
  const pct = duel.metric === 'best_effort' ? (duel.target / value) * 100 : (value / duel.target) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
}

function earlier(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a == null) return 1
  if (b == null) return -1
  return a - b
}

/**
 * Âm khi `a` xếp trên `b`. Đạt mục tiêu xếp trên chưa đạt; cự ly đã đạt thì ai đạt sớm hơn xếp trên;
 * còn lại so thành tích (km nhiều hơn / pace nhanh hơn), bằng nhau thì ai đạt sớm hơn xếp trên.
 */
function compareScores(duel: Duel, a: DuelScore, b: DuelScore): number {
  const reachedA = duelReached(duel, a.value)
  const reachedB = duelReached(duel, b.value)
  if (reachedA !== reachedB) return reachedA ? -1 : 1
  if (reachedA && duel.metric !== 'best_effort') return earlier(a.at, b.at)
  if (a.value == null || b.value == null) return a.value == null ? (b.value == null ? 0 : 1) : -1
  const diff = duel.metric === 'best_effort' ? a.value - b.value : b.value - a.value
  return Math.abs(diff) > 1e-9 ? diff : earlier(a.at, b.at)
}

export type RankedRow = { uid: string; value: number | null; at: number | null; rank: number; won: boolean }

/** Xếp hạng (cùng thành tích và cùng thời điểm thì cùng hạng); `winnerCount` người đứng đầu thắng */
export function rankDuel(duel: Duel, scores: Record<string, DuelScore>): RankedRow[] {
  const sorted = Object.entries(scores).sort(([, a], [, b]) => compareScores(duel, a, b))
  let rank = 0
  return sorted.map(([uid, score], i) => {
    if (i === 0 || compareScores(duel, sorted[i - 1][1], score) !== 0) rank = i + 1
    const qualified =
      duel.kind === 'target'
        ? duelReached(duel, score.value)
        : score.value != null && (duel.metric === 'best_effort' || score.value > 0)
    return { uid, value: score.value, at: score.at, rank, won: qualified && rank <= duel.winnerCount }
  })
}

/** Số thách đấu đang chờ duyệt / sắp / đang diễn ra mà người này tạo hoặc tham gia */
export function activeDuelCount(duels: Duel[], uid: string, now = Date.now()): number {
  return duels.filter((d) => {
    const phase = duelPhase(d, now)
    return (phase === 'pending' || phase === 'upcoming' || phase === 'ongoing') && Boolean(d.participants[uid])
  }).length
}

export function stakeSummary(duel: Duel): string {
  const parts = []
  if (duel.stakeText) parts.push(duel.stakeText)
  if (duel.fundAmount > 0) parts.push(`góp quỹ CLB ${formatVnd(duel.fundAmount)}`)
  return parts.join(' · ')
}

/**
 * Thành tích trực tiếp của từng người tham gia, tính từ `users/{uid}/strava_activities`
 * (thành viên chính thức đọc được hoạt động của nhau). `undefined` khi đang tải.
 */
export function useDuelScores(duel: Duel | null, enabled: boolean): Record<string, DuelScore | undefined> {
  const key = enabled && duel ? Object.keys(duel.participants).sort().join(',') : ''
  const [activities, setActivities] = useState<Record<string, Record<string, unknown>[]>>({})

  useEffect(() => {
    if (!key) return
    const offs = key.split(',').map((uid) =>
      subscribeShared(
        `users/${uid}/strava_activities`,
        (value) => {
          const list = Object.values(asDict(value) ?? {}).filter(
            (v): v is Record<string, unknown> => asDict(v) != null,
          )
          setActivities((prev) => ({ ...prev, [uid]: list }))
        },
        60_000,
      ),
    )
    return () => offs.forEach((off) => off())
  }, [key])

  return useMemo(() => {
    const out: Record<string, DuelScore | undefined> = {}
    if (!duel || !key) return out
    for (const uid of key.split(',')) {
      const list = activities[uid]
      out[uid] = list ? computeDuelScore(duel, list) : undefined
    }
    return out
  }, [duel, key, activities])
}
