import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useSharedValue } from '../lib/sharedValue'
import { formatBadgeCount, useUnreadNotificationCount } from '../lib/notifications'
import { parseChallenge, parseChallengeDayStartMs, STATUS_ONGOING } from '../lib/challengeRules'
import type { Challenge } from '../types'
import { ChallengeCard } from '../components/ChallengeCard'

const shortcuts = [
  { to: '/hall-of-fame', title: 'Bảng vàng', desc: 'PR Full / Half' },
  { to: '/notifications', title: 'Thông báo', desc: 'Tin club' },
  { to: '/members', title: 'Thành viên', desc: 'Danh sách runners' },
  { to: '/stats', title: 'Thống kê', desc: 'Km & pace' },
  { to: '/events', title: 'Events', desc: 'Giải & kết quả' },
  { to: '/profile', title: 'Strava', desc: 'Kết nối & sync trong Profile' },
]

export function HomePage() {
  const { profile, user } = useAuth()
  const challenges = useSharedValue<Record<string, Record<string, unknown>>>(
    user ? 'challenges' : null,
  )
  const unreadNotifications = useUnreadNotificationCount()
  const activities = useSharedValue<Record<string, unknown>>(
    user ? `users/${user.uid}/strava_activities` : null,
  )

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

  const activityCount =
    activities && typeof activities === 'object' ? Object.keys(activities).length : 0

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
            const unread = s.to === '/notifications' ? unreadNotifications : 0
            return (
              <Link
                key={s.to}
                to={s.to}
                className={unread > 0 ? 'shortcut-card has-unread' : 'shortcut-card'}
              >
                <strong>{s.title}</strong>
                <span className={unread > 0 ? 'tiny shortcut-unread' : 'tiny muted'}>
                  {unread > 0 ? `${unread} thông báo mới` : s.desc}
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
