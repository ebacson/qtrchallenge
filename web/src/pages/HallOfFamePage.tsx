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

const goldRingSrc = `${import.meta.env.BASE_URL}gold_ring.png`

function AvatarFace({
  athlete,
  size,
}: {
  athlete: AthletePrRow
  size: 'lg' | 'sm'
}) {
  if (athlete.avatar) {
    return <img src={athlete.avatar} alt="" className={`hof-face ${size}`} />
  }
  return (
    <span className={`hof-face placeholder ${size}`}>
      {(athlete.fullName || '?').charAt(0).toUpperCase()}
    </span>
  )
}

function TopLaureateCard({
  athlete,
  rank,
  distance,
}: {
  athlete: AthletePrRow
  rank: number
  distance: DistanceKey
}) {
  return (
    <Link to={`/hall-of-fame/${athlete.id}`} className="hof-laureate">
      <div className="hof-wreath">
        <img src={goldRingSrc} alt="" className="hof-wreath-img" />
        <AvatarFace athlete={athlete} size="lg" />
      </div>
      <p className="hof-laureate-rank">#{rank}</p>
      <strong className="hof-laureate-name">{athlete.fullName || 'Runner'}</strong>
      <span className="hof-laureate-time">{displayTime(athlete, distance)}</span>
      <span className="tiny muted">
        Lv {athlete.level}
        {athlete.member ? ' · Member' : ''}
      </span>
    </Link>
  )
}

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

  const top10 = ranked.slice(0, 10)
  const rest = ranked.slice(10)

  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow gold-eyebrow">Hall of Fame</p>
        <h1>Bảng vàng thành tích</h1>
        <p className="lede">
          Top 10 mang vòng nguyệt quế — xếp theo PR đã xác minh (hh:mm:ss).
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
        <>
          <section className="section hof-top-section">
            <h2>Top 10</h2>
            <div className="hof-laureate-column">
              {top10.map((a, index) => (
                <TopLaureateCard
                  key={a.id}
                  athlete={a}
                  rank={index + 1}
                  distance={distance}
                />
              ))}
            </div>
          </section>

          {rest.length > 0 && (
            <section className="section">
              <h2>Xếp hạng tiếp</h2>
              <ol className="hof-list" start={11}>
                {rest.map((a, index) => {
                  const rank = index + 11
                  return (
                    <li key={a.id}>
                      <Link to={`/hall-of-fame/${a.id}`} className="hof-row">
                        <span className="hof-rank">{rank}</span>
                        <div className="hof-avatar">
                          <AvatarFace athlete={a} size="sm" />
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
            </section>
          )}
        </>
      )}
    </div>
  )
}
