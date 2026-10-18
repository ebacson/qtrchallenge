import * as logger from 'firebase-functions/logger'
import { sendPushToUid } from './fcmSend'
import { DAY_MS, getPushState, setPushState } from './pushState'

function isAuthLikeStravaError(error: string): boolean {
  return /401|403|unauthorized|revoked|invalid.*(token|grant)|token.*(invalid|expired)|not authorized/i.test(
    error,
  )
}

/** Lên level (dedup theo level) */
export async function notifyLevelUp(uid: string, level: number): Promise<void> {
  if (!(level > 0)) return
  const key = `level_${uid}_${level}`
  if (await getPushState(key)) return
  await sendPushToUid(uid, {
    title: 'Lên level!',
    body: `Bạn đạt Level ${level}.`,
    url: '/profile',
    tag: `level-${uid}-${level}`,
  })
  await setPushState(key, {
    uid,
    kind: 'level',
    createdAt: Date.now(),
    remindedAt: Date.now(),
    meta: { level },
  })
  logger.info('notifyLevelUp', { uid, level })
}

/** Lỗi auth Strava — tối đa 1 lần / ngày */
export async function notifyStravaAuthError(uid: string, error: string): Promise<void> {
  if (!isAuthLikeStravaError(error)) return
  const now = Date.now()
  const dayKey = Math.floor(now / DAY_MS)
  const key = `strava_err_${uid}_${dayKey}`
  if (await getPushState(key)) return
  await sendPushToUid(uid, {
    title: 'Lỗi kết nối Strava',
    body: 'Cần kết nối lại để đồng bộ hoạt động.',
    url: '/profile',
    tag: 'strava-auth-error',
  })
  await setPushState(key, {
    uid,
    kind: 'strava_err',
    createdAt: now,
    remindedAt: now,
    meta: { error: error.slice(0, 120) },
  })
  logger.info('notifyStravaAuthError', { uid, error: error.slice(0, 120) })
}

/** Webhook athlete deauthorize */
export async function notifyStravaDeauthorized(uid: string): Promise<void> {
  await notifyStravaAuthError(uid, 'revoked / unauthorized')
}
