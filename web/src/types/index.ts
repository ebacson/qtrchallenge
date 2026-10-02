export interface Activity {
  id: string
  name: string
  type: string
  distance: string
  pace: string
  elapsedTime: string
  movingTime: string
  startDate: string
  averageCadence: string
  averageHeartrate: string
  maxHeartrate: string
  totalElevationGain: string
}

export interface UserProfile {
  id: string
  fullName: string
  email: string
  phone: string
  gender: string
  fullMarathonTime: string
  halfMarathonTime: string
  isFullMarathonVerified: boolean
  isHalfMarathonVerified: boolean
  dob: string
  avatar: string
  id_strava: string
  user_strava: string
  admin: boolean
  member: boolean
  level: number
}

/** Tùy chọn thử thách khoảng ngày: hoàn thành X/totalDays ngày, mỗi ngày ≥ kmPerDay */
export interface DayQuotaOption {
  daysRequired: number
  kmPerDay: number
  /**
   * Km yêu cầu cho từng ngày hoạt động (độ dài = daysRequired). Mỗi mức cần một
   * hoạt động có cự ly bằng mức đó (± 0,1 km) vào một ngày riêng, ngày nào cũng
   * được; ghi đè kmPerDay.
   */
  dailyKm?: number[]
}

/** Tiến độ của user cho một tùy chọn khoảng ngày đã chọn */
export interface UserDayQuotaProgress {
  /** Index trong dayQuotaOptions / targetDistances; -1 nếu chỉ suy ra từ nhãn cũ */
  optionIndex: number
  label: string
  option: DayQuotaOption
  daysCompleted: number
  completedTargets?: number[]
}

/** Không hoàn thành mà đạt từ `minPercent`% (đến dưới mức kế trên) thì phạt `amount` đồng */
export interface PenaltyTier {
  minPercent: number
  amount: number
}

/** Phần thưởng quay số cho người hoàn thành mục tiêu `target` (nhãn trong targetDistances) */
export interface RewardTier {
  target: string
  gifts: number
  prize: string
}

export interface RewardDraw {
  target: string
  gifts: number
  prize: string
  /** uid người hoàn thành mục tiêu lúc quay */
  candidates: string[]
  winners: string[]
  drawnAt: number
  drawnBy: string
}

export interface Challenge {
  id: string
  name: string
  description: string
  startDate: string
  endDate: string
  status: string
  targetDistances: string[]
  icon?: string
  creator?: string
  password?: string
  joinDeadlineDays: number
  challengeMode: 'distance' | 'monthly_pace' | 'activity_count' | 'day_quota'
  paceMinMinutes?: number
  paceMaxMinutes?: number
  requiredActivities?: number
  minActivityDistanceKm?: number
  totalDays?: number
  dayQuotaOptions?: DayQuotaOption[]
  /** Sắp xếp giảm dần theo minPercent; không có thì dùng mức phạt mặc định */
  penaltyTiers?: PenaltyTier[]
  rewards?: RewardTier[]
  rewardDraws?: RewardDraw[]
  /** Fields from current user's join row */
  userTarget?: string
  /** Tổng số ngày yêu cầu của các tùy chọn đã chọn */
  userDaysRequired?: number
  /** Các tùy chọn khoảng ngày user đã chọn (một hoặc nhiều) */
  userDayQuota?: UserDayQuotaProgress[]
  progress?: string
  totalpace?: string
  totalactiviti?: string
}

export interface ChallengeProgressResult {
  totalDistanceKm: number
  totalActivities: number
  totalPaceMinutes: number
  hasEligibleActivities: boolean
  daysCompleted?: number
  /** Index các mức trong dailyKm đã đạt */
  completedTargets?: number[]
}
