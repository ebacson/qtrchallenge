import type { RewardItem } from '../types'

/**
 * `lucky_draws/{id}`: chương trình quay số may mắn, tách riêng với quay thưởng thử thách.
 * Mọi người đăng nhập được đọc; Admin ghi; người dùng chỉ tự ghi `participants/{uid mình}` khi còn mở.
 */
export const LUCKY_DRAWS_PATH = 'lucky_draws'

/** open: đang nhận người tham gia; locked: đã chốt danh sách, đang quay; done: đã xác nhận kết quả */
export type LuckyDrawStatus = 'open' | 'locked' | 'done'

export type LuckyParticipant = {
  key: string
  name: string
  uid?: string
  avatar?: string
  source: 'self' | 'manual'
  addedAt: number
}

export type LuckyDraw = {
  id: string
  name: string
  note: string
  status: LuckyDrawStatus
  prizes: RewardItem[]
  participants: LuckyParticipant[]
  /** Danh sách được quay, chụp lại lúc chốt */
  candidates: string[]
  winners: string[]
  /** Tên và quà của từng người trúng, cùng thứ tự với winners */
  winnerNames: string[]
  winnerPrizes: string[]
  createdAt: number
  createdBy: string
  lockedAt?: number
  drawnAt?: number
  confirmedAt?: number
  confirmedBy?: string
}

function asDict(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

export function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const dict = asDict(value)
  if (!dict) return []
  return Object.entries(dict)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, v]) => v)
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function num(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function parsePrizes(raw: unknown): RewardItem[] {
  return asList(raw).flatMap((v) => {
    const row = asDict(v)
    const name = text(row?.name)
    const quantity = Math.max(0, Math.floor(Number(row?.quantity) || 0))
    return name && quantity ? [{ name, quantity }] : []
  })
}

export function parseLuckyDraw(id: string, raw: unknown): LuckyDraw | null {
  const row = asDict(raw)
  if (!row) return null
  const participants = Object.entries(asDict(row.participants) ?? {})
    .flatMap(([key, v]) => {
      const p = asDict(v)
      const name = text(p?.name)
      if (!p || !name) return []
      return [
        {
          key,
          name,
          uid: text(p.uid) || undefined,
          avatar: text(p.avatar) || undefined,
          source: p.source === 'self' ? ('self' as const) : ('manual' as const),
          addedAt: Number(p.addedAt) || 0,
        },
      ]
    })
    .sort((a, b) => a.addedAt - b.addedAt || a.name.localeCompare(b.name, 'vi'))
  const status: LuckyDrawStatus =
    row.status === 'done' ? 'done' : row.status === 'locked' ? 'locked' : 'open'
  return {
    id,
    name: text(row.name) || 'Quay số may mắn',
    note: text(row.note),
    status,
    prizes: parsePrizes(row.prizes),
    participants,
    candidates: asList(row.candidates).map(String),
    winners: asList(row.winners).map(String),
    winnerNames: asList(row.winnerNames).map(text),
    winnerPrizes: asList(row.winnerPrizes).map(text),
    createdAt: Number(row.createdAt) || 0,
    createdBy: text(row.createdBy),
    lockedAt: num(row.lockedAt),
    drawnAt: num(row.drawnAt),
    confirmedAt: num(row.confirmedAt),
    confirmedBy: text(row.confirmedBy) || undefined,
  }
}

export function parseLuckyDraws(raw: unknown): LuckyDraw[] {
  return Object.entries(asDict(raw) ?? {})
    .flatMap(([id, v]) => {
      const d = parseLuckyDraw(id, v)
      return d ? [d] : []
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

export const LUCKY_STATUS_LABELS: Record<LuckyDrawStatus, string> = {
  open: 'Đang nhận tham gia',
  locked: 'Đã chốt danh sách',
  done: 'Đã kết thúc',
}
