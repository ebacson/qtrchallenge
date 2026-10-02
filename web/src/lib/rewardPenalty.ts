import { parseChallengeDay, userDayQuotaProgress } from './challengeRules'
import type { Challenge, PenaltyTier } from '../types'

/** Mức phạt cho thử thách không tự đặt: dưới 50% phạt 150.000đ, 50% – dưới 100% phạt 100.000đ */
export const DEFAULT_PENALTY_TIERS: PenaltyTier[] = [
  { minPercent: 50, amount: 100_000 },
  { minPercent: 0, amount: 150_000 },
]

/** Thưởng/phạt chỉ áp dụng cho thử thách bắt đầu từ năm này trở đi */
export const REWARD_START_YEAR = 2026

export function isRewardEligible(challenge: Challenge): boolean {
  const start = parseChallengeDay(challenge.startDate)
  return start !== null && start.getFullYear() >= REWARD_START_YEAR
}

/** Thử thách không đặt mức phạt (kể cả thử thách cũ) thì không phạt */
export function penaltyTiersOf(challenge: Challenge): PenaltyTier[] {
  return challenge.penaltyTiers ?? []
}

/** Màu hiển thị: hoàn thành / mức phạt cao nhất về tỉ lệ / các mức thấp hơn */
export type CompletionTier = 'completed' | 'partial' | 'underHalf'

export type ParticipantCompletion = {
  done: number
  required: number
  unit: 'km' | 'ngày' | 'hoạt động'
  /** done/required, không giới hạn 1 (vượt mục tiêu > 1), không làm tròn */
  ratio: number
  tier: CompletionTier
  /** Vị trí trong mức phạt (giảm dần theo %); -1 khi hoàn thành */
  tierIndex: number
  penalty: number
}

function extractNumber(value: unknown): number {
  const n = Number(String(value ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function tierStyle(tierIndex: number, tierCount: number): CompletionTier {
  if (tierIndex < 0) return 'completed'
  return tierIndex === 0 && tierCount !== 1 ? 'partial' : 'underHalf'
}

/** Không có mức phạt: người chưa hoàn thành vào nhóm 0, không phạt */
export function penaltyForRatio(
  ratio: number,
  tiers: PenaltyTier[],
): { tierIndex: number; amount: number } {
  if (ratio >= 1) return { tierIndex: -1, amount: 0 }
  if (!tiers.length) return { tierIndex: 0, amount: 0 }
  const percent = ratio * 100
  const found = tiers.findIndex((t) => percent >= t.minPercent)
  const tierIndex = found >= 0 ? found : tiers.length - 1
  return { tierIndex, amount: tiers[tierIndex]?.amount ?? 0 }
}

/** "50% – dưới 100%" cho mức thứ `index` (danh sách giảm dần theo %) */
export function tierRangeLabel(tiers: PenaltyTier[], index: number): string {
  const upper = index === 0 ? 100 : tiers[index - 1].minPercent
  const min = index === tiers.length - 1 ? 0 : tiers[index].minPercent
  return min === 0 ? `Dưới ${upper}%` : `${min}% – dưới ${upper}%`
}

export function penaltySummary(tiers: PenaltyTier[]): string {
  if (!tiers.length) return 'Không đặt mức phạt'
  if (tiers.every((t) => t.amount === 0)) return 'Không phạt'
  return tiers
    .map((t, i) => `${tierRangeLabel(tiers, i)}: ${t.amount ? formatVnd(t.amount) : 'không phạt'}`)
    .join(' · ')
}

/** Tiến độ của một người tham gia; null nếu không xác định được mục tiêu. */
export function participantCompletion(
  challenge: Challenge,
  row: Record<string, unknown>,
): ParticipantCompletion | null {
  let done = 0
  let required = 0
  let unit: ParticipantCompletion['unit'] = 'km'

  const progress = String(row.progress ?? '')
  const dayMatch = progress.match(/^\s*(\d+)\s*\/\s*(\d+)\s*ngày/)

  if (challenge.challengeMode === 'day_quota') {
    const quota = userDayQuotaProgress(
      challenge.dayQuotaOptions,
      challenge.targetDistances,
      row,
    )
    unit = 'ngày'
    if (quota.length) {
      done = quota.reduce(
        (sum, q) => sum + Math.min(q.daysCompleted, q.option.daysRequired),
        0,
      )
      required = quota.reduce((sum, q) => sum + q.option.daysRequired, 0)
    } else if (dayMatch) {
      done = Number(dayMatch[1])
      required = Number(dayMatch[2])
    }
  } else if (challenge.challengeMode === 'activity_count' && challenge.requiredActivities) {
    unit = 'hoạt động'
    done = extractNumber(row.totalactiviti)
    required = challenge.requiredActivities
  } else if (dayMatch) {
    unit = 'ngày'
    done = Number(dayMatch[1])
    required = Number(dayMatch[2])
  } else {
    done = extractNumber(progress)
    required = extractNumber(row.userTarget)
  }

  if (!(required > 0)) return null
  const ratio = done / required
  const tiers = penaltyTiersOf(challenge)
  const { tierIndex, amount } = penaltyForRatio(ratio, tiers)
  return {
    done,
    required,
    unit,
    ratio,
    tier: tierStyle(tierIndex, tiers.length),
    tierIndex,
    penalty: amount,
  }
}

/**
 * Người hoàn thành mục tiêu `target`. Thử thách khoảng ngày: đủ số ngày của đúng tùy chọn đó
 * (người chọn nhiều tùy chọn có thể vào nhiều lượt quay); loại khác: chọn mục tiêu này và đạt 100%.
 */
export function rewardCandidates(
  challenge: Challenge,
  userChallenges: Record<string, Record<string, unknown> | null>,
  target: string,
): string[] {
  const targetIndex = challenge.targetDistances.indexOf(target)
  const out: string[] = []
  for (const [uid, row] of Object.entries(userChallenges)) {
    if (!row) continue
    if (challenge.challengeMode === 'day_quota' && challenge.dayQuotaOptions?.length) {
      const q = userDayQuotaProgress(
        challenge.dayQuotaOptions,
        challenge.targetDistances,
        row,
      ).find((p) => p.optionIndex === targetIndex)
      if (q && q.daysCompleted >= q.option.daysRequired) out.push(uid)
      continue
    }
    if (String(row.userTarget ?? '') !== target) continue
    const c = participantCompletion(challenge, row)
    if (c && c.ratio >= 1) out.push(uid)
  }
  return out.sort()
}

function randomIndex(maxExclusive: number): number {
  const buf = new Uint32Array(1)
  // Loại phần dư để mọi chỉ số có xác suất như nhau
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive
  do {
    crypto.getRandomValues(buf)
  } while (buf[0] >= limit)
  return buf[0] % maxExclusive
}

/** Quay ngẫu nhiên `gifts` người (đủ quà thì tất cả trúng). */
export function drawWinners(candidates: string[], gifts: number): string[] {
  const pool = [...candidates]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1)
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, Math.max(0, Math.min(gifts, pool.length)))
}

export function pickRandom<T>(list: T[]): T | undefined {
  return list.length ? list[randomIndex(list.length)] : undefined
}

export function formatVnd(amount: number): string {
  return `${amount.toLocaleString('vi-VN')}đ`
}

/** Phần trăm làm tròn xuống để 99,6% không hiển thị thành 100% */
export function completionPercent(ratio: number): number {
  return Math.floor(ratio * 100 + 1e-9)
}
