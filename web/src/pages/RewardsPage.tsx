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
  absentPenaltyFor,
  applyPenaltyWaiver,
  participantCompletion,
  penaltySummary,
  penaltyTiersOf,
  REWARD_START_YEAR,
  rewardItemsSummary,
  tierRangeLabel,
  tierStyle,
  type AbsentPenalty,
  type ParticipantCompletion,
} from '../lib/rewardPenalty'
import { PenaltyPaymentControl } from '../components/PenaltyPaymentControl'
import { RewardDrawSection } from '../components/RewardDraw'
import type { Challenge } from '../types'

type Profile = {
  fullName: string
  avatar: string
  member: boolean
  email: string
  memberSince?: number
}

type ReportRow = {
  uid: string
  name: string
  avatar: string
  completion: ParticipantCompletion
}

type AbsentRow = { uid: string; name: string; avatar: string; absent: AbsentPenalty }

type ChallengeReport = {
  challenge: Challenge
  userChallenges: Record<string, Record<string, unknown> | null>
  rows: ReportRow[]
  /** Thành viên chính thức không đăng ký tham gia (phạt theo absentPenalty của thử thách) */
  absent: AbsentRow[]
  endMs: number
}

const SYSTEM_EMAILS = new Set(['echiptime@gmail.com'])

/** Giá trị select cho mục tổng hợp theo năm, VD "year:2026" */
const YEAR_PREFIX = 'year:'

function challengeYear(challenge: Challenge): number {
  return parseChallengeDay(challenge.startDate)?.getFullYear() ?? 0
}

type Names = Record<string, { name: string; avatar: string }>

function formatAmount(value: number, unit: ParticipantCompletion['unit']): string {
  return value.toLocaleString('vi-VN', { maximumFractionDigits: unit === 'km' ? 2 : 0 })
}

function penaltyLabel(c: ParticipantCompletion): string {
  if (c.tier === 'completed') return '✓ Hoàn thành'
  if (c.waived) return c.waived.originalPenalty ? 'Miễn phạt' : 'Không phạt'
  return c.penalty ? `−${formatVnd(c.penalty)}` : 'Không phạt'
}

function absentLabel(a: AbsentPenalty): string {
  if (a.waived) return 'Miễn phạt'
  return a.penalty ? `−${formatVnd(a.penalty)}` : 'Không phạt'
}

function Avatar({ name, avatar }: { name: string; avatar: string }) {
  return (
    <div className="hof-avatar">
      {avatar ? <img src={avatar} alt="" /> : <span>{(name || '?').charAt(0).toUpperCase()}</span>}
    </div>
  )
}

function PaidSplit({ paid, unpaid }: { paid: number; unpaid: number }) {
  return (
    <div className="stat-split">
      <div className="stat-split-paid">
        <em>Đã nộp</em>
        <b>{formatVnd(paid)}</b>
      </div>
      <div className="stat-split-unpaid">
        <em>Chưa nộp</em>
        <b>{formatVnd(unpaid)}</b>
      </div>
    </div>
  )
}

