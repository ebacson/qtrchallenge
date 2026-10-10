import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { get, ref, runTransaction, set, update } from 'firebase/database'
import { BadgeCheck, RotateCcw } from 'lucide-react'
import { DrawStage, FullscreenButton } from '../components/DrawStage'
import { useAuth } from '../context/AuthContext'
import { parseChallenge, revealedWinners, STATUS_FINISHED } from '../lib/challengeRules'
import {
  drawPhase,
  prizeSlots,
  useDrawSpinner,
  useFullscreen,
  type StagePerson,
} from '../lib/drawSpinner'
import { db } from '../lib/firebase'
import { pickRandom, rewardCandidates, rewardItemsSummary } from '../lib/rewardPenalty'
import { useSharedValue } from '../lib/sharedValue'
import { useUserProfiles } from '../lib/userWrites'
import type { Challenge } from '../types'

const SYSTEM_EMAIL = 'echiptime@gmail.com'

function nowMs(): number {
  return Date.now()
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value)
  return []
}

type WatchedRound = { key: string; target: string; people: StagePerson[]; winner: StagePerson }

/** Lượt Admin đang quay (đã lưu người trúng, chưa công bố): người xem quay theo trên máy mình */
function watchedRound(
  challenge: Challenge,
  toPerson: (uid: string) => StagePerson,
): WatchedRound | null {
  for (const d of challenge.rewardDraws ?? []) {
    if (d.confirmedAt || d.revealed == null || d.winners.length <= d.revealed) continue
    const i = d.revealed
    const before = new Set(d.winners.slice(0, i))
    return {
      key: `${d.target}:${i}:${d.winners[i]}`,
      target: d.target,
      people: d.candidates.filter((uid) => !before.has(uid)).map(toPerson),
      winner: toPerson(d.winners[i]),
    }
  }
  return null
}

/**
 * Màn hình quay số của một thử thách: mỗi phần quà một lượt, lưu ngay sau từng lượt.
 * Thành viên mở cùng màn hình để xem trực tiếp (không có nút quay/xác nhận).
 */
