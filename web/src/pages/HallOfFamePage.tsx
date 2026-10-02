import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useUserProfiles } from '../lib/userWrites'
import {
  displayTime,
  mapAthleteFromUser,
  rankAthletes,
  type AthletePrRow,
  type DistanceKey,
  type GenderKey,
} from '../lib/prRanking'
import { parseHistory, type HistoryEntry } from '../lib/userRecords'

const goldRingSrc = `${import.meta.env.BASE_URL}gold_ring.png`
const HISTORY_PREVIEW = 2

const DISTANCE_LABEL: Record<DistanceKey, string> = {
  FM: 'Full Marathon',
  HM: 'Half Marathon',
}

function AvatarFace({
  athlete,
  size,
}: {
  athlete: AthletePrRow
  size: 'md' | 'sm'
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
  history,
}: {
  athlete: AthletePrRow
  rank: number
  distance: DistanceKey
  history: HistoryEntry[]
}) {
  const preview = history.slice(0, HISTORY_PREVIEW)
  const more = history.length - preview.length
  return (
    <Link
      to={`/hall-of-fame/${athlete.id}`}
      className={`hof-laureate-card${rank <= 3 ? ` podium podium-${rank}` : ''}`}
    >
      <div className="hof-wreath md">
        <img src={goldRingSrc} alt="" className="hof-wreath-img" />
        <AvatarFace athlete={athlete} size="md" />
      </div>
      <div className="hof-laureate-info">
        <span className="hof-laureate-rank">Top {rank}</span>
        <strong className="hof-laureate-name">{athlete.fullName || 'Runner'}</strong>
        <span className="hof-laureate-result">
          <span className="hof-laureate-time">{displayTime(athlete, distance)}</span>
          <span className="tiny muted">{DISTANCE_LABEL[distance]}</span>
        </span>
        <div className="hof-laureate-history">
          <span className="tiny muted">Lịch sử</span>
          {preview.length === 0 ? (
            <p className="tiny muted">Chưa có lịch sử thành tích.</p>
          ) : (
            <ul>
              {preview.map((h) => (
                <li key={h.id}>{h.content.split('\n')[0]}</li>
              ))}
              {more > 0 && <li className="muted">+{more} mục khác</li>}
            </ul>
          )}
        </div>
      </div>
    </Link>
  )
}

export function HallOfFamePage() {
  const profiles = useUserProfiles()
  const loading = profiles === null
  const [distance, setDistance] = useState<DistanceKey>('FM')
  const [gender, setGender] = useState<GenderKey>('Nam')

  const { athletes, histories } = useMemo(() => {
    const val = profiles ?? {}
    const list = Object.entries(val)
      .map(([id, data]) => mapAthleteFromUser(id, data))
      .filter((a): a is AthletePrRow => a != null)
    const historyMap: Record<string, HistoryEntry[]> = {}
    for (const a of list) historyMap[a.id] = parseHistory(val[a.id]?.history)
    return { athletes: list, histories: historyMap }
  }, [profiles])

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
          Bảng vàng vinh danh các thành viên có thành tích cao trong thi đấu.
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
            <div className="hof-laureate-list">
              {top10.map((a, index) => (
                <TopLaureateCard
                  key={a.id}
                  athlete={a}
                  rank={index + 1}
                  distance={distance}
                  history={histories[a.id] ?? []}
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
