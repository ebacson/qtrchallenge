import type {
  Challenge,
  ChallengeProgressResult,
  DayQuotaOption,
  PenaltyTier,
  RewardDraw,
  RewardTier,
  UserDayQuotaProgress,
} from '../types'

export const STATUS_UPCOMING = 'Sắp diễn ra'
export const STATUS_ONGOING = 'Đang diễn ra'
export const STATUS_FINISHED = 'Đã kết thúc'

export const ELIGIBLE_ACTIVITY_TYPES = new Set([
  'Run',
  'Walk',
  'TrailRun',
  'VirtualRun',
])

export const MIN_PACE = 3.5
export const MAX_PACE = 15.0
export const MIN_DISTANCE_KM = 1.0
export const DEFAULT_JOIN_DEADLINE_DAYS = 7

const TZ = 'Asia/Ho_Chi_Minh'

function parseDayParts(dayString: string): { y: number; m: number; d: number } | null {
  const parts = dayString.trim().split('-')
  if (parts.length !== 3) return null
  const d = Number(parts[0])
  const m = Number(parts[1])
  const y = Number(parts[2])
  if (!y || !m || !d) return null
  return { y, m, d }
}

/** Start of challenge day 00:00:00 in Asia/Ho_Chi_Minh as UTC ms */
export function parseChallengeDayStartMs(dayString: string): number | null {
  const p = parseDayParts(dayString)
  if (!p) return null
  // Approximate GMT+7 fixed offset (VN has no DST)
  const utcMs = Date.UTC(p.y, p.m - 1, p.d, 0, 0, 0) - 7 * 60 * 60 * 1000
  return utcMs
}

export function parseChallengeDayEndInclusiveMs(dayString: string): number | null {
  const start = parseChallengeDayStartMs(dayString)
  if (start == null) return null
  return start + 86_400_000
}

export function parseChallengeDay(dayString: string): Date | null {
  const ms = parseChallengeDayStartMs(dayString)
  return ms == null ? null : new Date(ms)
}

export function activityDayMs(startDateString: string): number | null {
  const day = startDateString.split(' ')[0] ?? startDateString
  return parseChallengeDayStartMs(day)
}

export function calculateStatus(
  startDateString: string,
  endDateString: string,
  now = Date.now(),
): string {
  const startMs = parseChallengeDayStartMs(startDateString)
  const endMs = parseChallengeDayEndInclusiveMs(endDateString)
  if (startMs == null || endMs == null) return STATUS_UPCOMING
  if (now < startMs) return STATUS_UPCOMING
  if (now >= startMs && now <= endMs) return STATUS_ONGOING
  return STATUS_FINISHED
}

export function joinDeadlineDaysFrom(dict: Record<string, unknown>): number {
  const raw = dict.joinDeadlineDays
  const days = typeof raw === 'number' ? raw : Number(raw)
  return days > 0 ? days : DEFAULT_JOIN_DEADLINE_DAYS
}

export function joinDeadlineDate(
  startDateString: string,
  joinDeadlineDays: number,
): Date | null {
  const start = parseChallengeDay(startDateString)
  if (!start) return null
  const d = new Date(start)
  d.setUTCDate(d.getUTCDate() + joinDeadlineDays)
  return d
}

