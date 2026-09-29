import {
  calculateProgress,
  parseChallengeDay,
  parseDayQuotaOptions,
  progressOptionsFromDict,
  resolveUserDayQuotaOptions,
} from './challengeRules'

/**
 * Các trường cần ghi vào `challenges/{id}/user_challenges/{uid}` sau khi tính lại
 * tiến độ từ danh sách hoạt động; `null` nếu không tính được (ngày lỗi, chưa chọn
 * tùy chọn...). Dùng chung cho web và Cloud Functions.
 */
export function computeUserChallengeUpdate(
  challenge: Record<string, unknown>,
  userRow: Record<string, unknown>,
  activities: Record<string, unknown>[],
): Record<string, unknown> | null {
  const startDate = parseChallengeDay(String(challenge.startDate ?? ''))
  const endDate = parseChallengeDay(String(challenge.endDate ?? ''))
  if (!startDate || !endDate) return null

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
    if (!selections.length) return null

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

    return {
      progress: `${done}/${required} ngày`,
      totalactiviti: String(done),
      totalpace: hasEligible ? String(totalPace) : '0',
      daysRequired: first.daysRequired,
      kmPerDay: first.kmPerDay,
      optionResults,
      completedTargets: null,
    }
  }

  const result = calculateProgress(activities, startDate, endDate, baseOpts)
  return {
    progress: result.hasEligibleActivities
      ? `${result.totalDistanceKm.toFixed(2)} km`
      : '0.00 km',
    totalactiviti: String(result.totalActivities),
    totalpace: result.hasEligibleActivities ? String(result.totalPaceMinutes) : '0',
  }
}
