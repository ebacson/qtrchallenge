import type { Challenge, ChallengeProgressResult } from '../types'

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
  if (challenge.status === STATUS_FINISHED) return 'Hạn đăng ký: đã hết'
  const deadline = joinDeadlineDate(challenge.startDate, challenge.joinDeadlineDays)
  if (!deadline) {
    return `Hạn đăng ký: ${challenge.joinDeadlineDays} ngày từ ngày bắt đầu`
  }
  const dateStr = formatDay(deadline)
  if (challenge.status === STATUS_UPCOMING) {
    return `Hạn đăng ký: đến ${dateStr} (${challenge.joinDeadlineDays} ngày sau khi bắt đầu)`
  }
  if (canJoin(challenge)) return `Hạn đăng ký: đến ${dateStr}`
  return `Hạn đăng ký: đã qua (${dateStr})`
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
): ChallengeProgressResult {
  let totalDistance = 0
  let totalActivities = 0
  let totalPace = 0

  for (const activity of activities) {
    const type = String(activity.type ?? '')
    if (!ELIGIBLE_ACTIVITY_TYPES.has(type)) continue

    const activityDateStr = String(activity.startDate ?? '')
    const distance = Number(activity.distance)
    const paceStr = String(activity.pace ?? '')
    if (!activityDateStr || Number.isNaN(distance) || distance < MIN_DISTANCE_KM) {
      continue
    }

    const dayMs = activityDayMs(activityDateStr)
    if (dayMs == null) continue

    const pace = convertPaceToMinutesPerKm(paceStr)
    if (pace < MIN_PACE || pace > MAX_PACE) continue

    if (dayMs >= startDate.getTime() && dayMs <= endDate.getTime()) {
      totalDistance += distance
      totalPace += pace
      totalActivities += 1
    }
  }

  return {
    totalDistanceKm: totalDistance,
    totalActivities,
    totalPaceMinutes: totalPace,
    hasEligibleActivities: totalActivities > 0,
  }
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
    userTarget: userData?.userTarget != null ? String(userData.userTarget) : undefined,
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
  const p = Number(String(progress).replace(/[^0-9.]/g, ''))
  const t = Number(String(target).replace(/[^0-9.]/g, ''))
  if (!t || Number.isNaN(p) || Number.isNaN(t)) return 0
  return Math.min(100, Math.round((p / t) * 100))
}