export function formatDay(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .format(date)
    .replace(/\//g, '-')
}

export function canJoin(challenge: Challenge, now = new Date()): boolean {
  switch (challenge.status) {
    case STATUS_FINISHED:
      return false
    case STATUS_UPCOMING:
      return true
    case STATUS_ONGOING: {
      const start = parseChallengeDay(challenge.startDate)
      if (!start) return false
      const days = Math.floor(
        (now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000),
      )
      return days <= challenge.joinDeadlineDays
    }
    default:
      return true
  }
}

export function joinBlockedMessage(challenge: Challenge): string {
  if (challenge.status === STATUS_FINISHED) {
    return 'Thử thách đã kết thúc, không thể tham gia.'
  }
  const deadline = joinDeadlineDate(challenge.startDate, challenge.joinDeadlineDays)
  if (deadline) {
    return `Đã quá hạn đăng ký (hết hạn ${formatDay(deadline)}).`
  }
  return 'Đã quá hạn đăng ký.'
}

export function listDisplayText(challenge: Challenge): string {
  const rules = challengeRulesSummary(challenge)
  if (challenge.status === STATUS_FINISHED) {
    return rules ? `${rules} · Hạn đăng ký: đã hết` : 'Hạn đăng ký: đã hết'
  }
  const deadline = joinDeadlineDate(challenge.startDate, challenge.joinDeadlineDays)
  if (!deadline) {
    const join = `Hạn đăng ký: ${challenge.joinDeadlineDays} ngày từ ngày bắt đầu`
    return rules ? `${rules} · ${join}` : join
  }
  const dateStr = formatDay(deadline)
  let join: string
  if (challenge.status === STATUS_UPCOMING) {
    join = `Hạn đăng ký: đến ${dateStr} (${challenge.joinDeadlineDays} ngày sau khi bắt đầu)`
  } else if (canJoin(challenge)) {
    join = `Hạn đăng ký: đến ${dateStr}`
  } else {
    join = `Hạn đăng ký: đã qua (${dateStr})`
  }
  return rules ? `${rules} · ${join}` : join
}

export function challengeRulesSummary(challenge: Challenge): string {
  if (challenge.challengeMode === 'monthly_pace') {
    const pace =
      challenge.paceMinMinutes != null && challenge.paceMaxMinutes != null
        ? `pace ${formatPaceMinutes(challenge.paceMinMinutes)}–${formatPaceMinutes(challenge.paceMaxMinutes)}`
        : 'theo tháng'
    return `Tháng · ${pace}`
  }
  if (challenge.challengeMode === 'day_quota') {
    const total = challenge.totalDays ?? '?'
    const n = challenge.dayQuotaOptions?.length ?? 0
    return `${total} ngày · ${n} tùy chọn`
  }
  if (challenge.challengeMode === 'activity_count') {
    const n = challenge.requiredActivities ?? 0
    const d = challenge.minActivityDistanceKm ?? MIN_DISTANCE_KM
    return `${n} hoạt động ≥ ${d} km`
  }
  return ''
}

export type ChallengeGoal = {
  /** Index trong targetDistances / dayQuotaOptions */
  index: number
  title: string
  summary: string
  details: string[]
  /** Các mức km từng ngày hoạt động (tùy chọn km riêng) */
  kmList?: number[]
}

function formatKmVi(km: number): string {
  return formatKm(km).replace('.', ',')
}

/** Mô tả đầy đủ từng mục tiêu / tùy chọn để hiển thị cho người tham gia. */
export function challengeGoals(challenge: Challenge): ChallengeGoal[] {
  const period = `${challenge.startDate} → ${challenge.endDate}`
  const tolerance = formatKmVi(DAY_TARGET_TOLERANCE_KM)

  if (challenge.challengeMode === 'day_quota' && challenge.dayQuotaOptions?.length) {
    const total = challenge.totalDays ?? countInclusiveDays(challenge.startDate, challenge.endDate)
    return challenge.dayQuotaOptions.map((o, index) => {
      const days =
        o.daysRequired === total
          ? `Hoạt động đủ cả ${total}/${total} ngày (${period}).`
          : `Hoạt động đủ ${o.daysRequired} ngày bất kỳ trong ${total} ngày (${period}), liên tục hoặc ngắt quãng.`
      if (o.dailyKm?.length) {
        return {
          index,
          title: `Tùy chọn ${index + 1}`,
          summary: formatDayQuotaLabel(o.daysRequired, total, o.kmPerDay, o.dailyKm),
          details: [
            days,
            `Mỗi ngày cần 1 hoạt động có cự ly bằng một trong ${o.dailyKm.length} mức bên dưới (sai số ±${tolerance} km). Mỗi mức chỉ tính cho 1 ngày, không cần theo thứ tự.`,
          ],
          kmList: o.dailyKm,
        }
      }
      return {
        index,
        title: `Tùy chọn ${index + 1}`,
        summary: formatDayQuotaLabel(o.daysRequired, total, o.kmPerDay),
        details: [
          days,
          `Mỗi ngày cần 1 hoạt động có cự ly ${formatKmVi(o.kmPerDay)} km (chấp nhận ${formatKmVi(o.kmPerDay - DAY_TARGET_TOLERANCE_KM)}–${formatKmVi(o.kmPerDay + DAY_TARGET_TOLERANCE_KM)} km).`,
        ],
      }
    })
  }

  if (challenge.challengeMode === 'activity_count') {
    const n = challenge.requiredActivities ?? 0
    const d = challenge.minActivityDistanceKm ?? MIN_DISTANCE_KM
    return [
      {
        index: 0,
        title: 'Mục tiêu',
        summary: `${n} hoạt động ≥ ${formatKmVi(d)} km`,
        details: [`Hoàn thành ${n} hoạt động, mỗi hoạt động từ ${formatKmVi(d)} km trở lên (${period}).`],
      },
    ]
  }

  return challenge.targetDistances.map((label, index) => ({
    index,
    title: `Mục tiêu ${index + 1}`,
    summary: `${label} tích lũy`,
    details: [
      `Tổng cự ly các hoạt động hợp lệ đạt ${label} trong khoảng ${period}.`,
      `Chỉ tính hoạt động từ ${formatKmVi(MIN_DISTANCE_KM)} km trở lên.`,
    ],
  }))
}

/** Quy định chung áp dụng cho mọi mục tiêu của thử thách. */
export function challengeGeneralRules(challenge: Challenge): string[] {
  const paceMin = challenge.paceMinMinutes ?? MIN_PACE
  const paceMax = challenge.paceMaxMinutes ?? MAX_PACE
  const rules = [
    `Tính các hoạt động ${[...ELIGIBLE_ACTIVITY_TYPES].join(', ')} đồng bộ từ Strava.`,
    `Pace hợp lệ: ${formatPaceMinutes(paceMin)}–${formatPaceMinutes(paceMax)} phút/km.`,
    'Ngày tính theo giờ Việt Nam (GMT+7).',
  ]
  if (challenge.challengeMode === 'day_quota' && (challenge.dayQuotaOptions?.length ?? 0) > 1) {
    rules.push(
      'Được chọn một hoặc nhiều tùy chọn; mỗi tùy chọn tính tiến độ riêng.',
    )
  }
  return rules
}

export function countInclusiveDays(startDate: string, endDate: string): number {
  const a = parseChallengeDayStartMs(startDate)
  const b = parseChallengeDayStartMs(endDate)
  if (a == null || b == null || b < a) return 0
  return Math.floor((b - a) / 86_400_000) + 1
}

function formatKm(km: number): string {
  return Number.isInteger(km) ? String(km) : km.toFixed(1)
}

export function formatDayQuotaLabel(
  daysRequired: number,
  totalDays: number,
  kmPerDay: number,
  dailyKm?: number[],
  optionNumber?: number,
): string {
  const prefix = optionNumber != null ? `Tùy chọn ${optionNumber}: ` : ''
  if (dailyKm?.length) {
    const min = Math.min(...dailyKm)
    const max = Math.max(...dailyKm)
    const range = min === max ? `${formatKm(min)} km` : `${formatKm(min)}–${formatKm(max)} km`
    return `${prefix}${daysRequired}/${totalDays} ngày · km theo từng ngày (${range})`
  }
  return `${prefix}${daysRequired}/${totalDays} ngày · ${formatKm(kmPerDay)} km/ngày`
}

function parseDailyKm(raw: unknown): number[] | undefined {
  if (raw == null || typeof raw !== 'object') return undefined
  const values = Array.isArray(raw)
    ? raw
    : Object.entries(raw as Record<string, unknown>)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, v]) => v)
  const list = values.map((v) => Number(v))
  if (!list.length || list.some((n) => !Number.isFinite(n) || n <= 0)) return undefined
  return list
}

