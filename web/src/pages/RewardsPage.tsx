import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSharedValue } from '../lib/sharedValue'
import { useUserProfiles } from '../lib/userWrites'
import {
  parseChallenge,
  parseChallengeDay,
  STATUS_FINISHED,
  STATUS_ONGOING,
  STATUS_UPCOMING,
  statusClass,
} from '../lib/challengeRules'
import {
  completionPercent,
  formatVnd,
  isRewardEligible,
  applyPenaltyWaiver,
  participantCompletion,
  penaltySummary,
  penaltyTiersOf,
  REWARD_START_YEAR,
  rewardItemsSummary,
  tierRangeLabel,
  tierStyle,
  type ParticipantCompletion,
} from '../lib/rewardPenalty'
import { PenaltyPaymentControl } from '../components/PenaltyPaymentControl'
import { RewardDrawSection } from '../components/RewardDraw'
import type { Challenge } from '../types'

type Profile = { fullName: string; avatar: string; member: boolean; email: string }

type ReportRow = {
  uid: string
  name: string
  avatar: string
  completion: ParticipantCompletion
}

type AbsentRow = { uid: string; name: string; avatar: string }

type ChallengeReport = {
  challenge: Challenge
  userChallenges: Record<string, Record<string, unknown> | null>
  rows: ReportRow[]
  /** Thành viên chính thức không đăng ký tham gia (chỉ liệt kê, không phạt) */
  absent: AbsentRow[]
  endMs: number
}

const SYSTEM_EMAILS = new Set(['echiptime@gmail.com'])

const ALL = 'all'

type Names = Record<string, { name: string; avatar: string }>

function formatAmount(value: number, unit: ParticipantCompletion['unit']): string {
  return value.toLocaleString('vi-VN', { maximumFractionDigits: unit === 'km' ? 2 : 0 })
}

function penaltyLabel(c: ParticipantCompletion): string {
  if (c.tier === 'completed') return '✓ Hoàn thành'
  if (c.waived) return c.waived.originalPenalty ? 'Miễn phạt' : 'Không phạt'
  return c.penalty ? `−${formatVnd(c.penalty)}` : 'Không phạt'
}

function Avatar({ name, avatar }: { name: string; avatar: string }) {
  return (
    <div className="hof-avatar">
      {avatar ? <img src={avatar} alt="" /> : <span>{(name || '?').charAt(0).toUpperCase()}</span>}
    </div>
  )
}

