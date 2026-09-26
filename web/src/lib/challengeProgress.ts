import { get, ref, update } from 'firebase/database'
import { db } from './firebase'
import {
  calculateProgress,
  calculateStatus,
  parseChallengeDay,
  progressOptionsFromDict,
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
          | Record<string, unknown>
          | undefined
        if (!userChallenges?.[uid]) return

        const startDate = parseChallengeDay(startStr)
        const endDate = parseChallengeDay(endStr)
        if (!startDate || !endDate) return

        const result = calculateProgress(
          activities,
          startDate,
          endDate,
          progressOptionsFromDict(challenge),
        )
        const updates = {
          progress: result.hasEligibleActivities
            ? `${result.totalDistanceKm.toFixed(2)} km`
            : '0.00 km',
          totalactiviti: String(result.totalActivities),
          totalpace: result.hasEligibleActivities
            ? String(result.totalPaceMinutes)
            : '0',
        }

        await update(
          ref(db, `challenges/${challengeId}/user_challenges/${uid}`),
          updates,
        )
        updatedChallengeIds.push(challengeId)
      }),
    )

    if (updatedChallengeIds.length) {
      const level = calculateLevelFromChallenges(uid, challenges)
      await update(ref(db, `users/${uid}`), { level })
    }

    lastSyncAt = Date.now()
    return {
      updatedChallengeIds,
      didWrite: updatedChallengeIds.length > 0,
    }
  } finally {
    syncing = false
  }
}