function parseIndexList(raw: unknown): number[] | undefined {
  if (raw == null || typeof raw !== 'object') return undefined
  const values = Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>)
  return values.map(Number).filter((n) => Number.isInteger(n) && n >= 0)
}

/** Tùy chọn user đã chọn khi tham gia (theo optionIndex, vị trí nhãn, hoặc nhãn cũ). */
export function resolveDayQuotaOption(
  options: DayQuotaOption[] | undefined,
  targetDistances: string[],
  userRow: Record<string, unknown> | undefined,
): DayQuotaOption | null {
  if (!userRow) return null
  const target = String(userRow.userTarget ?? '')
  const storedIndex = Number(userRow.optionIndex)
  const index =
    Number.isInteger(storedIndex) && storedIndex >= 0
      ? storedIndex
      : targetDistances.indexOf(target)
  if (options && index >= 0 && options[index]) return options[index]

  const daysRequired = Number(userRow.daysRequired)
  const kmPerDay = Number(userRow.kmPerDay)
  if (daysRequired > 0 && kmPerDay > 0) return { daysRequired, kmPerDay }
  return parseDayQuotaLabel(target)
}

export type DayQuotaSelection = {
  optionIndex: number
  label: string
  option: DayQuotaOption
}

/** Các tùy chọn user đã chọn: `optionIndexes` (nhiều), hoặc một tùy chọn như bản cũ. */
export function resolveUserDayQuotaOptions(
  options: DayQuotaOption[] | undefined,
  targetDistances: string[],
  userRow: Record<string, unknown> | undefined,
): DayQuotaSelection[] {
  if (!userRow) return []
  const indexes = parseIndexList(userRow.optionIndexes) ?? []
  const picked = [...new Set(indexes)]
    .filter((i) => options?.[i])
    .map((i) => ({
      optionIndex: i,
      label: targetDistances[i] ?? '',
      option: options![i],
    }))
  if (picked.length) return picked

  const single = resolveDayQuotaOption(options, targetDistances, userRow)
  if (!single) return []
  const optionIndex = options ? options.indexOf(single) : -1
  return [
    {
      optionIndex,
      label: targetDistances[optionIndex] ?? String(userRow.userTarget ?? ''),
      option: single,
    },
  ]
}

