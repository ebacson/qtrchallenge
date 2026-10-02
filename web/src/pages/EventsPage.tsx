import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { get, ref } from 'firebase/database'
import { auth, db } from '../lib/firebase'

export type ClubEvent = {
  id: string
  name: string
  raceday: string
  status: string
  location: string
  description: string
}

const INFO_FIELDS = ['name', 'raceday', 'infor', 'location', 'description'] as const

/**
 * Chỉ đọc các trường chữ: mỗi event còn ảnh base64 (race_infor.icon, adv) tới vài MB
 * mà trang này không dùng.
 */
async function loadEvent(id: string): Promise<ClubEvent | null> {
  const base = `EVENT/${id}`
  const [rootName, ...infoSnaps] = await Promise.all([
    get(ref(db, `${base}/name`)),
    ...INFO_FIELDS.map((f) => get(ref(db, `${base}/race_infor/${f}`))),
  ])
  const info = Object.fromEntries(INFO_FIELDS.map((f, i) => [f, infoSnaps[i].val()]))
  if (!rootName.exists() && infoSnaps.every((s) => !s.exists())) return null
  return {
    id,
    name: String(info.name ?? rootName.val() ?? id),
    raceday: String(info.raceday ?? ''),
    status: String(info.infor ?? 'Coming soon'),
    location: String(info.location ?? ''),
    description: String(info.description ?? ''),
  }
}

/** Danh sách id event không tải dữ liệu con (REST `shallow`). */
async function loadEventIds(): Promise<string[]> {
  const token = await auth.currentUser?.getIdToken()
  const dbUrl = String(db.app.options.databaseURL ?? '').replace(/\/+$/, '')
  const url = new URL(`${dbUrl}/EVENT.json`)
  url.searchParams.set('shallow', 'true')
  if (token) url.searchParams.set('auth', token)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Không tải được danh sách event (${res.status})`)
  const val = (await res.json()) as Record<string, unknown> | null
  return Object.keys(val ?? {})
}

/** Ngày "dd-MM-yyyy" → khoá sắp xếp "yyyyMMdd". */
function racedayKey(raceday: string): string {
  const m = raceday.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
  return m ? `${m[3]}${m[2].padStart(2, '0')}${m[1].padStart(2, '0')}` : raceday
}

export function EventsPage() {
  const [events, setEvents] = useState<ClubEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void loadEventIds()
      .then((ids) => Promise.all(ids.map(loadEvent)))
      .then((list) => {
        if (cancelled) return
        setEvents(
          list
            .filter((e): e is ClubEvent => e != null)
            .sort((a, b) => racedayKey(b.raceday).localeCompare(racedayKey(a.raceday))),
        )
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Không tải được event')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="page">
      <header className="page-header">
        <h1>Events</h1>
        <p className="lede">Giải chạy / sự kiện do QTR tổ chức.</p>
      </header>

      {loading ? (
        <p className="empty">Đang tải…</p>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : events.length === 0 ? (
        <p className="empty">Chưa có event.</p>
      ) : (
        <div className="event-list">
          {events.map((e) => (
            <Link
              key={e.id}
              to={`/events/${encodeURIComponent(e.id)}`}
              className="event-card"
            >
              <div className="event-card-body">
                <span className="status-pill status-upcoming">{e.status}</span>
                <h3>{e.name}</h3>
                <p className="muted">
                  {e.raceday || 'Chưa có ngày'}
                  {e.location ? ` · ${e.location}` : ''}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>()
  const id = eventId ? decodeURIComponent(eventId) : ''
  const [event, setEvent] = useState<ClubEvent | null>(null)
  const [results, setResults] = useState<Record<string, string>[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    void Promise.all([loadEvent(id), get(ref(db, `EVENT/${id}/race_results`))])
      .then(([info, resultsSnap]) => {
        if (cancelled) return
        setEvent(info)
        const raw = (resultsSnap.val() ?? {}) as Record<string, Record<string, unknown> | null>
        const rows = Object.values(raw)
          .filter((row): row is Record<string, unknown> => row != null)
          .map((row) => {
            const out: Record<string, string> = {}
            for (const [k, v] of Object.entries(row)) out[k] = String(v ?? '')
            return out
          })
        rows.sort((a, b) =>
          String(a['Chip Time'] || '').localeCompare(String(b['Chip Time'] || '')),
        )
        setResults(rows)
      })
      .catch(() => {
        if (!cancelled) setEvent(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return (
      <div className="page">
        <p className="empty">Đang tải…</p>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="page">
        <Link className="back-link" to="/events">
          ← Events
        </Link>
        <p className="empty">Không tìm thấy event.</p>
      </div>
    )
  }

  return (
    <div className="page">
      <Link className="back-link" to="/events">
        ← Events
      </Link>
      <header className="page-header">
        <span className="status-pill status-upcoming">{event.status}</span>
        <h1>{event.name}</h1>
        <p className="lede">
          {event.raceday}
          {event.location ? ` · ${event.location}` : ''}
        </p>
      </header>
      {event.description && (
        <section className="section panel">
          <h2>Thông tin</h2>
          <p className="body-text">{event.description}</p>
        </section>
      )}
      <section className="section panel">
        <h2>Kết quả ({results.length})</h2>
        {results.length === 0 ? (
          <p className="muted">Chưa có bảng xếp hạng.</p>
        ) : (
          <div className="results-table-wrap">
            <table className="results-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>BIB</th>
                  <th>Chip</th>
                  <th>Distance</th>
                </tr>
              </thead>
              <tbody>
                {results.slice(0, 100).map((r, i) => (
                  <tr key={`${r.BIB}-${i}`}>
                    <td>{i + 1}</td>
                    <td>{r.Name || '—'}</td>
                    <td>{r.BIB || '—'}</td>
                    <td>{r['Chip Time'] || '—'}</td>
                    <td>{r.Distance || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
