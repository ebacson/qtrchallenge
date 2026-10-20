import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { ActivityTrendPanel } from './ActivityTrendPanel'
import { RacePredictPanel } from './RacePredictPanel'
import { formatPaceMinutes, paceToMinutes } from '../lib/activityTrends'
import { STATUS_FINISHED, STATUS_ONGOING } from '../lib/challengeRules'
import {
  buildMemberChallengeEntries,
  type MyChallengeEntry,
} from '../lib/myChallengeStats'
import { completionPercent, formatVnd } from '../lib/rewardPenalty'
import { useSharedValue } from '../lib/sharedValue'

export type AdminMemberDetailTarget = {
  id: string
  fullName: string
  email: string
  avatar: string
  level: number
  member: boolean
  memberSince: number
  memberUntil: number
  admin: boolean
  phone: string
  gender: string
  dob: string
  idStrava: string
  userStrava: string
  raw: Record<string, unknown>
}

const STAT_TYPES = new Set(['Run', 'TrailRun', 'Walk'])

type Act = { type: string; distance: string; pace: string; startDate: string }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function entryResult(e: MyChallengeEntry): { tone: string; main: string; sub: string } {
  if (!e.joined) return { tone: 'underHalf', main: 'Không tham gia', sub: '' }
  const c = e.completion
  if (!c) return { tone: '', main: '—', sub: '' }
  const pct = `${completionPercent(c.ratio)}%`
  if (c.tier === 'completed') return { tone: 'completed', main: pct, sub: '✓ Hoàn thành' }
  if (e.challenge.status === STATUS_ONGOING) return { tone: '', main: pct, sub: 'Đang diễn ra' }
  return { tone: c.tier, main: pct, sub: 'Không hoàn thành' }
}

function PenaltyBadge({ entry }: { entry: MyChallengeEntry }) {
  if (!(entry.originalPenalty > 0)) return null
  if (entry.waived) return <span className="penalty-pay-badge waived">Miễn phạt</span>
  if (entry.paid) return <span className="penalty-pay-badge paid">✓ Đã nộp</span>
  return <span className="penalty-pay-badge unpaid">Chưa nộp</span>
}

