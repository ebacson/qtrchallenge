import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useSharedValue } from '../lib/sharedValue'
import { timeToSeconds } from '../lib/prRanking'
import { STATUS_FINISHED, STATUS_ONGOING } from '../lib/challengeRules'
import { useMyChallengeEntries, type MyChallengeEntry } from '../lib/myChallengeStats'
import { completionPercent, formatVnd, REWARD_START_YEAR } from '../lib/rewardPenalty'

type Act = {
  type: string
  distance: string
  pace: string
  startDate: string
}

const STAT_TYPES = new Set(['Run', 'TrailRun', 'Walk'])

function paceToMinutes(pace: string): number {
  const sec = timeToSeconds(pace.length === 5 ? `0:${pace}` : pace)
  return sec === Number.POSITIVE_INFINITY ? -1 : sec / 60
}

type ChallengeEntry = MyChallengeEntry

const ALL_YEARS = 'all'

function entryResult(e: ChallengeEntry): { tone: string; main: string; sub: string } {
  if (!e.joined) return { tone: 'underHalf', main: 'Không tham gia', sub: '' }
  const c = e.completion
  if (!c) return { tone: '', main: '—', sub: '' }
  const pct = `${completionPercent(c.ratio)}%`
  if (c.tier === 'completed') return { tone: 'completed', main: pct, sub: '✓ Hoàn thành' }
  if (e.challenge.status === STATUS_ONGOING) return { tone: '', main: pct, sub: 'Đang diễn ra' }
  return { tone: c.tier, main: pct, sub: 'Không hoàn thành' }
}

function PenaltyBadge({ entry }: { entry: ChallengeEntry }) {
  if (!(entry.originalPenalty > 0)) return null
  if (entry.waived) return <span className="penalty-pay-badge waived">Miễn phạt</span>
  if (entry.paid) return <span className="penalty-pay-badge paid">✓ Đã nộp</span>
  return <span className="penalty-pay-badge unpaid">Chưa nộp</span>
}