function ChallengeReportView({ report, names }: { report: ChallengeReport; names: Names }) {
  const { challenge, rows, absent } = report
  const completed = rows.filter((r) => r.completion.tier === 'completed').length
  const failed = rows.length - completed
  const totalPenalty = rows.reduce((sum, r) => sum + r.completion.penalty, 0)
  const penalized = rows.filter((r) => r.completion.penalty > 0)
  const paid = penalized.filter((r) => challenge.penaltyPayments?.[r.uid])
  const paidAmount = paid.reduce((sum, r) => sum + r.completion.penalty, 0)
  const waivedCount = rows.filter((r) => r.completion.waived?.originalPenalty).length
  const ongoing = challenge.status === STATUS_ONGOING
  const tiers = penaltyTiersOf(challenge)
  const sections = [
    { key: 'completed', index: -1, title: 'Hoàn thành', hint: 'Đạt 100% mục tiêu' },
    ...(tiers.length
      ? tiers.map((t, i) => ({
          key: `tier-${i}`,
          index: i,
          title:
            tiers.length === 1
              ? 'Không hoàn thành'
              : `Không hoàn thành (${tierRangeLabel(tiers, i).toLowerCase()})`,
          hint: t.amount ? `Phạt ${formatVnd(t.amount)}` : 'Không phạt',
        }))
      : [
          {
            key: 'tier-0',
            index: 0,
            title: 'Không hoàn thành',
            hint: 'Thử thách không đặt mức phạt',
          },
        ]),
  ]

  return (
    <>
      <div className="reward-challenge-head">
        <Link to={`/challenges/${challenge.id}`}>
          <strong>{challenge.name || 'Thử thách'}</strong>
        </Link>
        <span className={`status-pill ${statusClass(challenge.status)}`}>{challenge.status}</span>
        <span className="tiny muted">
          {challenge.startDate} → {challenge.endDate} · {rows.length} thành viên chính thức
          tham gia
        </span>
        <span className="tiny muted">
          Mức phạt: {penaltySummary(tiers)} · Thưởng:{' '}
          {challenge.rewards?.length
            ? challenge.rewards
                .map((r) => `${r.target}: ${rewardItemsSummary(r.items)}`)
                .join(' · ')
            : 'không đặt'}
        </span>
        {ongoing && (
          <span className="tiny form-info">
            Thử thách đang diễn ra — số liệu tạm tính theo tiến độ hiện tại.
          </span>
        )}
      </div>

      <div className="stat-row">
        <div className="stat">
          <strong>{completed}</strong>
          <span>Hoàn thành</span>
        </div>
        <div className="stat">
          <strong>{failed}</strong>
          <span>Không hoàn thành</span>
        </div>
        <div className="stat">
          <strong className="stat-money">{formatVnd(totalPenalty)}</strong>
          <span>Tổng phạt</span>
        </div>
      </div>
      {challenge.status === STATUS_FINISHED && (penalized.length > 0 || waivedCount > 0) && (
        <p className="tiny muted penalty-pay-summary">
          Đã nộp {paid.length}/{penalized.length} người · {formatVnd(paidAmount)} · Còn lại{' '}
          {formatVnd(totalPenalty - paidAmount)}
          {waivedCount > 0 && ` · Miễn phạt ${waivedCount} người`}
        </p>
      )}

      <RewardDrawSection
        challenge={challenge}
        userChallenges={report.userChallenges}
        names={names}
      />

      {sections.map(({ key, index, title, hint }) => {
        const list = rows.filter((r) => r.completion.tierIndex === index)
        const tier = tierStyle(index, tiers.length)
        return (
          <section key={key} className={`section panel reward-section reward-${tier}`}>
            <h2>
              {title} <span className="tiny muted">· {list.length} người</span>
            </h2>
            <p className="tiny muted">{hint}</p>
            {list.length === 0 ? (
              <p className="empty">Không có thành viên.</p>
            ) : (
              <ul className="participant-list reward-scroll">
                {list.map((r) => {
                  const c = r.completion
                  return (
                    <li key={r.uid} className="participant-row">
                      <Avatar name={r.name} avatar={r.avatar} />
                      <div className="participant-meta">
                        <strong>{r.name}</strong>
                        <span className="tiny muted">
                          {formatAmount(c.done, c.unit)} / {formatAmount(c.required, c.unit)}{' '}
                          {c.unit}
                        </span>
                        {tier !== 'completed' && (
                          <PenaltyPaymentControl
                            challenge={challenge}
                            uid={r.uid}
                            name={r.name}
                            amount={c.waived?.originalPenalty ?? c.penalty}
                          />
                        )}
                      </div>
                      <span className={`reward-amount ${tier}`}>
                        <strong>{completionPercent(c.ratio)}%</strong>
                        <small>{penaltyLabel(c)}</small>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}

      <section className="section panel reward-section">
        <h2>
          Thành viên chính thức không tham gia{' '}
          <span className="tiny muted">· {absent.length} người</span>
        </h2>
        <p className="tiny muted">
          Chỉ liệt kê, không tính phạt
          {ongoing && ' · vẫn có thể đăng ký nếu còn hạn tham gia'}
        </p>
        {absent.length === 0 ? (
          <p className="empty">Tất cả thành viên chính thức đã đăng ký.</p>
        ) : (
          <ul className="participant-list reward-scroll">
            {absent.map((r) => (
              <li key={r.uid} className="participant-row">
                <Avatar name={r.name} avatar={r.avatar} />
                <div className="participant-meta">
                  <strong>{r.name}</strong>
                  <span className="tiny muted">Chưa đăng ký tham gia</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

type MemberEntry = { challenge: Challenge; completion: ParticipantCompletion }

type MemberSummary = {
  uid: string
  name: string
  avatar: string
  joined: number
  completed: number
  failed: number
  penalty: number
  paid: number
  entries: MemberEntry[]
}

function MemberPenaltyDetail({ member }: { member: MemberSummary }) {
  return (
    <div className="penalty-detail">
      <ul className="penalty-detail-list">
        {member.entries.map(({ challenge, completion: c }) => {
          const tier = c.tier
          return (
            <li key={challenge.id}>
              <div className="participant-meta">
                <Link to={`/challenges/${challenge.id}`}>
                  <strong>{challenge.name || 'Thử thách'}</strong>
                </Link>
                <span className="tiny muted">
                  {challenge.startDate} → {challenge.endDate} · {completionPercent(c.ratio)}%
                </span>
                {tier !== 'completed' && (
                  <PenaltyPaymentControl
                    challenge={challenge}
                    uid={member.uid}
                    name={member.name}
                    amount={c.waived?.originalPenalty ?? c.penalty}
                  />
                )}
              </div>
              <span className={`reward-amount ${tier}`}>{penaltyLabel(c)}</span>
            </li>
          )
        })}
      </ul>
      <p className="penalty-detail-total">
        Tổng phạt <strong>{formatVnd(member.penalty)}</strong> · Đã nộp{' '}
        {formatVnd(member.paid)} · Còn lại <strong>{formatVnd(member.penalty - member.paid)}</strong>
      </p>
    </div>
  )
}

function SummaryView({ reports }: { reports: ChallengeReport[] }) {
  const finished = reports.filter((r) => r.challenge.status === STATUS_FINISHED)
  const [openUid, setOpenUid] = useState<string | null>(null)

  const members = useMemo(() => {
    const map = new Map<string, MemberSummary>()
    for (const report of finished) {
      for (const r of report.rows) {
        const m = map.get(r.uid) ?? {
          uid: r.uid,
          name: r.name,
          avatar: r.avatar,
          joined: 0,
          completed: 0,
          failed: 0,
          penalty: 0,
          paid: 0,
          entries: [],
        }
        m.joined += 1
        if (r.completion.tier === 'completed') m.completed += 1
        else m.failed += 1
        m.penalty += r.completion.penalty
        if (report.challenge.penaltyPayments?.[r.uid]) m.paid += r.completion.penalty
        m.entries.push({ challenge: report.challenge, completion: r.completion })
        map.set(r.uid, m)
      }
    }
    return [...map.values()].sort((a, b) => {
      if (b.penalty !== a.penalty) return b.penalty - a.penalty
      if (b.completed !== a.completed) return b.completed - a.completed
      return a.name.localeCompare(b.name, 'vi')
    })
  }, [finished])

  const totalCompleted = members.reduce((sum, m) => sum + m.completed, 0)
  const totalFailed = members.reduce((sum, m) => sum + m.failed, 0)
  const totalPenalty = members.reduce((sum, m) => sum + m.penalty, 0)
  const totalPaid = members.reduce((sum, m) => sum + m.paid, 0)

  if (finished.length === 0) {
    return <p className="empty">Chưa có thử thách nào kết thúc.</p>
  }

  return (
    <>
      <p className="tiny muted">
        Tổng hợp {finished.length} thử thách đã kết thúc từ năm {REWARD_START_YEAR} của thành
        viên chính thức (không tính thử thách đang diễn ra).
      </p>
      <div className="stat-row">
        <div className="stat">
          <strong>{totalCompleted}</strong>
          <span>Lượt hoàn thành</span>
        </div>
        <div className="stat">
          <strong>{totalFailed}</strong>
          <span>Lượt không hoàn thành</span>
        </div>
        <div className="stat">
          <strong className="stat-money">{formatVnd(totalPenalty)}</strong>
          <span>Tổng phạt</span>
        </div>
      </div>
      {totalPenalty > 0 && (
        <p className="tiny muted penalty-pay-summary">
          Đã nộp {formatVnd(totalPaid)} · Còn lại {formatVnd(totalPenalty - totalPaid)}
        </p>
      )}

      <section className="section panel">
        <h2>Theo thành viên</h2>
        <ul className="participant-list">
          {members.map((m) => {
            const open = openUid === m.uid
            const owed = m.penalty - m.paid
            return (
              <li key={m.uid} className="summary-member">
                <div className="participant-row">
                  <Avatar name={m.name} avatar={m.avatar} />
                  <div className="participant-meta">
                    <strong>{m.name}</strong>
                    <span className="tiny muted">
                      Tham gia {m.joined} · Hoàn thành {m.completed} · Không hoàn thành{' '}
                      {m.failed}
                    </span>
                    <button
                      type="button"
                      className="btn ghost compact summary-detail-btn"
                      aria-expanded={open}
                      onClick={() => setOpenUid(open ? null : m.uid)}
                    >
                      {open ? 'Ẩn chi tiết' : 'Chi tiết'}
                    </button>
                  </div>
                  <span className={`reward-amount ${m.penalty > 0 ? 'underHalf' : 'completed'}`}>
                    <strong>{m.penalty > 0 ? `−${formatVnd(m.penalty)}` : '✓'}</strong>
                    {m.penalty > 0 && (
                      <small className={owed > 0 ? '' : 'penalty-settled'}>
                        {owed > 0 ? `Còn ${formatVnd(owed)}` : 'Đã nộp đủ'}
                      </small>
                    )}
                  </span>
                </div>
                {open && <MemberPenaltyDetail member={m} />}
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}

export function RewardsPage() {
  const rawProfiles = useUserProfiles()
  const challengesValue = useSharedValue<Record<string, Record<string, unknown>>>('challenges')
  const loading = challengesValue === undefined
  const rawChallenges = useMemo(() => challengesValue ?? {}, [challengesValue])
  const [selected, setSelected] = useState('')

  const profiles = useMemo(() => {
    const map: Record<string, Profile> = {}
    for (const [uid, row] of Object.entries(rawProfiles ?? {})) {
      map[uid] = {
        fullName: String(row.fullName ?? ''),
        avatar: String(row.avatar ?? ''),
        member: row.member === true,
        email: String(row.email ?? '').toLowerCase(),
      }
    }
    return map
  }, [rawProfiles])

  const names = useMemo<Names>(() => {
    const map: Names = {}
    for (const [uid, p] of Object.entries(profiles)) map[uid] = { name: p.fullName, avatar: p.avatar }
    return map
  }, [profiles])

  const officialMembers = useMemo(
    () =>
      Object.entries(profiles)
        .filter(([, p]) => p.member && p.email && !SYSTEM_EMAILS.has(p.email))
        .map(([uid, p]) => ({ uid, name: p.fullName || 'Người dùng ẩn danh', avatar: p.avatar }))
        .sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    [profiles],
  )

  const reports = useMemo(() => {
    const officialIds = new Set(officialMembers.map((m) => m.uid))
    const list: ChallengeReport[] = []
    for (const [id, val] of Object.entries(rawChallenges)) {
      const challenge = parseChallenge(id, val)
      if (challenge.status === STATUS_UPCOMING || !isRewardEligible(challenge)) continue
      // Thưởng – phạt chỉ áp dụng cho thành viên chính thức
      const userChallenges = Object.fromEntries(
        Object.entries((val.user_challenges ?? {}) as Record<string, Record<string, unknown>>)
          .filter(([uid]) => officialIds.has(uid)),
      )
      const rows: ReportRow[] = []
      for (const [uid, row] of Object.entries(userChallenges)) {
        const raw = participantCompletion(challenge, row ?? {})
        if (!raw) continue
        const completion = applyPenaltyWaiver(challenge, uid, raw)
        rows.push({
          uid,
          name: profiles[uid]?.fullName || String(row?.name ?? '') || 'Người dùng ẩn danh',
          avatar: profiles[uid]?.avatar || '',
          completion,
        })
      }
      if (!rows.length) continue
      rows.sort((a, b) => {
        if (b.completion.ratio !== a.completion.ratio) return b.completion.ratio - a.completion.ratio
        return a.name.localeCompare(b.name, 'vi')
      })
      list.push({
        challenge,
        userChallenges,
        rows,
        absent: officialMembers.filter((m) => !(m.uid in userChallenges)),
        endMs: parseChallengeDay(challenge.endDate)?.getTime() ?? 0,
      })
    }
    return list.sort((a, b) => b.endMs - a.endMs)
  }, [rawChallenges, profiles, officialMembers])

  useEffect(() => {
    if (selected || !reports.length) return
    const latestFinished = reports.find((r) => r.challenge.status === STATUS_FINISHED)
    setSelected(latestFinished?.challenge.id ?? reports[0].challenge.id)
  }, [reports, selected])

  const current = reports.find((r) => r.challenge.id === selected)

  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">Thử thách</p>
        <h1>Thưởng - Phạt</h1>
      </header>

      {loading ? (
        <p className="empty">Đang tải…</p>
      ) : reports.length === 0 ? (
        <p className="empty">
          Chưa có thử thách nào từ năm {REWARD_START_YEAR} có thành viên chính thức tham gia.
        </p>
      ) : (
        <>
          <label className="search-field">
            Thử thách
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value={ALL}>
                Tổng hợp thử thách đã kết thúc (từ {REWARD_START_YEAR})
              </option>
              {reports.map((r) => (
                <option key={r.challenge.id} value={r.challenge.id}>
                  {r.challenge.name || 'Thử thách'}
                  {r.challenge.status === STATUS_ONGOING ? ' (đang diễn ra)' : ''}
                </option>
              ))}
            </select>
          </label>

          {selected === ALL ? (
            <SummaryView reports={reports} />
          ) : current ? (
            <ChallengeReportView report={current} names={names} />
          ) : null}
        </>
      )}
    </div>
  )
}
