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

/** Parse "hh:mm:ss" or "h:mm:ss" / "mm:ss" into total seconds. Invalid → Infinity. */
export function timeToSeconds(time: string): number {
  const parts = time.trim().split(':').map((p) => Number(p))
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return Number.POSITIVE_INFINITY
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return Number.POSITIVE_INFINITY
}

export function formatRankTime(time: string): string {
  return time.trim() || '—'
}

export function parsePersonalRecord(
  raw: Record<string, unknown> | null | undefined,
): PersonalRecord | null {
  if (!raw || typeof raw !== 'object') return null
  return {
    fullMarathonTime: String(raw.fullMarathonTime ?? ''),
    halfMarathonTime: String(raw.halfMarathonTime ?? ''),
    isFullMarathonVerified: Boolean(raw.isFullMarathonVerified),
    isHalfMarathonVerified: Boolean(raw.isHalfMarathonVerified),
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
        return pr.isFullMarathonVerified && Boolean(pr.fullMarathonTime.trim())
      }
      return pr.isHalfMarathonVerified && Boolean(pr.halfMarathonTime.trim())
    })
    .sort((a, b) => {
      const ta =
        distance === 'FM'
          ? timeToSeconds(a.personalRecord.fullMarathonTime)
          : timeToSeconds(a.personalRecord.halfMarathonTime)
      const tb =
        distance === 'FM'
          ? timeToSeconds(b.personalRecord.fullMarathonTime)
          : timeToSeconds(b.personalRecord.halfMarathonTime)
      return ta - tb
    })
}

export function displayTime(athlete: AthletePrRow, distance: DistanceKey): string {
  return distance === 'FM'
    ? formatRankTime(athlete.personalRecord.fullMarathonTime)
    : formatRankTime(athlete.personalRecord.halfMarathonTime)
}
