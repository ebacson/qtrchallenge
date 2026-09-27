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
   * Km yêu cầu cho từng ngày hoạt động (độ dài = daysRequired). Các ngày không cần
   * liên tục và không gắn với ngày cụ thể; ghi đè kmPerDay.
   */
  dailyKm?: number[]
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
  /** Fields from current user's join row */
  userTarget?: string
  userDaysRequired?: number
  userKmPerDay?: number
  userDailyKm?: number[]
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
}
