import { getDatabase } from 'firebase-admin/database'
import * as logger from 'firebase-functions/logger'
import { sendPushToUid, sendPushToUsers } from './fcmSend'
import { DAY_MS, getPushState, setPushState } from './pushState'
import {
  calculateStatus,
  parseChallengeDayEndInclusiveMs,
  parseChallengeDayStartMs,
  STATUS_ONGOING,
  STATUS_UPCOMING,
} from './shared/challengeRules'

/** Nhắc kết thúc khi còn ≤ N ngày (gửi một lần / user / thử thách) */
const END_SOON_DAYS = 3
/** Nhắc sắp bắt đầu trong khoảng này */
const START_SOON_MS = 1.5 * DAY_MS

function asDict(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value != null && typeof value === 'object') {
    return Object.keys(value as object)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => (value as Record<string, unknown>)[k])
  }
  return []
}

/** Thử thách mới → broadcast FCM */
export async function onChallengeCreated(
  challengeId: string,
  data: Record<string, unknown> | null,
): Promise<void> {
  if (!data) return
  const name = text(data.name) || 'Thử thách'
  const start = text(data.startDate)
  const body = start
    ? `“${name}” đã mở (bắt đầu ${start}) — xem và đăng ký.`
    : `“${name}” đã mở — xem và đăng ký.`
  const result = await sendPushToUsers({
    title: 'Thử thách mới',
    body,
    url: `/challenges/${challengeId}`,
    tag: `challenge-new-${challengeId}`,
  })
  logger.info('onChallengeCreated push', { challengeId, ...result })
}

/** Admin xác nhận quay thưởng → báo từng người trúng */
export async function onRewardDrawWritten(
  challengeId: string,
  index: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  if (!after) return
  const beforeConfirmed = Number(before?.confirmedAt) || 0
  const afterConfirmed = Number(after.confirmedAt) || 0
  if (!(afterConfirmed > 0) || beforeConfirmed > 0) return

  const winners = asList(after.winners).map((w) => String(w).trim()).filter(Boolean)
  const prizes = asList(after.prizes).map((p) => text(p))
  if (!winners.length) return

  const challenge = asDict((await getDatabase().ref(`challenges/${challengeId}`).get()).val())
  const name = text(challenge?.name) || 'Thử thách'
  const target = text(after.target)
  const url = target
    ? `/challenges/${challengeId}/draw?target=${encodeURIComponent(target)}`
    : `/challenges/${challengeId}/draw`

  let sent = 0
  for (let i = 0; i < winners.length; i++) {
    const prize = prizes[i] || 'phần thưởng'
    const r = await sendPushToUid(winners[i], {
      title: 'Trúng thưởng thử thách',
      body: `Bạn trúng “${prize}” ở “${name}”.`,
      url,
      tag: `reward-draw-${challengeId}-${index}-${winners[i]}`,
    })
    sent += r.sent
  }
  logger.info('onRewardDrawWritten push', { challengeId, index, winners: winners.length, sent })
}

/** Quét lịch thử thách: sắp bắt đầu / sắp kết thúc */
export async function scanChallengeCalendar(
  now = Date.now(),
): Promise<{ start: number; end: number; skipped: number }> {
  const db = getDatabase()
  const challenges =
    (asDict((await db.ref('challenges').get()).val()) as Record<
      string,
      Record<string, unknown>
    > | null) ?? {}

  let start = 0
  let end = 0
  let skipped = 0

  for (const [challengeId, raw] of Object.entries(challenges)) {
    const challenge = asDict(raw)
    if (!challenge) continue
    const name = text(challenge.name) || 'Thử thách'
    const startDate = text(challenge.startDate)
    const endDate = text(challenge.endDate)
    const status = calculateStatus(startDate, endDate, now)
    const url = `/challenges/${challengeId}`

    if (status === STATUS_UPCOMING) {
      const startMs = parseChallengeDayStartMs(startDate)
      if (startMs != null && startMs > now && startMs - now <= START_SOON_MS) {
        const key = `challenge_start_${challengeId}`
        if (await getPushState(key)) {
          skipped += 1
        } else {
          await sendPushToUsers({
            title: 'Thử thách sắp bắt đầu',
            body: `“${name}” bắt đầu ${startDate}.`,
            url,
            tag: `challenge-start-${challengeId}`,
          })
          await setPushState(key, {
            uid: '_broadcast',
            kind: 'challenge_start',
            createdAt: now,
            remindedAt: now,
            meta: { challengeId },
          })
          start += 1
        }
      }
    }

    if (status === STATUS_ONGOING) {
      const endMs = parseChallengeDayEndInclusiveMs(endDate)
      if (endMs == null || endMs <= now) continue
      const daysLeft = Math.ceil((endMs - now) / DAY_MS)
      if (daysLeft < 1 || daysLeft > END_SOON_DAYS) continue

      const participants = Object.keys(asDict(challenge.user_challenges) ?? {})
      for (const uid of participants) {
        const key = `challenge_end_${challengeId}_${uid}`
        if (await getPushState(key)) {
          skipped += 1
          continue
        }
        const dayLabel = daysLeft === 1 ? 'còn 1 ngày' : `còn ${daysLeft} ngày`
        await sendPushToUid(uid, {
          title: 'Thử thách sắp kết thúc',
          body: `“${name}” ${dayLabel}.`,
          url,
          tag: `challenge-end-${challengeId}`,
        })
        await setPushState(key, {
          uid,
          kind: 'challenge_end',
          createdAt: now,
          remindedAt: now,
          meta: { challengeId, daysLeft },
        })
        end += 1
      }
    }
  }

  logger.info('scanChallengeCalendar', { start, end, skipped })
  return { start, end, skipped }
}
