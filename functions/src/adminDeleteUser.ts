import { getAuth } from 'firebase-admin/auth'
import { getDatabase } from 'firebase-admin/database'
import * as logger from 'firebase-functions/logger'
import { readStravaEnv, refreshAccessToken, revokeAccessToken } from './stravaCore'
import { USER_PROFILES_PATH } from './shared/userProfile'

export class DeleteUserError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export type DeleteUserSummary = {
  strava: 'revoked' | 'not_connected' | 'already_revoked'
  challenges: number
  /** Khoản nộp phạt được giữ lại (gắn tên) trong sổ sách */
  penaltyPayments: number
  /** Khoản quỹ / thu chi trong `finance` được gắn tên */
  financeRecords: number
  rewardDraws: number
  notifications: number
  authDeleted: boolean
}

type Dict = Record<string, unknown>

function asDict(value: unknown): Dict | null {
  return value && typeof value === 'object' ? (value as Dict) : null
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const dict = asDict(value)
  if (!dict) return []
  return Object.keys(dict)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => dict[k])
}

/** Thu hồi quyền Strava của user (làm mới token nếu đã hết hạn). */
async function disconnectStrava(uid: string): Promise<DeleteUserSummary['strava']> {
  const db = getDatabase()
  const [access, refresh, expires] = await Promise.all([
    db.ref(`users/${uid}/access_token`).get(),
    db.ref(`users/${uid}/refresh_token`).get(),
    db.ref(`users/${uid}/expires_at`).get(),
  ])
  let accessToken = String(access.val() ?? '')
  const refreshToken = String(refresh.val() ?? '')
  const expiresAt = Number(expires.val() ?? 0)
  if (!accessToken && !refreshToken) return 'not_connected'

  if (refreshToken && (!accessToken || expiresAt * 1000 < Date.now() + 60_000)) {
    const env = readStravaEnv(process.env)
    if ('error' in env) throw new DeleteUserError(env.error, 500)
    const refreshed = await refreshAccessToken(env, refreshToken)
    if (refreshed.ok) {
      accessToken = refreshed.data.access_token
    } else if (refreshed.status === 400 || refreshed.status === 401) {
      // Refresh token không còn hiệu lực: user đã tự gỡ app trên Strava
      return 'already_revoked'
    } else {
      throw new DeleteUserError(`Không làm mới được token Strava: ${refreshed.error}`, 502)
    }
  }

  const revoked = await revokeAccessToken(accessToken)
  if (revoked.ok) return 'revoked'
  if (revoked.status === 401) return 'already_revoked'
  throw new DeleteUserError(
    `Không ngắt được kết nối Strava (${revoked.status}). Thử lại sau.`,
    502,
  )
}

/**
 * Ngắt Strava, xóa mọi dữ liệu RTDB gắn với uid (tham gia/quay thưởng thử thách, dấu đã đọc
 * thông báo, hồ sơ) rồi xóa tài khoản Firebase Auth. Sổ sách tiền (nộp phạt, quỹ, thu chi)
 * được giữ lại và gắn `memberName` để vẫn hiện đúng tên sau khi hồ sơ bị xóa.
 */
