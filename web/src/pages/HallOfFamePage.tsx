import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { onValue, ref } from 'firebase/database'
import { db } from '../lib/firebase'
import {
  displayTime,
  mapAthleteFromUser,
  rankAthletes,
  type AthletePrRow,
  type DistanceKey,
  type GenderKey,
} from '../lib/prRanking'

export function HallOfFamePage() {
  const [athletes, setAthletes] = useState<AthletePrRow[]>([])
  const [loading, setLoading] = useState(true)
  const [distance, setDistance] = useState<DistanceKey>('FM')
  const [gender, setGender] = useState<GenderKey>('Nam')

  useEffect(() => {
    const usersRef = ref(db, 'users')
    const unsub = onValue(usersRef, (snap) => {
      const val = (snap.val() ?? {}) as Record<string, Record<string, unknown>>
      const list = Object.entries(val)
        .map(([id, data]) => mapAthleteFromUser(id, data))
        .filter((a): a is AthletePrRow => a != null)
      setAthletes(list)
      setLoading(false)
    })
    return unsub
  }, [])

  const ranked = useMemo(
    () => rankAthletes(athletes, distance, gender),
    [athletes, distance, gender],
  )

  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow gold-eyebrow">Hall of Fame</p>
        <h1>Bảng vàng thành tích</h1>
        <p className="lede">
          Xếp hạng PR Full / Half Marathon đã được xác minh (theo giới tính).
        </p>
      </header>

      <div className="filter-row">
        {(
          [
            ['FM', 'Full Marathon'],
            ['HM', 'Half Marathon'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={distance === id ? 'chip active gold' : 'chip'}
            onClick={() => setDistance(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="filter-row">
        {(
          [
            ['Nam', 'Nam'],
            ['Nữ', 'Nữ'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={gender === id ? 'chip active' : 'chip'}
            onClick={() => setGender(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="empty">Đang tải…</p>
      ) : ranked.length === 0 ? (
        <p className="empty">Chưa có PR đã xác minh cho bộ lọc này.</p>
      ) : (
        <ol className="hof-list">
          {ranked.map((a, index) => {
            const rank = index + 1
            const top = rank <= 10
            return (
              <li key={a.id}>
                <Link
                  to={`/hall-of-fame/${a.id}`}
                  className={top ? 'hof-row top' : 'hof-row'}
                >
                  <span className={`hof-rank ${top ? 'gold' : ''}`}>{rank}</span>
                  <div className="hof-avatar">
                    {a.avatar ? (
                      <img src={a.avatar} alt="" />
                    ) : (
                      <span>{(a.fullName || '?').charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="hof-meta">
                    <strong>{a.fullName || 'Runner'}</strong>
                    <span className="tiny muted">
                      Lv {a.level}
                      {a.member ? ' · Member' : ''}
                    </span>
                  </div>
                  <span className="hof-time">{displayTime(a, distance)}</span>
                </Link>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
