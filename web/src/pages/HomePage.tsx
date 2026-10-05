import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { User } from 'firebase/auth'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import { useSharedValue } from '../lib/sharedValue'
import { useMyUnpaidPenalty } from '../lib/myChallengeStats'
import { formatBadgeCount, useUnreadNotificationCount } from '../lib/notifications'
import { formatVnd } from '../lib/rewardPenalty'
import { parseChallenge, parseChallengeDayStartMs, STATUS_ONGOING } from '../lib/challengeRules'
import type { Challenge } from '../types'
import { ChallengeCard } from '../components/ChallengeCard'

const shortcuts = [
  { to: '/hall-of-fame', title: 'Bảng vàng', desc: 'PR Full / Half' },
  { to: '/notifications', title: 'Thông báo', desc: 'Tin club' },
  { to: '/members', title: 'Thành viên', desc: 'Danh sách runners' },
  { to: '/stats', title: 'Thống kê', desc: 'Km, pace & thưởng/phạt' },
  { to: '/events', title: 'Events', desc: 'Giải & kết quả' },
  { to: '/profile', title: 'Strava', desc: 'Kết nối & sync trong Profile' },
]

const ACTIVITY_COUNT_TTL_MS = 5 * 60_000
const activityCountCache = new Map<string, { count: number; at: number }>()

/** Chỉ đếm khóa (REST `shallow`), không tải nội dung từng hoạt động. */
function useActivityCount(user: User | null): number {
  const uid = user?.uid ?? null
  const [counted, setCounted] = useState<{ uid: string; count: number } | null>(null)

  useEffect(() => {
    if (!user) return
    const hit = activityCountCache.get(user.uid)
    if (hit && Date.now() - hit.at < ACTIVITY_COUNT_TTL_MS) {
      setCounted({ uid: user.uid, count: hit.count })
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const token = await user.getIdToken()
        const url = `${db.app.options.databaseURL}/users/${user.uid}/strava_activities.json?shallow=true&auth=${encodeURIComponent(token)}`
        const res = await fetch(url)
        if (!res.ok) return
        const keys = (await res.json()) as Record<string, unknown> | null
        const count = keys && typeof keys === 'object' ? Object.keys(keys).length : 0
        activityCountCache.set(user.uid, { count, at: Date.now() })
        if (!cancelled) setCounted({ uid: user.uid, count })
      } catch {
        // giữ số cũ
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  if (!uid) return 0
  if (counted?.uid === uid) return counted.count
  return activityCountCache.get(uid)?.count ?? 0
}

export function HomePage() {
  const { profile, user } = useAuth()
  const challenges = useSharedValue<Record<string, Record<string, unknown>>>(
    user ? 'challenges' : null,
  )
  const unreadNotifications = useUnreadNotificationCount()
  const unpaidPenalty = useMyUnpaidPenalty()
  const activityCount = useActivityCount(user)

  const ongoing = useMemo<Challenge[]>(() => {
    if (!user) return []
    return Object.entries(challenges ?? {})
      .map(([id, dict]) => parseChallenge(id, dict, user.uid))
      .filter((c) => c.status === STATUS_ONGOING && c.userTarget)
      .sort(
        (a, b) =>
          (parseChallengeDayStartMs(b.startDate) ?? 0) -
          (parseChallengeDayStartMs(a.startDate) ?? 0),
      )
      .slice(0, 3)
  }, [challenges, user])

  return (
    <div className="page">
      <section className="hero-home">
        <p className="eyebrow">Xin chào</p>
        <h1>{profile?.fullName || 'Runner'}</h1>
        <p className="lede">
          QTR — One Team - One Dream.
        </p>
        <div className="stat-row">
          <div className="stat">
            <strong>{profile?.level ?? 0}</strong>
            <span>Level</span>
          </div>
          <div className="stat">
            <strong>{activityCount}</strong>
            <span>Hoạt động</span>
          </div>
          <div className="stat">
            <strong>{profile?.member ? 'Chính thức' : 'Tự do'}</strong>
            <span>Member</span>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Lối tắt</h2>
        <div className="shortcut-grid">
          {shortcuts.map((s) => {
            const unread =
              s.to === '/notifications'
                ? unreadNotifications
                : s.to === '/stats'
                  ? unpaidPenalty.count
                  : 0
            const alert =
              s.to === '/stats'
                ? `Chưa nộp phạt ${formatVnd(unpaidPenalty.amount)}`
                : `${unread} thông báo mới`
            return (
              <Link
                key={s.to}
                to={s.to}
                className={unread > 0 ? 'shortcut-card has-unread' : 'shortcut-card'}
              >
                <strong>{s.title}</strong>
                <span className={unread > 0 ? 'tiny shortcut-unread' : 'tiny muted'}>
                  {unread > 0 ? alert : s.desc}
                </span>
                {unread > 0 && (
                  <span className="count-badge shortcut-badge" aria-hidden>
                    {formatBadgeCount(unread)}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Đang tham gia</h2>
          <Link to="/challenges">Tất cả</Link>
        </div>
        {ongoing.length === 0 ? (
          <p className="empty">Chưa có thử thách đang diễn ra bạn đã tham gia.</p>
        ) : (
          <div className="challenge-list">
            {ongoing.map((c) => (
              <ChallengeCard key={c.id} challenge={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
