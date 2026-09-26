export type DistanceKey = 'FM' | 'HM'
export type GenderKey = 'Nam' | 'Nữ'

export type PersonalRecord = {
  fullMarathonTime: string
  halfMarathonTime: string
  isFullMarathonVerified: boolean
  isHalfMarathonVerified: boolean
  submittedAt?: string
}

export type AthletePrRow = {
  id: string
  fullName: string
  email: string
  gender: string
  avatar: string
  level: number
  member: boolean
  personalRecord: PersonalRecord
}

function asBool(value: unknown): boolean {
  if (value === true || value === 1) return true
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    return v === 'true' || v === '1' || v === 'yes'
  }
  return false
}

/**
 * Parse marathon PR time to total seconds.
 * Accepts hh:mm:ss / h:mm:ss (and fullwidth ： or . as separators).
 * Invalid → +Infinity (sorts last).
 */
export function timeToSeconds(time: string): number {
  const normalized = time
    .trim()
    .replace(/[：﹒．]/g, ':')
    .replace(/[^\d:]/g, '')

  const parts = normalized.split(':').filter((p) => p.length > 0)
  if (parts.length !== 3) return Number.POSITIVE_INFINITY

  const hours = Number(parts[0])
  const minutes = Number(parts[1])
  const seconds = Number(parts[2])

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    hours < 0 ||
    minutes < 0 ||
    minutes >= 60 ||
    seconds < 0 ||
    seconds >= 60
  ) {
    return Number.POSITIVE_INFINITY
  }

  return hours * 3600 + minutes * 60 + seconds
}

/** Normalize display to hh:mm:ss (zero-padded). */
export function formatRankTime(time: string): string {
  const sec = timeToSeconds(time)
  if (!Number.isFinite(sec) || sec === Number.POSITIVE_INFINITY) {
    const raw = time.trim()
    return raw || '—'
  }
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function parsePersonalRecord(
  raw: Record<string, unknown> | null | undefined,
): PersonalRecord | null {
  if (!raw || typeof raw !== 'object') return null
  return {
    fullMarathonTime: String(raw.fullMarathonTime ?? '').trim(),
    halfMarathonTime: String(raw.halfMarathonTime ?? '').trim(),
    isFullMarathonVerified: asBool(raw.isFullMarathonVerified),
    isHalfMarathonVerified: asBool(raw.isHalfMarathonVerified),
    submittedAt: raw.submittedAt ? String(raw.submittedAt) : undefined,
  }
}

export function mapAthleteFromUser(
  id: string,
  data: Record<string, unknown>,
): AthletePrRow | null {
  const pr = parsePersonalRecord(
    data.personalRecord as Record<string, unknown> | undefined,
  )
  if (!pr) return null
  if (!pr.fullMarathonTime && !pr.halfMarathonTime) return null
  return {
    id,
    fullName: String(data.fullName ?? ''),
    email: String(data.email ?? ''),
    gender: String(data.gender ?? ''),
    avatar: String(data.avatar ?? ''),
    level: Number(data.level ?? 0) || 0,
    member: Boolean(data.member),
    personalRecord: pr,
  }
}

function prSeconds(athlete: AthletePrRow, distance: DistanceKey): number {
  const raw =
    distance === 'FM'
      ? athlete.personalRecord.fullMarathonTime
      : athlete.personalRecord.halfMarathonTime
  return timeToSeconds(raw)
}

export function rankAthletes(
  athletes: AthletePrRow[],
  distance: DistanceKey,
  gender: GenderKey,
): AthletePrRow[] {
  return athletes
    .filter((a) => a.gender === gender)
    .filter((a) => {
      const pr = a.personalRecord
      if (distance === 'FM') {
        return (
          pr.isFullMarathonVerified &&
          pr.fullMarathonTime.length > 0 &&
          Number.isFinite(timeToSeconds(pr.fullMarathonTime))
        )
      }
      return (
        pr.isHalfMarathonVerified &&
        pr.halfMarathonTime.length > 0 &&
        Number.isFinite(timeToSeconds(pr.halfMarathonTime))
      )
    })
    .sort((a, b) => {
      const ta = prSeconds(a, distance)
      const tb = prSeconds(b, distance)
      if (ta !== tb) return ta - tb
      return a.fullName.localeCompare(b.fullName, 'vi')
    })
}

export function displayTime(athlete: AthletePrRow, distance: DistanceKey): string {
  return distance === 'FM'
    ? formatRankTime(athlete.personalRecord.fullMarathonTime)
    : formatRankTime(athlete.personalRecord.halfMarathonTime)
}
