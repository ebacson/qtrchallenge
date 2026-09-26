import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { onValue, ref } from 'firebase/database'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import { parseChallenge, STATUS_ONGOING } from '../lib/challengeRules'
import type { Challenge } from '../types'
import { ChallengeCard } from '../components/ChallengeCard'

export function HomePage() {
  const { profile, user } = useAuth()
  const [ongoing, setOngoing] = useState<Challenge[]>([])
  const [activityCount, setActivityCount] = useState(0)

  useEffect(() => {
    if (!user) return
    const challengesRef = ref(db, 'challenges')
    const unsub = onValue(challengesRef, (snap) => {
      const val = (snap.val() ?? {}) as Record<string, Record<string, unknown>>
      const list = Object.entries(val)
        .map(([id, dict]) => parseChallenge(id, dict, user.uid))
        .filter((c) => c.status === STATUS_ONGOING && c.userTarget)
        .slice(0, 3)
      setOngoing(list)
    })
    return unsub
  }, [user])

  useEffect(() => {
    if (!user) return
    const actRef = ref(db, `users/${user.uid}/strava_activities`)
    const unsub = onValue(actRef, (snap) => {
      const val = snap.val()
      setActivityCount(val && typeof val === 'object' ? Object.keys(val).length : 0)
    })
    return unsub
  }, [user])

  return (
    <div className="page">
      <section className="hero-home">
        <p className="eyebrow">Xin chào</p>
        <h1>{profile?.fullName || 'Runner'}</h1>
        <p className="lede">
          Theo dõi thử thách QTR và hoạt động Strava đã đồng bộ từ app.
        </p>
        <div className="stat-row">
          <div className="stat">
            <strong>{profile?.level ?? 0}</strong>
            <span>Level</span>
          </div>
          <div className="stat">
            <strong>{activityCount}</strong>
            <span>Activities</span>
          </div>
          <div className="stat">
            <strong>{profile?.member ? 'Official' : 'Guest'}</strong>
            <span>Member</span>
          </div>
        </div>
        <div className="cta-row">
          <Link className="btn primary" to="/challenges">
            Xem thử thách
          </Link>
          <Link className="btn ghost" to="/activities">
            Activities
          </Link>
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
