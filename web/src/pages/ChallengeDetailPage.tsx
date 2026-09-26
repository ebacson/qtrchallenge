import { useEffect, useMemo, useState, type FormEvent } from 'react'
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
  progressPercent,
  statusClass,
} from '../lib/challengeRules'
import type { Challenge } from '../types'

type Participant = {
  id: string
  fullName: string
  avatar: string
  progress: string
  userTarget: string
  totalactiviti: string
  progressKm: number
  targetKm: number
  rank: number
  pct: number
}

function extractKm(value: string): number {
  const n = Number(String(value).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function fillTone(pct: number): string {
  if (pct >= 100) return 'fill-done'
  if (pct >= 75) return 'fill-high'
  if (pct >= 40) return 'fill-mid'
  if (pct >= 20) return 'fill-low'
  return 'fill-start'
}

export function ChallengeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [rawUserChallenges, setRawUserChallenges] = useState<
    Record<string, Record<string, unknown>>
  >({})
  const [profiles, setProfiles] = useState<
    Record<string, { fullName: string; avatar: string }>
  >({})
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
        setRawUserChallenges({})
        return
      }
      const c = parseChallenge(id, val, user.uid)
      setChallenge(c)
      setSelectedTarget((prev) => prev || c.targetDistances[0] || '')
      const uc = (val.user_challenges ?? {}) as Record<
        string,
        Record<string, unknown>
      >
      setRawUserChallenges(uc)
    })
    return unsub
  }, [id, user])

  useEffect(() => {
    const usersRef = ref(db, 'users')
    const unsub = onValue(usersRef, (snap) => {
      const val = (snap.val() ?? {}) as Record<string, Record<string, unknown>>
      const map: Record<string, { fullName: string; avatar: string }> = {}
      for (const [uid, row] of Object.entries(val)) {
        map[uid] = {
          fullName: String(row.fullName ?? ''),
          avatar: String(row.avatar ?? ''),
        }
      }
      setProfiles(map)
    })
    return unsub
  }, [])

  const participants = useMemo(() => {
    const list: Omit<Participant, 'rank'>[] = Object.entries(rawUserChallenges).map(
      ([uid, row]) => {
        const progress = String(row.progress ?? '0.0 km')
        const userTarget = String(row.userTarget ?? '')
        const progressKm = extractKm(progress)
        const targetKm = extractKm(userTarget)
        const pct =
          targetKm > 0
            ? Math.min(100, Math.round((progressKm / targetKm) * 100))
            : progressPercent(progress, userTarget)
        const profile = profiles[uid]
        return {
          id: uid,
          fullName:
            profile?.fullName ||
            String(row.name ?? '') ||
            'Người dùng ẩn danh',
          avatar: profile?.avatar || '',
          progress,
          userTarget,
          totalactiviti: String(row.totalactiviti ?? ''),
          progressKm,
          targetKm,
          pct,
        }
      },
    )

    list.sort((a, b) => {
      if (b.progressKm !== a.progressKm) return b.progressKm - a.progressKm
      if (b.targetKm !== a.targetKm) return b.targetKm - a.targetKm
      return a.fullName.localeCompare(b.fullName, 'vi')
    })

    return list.map((p, index) => ({ ...p, rank: index + 1 }))
  }, [rawUserChallenges, profiles])

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
  const myRank = participants.find((p) => p.id === user?.uid)?.rank

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
        <>
          <section className="section panel">
            <h2>Tiến độ của bạn</h2>
            {myRank != null && (
              <p className="tiny muted" style={{ marginBottom: 8 }}>
                Hạng của bạn: {myRank}/{participants.length}
              </p>
            )}
            <p>
              {challenge.challengeMode === 'activity_count'
                ? `${challenge.totalactiviti ?? '0'} / ${challenge.requiredActivities ?? '?'} hoạt động (≥ ${challenge.minActivityDistanceKm ?? 1} km)`
                : `${challenge.progress ?? '0 km'} / ${challenge.userTarget}`}
            </p>
            <div className="progress-track large">
              <div
                className={`progress-fill ${fillTone(pct)}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="tiny muted">
              {challenge.totalactiviti
                ? `${challenge.totalactiviti} hoạt động hợp lệ`
                : 'Progress cập nhật sau khi sync Strava'}
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

          <section className="section panel">
            <h2>Bảng xếp hạng</h2>
            <p className="lede tiny">
              {participants.length} thành viên · sắp xếp theo km hoàn thành
            </p>
            {participants.length === 0 ? (
              <p className="muted">Chưa có ai tham gia.</p>
            ) : (
              <ol className="participant-list">
                {participants.map((p) => (
                  <li
                    key={p.id}
                    className={`participant-row${p.id === user?.uid ? ' me' : ''}`}
                  >
                    <span className="participant-rank">{p.rank}</span>
                    <div className="hof-avatar">
                      {p.avatar ? (
                        <img src={p.avatar} alt="" />
                      ) : (
                        <span>{(p.fullName || '?').charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="participant-meta">
                      <strong>
                        {p.fullName}
                        {p.id === user?.uid ? ' (bạn)' : ''}
                      </strong>
                      <span className="tiny muted">
                        Hoàn thành: {p.progress} / {p.userTarget || '—'}
                        {p.totalactiviti
                          ? ` · ${p.totalactiviti} hoạt động`
                          : ''}
                      </span>
                      <div className="progress-track">
                        <div
                          className={`progress-fill ${fillTone(p.pct)}`}
                          style={{ width: `${p.pct}%` }}
                        />
                      </div>
                    </div>
                    <span className="participant-km">{p.progressKm.toFixed(1)} km</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
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
