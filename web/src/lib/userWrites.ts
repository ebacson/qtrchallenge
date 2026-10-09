import { ref, update } from 'firebase/database'
import { db } from './firebase'
import { useSharedValue } from './sharedValue'
import { mirroredUserUpdates, pickProfile, USER_PROFILES_PATH } from './userProfile'

/** Cập nhật `users/{uid}` (đường dẫn tương đối) và giữ `user_profiles/{uid}` khớp. */
export function updateUser(uid: string, updates: Record<string, unknown>): Promise<void> {
  return update(ref(db), mirroredUserUpdates(uid, updates))
}

/** Ghi mới toàn bộ node user (đăng ký) kèm hồ sơ gọn. */
export function createUser(uid: string, data: Record<string, unknown>): Promise<void> {
  return update(ref(db), {
    [`users/${uid}`]: data,
    [`${USER_PROFILES_PATH}/${uid}`]: pickProfile(data),
  })
}

export function removeUser(uid: string): Promise<void> {
  return update(ref(db), {
    [`users/${uid}`]: null,
    [`${USER_PROFILES_PATH}/${uid}`]: null,
  })
}

type Profiles = Record<string, Record<string, unknown>>

/**
 * Hồ sơ gọn của mọi thành viên (~150 KB), một listener giữ suốt phiên.
 * `null` khi đang tải lần đầu.
 */
export function useUserProfiles(): Profiles | null {
  const value = useSharedValue<Profiles>(USER_PROFILES_PATH, 24 * 60 * 60_000)
  return value === undefined ? null : (value ?? {})
}

export const DELETED_USERS_PATH = 'deleted_users'

const NO_PROFILES: Profiles = {}

/** Tên các tài khoản đã bị xóa (`deleted_users/{uid}/fullName`), ghi bởi Cloud Function. */
export function useDeletedUsers(): Profiles {
  return useSharedValue<Profiles>(DELETED_USERS_PATH, 24 * 60 * 60_000) ?? NO_PROFILES
}
