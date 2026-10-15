import { useEffect, useMemo, useState } from 'react'
import {
  activityDayMs,
  calculateProgress,
  convertPaceToMinutesPerKm,
  ELIGIBLE_ACTIVITY_TYPES,
  formatPaceMinutes,
  MAX_PACE,
  MIN_PACE,
  parseChallengeDay,
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

export type DuelResultRow = { name: string; value: number | null; rank: number; won: boolean }

export type Duel = {
  id: string
  title: string
  description: string
  createdBy: string
  createdByName: string
  createdAt: number
  metric: DuelMetric
  kind: DuelKind
  /** km (cự ly, pace), số buổi (số buổi), pace phút/km (buổi nhanh nhất + đạt mục tiêu) */
  target: number
  /** Cự ly tối thiểu mỗi buổi; với "buổi nhanh nhất" là cự ly buổi chạy phải đạt */
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
            return { name: text(r.name), value, rank: num(r.rank), won: r.won === true }
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
  distance: 'Tổng cự ly',
  pace: 'Cự ly theo pace',
  count: 'Số buổi chạy',
  best_effort: 'Buổi nhanh nhất',
}

export function isJoinOpen(duel: Duel, now = Date.now()): boolean {
  return duel.approval.status === 'approved' && now < duel.joinUntil
}

/** Thời điểm hết hạn tham gia: hết ngày thứ `joinDays` tính từ ngày bắt đầu (0 = hết ngày đầu) */
export function joinUntilFor(startAt: number, endAt: number, joinDays: number): number {
  return Math.min(endAt, startAt + (joinDays + 1) * DAY_MS)
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

/** `joinUntil` là mốc 00:00 ngày kế tiếp (không tính), hiển thị thành 23:59 ngày cuối được tham gia */
export function formatJoinDeadline(joinUntil: number): string {
  return formatDateTime(joinUntil - 60_000)
}

function km(n: number): string {
  return `${Number(n.toFixed(2))} km`
}

/** Một dòng tóm tắt mục tiêu: "Đạt 100 km" / "Ai chạy nhiều km nhất" */
export function duelGoalText(duel: Duel): string {
  const paceRange =
    duel.paceMin && duel.paceMax
      ? ` (pace ${formatPaceMinutes(duel.paceMin)}–${formatPaceMinutes(duel.paceMax)})`
      : ''
  if (duel.kind === 'target') {
    switch (duel.metric) {
      case 'distance':
        return `Đạt ${km(duel.target)} tích lũy`
      case 'pace':
        return `Đạt ${km(duel.target)} tích lũy${paceRange}`
      case 'count':
        return `Chạy ${duel.target} buổi, mỗi buổi ≥ ${km(duel.minKm)}`
      case 'best_effort':
        return `Chạy một buổi ≥ ${km(duel.minKm)} với pace ≤ ${formatPaceMinutes(duel.target)}`
    }
  }
  const top = duel.winnerCount > 1 ? `${duel.winnerCount} người` : 'Ai'
  switch (duel.metric) {
    case 'distance':
      return `${top} chạy nhiều km nhất`
    case 'pace':
      return `${top} chạy nhiều km nhất${paceRange}`
    case 'count':
      return `${top} chạy nhiều buổi nhất (mỗi buổi ≥ ${km(duel.minKm)})`
    case 'best_effort':
      return `${top} có buổi ≥ ${km(duel.minKm)} nhanh nhất`
  }
}

export function duelRules(duel: Duel): string[] {
  const rules = [
    `Thời gian: ${duel.startDate} → ${duel.endDate}.`,
    duel.kind === 'target'
      ? 'Ai đạt mục tiêu là thắng; có thể nhiều người cùng thắng.'
      : duel.winnerCount > 1
        ? `Xếp hạng khi kết thúc: ${duel.winnerCount} người đứng đầu thắng, bằng thành tích thì cùng hạng.`
        : 'Xếp hạng khi kết thúc: người đứng đầu thắng, bằng thành tích thì cùng hạng.',
    'Chỉ tính hoạt động chạy/đi bộ đồng bộ từ Strava trong thời gian thách đấu.',
  ]
  if (duel.metric === 'pace' && duel.paceMin && duel.paceMax) {
    rules.push(
      `Chỉ tính buổi có pace từ ${formatPaceMinutes(duel.paceMin)} đến ${formatPaceMinutes(duel.paceMax)} phút/km.`,
    )
  } else {
    rules.push(
      `Buổi có pace ngoài ${formatPaceMinutes(MIN_PACE)}–${formatPaceMinutes(MAX_PACE)} phút/km không được tính.`,
    )
  }
  if (duel.metric === 'best_effort') {
    rules.push('Pace tính theo pace trung bình của cả buổi.')
  } else if (duel.minKm > 0) {
    rules.push(`Mỗi buổi phải ≥ ${km(duel.minKm)} mới được tính.`)
  }
  rules.push(`Hạn tham gia: ${formatJoinDeadline(duel.joinUntil)}.`)
  rules.push('Người tham gia muốn rút lui phải được người tạo đồng ý.')
  return rules
}

/** Thành tích từ danh sách hoạt động Strava; `null` khi chưa có buổi hợp lệ (buổi nhanh nhất) */
export function computeDuelValue(duel: Duel, activities: Record<string, unknown>[]): number | null {
  const start = parseChallengeDay(duel.startDate)
  const end = parseChallengeDay(duel.endDate)
  if (!start || !end) return null
  if (duel.metric === 'best_effort') {
    let best: number | null = null
    for (const a of activities) {
      if (!ELIGIBLE_ACTIVITY_TYPES.has(String(a.type ?? ''))) continue
      const distance = Number(a.distance)
      if (!(distance >= duel.minKm)) continue
      const dayMs = activityDayMs(String(a.startDate ?? ''))
      if (dayMs == null || dayMs < start.getTime() || dayMs > end.getTime()) continue
      const pace = convertPaceToMinutesPerKm(String(a.pace ?? ''))
      if (pace < MIN_PACE || pace > MAX_PACE) continue
      if (best == null || pace < best) best = pace
    }
    return best
  }
  const result = calculateProgress(activities, start, end, {
    minActivityDistanceKm: duel.minKm > 0 ? duel.minKm : undefined,
    paceMin: duel.metric === 'pace' ? duel.paceMin : undefined,
    paceMax: duel.metric === 'pace' ? duel.paceMax : undefined,
  })
  return duel.metric === 'count' ? result.totalActivities : Number(result.totalDistanceKm.toFixed(2))
}

export function formatDuelValue(duel: Duel, value: number | null | undefined): string {
  if (value === undefined) return '…'
  if (duel.metric === 'best_effort') return value == null ? 'Chưa có' : `${formatPaceMinutes(value)}/km`
  if (duel.metric === 'count') return `${value ?? 0} buổi`
  return km(value ?? 0)
}

/** % hoàn thành mục tiêu (chỉ kiểu đạt mục tiêu) */
export function duelPercent(duel: Duel, value: number | null | undefined): number {
  if (duel.kind !== 'target' || value == null || !(duel.target > 0)) return 0
  const pct = duel.metric === 'best_effort' ? (duel.target / value) * 100 : (value / duel.target) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
}

function better(duel: Duel, a: number | null, b: number | null): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return duel.metric === 'best_effort' ? a - b : b - a
}

export type RankedRow = { uid: string; value: number | null; rank: number; won: boolean }

/** Xếp hạng (bằng thành tích thì cùng hạng) và xác định người thắng */
export function rankDuel(duel: Duel, values: Record<string, number | null>): RankedRow[] {
  const sorted = Object.entries(values).sort(([, a], [, b]) => better(duel, a, b))
  let rank = 0
  return sorted.map(([uid, value], i) => {
    if (i === 0 || better(duel, sorted[i - 1][1], value) !== 0) rank = i + 1
    const hasValue = value != null && (duel.metric === 'best_effort' || value > 0)
    const won =
      duel.kind === 'target'
        ? value != null &&
          (duel.metric === 'best_effort' ? value <= duel.target + 1e-9 : value >= duel.target - 1e-9)
        : hasValue && rank <= duel.winnerCount
    return { uid, value, rank, won }
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
export function useDuelValues(duel: Duel | null, enabled: boolean): Record<string, number | null | undefined> {
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
    const out: Record<string, number | null | undefined> = {}
    if (!duel || !key) return out
    for (const uid of key.split(',')) {
      const list = activities[uid]
      out[uid] = list ? computeDuelValue(duel, list) : undefined
    }
    return out
  }, [duel, key, activities])
}
