import { parsePersonalRecord, timeToSeconds } from './prRanking'

export type RecordDistance = 'FM' | 'HM'

export const RECORD_FIELDS = {
  FM: {
    time: 'fullMarathonTime',
    flag: 'isFullMarathonVerified',
    label: 'Full Marathon (42 km)',
  },
  HM: {
    time: 'halfMarathonTime',
    flag: 'isHalfMarathonVerified',
    label: 'Half Marathon (21 km)',
  },
} as const

export type RecordStatus = {
  /** PR user khai (users/{uid}/…Time), hoặc PR trong personalRecord nếu chưa khai */
  submitted: string
  /** PR đang dùng cho Bảng vàng (personalRecord, đã xác thực) */
  approved: string
  verified: boolean
  pending: boolean
  validFormat: boolean
}

export function recordStatus(
  row: Record<string, unknown>,
  distance: RecordDistance,
): RecordStatus {
  const { time } = RECORD_FIELDS[distance]
  const pr = parsePersonalRecord(row.personalRecord as Record<string, unknown> | undefined)
  const prTime = distance === 'FM' ? pr?.fullMarathonTime ?? '' : pr?.halfMarathonTime ?? ''
  const prVerified =
    distance === 'FM' ? Boolean(pr?.isFullMarathonVerified) : Boolean(pr?.isHalfMarathonVerified)
  const submitted = String(row[time] ?? '').trim() || prTime
  const submittedSec = timeToSeconds(submitted)
  const validFormat = Number.isFinite(submittedSec)
  const approved = prVerified ? prTime : ''
  const verified =
    Boolean(submitted) && prVerified && timeToSeconds(prTime) === submittedSec
  return {
    submitted,
    approved,
    verified,
    pending: Boolean(submitted) && !verified,
    validFormat,
  }
}

export type HistoryEntry = {
  id: string
  content: string
  timestamp: string
  createdAt: number
}

export function parseHistory(raw: unknown): HistoryEntry[] {
  const val = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    Record<string, unknown>
  >
  return Object.entries(val)
    .map(([id, row]) => ({
      id,
      content: String(row?.content ?? ''),
      timestamp: String(row?.timestamp ?? ''),
      createdAt: Number(row?.createdAt ?? 0) || 0,
    }))
    .sort((a, b) => {
      const ta = a.createdAt || Number(a.id) || 0
      const tb = b.createdAt || Number(b.id) || 0
      return tb - ta
    })
}

export function formatHistoryTime(entry: HistoryEntry): string {
  const ms =
    entry.createdAt > 0
      ? entry.createdAt * (entry.createdAt < 1e12 ? 1000 : 1)
      : Number(entry.timestamp) || 0
  if (!ms) return entry.timestamp || ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return entry.timestamp || ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
