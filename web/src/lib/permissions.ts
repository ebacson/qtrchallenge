type Role = { admin?: boolean; member?: boolean } | null | undefined

/** Thành viên tự do chỉ xem được hoạt động của chính mình. */
export function canViewOthersActivities(profile: Role): boolean {
  return Boolean(profile?.admin || profile?.member)
}

/** Trang Tài chính: admin và thành viên chính thức xem được, chỉ admin sửa. */
export function canViewFinance(profile: Role): boolean {
  return Boolean(profile?.admin || profile?.member)
}