/** Chi tiết thành viên cho Admin — cùng các chỉ số như trang Thống kê của chính thành viên. */
export function AdminMemberDetailDialog({
  member,
  onClose,
}: {
  member: AdminMemberDetailTarget
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const rawActivities = useSharedValue<Record<string, Record<string, unknown>>>(
    `users/${member.id}/strava_activities`,
  )
  const rawChallenges = useSharedValue<Record<string, Record<string, unknown>>>('challenges')
  const loadingActivities = rawActivities === undefined

  const acts = useMemo<Act[]>(
    () =>
      Object.values(rawActivities ?? {}).map((row) => ({
        type: String(row.type ?? ''),
        distance: String(row.distance ?? ''),
        pace: String(row.pace ?? ''),
        startDate: String(row.startDate ?? ''),
      })),
    [rawActivities],
  )

  const stats = useMemo(() => {
    const eligible = acts.filter((a) => STAT_TYPES.has(a.type))
    let totalKm = 0
    let bestPace = Number.POSITIVE_INFINITY
    let longest = 0
    let paceSum = 0
    let paceCount = 0
    for (const a of eligible) {
      const km = Number(a.distance) || 0
      totalKm += km
      if (km > longest) longest = km
      const p = paceToMinutes(a.pace)
      if (p > 0) {
        if (p < bestPace) bestPace = p
        paceSum += p
        paceCount += 1
      }
    }
    return {
      count: eligible.length,
      totalKm: totalKm.toFixed(1),
      longest: longest.toFixed(1),
      bestPace: formatPaceMinutes(bestPace),
      avgPace: formatPaceMinutes(paceCount ? paceSum / paceCount : 0),
    }
  }, [acts])

  const entries = useMemo(
    () =>
      rawChallenges === undefined
        ? null
        : buildMemberChallengeEntries(rawChallenges, member.id, {
            member: member.member,
            memberSince: member.memberSince || undefined,
            memberUntil: member.memberUntil || undefined,
          }),
    [rawChallenges, member.id, member.member, member.memberSince, member.memberUntil],
  )

  const isMember = Boolean(member.member || member.memberUntil)
  const joined = (entries ?? []).filter((e) => e.joined)
  const completed = joined.filter((e) => e.completion?.tier === 'completed').length
  const failed = joined.filter(
    (e) => e.challenge.status === STATUS_FINISHED && e.completion && e.completion.tier !== 'completed',
  ).length
  const totalPenalty = (entries ?? []).reduce((sum, e) => sum + e.penalty, 0)
  const paidAmount = (entries ?? []).reduce((sum, e) => sum + (e.paid ? e.penalty : 0), 0)
  const won = (entries ?? []).flatMap((e) => e.prizes.map((p) => ({ ...p, challenge: e.challenge })))

  const personalRecord = asRecord(member.raw.personalRecord)
  const fmTime = String(member.raw.fullMarathonTime ?? personalRecord?.fullMarathonTime ?? '')
  const hmTime = String(member.raw.halfMarathonTime ?? personalRecord?.halfMarathonTime ?? '')
  const fmVerified = Boolean(member.raw.isFullMarathonVerified ?? personalRecord?.isFullMarathonVerified)
  const hmVerified = Boolean(member.raw.isHalfMarathonVerified ?? personalRecord?.isHalfMarathonVerified)

  return createPortal(
    <div className="pay-overlay" onClick={onClose}>
      <div
        className="pay-sheet member-detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pay-head">
          <div className="member-detail-identity">
            <div className="hof-avatar">
              {member.avatar ? (
                <img src={member.avatar} alt="" />
              ) : (
                <span>{(member.fullName || '?').charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div>
              <h3 id="member-detail-title">{member.fullName || 'Runner'}</h3>
              <p className="tiny muted">{member.email}</p>
              <div className="profile-badges">
                {member.admin && <span className="admin-badge prominent">Admin</span>}
                <span className={`member-badge ${member.member ? 'yes' : 'no'}`}>
                  {member.member ? 'Chính thức' : 'Tự do'}
                </span>
                <span className="level-badge level-bronze">Lv {member.level}</span>
              </div>
            </div>
          </div>
          <button type="button" className="btn ghost compact" aria-label="Đóng" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>

        <dl className="admin-user-info member-detail-info">
          <div>
            <dt>Điện thoại</dt>
            <dd>{member.phone || '—'}</dd>
          </div>
          <div>
            <dt>Ngày sinh</dt>
            <dd>{member.dob || '—'}</dd>
          </div>
          <div>
            <dt>Strava</dt>
            <dd>
              {member.idStrava ? (
                <a
                  href={`https://www.strava.com/athletes/${member.idStrava}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {member.userStrava || member.idStrava}
                </a>
              ) : (
                'Chưa kết nối'
              )}
            </dd>
          </div>
        </dl>

        <section className="member-detail-block">
          <h4>Hoạt động</h4>
          {loadingActivities ? (
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
                  <strong>{member.level}</strong>
                  <span>Level</span>
                </div>
              </div>
            </>
          )}
        </section>

        {!loadingActivities && (
          <>
            <ActivityTrendPanel activities={acts} />
            <RacePredictPanel activities={acts} />
          </>
        )}

        <section className="member-detail-block">
          <h4>Thử thách</h4>
          {entries === null ? (
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

              <p className="tiny muted">
                🎁 Nhận thưởng: <strong>{won.length}</strong>
                {won.length ? ' phần quà' : ' — chưa trúng thưởng lần nào'}
              </p>
              {won.length > 0 && (
                <ul className="reward-recipient-prizes">
                  {won.map((p, i) => (
                    <li key={`${p.challenge.id}-${p.target}-${i}`}>
                      <span className="tiny">
                        <Link to={`/challenges/${p.challenge.id}`}>{p.challenge.name || 'Thử thách'}</Link>{' '}
                        <span className="muted">· {p.target}</span>
                      </span>
                      {p.prize && <span className="reward-winner-prize">{p.prize}</span>}
                    </li>
                  ))}
                </ul>
              )}

              {entries.length === 0 ? (
                <p className="empty">Chưa có thử thách nào.</p>
              ) : (
                <ul className="participant-list">
                  {entries.map((e) => {
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

        <section className="member-detail-block">
          <h4>Marathon PR (hồ sơ)</h4>
          <p>
            FM: <strong>{fmTime || '—'}</strong> {fmTime ? (fmVerified ? '✓' : '(chưa xác minh)') : ''}
          </p>
          <p>
            HM: <strong>{hmTime || '—'}</strong> {hmTime ? (hmVerified ? '✓' : '(chưa xác minh)') : ''}
          </p>
        </section>
      </div>
    </div>,
    document.body,
  )
}
