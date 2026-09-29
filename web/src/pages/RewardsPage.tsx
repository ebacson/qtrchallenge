import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { onValue, ref } from 'firebase/database'
import { db } from '../lib/firebase'
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
  participantCompletion,
  PENALTY_PARTIAL,
  PENALTY_UNDER_HALF,
  REWARD_START_YEAR,
  type CompletionTier,
  type ParticipantCompletion,
} from '../lib/rewardPenalty'
import type { Challenge } from '../types'

type Profile = { fullName: string; avatar: string }

type ReportRow = {
  uid: string
  name: string
  avatar: string
  completion: ParticipantCompletion
}

type ChallengeReport = {
  challenge: Challenge
  rows: ReportRow[]
  endMs: number
}

const ALL = 'all'

const TIER_SECTIONS: { tier: CompletionTier; title: string; hint: string }[] = [
  { tier: 'completed', title: 'Hoàn thành', hint: 'Đạt 100% mục tiêu' },
  {
    tier: 'partial',
    title: 'Không hoàn thành (50% – dưới 100%)',
    hint: `Phạt ${formatVnd(PENALTY_PARTIAL)}`,
  },
  {
    tier: 'underHalf',
    title: 'Không hoàn thành (dưới 50%)',
    hint: `Phạt ${formatVnd(PENALTY_UNDER_HALF)}`,
  },
]

function formatAmount(value: number, unit: ParticipantCompletion['unit']): string {
  return value.toLocaleString('vi-VN', { maximumFractionDigits: unit === 'km' ? 2 : 0 })
}

function Avatar({ name, avatar }: { name: string; avatar: string }) {
  return (
    <div className="hof-avatar">
      {avatar ? <img src={avatar} alt="" /> : <span>{(name || '?').charAt(0).toUpperCase()}</span>}
    </div>
  )
}

function ChallengeReportView({ report }: { report: ChallengeReport }) {
  const { challenge, rows } = report
  const completed = rows.filter((r) => r.completion.tier === 'completed').length
  const failed = rows.length - completed
  const totalPenalty = rows.reduce((sum, r) => sum + r.completion.penalty, 0)
  const ongoing = challenge.status === STATUS_ONGOING

  return (
    <>
      <div className="reward-challenge-head">
        <Link to={`/challenges/${challenge.id}`}>
          <strong>{challenge.name || 'Thử thách'}</strong>
        </Link>
        <span className={`status-pill ${statusClass(challenge.status)}`}>{challenge.status}</span>
        <span className="tiny muted">
          {challenge.startDate} → {challenge.endDate} · {rows.length} người tham gia
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

      {TIER_SECTIONS.map(({ tier, title, hint }) => {
        const list = rows.filter((r) => r.completion.tier === tier)
        return (
          <section key={tier} className={`section panel reward-section reward-${tier}`}>
            <h2>
              {title} <span className="tiny muted">· {list.length} người</span>
            </h2>
            <p className="tiny muted">{hint}</p>
            {list.length === 0 ? (
              <p className="empty">Không có thành viên.</p>
            ) : (
              <ul className="participant-list">
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
                      </div>
                      <span className={`reward-amount ${tier}`}>
                        <strong>{completionPercent(c.ratio)}%</strong>
                        <small>
                          {tier === 'completed' ? '✓ Hoàn thành' : `−${formatVnd(c.penalty)}`}
                        </small>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
    </>
  )
}

function SummaryView({ reports }: { reports: ChallengeReport[] }) {
  const finished = reports.filter((r) => r.challenge.status === STATUS_FINISHED)

  const members = useMemo(() => {
    const map = new Map<
      string,
      {
        uid: string
        name: string
        avatar: string
        joined: number
        completed: number
        failed: number
        penalty: number
      }
    >()
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
        }
        m.joined += 1
        if (r.completion.tier === 'completed') m.completed += 1
        else m.failed += 1
        m.penalty += r.completion.penalty
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

  if (finished.length === 0) {
    return <p className="empty">Chưa có thử thách nào kết thúc.</p>
  }

  return (
    <>
      <p className="tiny muted">
        Tổng hợp {finished.length} thử thách đã kết thúc từ năm {REWARD_START_YEAR} (không tính
        thử thách đang diễn ra).
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

      <section className="section panel">
        <h2>Theo thành viên</h2>
        <ul className="participant-list">
          {members.map((m) => (
            <li key={m.uid} className="participant-row">
              <Avatar name={m.name} avatar={m.avatar} />
              <div className="participant-meta">
                <strong>{m.name}</strong>
                <span className="tiny muted">
                  Tham gia {m.joined} · Hoàn thành {m.completed} · Không hoàn thành {m.failed}
                </span>
              </div>
              <span className={`reward-amount ${m.penalty > 0 ? 'underHalf' : 'completed'}`}>
                {m.penalty > 0 ? `−${formatVnd(m.penalty)}` : '✓'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

export function RewardsPage() {
  const [rawChallenges, setRawChallenges] = useState<Record<string, Record<string, unknown>>>({})
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState('')

  useEffect(() => {
    const unsub = onValue(ref(db, 'challenges'), (snap) => {
      setRawChallenges((snap.val() ?? {}) as Record<string, Record<string, unknown>>)
      setLoading(false)
    })
    return unsub
  }, [])

  useEffect(() => {
    const unsub = onValue(ref(db, 'users'), (snap) => {
      const val = (snap.val() ?? {}) as Record<string, Record<string, unknown>>
      const map: Record<string, Profile> = {}
      for (const [uid, row] of Object.entries(val)) {
        map[uid] = { fullName: String(row.fullName ?? ''), avatar: String(row.avatar ?? '') }
      }
      setProfiles(map)
    })
    return unsub
  }, [])

  const reports = useMemo(() => {
    const list: ChallengeReport[] = []
    for (const [id, val] of Object.entries(rawChallenges)) {
      const challenge = parseChallenge(id, val)
      if (challenge.status === STATUS_UPCOMING || !isRewardEligible(challenge)) continue
      const userChallenges = (val.user_challenges ?? {}) as Record<
        string,
        Record<string, unknown>
      >
      const rows: ReportRow[] = []
      for (const [uid, row] of Object.entries(userChallenges)) {
        const completion = participantCompletion(challenge, row ?? {})
        if (!completion) continue
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
        rows,
        endMs: parseChallengeDay(challenge.endDate)?.getTime() ?? 0,
      })
    }
    return list.sort((a, b) => b.endMs - a.endMs)
  }, [rawChallenges, profiles])

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
        <p className="lede">
          Thống kê thành viên hoàn thành và không hoàn thành thử thách. Không hoàn thành dưới 50%
          mục tiêu phạt {formatVnd(PENALTY_UNDER_HALF)}, từ 50% đến dưới 100% phạt{' '}
          {formatVnd(PENALTY_PARTIAL)}. Chỉ tính các thử thách bắt đầu từ năm {REWARD_START_YEAR}{' '}
          trở đi.
        </p>
      </header>

      {loading ? (
        <p className="empty">Đang tải…</p>
      ) : reports.length === 0 ? (
        <p className="empty">
          Chưa có thử thách nào từ năm {REWARD_START_YEAR} có người tham gia.
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
            <ChallengeReportView report={current} />
          ) : null}
        </>
      )}
    </div>
  )
}
