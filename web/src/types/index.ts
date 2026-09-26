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
  /** distance | monthly_pace | activity_count */
  challengeMode: 'distance' | 'monthly_pace' | 'activity_count'
  paceMinMinutes?: number
  paceMaxMinutes?: number
  requiredActivities?: number
  minActivityDistanceKm?: number
  userTarget?: string
  progress?: string
  totalpace?: string
  totalactiviti?: string
}

export interface ChallengeProgressResult {
  totalDistanceKm: number
  totalActivities: number
  totalPaceMinutes: number
  hasEligibleActivities: boolean
}
