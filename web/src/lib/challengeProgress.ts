import { get, ref, update } from 'firebase/database'
import { db } from './firebase'
import { calculateStatus, STATUS_FINISHED } from './challengeRules'
import { calculateLevelFromChallenges } from './levelCalculator'
import { computeUserChallengeUpdate } from './progressCompute'
import { updateUser } from './userWrites'

const THROTTLE_MS = 300_000

let lastSyncAt = 0
let syncing = false

export type ProgressSyncResult = {
  updatedChallengeIds: string[]
  didWrite: boolean
}

function shouldRecalculate(status: string): boolean {
  return status !== STATUS_FINISHED
}

/**
 * Tính lại level từ các thử thách đã kết thúc và chỉ ghi khi giá trị thay đổi.
 * `currentLevel` bỏ qua thì đọc từ RTDB; không tạo node user nếu user chưa tồn tại.
 */
export async function refreshUserLevel(
  uid: string,
  challenges?: Record<string, Record<string, unknown>>,
  currentLevel?: number,
): Promise<number> {
  const data =
    challenges ??
    (((await get(ref(db, 'challenges'))).val() ?? {}) as Record<
      string,
      Record<string, unknown>
    >)
  const level = calculateLevelFromChallenges(uid, data)

  let current = currentLevel
  if (current === undefined) {
    const userSnap = await get(ref(db, `users/${uid}/level`))
    if (!userSnap.exists()) {
      const existsSnap = await get(ref(db, `users/${uid}/email`))
      if (!existsSnap.exists()) return level
    }
    current = Number(userSnap.val() ?? 0) || 0
  }

  if (level !== current) {
    await updateUser(uid, { level })
  }
  return level
}

export async function syncOngoingChallengeProgress(
  uid: string,
  force = false,
): Promise<ProgressSyncResult> {
  const now = Date.now()
  if (!force && now - lastSyncAt < THROTTLE_MS) {
    return { updatedChallengeIds: [], didWrite: false }
  }
  if (syncing) return { updatedChallengeIds: [], didWrite: false }

  syncing = true
  try {
    const [challengesSnap, activitiesSnap] = await Promise.all([
      get(ref(db, 'challenges')),
      get(ref(db, `users/${uid}/strava_activities`)),
    ])

    const challenges = (challengesSnap.val() ?? {}) as Record<
      string,
      Record<string, unknown>
    >
    const activitiesDict = (activitiesSnap.val() ?? {}) as Record<
      string,
      Record<string, unknown>
    >
    const activities = Object.values(activitiesDict)

    const updatedChallengeIds: string[] = []

    await Promise.all(
      Object.entries(challenges).map(async ([challengeId, challenge]) => {
        const startStr = String(challenge.startDate ?? '')
        const endStr = String(challenge.endDate ?? '')
        const status =
          String(challenge.status ?? '') || calculateStatus(startStr, endStr)
        if (!shouldRecalculate(status)) return

        const userChallenges = challenge.user_challenges as
          | Record<string, Record<string, unknown>>
          | undefined
        const userRow = userChallenges?.[uid]
        if (!userRow) return

        const updates = computeUserChallengeUpdate(challenge, userRow, activities)
        if (!updates) return

        await update(
          ref(db, `challenges/${challengeId}/user_challenges/${uid}`),
          updates,
        )
        // Áp vào bản đã đọc để tính level, khỏi đọc lại cả `challenges`
        Object.assign(userRow, updates)
        updatedChallengeIds.push(challengeId)
      }),
    )

    await refreshUserLevel(uid, challenges)

    lastSyncAt = Date.now()
    return {
      updatedChallengeIds,
      didWrite: updatedChallengeIds.length > 0,
    }
  } finally {
    syncing = false
  }
}
