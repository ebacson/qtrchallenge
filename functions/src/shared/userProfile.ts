// GENERATED from web/src/lib/userProfile.ts by scripts/sync-shared.mjs — edit the web copy.
/**
 * `user_profiles/{uid}` là bản sao gọn của các trường hồ sơ trong `users/{uid}` (không có
 * strava_activities, token). Các trang danh sách đọc nhánh này thay vì cả `users` (~11 MB).
 * Dùng chung cho web và Cloud Functions (scripts/sync-shared.mjs).
 */
export const USER_PROFILES_PATH = 'user_profiles'

export const PROFILE_FIELDS = [
  'fullName',
  'email',
  'avatar',
  'level',
  'member',
  'memberSince',
  'admin',
  'phone',
  'gender',
  'dob',
  'id_strava',
  'user_strava',
  'personalRecord',
  'fullMarathonTime',
  'halfMarathonTime',
  'isFullMarathonVerified',
  'isHalfMarathonVerified',
  'history',
] as const

const PROFILE_FIELD_SET: ReadonlySet<string> = new Set(PROFILE_FIELDS)

/** `memberSince` (ms) → "dd/MM/yyyy" theo giờ Việt Nam; '' nếu chưa có. */
export function formatMemberSince(value: unknown): string {
  const ms = Number(value)
  if (!(ms > 0)) return ''
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(ms))
}

export function pickProfile(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of PROFILE_FIELDS) {
    if (row[field] != null) out[field] = row[field]
  }
  return out
}

/** `relPath` tính từ `users/{uid}`, ví dụ "fullName" hay "personalRecord/fullMarathonTime". */
export function isProfilePath(relPath: string): boolean {
  return PROFILE_FIELD_SET.has(relPath.split('/')[0])
}

/**
 * Đổi bản cập nhật tương đối với `users/{uid}` thành bản cập nhật từ gốc, ghi kèm
 * `user_profiles/{uid}` cho các trường hồ sơ.
 */
export function mirroredUserUpdates(
  uid: string,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  for (const [relPath, value] of Object.entries(updates)) {
    root[`users/${uid}/${relPath}`] = value
    if (isProfilePath(relPath)) root[`${USER_PROFILES_PATH}/${uid}/${relPath}`] = value
  }
  return root
}
