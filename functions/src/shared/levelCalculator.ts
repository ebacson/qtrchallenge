// GENERATED from web/src/lib/levelCalculator.ts by scripts/sync-shared.mjs — edit the web copy.
import { STATUS_FINISHED, calculateStatus } from './challengeRules'

function extractDistance(distanceStr: string): number {
  if (!distanceStr) return 0
  const clean = distanceStr.replace(/[^0-9.]/g, '')
  if (!clean) return 0
  const n = Number(clean)
  return Number.isNaN(n) ? 0 : Math.floor(n)
}

export function calculateLevelPoints(targetDistance: string): number {
  const distance = extractDistance(targetDistance)
  if (distance >= 300) return 5
  if (distance >= 250) return 4
  if (distance >= 200) return 3
  if (distance >= 150) return 2
  if (distance >= 100) return 1
  return 0
}

function isChallengeFinished(data: Record<string, unknown>): boolean {
  if (data.status === STATUS_FINISHED) return true
  const start = String(data.startDate ?? '')
  const end = String(data.endDate ?? '')
  if (start && end) {
    return calculateStatus(start, end) === STATUS_FINISHED
  }
  return false
}

function isChallengeCompleted(userData: Record<string, unknown>): boolean {
  if (userData.isCompleted === true) return true
  const userTarget = userData.userTarget != null ? String(userData.userTarget) : ''
  const progress = userData.progress != null ? String(userData.progress) : ''
  if (!userTarget || !progress) return false
  const targetDistance = extractDistance(userTarget)
  const progressDistance = extractDistance(progress)
  return progressDistance >= targetDistance && targetDistance > 0
}

export function calculateLevelFromChallenges(
  userId: string,
  challenges: Record<string, Record<string, unknown>>,
): number {
  let total = 0
  const processed = new Set<string>()

  for (const [challengeId, challengeDict] of Object.entries(challenges)) {
    if (!isChallengeFinished(challengeDict)) continue
    const userChallenges = challengeDict.user_challenges as
      | Record<string, Record<string, unknown>>
      | undefined
    const userData = userChallenges?.[userId]
    if (!userData || !isChallengeCompleted(userData)) continue
    if (processed.has(challengeId)) continue
    const userTarget =
      userData.userTarget != null ? String(userData.userTarget) : ''
    if (!userTarget) continue
    total += calculateLevelPoints(userTarget)
    processed.add(challengeId)
  }

  return total
}

export function levelTone(level: number): string {
  if (level >= 16) return 'platinum'
  if (level >= 11) return 'gold'
  if (level >= 6) return 'silver'
  if (level >= 1) return 'bronze'
  return 'none'
}
