import { useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSharedValue } from './sharedValue'

/** Số thông báo người dùng hiện tại chưa đọc (theo `notifications/{id}/readBy/{uid}`). */
export function useUnreadNotificationCount(): number {
  const { user } = useAuth()
  const value = useSharedValue<Record<string, { readBy?: Record<string, unknown> } | null>>(
    user ? 'notifications' : null,
  )
  return useMemo(() => {
    if (!user || !value) return 0
    return Object.values(value).filter((row) => row && !row.readBy?.[user.uid]).length
  }, [value, user])
}

export function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}