export function ChallengeDrawPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const { user, profile } = useAuth()
  const isAdmin = profile?.admin === true
  const raw = useSharedValue<Record<string, unknown>>(id ? `challenges/${id}` : null)
  const rawProfiles = useUserProfiles()
  const spinner = useDrawSpinner()
  const [selected, setSelected] = useState<string | null>(() => searchParams.get('target'))
  const [saving, setSaving] = useState(false)
  /** Người vừa trúng đã lưu nhưng còn đang quay: chưa hiện ra */
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const { ref: screenRef, ...fullscreen } = useFullscreen<HTMLDivElement>()

  const challenge = useMemo(
    () => (raw && user ? parseChallenge(id, raw, user.uid) : null),
    [raw, id, user],
  )

  /** Quay thưởng chỉ trong thành viên chính thức (như trang chi tiết thử thách) */
  const officialUserChallenges = useMemo(() => {
    const rows = (raw?.user_challenges ?? {}) as Record<string, Record<string, unknown> | null>
    return Object.fromEntries(
      Object.entries(rows).filter(
        ([uid]) =>
          rawProfiles?.[uid]?.member === true &&
          String(rawProfiles[uid].email ?? '').toLowerCase() !== SYSTEM_EMAIL,
      ),
    )
  }, [raw, rawProfiles])

  const toPerson = (uid: string): StagePerson => ({
    id: uid,
    name: String(rawProfiles?.[uid]?.fullName ?? '') || 'Người dùng ẩn danh',
    avatar: String(rawProfiles?.[uid]?.avatar ?? '') || undefined,
  })

  /** Lượt người xem đã quay xong trên máy mình (có thể trước khi Admin công bố vài trăm ms) */
  const [watchedKey, setWatchedKey] = useState('')
  const watched =
    !isAdmin && challenge?.status === STATUS_FINISHED && rawProfiles
      ? watchedRound(challenge, toPerson)
      : null
  const watchKey = watched?.key ?? ''

  useEffect(() => {
    if (!watched) return
    let finished = false
    void spinner.spin(watched.people, watched.winner, { music: false }).then((ok) => {
      finished = true
      if (!ok) return
      setWatchedKey(watched.key)
      setSelected(watched.target)
    })
    return () => {
      if (!finished) spinner.stop()
    }
    // Chỉ chạy lại khi sang lượt khác; watched/spinner đổi object mỗi lần render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey])

  if (raw === undefined || rawProfiles === null) {
    return (
      <div className="page">
        <p className="muted">Đang tải…</p>
      </div>
    )
  }
  if (!challenge) {
    return (
      <div className="page">
        <p className="form-error">Không tìm thấy thử thách.</p>
        <Link to="/challenges">← Danh sách thử thách</Link>
      </div>
    )
  }

  const rewards = challenge.rewards ?? []
  const drawOf = (target: string) => challenge.rewardDraws?.find((d) => d.target === target)
  const isConfirmed = (target: string) => Boolean(drawOf(target)?.confirmedAt)
  const reward =
    rewards.find((r) => r.target === (watched?.target ?? selected)) ??
    rewards.find((r) => !isConfirmed(r.target)) ??
    rewards[0]
  const finished = challenge.status === STATUS_FINISHED

  const header = (
    <header className="page-header">
      <p className="eyebrow">
        <Link to={`/challenges/${challenge.id}`}>← {challenge.name}</Link>
      </p>
      <h1>Quay số trúng thưởng</h1>
    </header>
  )

  if (!reward) {
    return (
      <div className="page">
        {header}
        <p className="muted">Thử thách này không đặt phần thưởng quay số.</p>
      </div>
    )
  }
  if (!finished) {
    return (
      <div className="page">
        {header}
        <p className="muted">Chỉ quay số sau khi thử thách kết thúc.</p>
      </div>
    )
  }

  const targetIndex = challenge.targetDistances.indexOf(reward.target)
  const drawPath = `challenges/${challenge.id}/rewardDraws/${targetIndex}`
  const draw = drawOf(reward.target)
  const confirmed = Boolean(draw?.confirmedAt)
  const live = rewardCandidates(challenge, officialUserChallenges, reward.target)
  const liveIds = live.map((c) => c.uid)
  const paidIds = new Set(live.filter((c) => c.via === 'paid').map((c) => c.uid))
  /** Đã bắt đầu quay thì giữ danh sách lúc quay lượt đầu */
  const candidates = draw ? draw.candidates : liveIds
  const listChanged =
    draw != null &&
    (draw.candidates.length !== liveIds.length ||
      draw.candidates.some((uid) => !liveIds.includes(uid)))
  const slots = prizeSlots(reward.items)
  const allWinners = draw?.winners ?? []
  const shownCount = isAdmin
    ? allWinners.length
    : (draw ? revealedWinners(draw).length : 0) +
      (watched && watched.target === reward.target && watchedKey === watched.key ? 1 : 0)
  const savedWinners = allWinners.slice(0, shownCount)
  const winners = pendingId ? savedWinners.filter((uid) => uid !== pendingId) : savedWinners
  const winnerSet = new Set(winners)
  const pool = candidates.filter((uid) => !savedWinners.includes(uid))
  const totalRounds = Math.min(slots.length, candidates.length)
  const round = winners.length
  const busy = saving || spinner.spinning
  const phase = drawPhase(spinner.spinning, round, totalRounds)
  const prizeAt = (i: number) => draw?.prizes[i] || slots[i] || ''
  const stageWinners = winners.map((uid, i) => ({ person: toPerson(uid), prize: prizeAt(i) }))
  const nextReward = rewards.find((r) => r.target !== reward.target && !isConfirmed(r.target))

  function selectReward(target: string) {
    spinner.stop()
    setError('')
    setSelected(target)
  }

  async function lockedNow(): Promise<boolean> {
    const snap = await get(ref(db, `${drawPath}/confirmedAt`))
    if (!(Number(snap.val()) > 0)) return false
    setError('Kết quả đã được xác nhận — không thể quay lại hoặc xóa.')
    return true
  }

  /** Quay một phần quà: lưu người trúng trước rồi mới chạy hiệu ứng */
  async function runRound() {
    if (!user || !reward || busy || confirmed || round >= totalRounds || targetIndex < 0) return
    const picked = pickRandom(pool)
    if (!picked) return
    const expected = savedWinners.length
    const prize = slots[expected] ?? ''
    const uid = user.uid
    const snapshot = candidates
    setSaving(true)
    setError('')
    setPendingId(picked)
    try {
      const result = await runTransaction(
        ref(db, drawPath),
        (cur: Record<string, unknown> | null) => {
          if (cur && Number(cur.confirmedAt) > 0) return undefined
          const curWinners = asList(cur?.winners).map(String)
          if (curWinners.length !== expected) return undefined
          const curPrizes = asList(cur?.prizes)
          const at = nowMs()
          return {
            ...(cur ?? {}),
            target: reward.target,
            gifts: reward.gifts,
            prize: reward.prize,
            candidates: cur ? asList(cur.candidates) : snapshot,
            winners: [...curWinners, picked],
            prizes: [...curWinners.map((_, i) => String(curPrizes[i] ?? slots[i] ?? '')), prize],
            revealed: expected,
            drawnAt: at,
            drawnBy: uid,
          }
        },
        { applyLocally: false },
      )
      if (!result.committed) {
        setPendingId(null)
        setError('Kết quả vừa thay đổi ở máy khác (đã quay hoặc đã xác nhận). Hãy xem lại trước khi quay tiếp.')
        return
      }
    } catch (err) {
      setPendingId(null)
      setError(err instanceof Error ? err.message : 'Không lưu được kết quả')
      return
    } finally {
      setSaving(false)
    }
    await spinner.spin(pool.map(toPerson), toPerson(picked))
    setPendingId(null)
    void runTransaction(
      ref(db, drawPath),
      (cur: Record<string, unknown> | null) => {
        if (!cur || asList(cur.winners).length !== expected + 1) return undefined
        return { ...cur, revealed: expected + 1 }
      },
      { applyLocally: false },
    ).catch(() => {})
  }

  async function confirmDraw() {
    if (!user || !reward || !draw || confirmed || busy) return
    if (
      !window.confirm(
        `Xác nhận kết quả quay thưởng mục tiêu "${reward.target}" (${winners.length} người trúng thưởng)?\n\n` +
          'Sau khi xác nhận sẽ không thể quay lại hoặc xóa kết quả nữa.',
      )
    )
      return
    setSaving(true)
    setError('')
    try {
      if (await lockedNow()) return
      await update(ref(db, drawPath), { confirmedAt: nowMs(), confirmedBy: user.uid })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xác nhận được')
    } finally {
      setSaving(false)
    }
  }

  async function resetDraw() {
    if (!reward || !draw || confirmed || busy) return
    if (
      !window.confirm(
        `Xóa kết quả ${winners.length} người đã trúng mục tiêu "${reward.target}" và quay lại từ đầu?`,
      )
    )
      return
    spinner.stop()
    setSaving(true)
    setError('')
    try {
      if (await lockedNow()) return
      await set(ref(db, drawPath), null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xóa được')
    } finally {
      setSaving(false)
    }
  }

  const confirmedText = (
    <>
      <BadgeCheck size={18} aria-hidden /> Đã xác nhận kết quả {reward.target}
    </>
  )

  const viewerActions = (
    <span className="draw-confirmed">
      {confirmed
        ? confirmedText
        : phase === 'spinning'
          ? 'Đang quay…'
          : phase === 'done'
            ? 'Chờ Admin xác nhận kết quả'
            : 'Chờ Admin quay số'}
    </span>
  )

  const adminActions = (
    <>
      {confirmed ? (
        <>
          <span className="draw-confirmed">{confirmedText}</span>
          {nextReward && (
            <button
              type="button"
              className="draw-go"
              onClick={() => selectReward(nextReward.target)}
            >
              Quay mục tiêu {nextReward.target} →
            </button>
          )}
        </>
      ) : phase === 'done' ? (
        <button type="button" className="draw-go" disabled={busy} onClick={() => void confirmDraw()}>
          Xác nhận kết quả {reward.target}
        </button>
      ) : (
        <button
          type="button"
          className="draw-go"
          disabled={busy || totalRounds === 0}
          onClick={() => void runRound()}
        >
          {busy ? 'Đang quay…' : round === 0 ? 'Quay số' : 'Quay tiếp'}
        </button>
      )}
      {draw && !busy && !confirmed && (
        <button type="button" className="draw-reset" onClick={() => void resetDraw()}>
          <RotateCcw size={16} aria-hidden /> Quay lại từ đầu
        </button>
      )}
    </>
  )

  return (
    <div className="page draw-test">
      {header}

      <div
        ref={screenRef}
        className={fullscreen.isFull ? 'draw-screen full' : 'draw-screen'}
      >
        {rewards.length > 1 && (
          <div className="filter-row draw-tier-chips">
            {rewards.map((r) => {
              const d = drawOf(r.target)
              const won = d ? (isAdmin ? d.winners : revealedWinners(d)).length : 0
              return (
                <button
                  key={r.target}
                  type="button"
                  className={r.target === reward.target ? 'chip active' : 'chip'}
                  disabled={busy}
                  onClick={() => selectReward(r.target)}
                >
                  {r.target}
                  {d?.confirmedAt ? (
                    <BadgeCheck size={14} aria-label="Đã xác nhận" />
                  ) : won > 0 ? (
                    ` · ${won} đã trúng`
                  ) : null}
                </button>
              )
            })}
          </div>
        )}

        <DrawStage
          spinner={spinner}
          phase={phase}
          target={reward.target}
          itemsSummary={rewardItemsSummary(reward.items)}
          roundText={
            totalRounds === 0
              ? 'Chưa có ai đủ điều kiện quay số'
              : phase === 'done'
                ? `${confirmed ? 'Đã xác nhận' : 'Đã quay xong'} · ${winners.length}/${slots.length} phần quà`
                : `Lượt ${round + 1}/${totalRounds} · ${slots[round] ?? ''} · còn ${candidates.length - round} người`
          }
          idleText={`${candidates.length} người · ${slots.length} phần quà`}
          lastWin={stageWinners[stageWinners.length - 1]}
          winners={stageWinners}
          tools={<FullscreenButton {...fullscreen} />}
          actions={isAdmin ? adminActions : viewerActions}
        />
        {error && <p className="form-error">{error}</p>}
        {isAdmin && listChanged && !confirmed && (
          <p className="tiny form-error">
            Danh sách đủ điều kiện đã thay đổi so với lúc bắt đầu quay ({liveIds.length} người hiện
            tại). Muốn quay theo danh sách mới thì bấm "Quay lại từ đầu".
          </p>
        )}

        <section className="section panel">
          <h2>Danh sách được quay ({candidates.length})</h2>
          <ol className="reward-candidates">
            {candidates.map((uid) => {
              const p = toPerson(uid)
              return (
                <li
                  key={uid}
                  className={[
                    'reward-candidate',
                    paidIds.has(uid) ? 'paid' : '',
                    winnerSet.has(uid) ? 'winner' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  title={p.name}
                >
                  <span className="reward-candidate-avatar" aria-hidden>
                    {p.avatar ? <img src={p.avatar} alt="" /> : p.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="reward-candidate-text">
                    <span className="reward-candidate-name">{p.name}</span>
                    {winnerSet.has(uid) ? (
                      <small className="tag-winner">🎁 Trúng thưởng</small>
                    ) : paidIds.has(uid) ? (
                      <small className="tag-paid">Đã nộp phạt</small>
                    ) : (
                      <small className="tag-done">Hoàn thành</small>
                    )}
                  </span>
                </li>
              )
            })}
          </ol>
        </section>
      </div>
    </div>
  )
}