type StoredOptionResult = { daysCompleted: number; completedTargets?: number[] }

function parseOptionResults(raw: unknown): Map<number, StoredOptionResult> {
  const map = new Map<number, StoredOptionResult>()
  if (raw == null || typeof raw !== 'object') return map
  const rows = Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>)
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const optionIndex = Number(r.optionIndex)
    if (!Number.isInteger(optionIndex)) continue
    map.set(optionIndex, {
      daysCompleted: Number(r.daysCompleted) || 0,
      completedTargets: parseIndexList(r.completedTargets),
    })
  }
  return map
}

export function userDayQuotaProgress(
  options: DayQuotaOption[] | undefined,
  targetDistances: string[],
  userRow: Record<string, unknown> | undefined,
): UserDayQuotaProgress[] {
  const selections = resolveUserDayQuotaOptions(options, targetDistances, userRow)
  if (!userRow || !selections.length) return []
  const results = parseOptionResults(userRow.optionResults)
  return selections.map((s) => {
    const stored = results.get(s.optionIndex)
    if (stored) return { ...s, ...stored }
    // Dòng tham gia một tùy chọn trước khi có optionResults
    const legacyDone = selections.length === 1 ? Number(userRow.totalactiviti) || 0 : 0
    return {
      ...s,
      daysCompleted: legacyDone,
      completedTargets:
        selections.length === 1 ? parseIndexList(userRow.completedTargets) : undefined,
    }
  })
}

export function parseDayQuotaLabel(label: string): DayQuotaOption | null {
  const m = label.match(/(\d+)\s*\/\s*\d+\s*ngày\s*·\s*([\d.]+)\s*km/i)
  if (!m) return null
  const daysRequired = Number(m[1])
  const kmPerDay = Number(m[2])
  if (!Number.isFinite(daysRequired) || !Number.isFinite(kmPerDay)) return null
  return { daysRequired, kmPerDay }
}

export function parseDayQuotaOptions(
  raw: unknown,
): DayQuotaOption[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const list: DayQuotaOption[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const daysRequired = Number(o.daysRequired)
    const kmPerDay = Number(o.kmPerDay)
    const dailyKm = parseDailyKm(o.dailyKm)
    if (
      Number.isFinite(daysRequired) &&
      daysRequired > 0 &&
      Number.isFinite(kmPerDay) &&
      kmPerDay > 0
    ) {
      list.push(dailyKm ? { daysRequired, kmPerDay, dailyKm } : { daysRequired, kmPerDay })
    }
  }
  return list.length ? list : undefined
}

