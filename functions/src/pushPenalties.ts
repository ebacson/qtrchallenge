import { getDatabase } from 'firebase-admin/database'
import * as logger from 'firebase-functions/logger'
import { sendPushToUid } from './fcmSend'
import {
  clearPushState,
  DAY_MS,
  getPushState,
  REMIND_7D_MS,
  setPushState,
} from './pushState'
import { parseChallenge, parseChallengeDayEndInclusiveMs } from './shared/challengeRules'
import { formatVnd, unpaidPenaltiesOf } from './shared/rewardPenalty'

/** Chỉ tự báo phạt mới (thử thách kết thúc trong N ngày gần đây), tránh spam nợ cũ */
const PENALTY_FIRST_NOTIFY_MAX_AGE_MS = 14 * DAY_MS

function asDict(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

/** Admin miễn phạt → báo người đó */
export async function onPenaltyPaymentWritten(
  challengeId: string,
  uid: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  if (!after) {
    // Hủy thanh toán / xóa node — không push
    return
  }
  const wasWaived = before?.waived === true
  const isWaived = after.waived === true
  if (isWaived && !wasWaived) {
    const challenge = asDict((await getDatabase().ref(`challenges/${challengeId}`).get()).val())
    const name = text(challenge?.name) || 'Thử thách'
    await sendPushToUid(uid, {
      title: 'Đã được miễn phạt',
      body: `Phạt thử thách “${name}” đã được miễn.`,
      url: '/rewards',
      tag: `penalty-waived-${challengeId}`,
    })
    await clearPushState(`penalty_${challengeId}_${uid}`)
    return
  }
  // Vừa ghi nhận nộp phạt (có node payment, không phải miễn)
  if (!before && !isWaived) {
    await clearPushState(`penalty_${challengeId}_${uid}`)
  }
}

/** Quét phạt chưa nộp: gửi lần đầu + lên lịch nhắc 7 ngày */
export async function scanUnpaidPenalties(now = Date.now()): Promise<{ first: number; skipped: number }> {
  const db = getDatabase()
  const [challengesSnap, usersSnap] = await Promise.all([
    db.ref('challenges').get(),
    db.ref('users').get(),
  ])
  const challenges = (challengesSnap.val() as Record<string, Record<string, unknown>> | null) ?? {}
  const users = asDict(usersSnap.val()) ?? {}
  let first = 0
  let skipped = 0

  for (const [uid, rawUser] of Object.entries(users)) {
    const user = asDict(rawUser)
    if (!user) continue
    const person = {
      member: user.member === true,
      memberSince: Number(user.memberSince) || undefined,
      memberUntil: Number(user.memberUntil) || undefined,
    }
    if (!person.member && !person.memberUntil) continue
    const unpaid = unpaidPenaltiesOf(challenges, uid, person)
    for (const item of unpaid) {
      const key = `penalty_${item.challengeId}_${uid}`
      const existing = await getPushState(key)
      if (existing) {
        skipped += 1
        continue
      }
      const rawChallenge = challenges[item.challengeId]
      const challenge = parseChallenge(item.challengeId, rawChallenge)
      const endMs = parseChallengeDayEndInclusiveMs(challenge.endDate) ?? 0
      if (!(endMs > 0) || now - endMs > PENALTY_FIRST_NOTIFY_MAX_AGE_MS) {
        // Nợ cũ: đánh dấu đã xử lý, không gửi
        await setPushState(key, {
          uid,
          kind: 'penalty',
          createdAt: now,
          remindedAt: now,
          meta: { challengeId: item.challengeId, skippedOld: true },
        })
        skipped += 1
        continue
      }
      const title = 'Phạt thử thách chưa nộp'
      const body = `“${item.name}”: ${formatVnd(item.amount)}.`
      const url = '/rewards'
      const tag = `penalty-${item.challengeId}-${uid}`
      await sendPushToUid(uid, { title, body, url, tag })
      await setPushState(key, {
        uid,
        kind: 'penalty',
        createdAt: now,
        remindAt: now + REMIND_7D_MS,
        title: 'Nhắc nộp phạt',
        body: `Bạn còn phạt “${item.name}”: ${formatVnd(item.amount)}.`,
        url,
        tag: `${tag}-remind`,
        meta: { challengeId: item.challengeId, amount: item.amount },
      })
      first += 1
    }
  }
  logger.info('scanUnpaidPenalties', { first, skipped })
  return { first, skipped }
}

export async function processPenaltyReminder(
  key: string,
  row: {
    uid: string
    title?: string
    body?: string
    url?: string
    tag?: string
    meta?: Record<string, string | number | boolean | null>
  },
): Promise<boolean> {
  const challengeId = String(row.meta?.challengeId ?? '')
  if (!challengeId) {
    await clearPushState(key)
    return false
  }
  const db = getDatabase()
  const [challengeSnap, userSnap] = await Promise.all([
    db.ref(`challenges/${challengeId}`).get(),
    db.ref(`users/${row.uid}`).get(),
  ])
  const challengeRaw = asDict(challengeSnap.val())
  const user = asDict(userSnap.val())
  if (!challengeRaw || !user) {
    await clearPushState(key)
    return false
  }
  if (asDict(challengeRaw.penaltyPayments)?.[row.uid]) {
    await clearPushState(key)
    return false
  }
  const unpaid = unpaidPenaltiesOf(
    { [challengeId]: challengeRaw as Record<string, unknown> },
    row.uid,
    {
      member: user.member === true,
      memberSince: Number(user.memberSince) || undefined,
      memberUntil: Number(user.memberUntil) || undefined,
    },
  )
  if (!unpaid.length) {
    await clearPushState(key)
    return false
  }
  const item = unpaid[0]
  await sendPushToUid(row.uid, {
    title: text(row.title) || 'Nhắc nộp phạt',
    body: text(row.body) || `“${item.name}”: ${formatVnd(item.amount)}.`,
    url: text(row.url) || '/rewards',
    tag: text(row.tag) || key,
  })
  return true
}