function ChallengeReportView({ report, names }: { report: ChallengeReport; names: Names }) {
  const { challenge, rows, absent } = report
  const completed = rows.filter((r) => r.completion.tier === 'completed').length
  const failed = rows.length - completed
  // Người phải nộp: không hoàn thành + không tham gia (sau khi miễn)
  const owing = [
    ...rows.map((r) => ({ uid: r.uid, penalty: r.completion.penalty })),
    ...absent.map((a) => ({ uid: a.uid, penalty: a.absent.penalty })),
  ].filter((p) => p.penalty > 0)
  const totalPenalty = owing.reduce((sum, p) => sum + p.penalty, 0)
  const absentPenaltyTotal = absent.reduce((sum, a) => sum + a.absent.penalty, 0)
  const paid = owing.filter((p) => challenge.penaltyPayments?.[p.uid])
  const paidAmount = paid.reduce((sum, p) => sum + p.penalty, 0)
  const waivedCount =
    rows.filter((r) => r.completion.waived?.originalPenalty).length +
    absent.filter((a) => a.absent.waived).length
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
          Mức phạt: {penaltySummary(tiers)} · Không tham gia:{' '}
          {challenge.absentPenalty ? formatVnd(challenge.absentPenalty) : 'không phạt'} · Thưởng:{' '}
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
          {challenge.status === STATUS_FINISHED && totalPenalty > 0 && (
            <PaidSplit paid={paidAmount} unpaid={totalPenalty - paidAmount} />
          )}
        </div>
      </div>
      {absentPenaltyTotal > 0 && (
        <p className="tiny muted penalty-pay-summary">
          Trong đó phạt không tham gia: {formatVnd(absentPenaltyTotal)}
        </p>
      )}
      {challenge.status === STATUS_FINISHED && (owing.length > 0 || waivedCount > 0) && (
        <p className="tiny muted penalty-pay-summary">
          Đã nộp {paid.length}/{owing.length} người
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
          {challenge.absentPenalty
            ? `Phạt ${formatVnd(challenge.absentPenalty)} (không áp dụng nếu được duyệt chính thức từ ngày bắt đầu thử thách)`
            : 'Thử thách không đặt mức phạt không tham gia'}
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
                  <span className="tiny muted">
                    {r.absent.lateMember
                      ? 'Chưa đăng ký · chính thức sau khi thử thách bắt đầu'
                      : 'Chưa đăng ký tham gia'}
                  </span>
                  {r.absent.originalPenalty > 0 && (
                    <PenaltyPaymentControl
                      challenge={challenge}
                      uid={r.uid}
                      name={r.name}
                      amount={r.absent.originalPenalty}
                    />
                  )}
                </div>
                {challenge.absentPenalty ? (
                  <span
                    className={`reward-amount ${r.absent.penalty > 0 ? 'underHalf' : 'completed'}`}
                  >
                    {absentLabel(r.absent)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

type MemberEntry =
  | { kind: 'joined'; challenge: Challenge; completion: ParticipantCompletion }
  | { kind: 'absent'; challenge: Challenge; absent: AbsentPenalty }

type MemberSummary = {
  uid: string
  name: string
  avatar: string
  joined: number
  completed: number
  failed: number
  absentCount: number
  penalty: number
  paid: number
  entries: MemberEntry[]
}

function MemberPenaltyDetail({ member }: { member: MemberSummary }) {
  return (
    <div className="penalty-detail">
      <ul className="penalty-detail-list">
        {member.entries.map((entry) => {
          const { challenge } = entry
          const original =
            entry.kind === 'joined'
              ? entry.completion.tier === 'completed'
                ? 0
                : (entry.completion.waived?.originalPenalty ?? entry.completion.penalty)
              : entry.absent.originalPenalty
          const tone =
            entry.kind === 'joined'
              ? entry.completion.tier
              : entry.absent.penalty > 0
                ? 'underHalf'
                : 'completed'
          return (
            <li key={challenge.id}>
              <div className="participant-meta">
                <Link to={`/challenges/${challenge.id}`}>
                  <strong>{challenge.name || 'Thử thách'}</strong>
                </Link>
                <span className="tiny muted">
                  {challenge.startDate} → {challenge.endDate} ·{' '}
                  {entry.kind === 'joined'
                    ? `${completionPercent(entry.completion.ratio)}%`
                    : 'Không tham gia'}
                </span>
                {original > 0 && (
                  <PenaltyPaymentControl
                    challenge={challenge}
                    uid={member.uid}
                    name={member.name}
                    amount={original}
                  />
                )}
              </div>
              <span className={`reward-amount ${tone}`}>
                {entry.kind === 'joined' ? penaltyLabel(entry.completion) : absentLabel(entry.absent)}
              </span>
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

function SummaryView({ reports, year }: { reports: ChallengeReport[]; year: number }) {
  const finished = useMemo(
    () =>
      reports.filter(
        (r) => r.challenge.status === STATUS_FINISHED && challengeYear(r.challenge) === year,
      ),
    [reports, year],
  )
  const [openUid, setOpenUid] = useState<string | null>(null)

  const members = useMemo(() => {
    const map = new Map<string, MemberSummary>()
    const memberOf = (r: { uid: string; name: string; avatar: string }) => {
      const m = map.get(r.uid) ?? {
        uid: r.uid,
        name: r.name,
        avatar: r.avatar,
        joined: 0,
        completed: 0,
        failed: 0,
        absentCount: 0,
        penalty: 0,
        paid: 0,
        entries: [],
      }
      map.set(r.uid, m)
      return m
    }
    for (const report of finished) {
      const payments = report.challenge.penaltyPayments
      for (const r of report.rows) {
        const m = memberOf(r)
        m.joined += 1
        if (r.completion.tier === 'completed') m.completed += 1
        else m.failed += 1
        m.penalty += r.completion.penalty
        if (payments?.[r.uid]) m.paid += r.completion.penalty
        m.entries.push({ kind: 'joined', challenge: report.challenge, completion: r.completion })
      }
      for (const a of report.absent) {
        if (!(a.absent.originalPenalty > 0)) continue
        const m = memberOf(a)
        m.absentCount += 1
        m.penalty += a.absent.penalty
        if (payments?.[a.uid]) m.paid += a.absent.penalty
        m.entries.push({ kind: 'absent', challenge: report.challenge, absent: a.absent })
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
        Tổng hợp {finished.length} thử thách đã kết thúc năm {year} của thành viên chính thức
        (không tính thử thách đang diễn ra).
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
          {totalPenalty > 0 && <PaidSplit paid={totalPaid} unpaid={totalPenalty - totalPaid} />}
        </div>
      </div>

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
                      {m.absentCount > 0 && ` · Không tham gia ${m.absentCount}`}
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
        memberSince: Number(row.memberSince) || undefined,
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
        .map(([uid, p]) => ({
          uid,
          name: p.fullName || 'Người dùng ẩn danh',
          avatar: p.avatar,
          memberSince: p.memberSince,
        }))
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
        absent: officialMembers
          .filter((m) => !(m.uid in userChallenges))
          .map((m) => ({
            uid: m.uid,
            name: m.name,
            avatar: m.avatar,
            absent: absentPenaltyFor(challenge, m.uid, m.memberSince),
          })),
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

  const summaryYears = useMemo(
    () =>
      [
        ...new Set(
          reports
            .filter((r) => r.challenge.status === STATUS_FINISHED)
            .map((r) => challengeYear(r.challenge)),
        ),
      ].sort((a, b) => b - a),
    [reports],
  )

  const current = reports.find((r) => r.challenge.id === selected)
  const selectedYear = selected.startsWith(YEAR_PREFIX)
    ? Number(selected.slice(YEAR_PREFIX.length))
    : null

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
          <div className="reward-picker">
            <label className="search-field">
              Thử thách
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                {summaryYears.length > 0 && (
                  <optgroup label="Tổng hợp thử thách đã kết thúc">
                    {summaryYears.map((y) => (
                      <option key={y} value={`${YEAR_PREFIX}${y}`}>
                        Tổng hợp năm {y}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Từng thử thách">
                  {reports.map((r) => (
                    <option key={r.challenge.id} value={r.challenge.id}>
                      {r.challenge.name || 'Thử thách'}
                      {r.challenge.status === STATUS_ONGOING ? ' (đang diễn ra)' : ''}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
          </div>

          {selectedYear != null ? (
            <SummaryView reports={reports} year={selectedYear} />
          ) : current ? (
            <ChallengeReportView report={current} names={names} />
          ) : null}
        </>
      )}
    </div>
  )
}