export function formatPaceMinutes(min: number): string {
  if (!Number.isFinite(min) || min < 0) return '—'
  const m = Math.floor(min)
  const s = Math.round((min - m) * 60)
  const ss = s === 60 ? 0 : s
  const mm = s === 60 ? m + 1 : m
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

export function parsePaceInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.includes(':')) {
    const pace = convertPaceToMinutesPerKm(trimmed)
    return pace < 0 ? null : pace
  }
  const n = Number(trimmed.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

export type ProgressOptions = {
  paceMin?: number
  paceMax?: number
  minActivityDistanceKm?: number
  /** Đếm ngày đạt đủ kmPerDay trong khoảng */
  kmPerDay?: number
  /** Km yêu cầu cho từng ngày hoạt động, không theo thứ tự ngày; ưu tiên hơn kmPerDay */
  dailyKm?: number[]
}

/** Sai số cho phép giữa cự ly một hoạt động và mức km đặt cho ngày. */
export const DAY_TARGET_TOLERANCE_KM = 0.1

function matchesDayTarget(km: number, target: number): boolean {
  return Math.abs(km - target) <= DAY_TARGET_TOLERANCE_KM + 1e-9
}

/**
 * Ghép ngày ↔ mức km: một ngày đạt một mức nếu có một hoạt động trong ngày có
 * cự ly bằng mức đó (± sai số); mỗi ngày chỉ dùng cho một mức. Trả về index các
 * mức đạt được (ghép cực đại).
 */
export function matchDayTargets(dayActivityKms: number[][], targets: number[]): number[] {
  const candidates = dayActivityKms.map((kms) =>
    targets.flatMap((t, i) => (kms.some((km) => matchesDayTarget(km, t)) ? [i] : [])),
  )
  const owner = new Array<number>(targets.length).fill(-1)

  const tryAssign = (day: number, seen: boolean[]): boolean => {
    for (const t of candidates[day]) {
      if (seen[t]) continue
      seen[t] = true
      if (owner[t] < 0 || tryAssign(owner[t], seen)) {
        owner[t] = day
        return true
      }
    }
    return false
  }

  candidates.forEach((_, day) => {
    tryAssign(day, new Array<boolean>(targets.length).fill(false))
  })
  return owner.flatMap((day, i) => (day >= 0 ? [i] : []))
}

export function convertPaceToMinutesPerKm(pace: string): number {
  const parts = pace.split(':')
  if (parts.length !== 2) return -1
  const minutes = Number(parts[0])
  const seconds = Number(parts[1])
  if (
    Number.isNaN(minutes) ||
    Number.isNaN(seconds) ||
    minutes < 0 ||
    seconds < 0 ||
    seconds >= 60
  ) {
    return -1
  }
  return minutes + seconds / 60
}

export function calculateProgress(
  activities: Record<string, unknown>[],
  startDate: Date,
  endDate: Date,
  options?: ProgressOptions,
): ChallengeProgressResult {
  const paceMin = options?.paceMin ?? MIN_PACE
  const paceMax = options?.paceMax ?? MAX_PACE
  const minDist = options?.minActivityDistanceKm ?? MIN_DISTANCE_KM
  const kmPerDay = options?.kmPerDay
  const dailyKm = options?.dailyKm
  const isDayQuota = kmPerDay != null || dailyKm != null

  let totalDistance = 0
  let totalActivities = 0
  let totalPace = 0
  const dayActivityKms = new Map<number, number[]>()

  for (const activity of activities) {
    const type = String(activity.type ?? '')
    if (!ELIGIBLE_ACTIVITY_TYPES.has(type)) continue

    const activityDateStr = String(activity.startDate ?? '')
    const distance = Number(activity.distance)
    const paceStr = String(activity.pace ?? '')
    if (!activityDateStr || Number.isNaN(distance)) continue

    // Day quota matches single activities against the day targets instead
    if (!isDayQuota && distance < minDist) continue

    const dayMs = activityDayMs(activityDateStr)
    if (dayMs == null) continue

    const pace = convertPaceToMinutesPerKm(paceStr)
    if (pace < paceMin || pace > paceMax) continue

    if (dayMs >= startDate.getTime() && dayMs <= endDate.getTime()) {
      totalDistance += distance
      totalPace += pace
      totalActivities += 1
      const kms = dayActivityKms.get(dayMs)
      if (kms) kms.push(distance)
      else dayActivityKms.set(dayMs, [distance])
    }
  }

  let daysCompleted: number | undefined
  let completedTargets: number[] | undefined
  if (dailyKm?.length) {
    completedTargets = matchDayTargets([...dayActivityKms.values()], dailyKm)
    daysCompleted = completedTargets.length
  } else if (kmPerDay != null && kmPerDay > 0) {
    daysCompleted = 0
    for (const kms of dayActivityKms.values()) {
      if (kms.some((km) => matchesDayTarget(km, kmPerDay))) daysCompleted += 1
    }
  }

  return {
    totalDistanceKm: totalDistance,
    totalActivities,
    totalPaceMinutes: totalPace,
    hasEligibleActivities: totalActivities > 0,
    daysCompleted,
    completedTargets,
  }
}

export function progressOptionsFromDict(
  dict: Record<string, unknown>,
): ProgressOptions | undefined {
  const paceMin =
    dict.paceMinMinutes != null ? Number(dict.paceMinMinutes) : NaN
  const paceMax =
    dict.paceMaxMinutes != null ? Number(dict.paceMaxMinutes) : NaN
  const minDist =
    dict.minActivityDistanceKm != null
      ? Number(dict.minActivityDistanceKm)
      : NaN
  const opts: ProgressOptions = {}
  if (Number.isFinite(paceMin) && paceMin > 0) opts.paceMin = paceMin
  if (Number.isFinite(paceMax) && paceMax > 0) opts.paceMax = paceMax
  if (Number.isFinite(minDist) && minDist > 0) opts.minActivityDistanceKm = minDist
  return Object.keys(opts).length ? opts : undefined
}

/** RTDB trả mảng (có thể lẫn null) hoặc object khóa số */
function listValues(raw: unknown): Record<string, unknown>[] {
  if (raw == null || typeof raw !== 'object') return []
  const values = Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>)
  return values.filter(
    (v): v is Record<string, unknown> => v != null && typeof v === 'object',
  )
}

