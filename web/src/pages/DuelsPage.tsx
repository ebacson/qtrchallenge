import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  activeDuelCount,
  DUEL_PHASE_LABELS,
  DUELS_PATH,
  duelGoalText,
  duelPhase,
  isJoinOpen,
  MAX_ACTIVE_DUELS,
  parseDuels,
  stakeSummary,
  type Duel,
  type DuelPhase,
} from '../lib/duels'
import { codeMatchesQuery, duelCode } from '../lib/payment'
import { useSharedValue } from '../lib/sharedValue'

type Tab = 'invites' | 'open' | 'mine' | 'finished' | 'review'

function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
}

export function DuelPhasePill({ phase }: { phase: DuelPhase }) {
  return <span className={`duel-phase duel-phase-${phase}`}>{DUEL_PHASE_LABELS[phase]}</span>
}

function DuelCard({ duel, uid, now, codeHit }: { duel: Duel; uid: string; now: number; codeHit?: string }) {
  const phase = duelPhase(duel, now)
  const joined = Boolean(duel.participants[uid])
  const invited = duel.invited.includes(uid) && !joined
  const count = Object.keys(duel.participants).length
  const stake = stakeSummary(duel)
  return (
    <li>
      <Link to={`/duels/${duel.id}`} className="lucky-card panel duel-card">
        <DuelPhasePill phase={phase} />
        <strong>{duel.title}</strong>
        <span className="tiny">{duelGoalText(duel)}</span>
        <span className="tiny muted">
          {duel.startDate} → {duel.endDate} · {count} người · Tạo bởi {duel.createdByName || '—'}
        </span>
        {stake && <span className="tiny muted">Cam kết: {stake}</span>}
        {codeHit && <span className="tiny lucky-me">Mã {codeHit}</span>}
        {joined ? (
          <span className="tiny lucky-me">
            {duel.createdBy === uid ? '★ Bạn là người tạo' : '✓ Bạn đã tham gia'}
          </span>
        ) : invited && duel.declined[uid] ? (
          <span className="tiny muted">Bạn đã từ chối lời mời</span>
        ) : invited ? (
          <span className="tiny lucky-me">✉ Bạn được mời</span>
        ) : null}
      </Link>
    </li>
  )
}

export function DuelsPage() {
  const { user, profile } = useAuth()
  const isAdmin = Boolean(profile?.admin)
  const canCreate = Boolean(profile?.member || profile?.admin)
  const raw = useSharedValue<Record<string, unknown>>(DUELS_PATH)
  const [tab, setTab] = useState<Tab>('open')
  const [query, setQuery] = useState('')
  const [now] = useState(() => Date.now())
  const uid = user?.uid ?? ''
  const duels = parseDuels(raw)

  const visible = duels.filter(
    (d) => d.approval.status === 'approved' || d.createdBy === uid || isAdmin,
  )
  const lists: Record<Tab, Duel[]> = {
    invites: visible.filter(
      (d) =>
        isJoinOpen(d, now) && d.invited.includes(uid) && !d.participants[uid] && !d.declined[uid],
    ),
    open: visible.filter((d) => {
      const phase = duelPhase(d, now)
      return phase === 'upcoming' || phase === 'ongoing'
    }),
    mine: visible.filter((d) => d.createdBy === uid || Boolean(d.participants[uid])),
    finished: visible.filter((d) => duelPhase(d, now) === 'finished'),
    review: visible.filter((d) => {
      const phase = duelPhase(d, now)
      return phase === 'pending' || phase === 'expired'
    }),
  }
  const tabs: { value: Tab; label: string }[] = [
    { value: 'invites', label: 'Lời mời' },
    { value: 'open', label: 'Đang diễn ra' },
    { value: 'mine', label: 'Của tôi' },
    { value: 'finished', label: 'Đã kết thúc' },
    ...(isAdmin ? [{ value: 'review' as const, label: 'Chờ duyệt' }] : []),
  ]

  const q = query.trim()
  const folded = foldText(q)
  const codeHits = new Map<string, string>()
  const searched = q
    ? visible.filter((d) => {
        if (foldText(d.title).includes(folded)) return true
        for (const pid of Object.keys(d.participants)) {
          const code = duelCode(d, pid)
          if (codeMatchesQuery(code, q)) {
            codeHits.set(d.id, `${code} — ${d.participants[pid].name}`)
            return true
          }
        }
        return false
      })
    : null
  const shown = searched ?? lists[tab]
  const active = activeDuelCount(duels, uid, now)

  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">Câu lạc bộ</p>
        <h1>Thách đấu</h1>
        <p className="lede">
          Thách đấu do thành viên chính thức tạo, Admin duyệt. Không tính vào thưởng phạt, level hay
          quỹ CLB.
        </p>
      </header>

      <div className="finance-toolbar gift-toolbar">
        <label className="search-field">
          Tìm thách đấu
          <input
            type="search"
            value={query}
            placeholder="Tên thách đấu hoặc mã QTRD…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {canCreate &&
          (isAdmin || active < MAX_ACTIVE_DUELS ? (
            <Link className="btn primary" to="/duels/new">
              <Plus size={16} aria-hidden /> Tạo thách đấu
            </Link>
          ) : (
            <p className="tiny muted">
              Bạn đang có {active} thách đấu chờ duyệt hoặc đang chạy (tối đa {MAX_ACTIVE_DUELS}).
            </p>
          ))}
      </div>

      {!searched && (
        <div className="filter-row">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              className={tab === t.value ? 'chip active' : 'chip'}
              onClick={() => setTab(t.value)}
            >
              {t.label} ({lists[t.value].length})
            </button>
          ))}
        </div>
      )}

      {raw === undefined ? (
        <p className="empty">Đang tải…</p>
      ) : shown.length === 0 ? (
        <p className="empty">
          {searched ? 'Không tìm thấy thách đấu phù hợp.' : 'Chưa có thách đấu nào.'}
        </p>
      ) : (
        <ul className="lucky-list duel-list">
          {shown.map((d) => (
            <DuelCard key={d.id} duel={d} uid={uid} now={now} codeHit={codeHits.get(d.id)} />
          ))}
        </ul>
      )}
    </div>
  )
}
