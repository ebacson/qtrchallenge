import { Link } from 'react-router-dom'
import type { Challenge } from '../types'
import { listDisplayText, progressPercent, statusClass } from '../lib/challengeRules'

export function ChallengeCard({ challenge }: { challenge: Challenge }) {
  const joined = Boolean(challenge.userTarget)
  const pct = progressPercent(challenge.progress, challenge.userTarget)

  return (
    <Link to={`/challenges/${challenge.id}`} className="challenge-card">
      <div className="challenge-card-media">
        {challenge.icon ? (
          <img src={challenge.icon} alt="" />
        ) : (
          <div className="challenge-placeholder" />
        )}
      </div>
      <div className="challenge-card-body">
        <div className="challenge-card-top">
          <h3>{challenge.name}</h3>
          <span className={`status-pill ${statusClass(challenge.status)}`}>
            {challenge.status}
          </span>
        </div>
        <p className="muted">
          {challenge.startDate} → {challenge.endDate}
        </p>
        <p className="tiny muted">{listDisplayText(challenge)}</p>
        {joined ? (
          <div className="progress-block">
            <div className="progress-meta">
              <span>
                {challenge.progress ?? '0 km'} / {challenge.userTarget}
              </span>
              <span>{pct}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : (
          <p className="tiny accent-text">Chưa tham gia</p>
        )}
      </div>
    </Link>
  )
}
