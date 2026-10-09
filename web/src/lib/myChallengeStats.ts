import { useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  parseChallenge,
  parseChallengeDay,
  STATUS_FINISHED,
  STATUS_UPCOMING,
} from './challengeRules'
import {
  absentPenaltyFor,
  applyPenaltyWaiver,
  countsAsOfficial,
  isRewardEligible,
  participantCompletion,
  type ParticipantCompletion,
} from './rewardPenalty'
import { useSharedValue } from './sharedValue'
import type { Challenge } from '../types'

export type MyPrize = { target: string; prize: string }

export type MyChallengeEntry = {
  challenge: Challenge
  year: number
  endMs: number
  joined: boolean
  completion: ParticipantCompletion | null
  /** Mức phải nộp (sau miễn phạt) */
  penalty: number
  /** Mức gốc (trước miễn phạt) */
  originalPenalty: number
  paid: boolean
  waived: boolean
  /** Phần thưởng trúng trong các lượt quay số của thử thách */
  prizes: MyPrize[]
}

/**
 * Thử thách (đã bắt đầu) của người dùng hiện tại kèm tiền phạt và phần thưởng, mới nhất trước.
 * `null` khi đang tải.
 */
export function useMyChallengeEntries(): MyChallengeEntry[] | null {
  const { user, profile } = useAuth()
  const raw = useSharedValue<Record<string, Record<string, unknown>>>(user ? 'challenges' : null)
  const isMember = Boolean(profile?.member)
  const memberSince = profile?.memberSince
  const memberUntil = profile?.memberUntil

  return useMemo(() => {
    if (!user) return []
    if (raw === undefined) return null
    const list: MyChallengeEntry[] = []
    for (const [id, val] of Object.entries(raw ?? {})) {
      const challenge = parseChallenge(id, val)
      if (challenge.status === STATUS_UPCOMING) continue
      const row = ((val.user_challenges ?? {}) as Record<string, Record<string, unknown> | null>)[
        user.uid
      ]
      const joined = row != null
      // Thưởng – phạt: thành viên chính thức (kể cả đã chuyển Tự do sau khi thử thách kết thúc),
      // thử thách đã kết thúc từ REWARD_START_YEAR
      const penalized =
        countsAsOfficial({ member: isMember, memberUntil }, challenge) &&
        challenge.status === STATUS_FINISHED &&
        isRewardEligible(challenge)
      const payment = challenge.penaltyPayments?.[user.uid]
      let completion: ParticipantCompletion | null = null
      let penalty = 0
      let originalPenalty = 0
      let waived = false

      if (joined) {
        completion = participantCompletion(challenge, row ?? {})
        if (completion && penalized) {
          completion = applyPenaltyWaiver(challenge, user.uid, completion)
          penalty = completion.penalty
          originalPenalty = completion.waived?.originalPenalty ?? completion.penalty
          waived = Boolean(completion.waived)
        }
      } else {
        if (!penalized) continue
        const absent = absentPenaltyFor(challenge, user.uid, memberSince)
        if (!(absent.originalPenalty > 0)) continue
        penalty = absent.penalty
        originalPenalty = absent.originalPenalty
        waived = Boolean(absent.waived)
      }

      const prizes: MyPrize[] = []
      for (const draw of challenge.rewardDraws ?? []) {
        draw.winners.forEach((uid, i) => {
          if (uid === user.uid) prizes.push({ target: draw.target, prize: draw.prizes[i] ?? '' })
        })
      }

      list.push({
        challenge,
        year: parseChallengeDay(challenge.startDate)?.getFullYear() ?? 0,
        endMs: parseChallengeDay(challenge.endDate)?.getTime() ?? 0,
        joined,
        completion,
        penalty,
        originalPenalty,
        paid: Boolean(payment) && !waived,
        waived,
        prizes,
      })
    }
    return list.sort((a, b) => b.endMs - a.endMs)
  }, [raw, user, isMember, memberSince, memberUntil])
}

/** Số thử thách và tổng tiền phạt người dùng hiện tại chưa nộp. */
export function useMyUnpaidPenalty(): { count: number; amount: number } {
  const entries = useMyChallengeEntries()
  return useMemo(() => {
    const unpaid = (entries ?? []).filter((e) => e.penalty > 0 && !e.paid)
    return { count: unpaid.length, amount: unpaid.reduce((sum, e) => sum + e.penalty, 0) }
  }, [entries])
}
