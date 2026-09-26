import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { onValue, ref, remove, update } from 'firebase/database'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import {
  canJoin,
  challengeProgressPercent,
  challengeRulesSummary,
  joinBlockedMessage,
  listDisplayText,
  parseChallenge,
  statusClass,
} from '../lib/challengeRules'
import type { Challenge } from '../types'

export function ChallengeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [selectedTarget, setSelectedTarget] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id || !user) return
    const challengeRef = ref(db, `challenges/${id}`)
    const unsub = onValue(challengeRef, (snap) => {
      const val = snap.val() as Record<string, unknown> | null
      if (!val) {
        setChallenge(null)
        return
      }
      const c = parseChallenge(id, val, user.uid)
      setChallenge(c)
      setSelectedTarget((prev) => prev || c.targetDistances[0] || '')
    })
    return unsub
  }, [id, user])

  if (!challenge) {
    return (
      <div className="page">
        <p className="empty">Không tìm thấy thử thách.</p>
        <Link to="/challenges">← Quay lại</Link>
      </div>
    )
  }

  const joined = Boolean(challenge.userTarget)
  const pct = challengeProgressPercent(challenge)
  const needsPassword = Boolean(challenge.password)
  const rules = challengeRulesSummary(challenge)

  async function onJoin(e: FormEvent) {
    e.preventDefault()
    if (!user || !id || !challenge) return
    setError('')
    setMessage('')

    if (!canJoin(challenge)) {
      setError(joinBlockedMessage(challenge))
      return
    }
    if (needsPassword && password !== challenge.password) {
      setError('Mật khẩu không đúng.')
      return
    }
    if (!selectedTarget) {
      setError('Chọn mục tiêu cự ly.')
      return
    }

    setBusy(true)
    try {
      await update(ref(db, `challenges/${id}/user_challenges/${user.uid}`), {
        userTarget: selectedTarget,
        progress: '0.0 km',
      })
      setMessage('Đã tham gia thử thách thành công!')
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tham gia')
    } finally {
      setBusy(false)
    }
  }

  async function onLeave() {
    if (!user || !id) return
    if (!window.confirm('Bạn chắc muốn rời thử thách này?')) return
    setBusy(true)
    setError('')
    try {
      await remove(ref(db, `challenges/${id}/user_challenges/${user.uid}`))
      setMessage('Đã rời thử thách.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể rời thử thách')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page detail-page">
      <Link className="back-link" to="/challenges">
        ← Thử thách
      </Link>

      <div className="detail-hero">
        {challenge.icon ? (
          <img className="detail-icon" src={challenge.icon} alt="" />
        ) : (
          <div className="detail-icon placeholder" />
        )}
        <div>
          <span className={`status-pill ${statusClass(challenge.status)}`}>
            {challenge.status}
          </span>
          <h1>{challenge.name}</h1>
          <p className="muted">
            {challenge.startDate} → {challenge.endDate}
          </p>
          <p className="tiny muted">{listDisplayText(challenge)}</p>
          {rules && <p className="challenge-rules-tag">{rules}</p>}
        </div>
      </div>

      {challenge.description && (
        <section className="section">
          <h2>Mô tả</h2>
          <p className="body-text">{challenge.description}</p>
        </section>
      )}

      {joined ? (
        <section className="section panel">
          <h2>Tiến độ của bạn</h2>
          <p>
            {challenge.challengeMode === 'activity_count'
              ? `${challenge.totalactiviti ?? '0'} / ${challenge.requiredActivities ?? '?'} hoạt động (≥ ${challenge.minActivityDistanceKm ?? 1} km)`
              : `${challenge.progress ?? '0 km'} / ${challenge.userTarget}`}
          </p>
          <div className="progress-track large">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="tiny muted">
            {challenge.totalactiviti
              ? `${challenge.totalactiviti} hoạt động hợp lệ`
              : 'Progress cập nhật sau khi sync Strava từ app'}
          </p>
          <button
            type="button"
            className="btn danger"
            disabled={busy}
            onClick={() => void onLeave()}
          >
            Rời thử thách
          </button>
        </section>
      ) : (
        <section className="section panel">
          <h2>Tham gia</h2>
          {!canJoin(challenge) ? (
            <p className="form-error">{joinBlockedMessage(challenge)}</p>
          ) : (
            <form className="auth-form" onSubmit={onJoin}>
              <label>
                Mục tiêu
                <select
                  value={selectedTarget}
                  onChange={(e) => setSelectedTarget(e.target.value)}
                >
                  {challenge.targetDistances.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              {needsPassword && (
                <label>
                  Mật khẩu thử thách
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              )}
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Đang xử lý…' : 'Tham gia'}
              </button>
            </form>
          )}
        </section>
      )}

      {error && <p className="form-error">{error}</p>}
      {message && <p className="form-info">{message}</p>}
    </div>
  )
}