function stringList(raw: unknown): string[] {
  if (raw == null || typeof raw !== 'object') return []
  const values = Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>)
  return values.filter((v): v is string => typeof v === 'string' && v.length > 0)
}

export function parsePenaltyTiers(raw: unknown): PenaltyTier[] | undefined {
  const list = listValues(raw).flatMap((o) => {
    const minPercent = Number(o.minPercent)
    const amount = Number(o.amount)
    if (!Number.isFinite(minPercent) || minPercent < 0 || minPercent >= 100) return []
    if (!Number.isFinite(amount) || amount < 0) return []
    return [{ minPercent, amount }]
  })
  return list.length ? list.sort((a, b) => b.minPercent - a.minPercent) : undefined
}

export function parseRewardTiers(raw: unknown): RewardTier[] | undefined {
  const list = listValues(raw).flatMap((o) => {
    const target = String(o.target ?? '')
    const gifts = Number(o.gifts)
    if (!target || !Number.isInteger(gifts) || gifts < 1) return []
    return [{ target, gifts, prize: String(o.prize ?? '') }]
  })
  return list.length ? list : undefined
}

export function parseRewardDraws(raw: unknown): RewardDraw[] | undefined {
  const list = listValues(raw).flatMap((o) => {
    const target = String(o.target ?? '')
    if (!target) return []
    return [
      {
        target,
        gifts: Number(o.gifts) || 0,
        prize: String(o.prize ?? ''),
        candidates: stringList(o.candidates),
        winners: stringList(o.winners),
        drawnAt: Number(o.drawnAt) || 0,
        drawnBy: String(o.drawnBy ?? ''),
      },
    ]
  })
  return list.length ? list : undefined
}

function parseChallengeMode(
  raw: unknown,
): Challenge['challengeMode'] {
  if (
    raw === 'monthly_pace' ||
    raw === 'activity_count' ||
    raw === 'day_quota' ||
    raw === 'distance'
  ) {
    return raw
  }
  return 'distance'
}

