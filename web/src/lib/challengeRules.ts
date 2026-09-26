import type { Challenge, ChallengeProgressResult, DayQuotaOption } from '../types'

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

export function countInclusiveDays(startDate: string, endDate: string): number {
  const a = parseChallengeDayStartMs(startDate)
  const b = parseChallengeDayStartMs(endDate)
  if (a == null || b == null || b < a) return 0
  return Math.floor((b - a) / 86_400_000) + 1
}

export function formatDayQuotaLabel(
  daysRequired: number,
  totalDays: number,
  kmPerDay: number,
): string {
  const km = Number.isInteger(kmPerDay) ? String(kmPerDay) : kmPerDay.toFixed(1)
  return `${daysRequired}/${totalDays} ngày · ${km} km/ngày`
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
    if (
      Number.isFinite(daysRequired) &&
      daysRequired > 0 &&
      Number.isFinite(kmPerDay) &&
      kmPerDay > 0
    ) {
      list.push({ daysRequired, kmPerDay })
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

  let totalDistance = 0
  let totalActivities = 0
  let totalPace = 0
  const dayTotals = new Map<number, number>()

  for (const activity of activities) {
    const type = String(activity.type ?? '')
    if (!ELIGIBLE_ACTIVITY_TYPES.has(type)) continue

    const activityDateStr = String(activity.startDate ?? '')
    const distance = Number(activity.distance)
    const paceStr = String(activity.pace ?? '')
    if (!activityDateStr || Number.isNaN(distance)) continue

    // For day_quota, keep all distances in day bucket; filter day later by kmPerDay
    if (kmPerDay == null && distance < minDist) continue

    const dayMs = activityDayMs(activityDateStr)
    if (dayMs == null) continue

    const pace = convertPaceToMinutesPerKm(paceStr)
    if (pace < paceMin || pace > paceMax) continue

    if (dayMs >= startDate.getTime() && dayMs <= endDate.getTime()) {
      totalDistance += distance
      totalPace += pace
      totalActivities += 1
      dayTotals.set(dayMs, (dayTotals.get(dayMs) ?? 0) + distance)
    }
  }

  let daysCompleted: number | undefined
  if (kmPerDay != null && kmPerDay > 0) {
    daysCompleted = 0
    for (const km of dayTotals.values()) {
      if (km >= kmPerDay) daysCompleted += 1
    }
  }

  return {
    totalDistanceKm: totalDistance,
    totalActivities,
    totalPaceMinutes: totalPace,
    hasEligibleActivities: totalActivities > 0,
    daysCompleted,
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

  const userDaysRequired = Number(userData?.daysRequired)
  const userKmPerDay = Number(userData?.kmPerDay)
  const parsedFromTarget = userData?.userTarget
    ? parseDayQuotaLabel(String(userData.userTarget))
    : null

  return {
    id,
    name: String(dict.name ?? ''),
    description: String(dict.description ?? ''),
    startDate,
    endDate,
    status: computedStatus,
    targetDistances: Array.isArray(dict.targetDistances)
      ? (dict.targetDistances as string[])
      : [],
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
    userTarget: userData?.userTarget != null ? String(userData.userTarget) : undefined,
    userDaysRequired:
      Number.isFinite(userDaysRequired) && userDaysRequired > 0
        ? userDaysRequired
        : parsedFromTarget?.daysRequired,
    userKmPerDay:
      Number.isFinite(userKmPerDay) && userKmPerDay > 0
        ? userKmPerDay
        : parsedFromTarget?.kmPerDay,
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
  if (challenge.challengeMode === 'day_quota' && challenge.userDaysRequired) {
    const m = String(challenge.progress ?? '').match(/(\d+)\s*\//)
    const done = m ? Number(m[1]) : Number(challenge.totalactiviti ?? 0) || 0
    return Math.min(
      100,
      Math.round((done / challenge.userDaysRequired) * 100),
    )
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
