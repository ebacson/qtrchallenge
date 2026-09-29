import { parseChallengeDay, userDayQuotaProgress } from './challengeRules'
import type { Challenge } from '../types'

export const PENALTY_UNDER_HALF = 150_000
export const PENALTY_PARTIAL = 100_000
/** Thành viên chính thức không đăng ký tham gia thử thách */
export const PENALTY_NOT_JOINED = 50_000

/** Thưởng/phạt chỉ áp dụng cho thử thách bắt đầu từ năm này trở đi */
export const REWARD_START_YEAR = 2026

export function isRewardEligible(challenge: Challenge): boolean {
  const start = parseChallengeDay(challenge.startDate)
  return start !== null && start.getFullYear() >= REWARD_START_YEAR
}

export type CompletionTier = 'completed' | 'partial' | 'underHalf'

export type ParticipantCompletion = {
  done: number
  required: number
  unit: 'km' | 'ngày' | 'hoạt động'
  /** done/required, không giới hạn 1 (vượt mục tiêu > 1), không làm tròn */
  ratio: number
  tier: CompletionTier
  penalty: number
}

function extractNumber(value: unknown): number {
  const n = Number(String(value ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function tierFromRatio(ratio: number): CompletionTier {
  if (ratio >= 1) return 'completed'
  if (ratio >= 0.5) return 'partial'
  return 'underHalf'
}

export function penaltyForTier(tier: CompletionTier): number {
  if (tier === 'underHalf') return PENALTY_UNDER_HALF
  if (tier === 'partial') return PENALTY_PARTIAL
  return 0
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
  const tier = tierFromRatio(ratio)
  return { done, required, unit, ratio, tier, penalty: penaltyForTier(tier) }
}

export function formatVnd(amount: number): string {
  return `${amount.toLocaleString('vi-VN')}đ`
}

/** Phần trăm làm tròn xuống để 99,6% không hiển thị thành 100% */
export function completionPercent(ratio: number): number {
  return Math.floor(ratio * 100 + 1e-9)
}
