import { getDatabase } from 'firebase-admin/database'
import * as logger from 'firebase-functions/logger'
import { sendPushToUid } from './fcmSend'
import {
  clearPushState,
  getPushState,
  REMIND_7D_MS,
  setPushState,
} from './pushState'
import { formatVnd } from './shared/rewardPenalty'

function asDict(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function vnYear(now = Date.now()): number {
  return Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
    }).format(now),
  )
}

/** Ghi nhận nộp / miễn quỹ → báo thành viên; xóa nhắc unpaid */
export async function onDuesMemberWritten(
  year: string,
  uid: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  if (!after) return

  const wasWaived = before?.waived === true
  const isWaived = after.waived === true
  const amount = Number(after.amount)
  const key = `dues_${year}_${uid}`

  if (isWaived && !wasWaived) {
    await sendPushToUid(uid, {
      title: 'Đã được miễn quỹ',
      body: `Quỹ năm ${year} đã được miễn.`,
      url: '/finance',
      tag: `dues-waived-${year}`,
    })
    await clearPushState(key)
    return
  }

  if (!before && !isWaived && amount >= 0) {
    await sendPushToUid(uid, {
      title: 'Đã ghi nhận quỹ',
      body:
        amount > 0
          ? `Quỹ năm ${year}: ${formatVnd(amount)}.`
          : `Quỹ năm ${year} đã được ghi nhận.`,
      url: '/finance',
      tag: `dues-paid-${year}`,
    })
    await clearPushState(key)
  }
}

/** Quét thành viên chính thức chưa đóng quỹ năm hiện tại */
export async function scanUnpaidDues(
  now = Date.now(),
): Promise<{ first: number; skipped: number }> {
  const year = vnYear(now)
  const db = getDatabase()
  const [duesSnap, usersSnap] = await Promise.all([
    db.ref(`finance/dues/${year}`).get(),
    db.ref('users').get(),
  ])
  const dues = asDict(duesSnap.val())
  const settingsAmount = Number(asDict(dues?.settings)?.amount)
  if (!dues || !(settingsAmount >= 0)) {
    logger.info('scanUnpaidDues: no amount set', { year })
    return { first: 0, skipped: 0 }
  }

  const paid = asDict(dues.members) ?? {}
  const users = asDict(usersSnap.val()) ?? {}
  let first = 0
  let skipped = 0

  for (const [uid, rawUser] of Object.entries(users)) {
    const user = asDict(rawUser)
    if (!user || user.member !== true) continue
    if (paid[uid]) {
      skipped += 1
      continue
    }
    const key = `dues_${year}_${uid}`
    const existing = await getPushState(key)
    if (existing) {
      skipped += 1
      continue
    }
    const title = 'Nhắc đóng quỹ'
    const body =
      settingsAmount > 0
        ? `Bạn chưa đóng quỹ ${year} (${formatVnd(settingsAmount)}).`
        : `Bạn chưa đóng quỹ ${year}.`
    const url = '/finance'
    const tag = `dues-unpaid-${year}`
    await sendPushToUid(uid, { title, body, url, tag })
    await setPushState(key, {
      uid,
      kind: 'dues',
      createdAt: now,
      remindAt: now + REMIND_7D_MS,
      title: 'Nhắc đóng quỹ',
      body,
      url,
      tag: `${tag}-remind`,
      meta: { year, amount: settingsAmount },
    })
    first += 1
  }

  logger.info('scanUnpaidDues', { year, first, skipped })
  return { first, skipped }
}

export async function processDuesReminder(
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
  const year = String(row.meta?.year ?? '')
  if (!year) {
    await clearPushState(key)
    return false
  }
  const db = getDatabase()
  const [memberSnap, userSnap, settingsSnap] = await Promise.all([
    db.ref(`finance/dues/${year}/members/${row.uid}`).get(),
    db.ref(`users/${row.uid}`).get(),
    db.ref(`finance/dues/${year}/settings/amount`).get(),
  ])
  if (memberSnap.exists()) {
    await clearPushState(key)
    return false
  }
  const user = asDict(userSnap.val())
  if (!user || user.member !== true) {
    await clearPushState(key)
    return false
  }
  const amount = Number(settingsSnap.val())
  const body =
    text(row.body) ||
    (amount > 0
      ? `Bạn chưa đóng quỹ ${year} (${formatVnd(amount)}).`
      : `Bạn chưa đóng quỹ ${year}.`)
  await sendPushToUid(row.uid, {
    title: text(row.title) || 'Nhắc đóng quỹ',
    body,
    url: text(row.url) || '/finance',
    tag: text(row.tag) || key,
  })
  return true
}
