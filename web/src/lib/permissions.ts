type Role = { admin?: boolean; member?: boolean } | null | undefined

/** Thành viên tự do chỉ xem được hoạt động của chính mình. */
export function canViewOthersActivities(profile: Role): boolean {
  return Boolean(profile?.admin || profile?.member)
}