function ChallengeStats() {
  const { profile } = useAuth()
  const isMember = Boolean(profile?.member)
  const [year, setYear] = useState(ALL_YEARS)
  const loaded = useMyChallengeEntries()
  const entries = useMemo(() => loaded ?? [], [loaded])

  const years = useMemo(
    () => [...new Set(entries.map((e) => e.year).filter(Boolean))].sort((a, b) => b - a),
    [entries],
  )

  const visible = year === ALL_YEARS ? entries : entries.filter((e) => String(e.year) === year)
  const joined = visible.filter((e) => e.joined)
  const completed = joined.filter((e) => e.completion?.tier === 'completed').length
  const failed = joined.filter(
    (e) =>
      e.challenge.status === STATUS_FINISHED && e.completion && e.completion.tier !== 'completed',
  ).length
  const ongoing = joined.filter(
    (e) => e.challenge.status === STATUS_ONGOING && e.completion?.tier !== 'completed',
  ).length
  const absentCount = visible.length - joined.length
  const totalPenalty = visible.reduce((sum, e) => sum + e.penalty, 0)
  const paidAmount = visible.reduce((sum, e) => sum + (e.paid ? e.penalty : 0), 0)
  const won = visible.flatMap((e) => e.prizes.map((p) => ({ ...p, challenge: e.challenge })))

  return (
    <section className="section panel">
      <div className="section-head">
        <h2>Thử thách</h2>
        {years.length > 0 && (
          <select
            className="stats-year-select"
            value={year}
            aria-label="Lọc theo năm"
            onChange={(e) => setYear(e.target.value)}
          >
            <option value={ALL_YEARS}>Tất cả các năm</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>
                Năm {y}
              </option>
            ))}
          </select>
        )}
      </div>

      {loaded === null ? (
        <p className="empty">Đang tải…</p>
      ) : (
        <>
          <div className="stat-row">
            <div className="stat">
              <strong>{joined.length}</strong>
              <span>Đã tham gia</span>
            </div>
            <div className="stat">
              <strong>{completed}</strong>
              <span>Hoàn thành</span>
            </div>
            <div className="stat">
              <strong>{failed}</strong>
              <span>Không hoàn thành</span>
            </div>
            {isMember && (
              <>
                <div className="stat">
                  <strong className="stat-money">{formatVnd(totalPenalty)}</strong>
                  <span>Tiền phạt</span>
                </div>
                <div className="stat">
                  <strong className="stat-money stat-paid">{formatVnd(paidAmount)}</strong>
                  <span>Đã nộp</span>
                </div>
                <div className="stat">
                  <strong className="stat-money stat-unpaid">
                    {formatVnd(totalPenalty - paidAmount)}
                  </strong>
                  <span>Chưa nộp</span>
                </div>
              </>
            )}
          </div>
          <p className="tiny muted penalty-pay-summary">
            {[
              ongoing > 0 && `Đang diễn ra ${ongoing} thử thách`,
              isMember && absentCount > 0 && `Không tham gia ${absentCount} thử thách (bị phạt)`,
              isMember
                ? `Tiền phạt tính các thử thách đã kết thúc từ năm ${REWARD_START_YEAR}.`
                : 'Thưởng – phạt chỉ áp dụng cho thành viên chính thức.',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>

          <div className={`stats-rewards${won.length ? ' has-prizes' : ''}`}>
            <p>
              🎁 <strong>Nhận thưởng: {won.length}</strong>{' '}
              {won.length ? 'phần quà' : '— chưa trúng thưởng lần nào'}
            </p>
            {won.length > 0 && (
              <ul className="reward-recipient-prizes">
                {won.map((p, i) => (
                  <li key={`${p.challenge.id}-${p.target}-${i}`}>
                    <span className="tiny">
                      <Link to={`/challenges/${p.challenge.id}`}>
                        {p.challenge.name || 'Thử thách'}
                      </Link>{' '}
                      <span className="muted">· {p.target}</span>
                    </span>
                    {p.prize && <span className="reward-winner-prize">{p.prize}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {visible.length === 0 ? (
            <p className="empty">Chưa có thử thách nào.</p>
          ) : (
            <ul className="participant-list">
              {visible.map((e) => {
                const result = entryResult(e)
                return (
                  <li key={e.challenge.id} className="participant-row">
                    <div className="participant-meta">
                      <Link to={`/challenges/${e.challenge.id}`}>
                        <strong>{e.challenge.name || 'Thử thách'}</strong>
                      </Link>
                      <span className="tiny muted">
                        {e.challenge.startDate} → {e.challenge.endDate}
                        {e.originalPenalty > 0 && ` · Phạt ${formatVnd(e.originalPenalty)}`}
                      </span>
                      <span className="penalty-pay">
                        <PenaltyBadge entry={e} />
                        {e.prizes.map((p, i) => (
                          <span key={i} className="reward-winner-prize">
                            🎁 {p.prize || 'Trúng thưởng'}
                          </span>
                        ))}
                      </span>
                    </div>
                    <span className={`reward-amount ${result.tone}`}>
                      <strong>{result.main}</strong>
                      {result.sub && <small>{result.sub}</small>}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

export function StatsPage() {
  const { user, profile } = useAuth()
  const raw = useSharedValue<Record<string, Record<string, unknown>>>(
    user ? `users/${user.uid}/strava_activities` : null,
  )
  const loading = raw === undefined

  const acts = useMemo<Act[]>(
    () =>
      Object.values(raw ?? {}).map((row) => ({
        type: String(row.type ?? ''),
        distance: String(row.distance ?? ''),
        pace: String(row.pace ?? ''),
        startDate: String(row.startDate ?? ''),
      })),
    [raw],
  )

  const stats = useMemo(() => {
    const eligible = acts.filter((a) => STAT_TYPES.has(a.type))
    let totalKm = 0
    let bestPace = Number.POSITIVE_INFINITY
    let longest = 0
    for (const a of eligible) {
      const km = Number(a.distance) || 0
      totalKm += km
      if (km > longest) longest = km
      const p = paceToMinutes(a.pace)
      if (p > 0 && p < bestPace) bestPace = p
    }
    const avgPace =
      eligible.length === 0
        ? 0
        : eligible.reduce((s, a) => {
            const p = paceToMinutes(a.pace)
            return s + (p > 0 ? p : 0)
          }, 0) / Math.max(1, eligible.filter((a) => paceToMinutes(a.pace) > 0).length)

    const formatPace = (mins: number) => {
      if (!mins || !Number.isFinite(mins) || mins === Number.POSITIVE_INFINITY) {
        return '—'
      }
      const m = Math.floor(mins)
      const s = Math.round((mins - m) * 60)
      return `${m}:${String(s).padStart(2, '0')}`
    }

    return {
      count: eligible.length,
      totalKm: totalKm.toFixed(1),
      longest: longest.toFixed(1),
      bestPace: formatPace(bestPace),
      avgPace: formatPace(avgPace),
    }
  }, [acts])

  return (
    <div className="page">
      <header className="page-header">
        <h1>Thống kê</h1>
        <p className="lede">
          Tổng hợp Run / TrailRun / Walk từ activities đã sync.
        </p>
      </header>

      {loading ? (
        <p className="empty">Đang tải…</p>
      ) : (
        <>
          <div className="stat-row">
            <div className="stat">
              <strong>{stats.count}</strong>
              <span>Hoạt động</span>
            </div>
            <div className="stat">
              <strong>{stats.totalKm}</strong>
              <span>Km</span>
            </div>
            <div className="stat">
              <strong>{stats.longest}</strong>
              <span>Longest</span>
            </div>
          </div>
          <div className="stat-row">
            <div className="stat">
              <strong>{stats.bestPace}</strong>
              <span>Best pace</span>
            </div>
            <div className="stat">
              <strong>{stats.avgPace}</strong>
              <span>Avg pace</span>
            </div>
            <div className="stat">
              <strong>{profile?.level ?? 0}</strong>
              <span>Level</span>
            </div>
          </div>

          <ChallengeStats />

          <section className="section panel">
            <h2>Marathon PR (hồ sơ)</h2>
            <p>
              FM: <strong>{profile?.fullMarathonTime || '—'}</strong>{' '}
              {profile?.isFullMarathonVerified ? '✓' : '(chưa xác minh)'}
            </p>
            <p>
              HM: <strong>{profile?.halfMarathonTime || '—'}</strong>{' '}
              {profile?.isHalfMarathonVerified ? '✓' : '(chưa xác minh)'}
            </p>
          </section>
        </>
      )}
    </div>
  )
}
