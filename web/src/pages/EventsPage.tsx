import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { onValue, ref } from 'firebase/database'
import { db } from '../lib/firebase'

export type ClubEvent = {
  id: string
  name: string
  raceday: string
  status: string
  location: string
  description: string
}

function mapEvent(id: string, data: Record<string, unknown>): ClubEvent {
  const info = (data.race_infor ?? {}) as Record<string, unknown>
  return {
    id,
    name: String(info.name ?? data.name ?? id),
    raceday: String(info.raceday ?? ''),
    status: String(info.infor ?? 'Coming soon'),
    location: String(info.location ?? ''),
    description: String(info.description ?? ''),
  }
}

export function EventsPage() {
  const [events, setEvents] = useState<ClubEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const eRef = ref(db, 'EVENT')
    const unsub = onValue(eRef, (snap) => {
      const val = (snap.val() ?? {}) as Record<string, Record<string, unknown>>
      const list = Object.entries(val)
        .map(([id, data]) => mapEvent(id, data))
        .sort((a, b) => b.raceday.localeCompare(a.raceday))
      setEvents(list)
      setLoading(false)
    })
    return unsub
  }, [])

  return (
    <div className="page">
      <header className="page-header">
        <h1>Events</h1>
        <p className="lede">Giải chạy / sự kiện từ Firebase EVENT.</p>
      </header>

      {loading ? (
        <p className="empty">Đang tải…</p>
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
    const eRef = ref(db, `EVENT/${id}`)
    const unsub = onValue(eRef, (snap) => {
      const val = snap.val() as Record<string, unknown> | null
      if (!val) {
        setEvent(null)
        setLoading(false)
        return
      }
      setEvent(mapEvent(id, val))
      const raw = (val.race_results ?? {}) as Record<
        string,
        Record<string, unknown>
      >
      const rows = Object.values(raw).map((row) => {
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(row)) out[k] = String(v ?? '')
        return out
      })
      rows.sort((a, b) =>
        String(a['Chip Time'] || '').localeCompare(String(b['Chip Time'] || '')),
      )
      setResults(rows)
      setLoading(false)
    })
    return unsub
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
