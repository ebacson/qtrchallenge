import { Link } from 'react-router-dom'
import type { Challenge } from '../types'
import {
  challengeGoals,
  challengeProgressPercent,
  listDisplayText,
  statusClass,
} from '../lib/challengeRules'

export function ChallengeCard({ challenge }: { challenge: Challenge }) {
  const joined = Boolean(challenge.userTarget)
  const pct = challengeProgressPercent(challenge)
  const goals = challengeGoals(challenge)

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
        {challenge.challengeMode === 'day_quota' && goals.length > 0 && (
          <ul className="card-goal-list">
            {goals.map((g) => (
              <li key={g.index}>
                <strong>{g.title}:</strong> {g.summary}
              </li>
            ))}
          </ul>
        )}
        {joined ? (
          <div className="progress-block">
            <div className="progress-meta">
              <span>
                {challenge.challengeMode === 'day_quota'
                  ? `${challenge.totalactiviti ?? '0'} / ${challenge.requiredActivities ?? challenge.userDaysRequired ?? '?'} ngày`
                  : challenge.challengeMode === 'activity_count'
                    ? `${challenge.totalactiviti ?? '0'} / ${challenge.requiredActivities ?? '?'} hoạt động`
                    : `${challenge.progress ?? '0 km'} / ${challenge.userTarget}`}
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
