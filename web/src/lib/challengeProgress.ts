import { get, ref, update } from 'firebase/database'
import { db } from './firebase'
import {
  calculateProgress,
  calculateStatus,
  parseChallengeDay,
  parseDayQuotaOptions,
  progressOptionsFromDict,
  resolveUserDayQuotaOptions,
  STATUS_FINISHED,
} from './challengeRules'
import { calculateLevelFromChallenges } from './levelCalculator'

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
    await update(ref(db, `users/${uid}`), { level })
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

        const startDate = parseChallengeDay(startStr)
        const endDate = parseChallengeDay(endStr)
        if (!startDate || !endDate) return

        const mode = String(challenge.challengeMode ?? '')
        const baseOpts = progressOptionsFromDict(challenge) ?? {}

        if (mode === 'day_quota') {
          const selections = resolveUserDayQuotaOptions(
            parseDayQuotaOptions(challenge.dayQuotaOptions),
            Array.isArray(challenge.targetDistances)
              ? (challenge.targetDistances as string[])
              : [],
            userRow,
          )
          if (!selections.length) return

          // Mỗi tùy chọn tính độc lập: một hoạt động có thể được tính cho nhiều tùy chọn
          let hasEligible = false
          let totalPace = 0
          const optionResults = selections.map(({ optionIndex, option }) => {
            const result = calculateProgress(activities, startDate, endDate, {
              ...baseOpts,
              kmPerDay: option.kmPerDay,
              dailyKm: option.dailyKm,
            })
            hasEligible ||= result.hasEligibleActivities
            totalPace = result.totalPaceMinutes
            return {
              optionIndex,
              daysCompleted: Math.min(result.daysCompleted ?? 0, option.daysRequired),
              daysRequired: option.daysRequired,
              completedTargets: result.completedTargets ?? null,
            }
          })
          const done = optionResults.reduce((sum, r) => sum + r.daysCompleted, 0)
          const required = optionResults.reduce((sum, r) => sum + r.daysRequired, 0)
          const first = selections[0].option

          await update(
            ref(db, `challenges/${challengeId}/user_challenges/${uid}`),
            {
              progress: `${done}/${required} ngày`,
              totalactiviti: String(done),
              totalpace: hasEligible ? String(totalPace) : '0',
              daysRequired: first.daysRequired,
              kmPerDay: first.kmPerDay,
              optionResults,
              completedTargets: null,
            },
          )
          updatedChallengeIds.push(challengeId)
          return
        }

        const result = calculateProgress(
          activities,
          startDate,
          endDate,
          baseOpts,
        )
        await update(
          ref(db, `challenges/${challengeId}/user_challenges/${uid}`),
          {
            progress: result.hasEligibleActivities
              ? `${result.totalDistanceKm.toFixed(2)} km`
              : '0.00 km',
            totalactiviti: String(result.totalActivities),
            totalpace: result.hasEligibleActivities
              ? String(result.totalPaceMinutes)
              : '0',
          },
        )
        updatedChallengeIds.push(challengeId)
      }),
    )

    // Progress vừa ghi có thể là lần cuối của thử thách vừa kết thúc → đọc lại trước khi tính level
    const latestChallenges = updatedChallengeIds.length
      ? ((await get(ref(db, 'challenges'))).val() ?? {})
      : challenges
    await refreshUserLevel(uid, latestChallenges)

    lastSyncAt = Date.now()
    return {
      updatedChallengeIds,
      didWrite: updatedChallengeIds.length > 0,
    }
  } finally {
    syncing = false
  }
}