export function parseChallenge(
  id: string,
  dict: Record<string, unknown>,
  userId?: string | null,
): Challenge {
  const userChallenges = dict.user_challenges as
    | Record<string, Record<string, unknown>>
    | undefined
  const userData =
    userId && userChallenges ? userChallenges[userId] : undefined

  const startDate = String(dict.startDate ?? '')
  const endDate = String(dict.endDate ?? '')
  const computedStatus = calculateStatus(startDate, endDate)
  const paceMin = Number(dict.paceMinMinutes)
  const paceMax = Number(dict.paceMaxMinutes)
  const requiredActivities = Number(dict.requiredActivities)
  const minActivityDistanceKm = Number(dict.minActivityDistanceKm)
  const totalDaysRaw = Number(dict.totalDays)
  const dayQuotaOptions = parseDayQuotaOptions(dict.dayQuotaOptions)
  const totalDays =
    Number.isFinite(totalDaysRaw) && totalDaysRaw > 0
      ? totalDaysRaw
      : countInclusiveDays(startDate, endDate) || undefined

  const targetDistances = Array.isArray(dict.targetDistances)
    ? (dict.targetDistances as string[])
    : []
  const userDayQuota = userDayQuotaProgress(dayQuotaOptions, targetDistances, userData)

  return {
    id,
    name: String(dict.name ?? ''),
    description: String(dict.description ?? ''),
    startDate,
    endDate,
    status: computedStatus,
    targetDistances,
    icon: dict.icon ? String(dict.icon) : undefined,
    creator: dict.creator != null ? String(dict.creator) : undefined,
    password: dict.password ? String(dict.password) : undefined,
    joinDeadlineDays: joinDeadlineDaysFrom(dict),
    challengeMode: parseChallengeMode(dict.challengeMode),
    paceMinMinutes:
      Number.isFinite(paceMin) && paceMin > 0 ? paceMin : undefined,
    paceMaxMinutes:
      Number.isFinite(paceMax) && paceMax > 0 ? paceMax : undefined,
    requiredActivities:
      Number.isFinite(requiredActivities) && requiredActivities > 0
        ? requiredActivities
        : undefined,
    minActivityDistanceKm:
      Number.isFinite(minActivityDistanceKm) && minActivityDistanceKm > 0
        ? minActivityDistanceKm
        : undefined,
    totalDays,
    dayQuotaOptions,
    penaltyTiers: parsePenaltyTiers(dict.penaltyTiers),
    rewards: parseRewardTiers(dict.rewards),
    rewardDraws: parseRewardDraws(dict.rewardDraws),
    userTarget: userData?.userTarget != null ? String(userData.userTarget) : undefined,
    userDaysRequired: userDayQuota.length
      ? userDayQuota.reduce((sum, q) => sum + q.option.daysRequired, 0)
      : undefined,
    userDayQuota: userDayQuota.length ? userDayQuota : undefined,
    progress: userData?.progress != null ? String(userData.progress) : undefined,
    totalpace: userData?.totalpace != null ? String(userData.totalpace) : undefined,
    totalactiviti:
      userData?.totalactiviti != null ? String(userData.totalactiviti) : undefined,
  }
}

export function statusClass(status: string): string {
  switch (status) {
    case STATUS_ONGOING:
      return 'status-ongoing'
    case STATUS_UPCOMING:
      return 'status-upcoming'
    case STATUS_FINISHED:
      return 'status-finished'
    default:
      return ''
  }
}

export function progressPercent(progress?: string, target?: string): number {
  if (!progress || !target) return 0
  const dayMatch = String(progress).match(/(\d+)\s*\/\s*(\d+)/)
  if (dayMatch) {
    const a = Number(dayMatch[1])
    const b = Number(dayMatch[2])
    if (b > 0) return Math.min(100, Math.round((a / b) * 100))
  }
  const p = Number(String(progress).replace(/[^0-9.]/g, ''))
  const t = Number(String(target).replace(/[^0-9.]/g, ''))
  if (!t || Number.isNaN(p) || Number.isNaN(t)) return 0
  return Math.min(100, Math.round((p / t) * 100))
}

export function challengeProgressPercent(challenge: Challenge): number {
  if (challenge.challengeMode === 'day_quota' && challenge.userDayQuota?.length) {
    const done = challenge.userDayQuota.reduce((sum, q) => sum + q.daysCompleted, 0)
    const required = challenge.userDaysRequired ?? 0
    return required > 0 ? Math.min(100, Math.round((done / required) * 100)) : 0
  }
  if (
    challenge.challengeMode === 'activity_count' &&
    challenge.requiredActivities &&
    challenge.requiredActivities > 0
  ) {
    const n = Number(challenge.totalactiviti ?? 0) || 0
    return Math.min(
      100,
      Math.round((n / challenge.requiredActivities) * 100),
    )
  }
  return progressPercent(challenge.progress, challenge.userTarget)
}