export async function deleteUserCompletely(
  adminUid: string,
  targetUid: string,
): Promise<DeleteUserSummary> {
  if (!targetUid) throw new DeleteUserError('Thiếu uid.', 400)
  if (targetUid === adminUid) throw new DeleteUserError('Không thể xóa chính mình.', 400)

  const db = getDatabase()
  if ((await db.ref(`users/${targetUid}/admin`).get()).val() === true) {
    throw new DeleteUserError('Không xóa tài khoản Admin. Hãy hủy quyền Admin trước.', 400)
  }

  const strava = await disconnectStrava(targetUid)

  const [profileName, userName, userEmail] = await Promise.all([
    db.ref(`${USER_PROFILES_PATH}/${targetUid}/fullName`).get(),
    db.ref(`users/${targetUid}/fullName`).get(),
    db.ref(`users/${targetUid}/email`).get(),
  ])
  const memberName =
    String(profileName.val() ?? '').trim() ||
    String(userName.val() ?? '').trim() ||
    String(userEmail.val() ?? '').trim() ||
    targetUid

  const updates: Dict = {}
  let challengeCount = 0
  let penaltyCount = 0
  let financeCount = 0
  let drawCount = 0

  const challenges = asDict((await db.ref('challenges').get()).val()) ?? {}
  for (const [challengeId, raw] of Object.entries(challenges)) {
    const challenge = asDict(raw)
    if (!challenge) continue
    const base = `challenges/${challengeId}`

    if (asDict(challenge.user_challenges)?.[targetUid] != null) {
      updates[`${base}/user_challenges/${targetUid}`] = null
      challengeCount++
    }
    const payment = asDict(asDict(challenge.penaltyPayments)?.[targetUid])
    if (payment) {
      if (!payment.memberName) {
        updates[`${base}/penaltyPayments/${targetUid}/memberName`] = memberName
      }
      penaltyCount++
    }

    const draws = asDict(challenge.rewardDraws)
    for (const [index, drawRaw] of Object.entries(draws ?? {})) {
      const draw = asDict(drawRaw)
      if (!draw) continue
      const candidates = asList(draw.candidates).map(String)
      const winners = asList(draw.winners).map(String)
      const prizes = asList(draw.prizes)
      if (!candidates.includes(targetUid) && !winners.includes(targetUid)) continue
      const keep = winners.map((uid, i) => (uid === targetUid ? -1 : i)).filter((i) => i >= 0)
      updates[`${base}/rewardDraws/${index}/candidates`] = candidates.filter(
        (uid) => uid !== targetUid,
      )
      updates[`${base}/rewardDraws/${index}/winners`] = keep.map((i) => winners[i])
      updates[`${base}/rewardDraws/${index}/prizes`] = keep.map((i) => prizes[i] ?? null)
      drawCount++
    }
  }

  const [duesSnap, transactionsSnap] = await Promise.all([
    db.ref('finance/dues').get(),
    db.ref('finance/transactions').get(),
  ])
  for (const [year, raw] of Object.entries(asDict(duesSnap.val()) ?? {})) {
    const paid = asDict(asDict(asDict(raw)?.members)?.[targetUid])
    if (!paid) continue
    if (!paid.memberName) {
      updates[`finance/dues/${year}/members/${targetUid}/memberName`] = memberName
    }
    financeCount++
  }
  for (const [year, raw] of Object.entries(asDict(transactionsSnap.val()) ?? {})) {
    for (const [id, rowRaw] of Object.entries(asDict(raw) ?? {})) {
      const row = asDict(rowRaw)
      if (!row || row.memberUid !== targetUid) continue
      if (!row.memberName) {
        updates[`finance/transactions/${year}/${id}/memberName`] = memberName
      }
      financeCount++
    }
  }

  let notificationCount = 0
  const notifications = asDict((await db.ref('notifications').get()).val()) ?? {}
  for (const [id, raw] of Object.entries(notifications)) {
    if (asDict(asDict(raw)?.readBy)?.[targetUid] != null) {
      updates[`notifications/${id}/readBy/${targetUid}`] = null
      notificationCount++
    }
  }

  updates[`users/${targetUid}`] = null
  updates[`${USER_PROFILES_PATH}/${targetUid}`] = null
  await db.ref().update(updates)

  let authDeleted = false
  try {
    await getAuth().deleteUser(targetUid)
    authDeleted = true
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/user-not-found') throw err
  }

  const summary: DeleteUserSummary = {
    strava,
    challenges: challengeCount,
    penaltyPayments: penaltyCount,
    financeRecords: financeCount,
    rewardDraws: drawCount,
    notifications: notificationCount,
    authDeleted,
  }
  logger.info('adminDeleteUser', { adminUid, targetUid, ...summary })
  return summary
}
