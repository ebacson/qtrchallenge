import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { onValue, ref } from 'firebase/database'
import { db } from '../lib/firebase'
import { mapAthleteFromUser, type AthletePrRow } from '../lib/prRanking'

type HistoryEntry = {
  id: string
  content: string
  timestamp: string
}

export function AthletePrPage() {
  const { uid } = useParams<{ uid: string }>()
  const [athlete, setAthlete] = useState<AthletePrRow | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid) return
    const userRef = ref(db, `users/${uid}`)
    const unsub = onValue(userRef, (snap) => {
      const val = snap.val() as Record<string, unknown> | null
      setAthlete(val ? mapAthleteFromUser(uid, val) : null)
      const hist = (val?.history ?? {}) as Record<string, Record<string, unknown>>
      const entries = Object.entries(hist)
        .map(([id, row]) => ({
          id,
          content: String(row.content ?? ''),
          timestamp: String(row.timestamp ?? row.createdAt ?? ''),
        }))
        .sort((a, b) => b.id.localeCompare(a.id))
      setHistory(entries)
      setLoading(false)
    })
    return unsub
  }, [uid])

  if (loading) {
    return (
      <div className="page">
        <p className="empty">Đang tải…</p>
      </div>
    )
  }

  if (!athlete) {
    return (
      <div className="page">
        <Link className="back-link" to="/hall-of-fame">
          ← Bảng vàng
        </Link>
        <p className="empty">Không tìm thấy PR đã nộp cho vận động viên này.</p>
      </div>
    )
  }

  const pr = athlete.personalRecord

  return (
    <div className="page">
      <Link className="back-link" to="/hall-of-fame">
        ← Bảng vàng
      </Link>

      <header className="page-header profile-header">
        <div className="avatar-wrap">
          {athlete.avatar ? (
            <img src={athlete.avatar} alt="" className="avatar" />
          ) : (
            <div className="avatar placeholder">
              {(athlete.fullName || '?').charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div>
          <h1>{athlete.fullName || 'Runner'}</h1>
          <p className="muted">
            {athlete.gender} · Level {athlete.level}
          </p>
        </div>
      </header>

      <section className="section panel">
        <h2>Personal Records</h2>
        <div className="pr-grid">
          <div className="pr-card">
            <span className="tiny muted">Full Marathon</span>
            <strong>{pr.fullMarathonTime || '—'}</strong>
            <span
              className={`verify-pill ${pr.isFullMarathonVerified ? 'yes' : 'no'}`}
            >
              {pr.isFullMarathonVerified ? 'Đã xác minh' : 'Chưa xác minh'}
            </span>
          </div>
          <div className="pr-card">
            <span className="tiny muted">Half Marathon</span>
            <strong>{pr.halfMarathonTime || '—'}</strong>
            <span
              className={`verify-pill ${pr.isHalfMarathonVerified ? 'yes' : 'no'}`}
            >
              {pr.isHalfMarathonVerified ? 'Đã xác minh' : 'Chưa xác minh'}
            </span>
          </div>
        </div>
      </section>

      <section className="section panel">
        <h2>Lịch sử</h2>
        {history.length === 0 ? (
          <p className="muted">Chưa có ghi chú lịch sử.</p>
        ) : (
          <ul className="history-list">
            {history.map((h) => (
              <li key={h.id}>
                <p>{h.content}</p>
                <span className="tiny muted">{h.timestamp}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
