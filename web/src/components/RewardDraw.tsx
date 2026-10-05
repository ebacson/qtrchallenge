import { useEffect, useRef, useState } from 'react'
import { get, ref, set, update } from 'firebase/database'
import { Gift } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { STATUS_FINISHED } from '../lib/challengeRules'
import { db } from '../lib/firebase'
import {
  assignPrizes,
  drawWinners,
  pickRandom,
  rewardCandidates,
  rewardItemsSummary,
  type RewardCandidate,
} from '../lib/rewardPenalty'
import type { Challenge, RewardTier } from '../types'

/** Tổng thời gian quay; tên đổi nhanh lúc đầu rồi chậm dần */
const SPIN_MS = 7000
const TICK_START_MS = 90
const TICK_END_MS = 650
/** Dừng lại trên tên người trúng đầu tiên trước khi hiện kết quả */
const HOLD_MS = 1500

type Names = Record<string, { name: string; avatar: string }>

function displayName(names: Names, uid: string): string {
  return names[uid]?.name || 'Người dùng ẩn danh'
}

function formatDrawTime(ms: number): string {
  if (!ms) return ''
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(ms))
}

/** Danh sách tên người được quay; người đã nộp phạt (chưa hoàn thành) có nhãn riêng */
function CandidateList({
  uids,
  paidUids,
  winners,
  names,
}: {
  uids: string[]
  paidUids: Set<string>
  winners: Set<string>
  names: Names
}) {
  // Người trúng → hoàn thành → đã nộp phạt; trong mỗi nhóm theo tên
  const rank = (uid: string) => (winners.has(uid) ? 0 : paidUids.has(uid) ? 2 : 1)
  const sorted = [...uids].sort(
    (a, b) =>
      rank(a) - rank(b) || displayName(names, a).localeCompare(displayName(names, b), 'vi'),
  )
  return (
    <ol className="reward-candidates">
      {sorted.map((uid) => {
        const name = displayName(names, uid)
        const avatar = names[uid]?.avatar
        return (
          <li
            key={uid}
            className={[
              'reward-candidate',
              paidUids.has(uid) ? 'paid' : '',
              winners.has(uid) ? 'winner' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            title={name}
          >
            <span className="reward-candidate-avatar" aria-hidden>
              {avatar ? <img src={avatar} alt="" /> : name.charAt(0).toUpperCase()}
            </span>
            <span className="reward-candidate-text">
              <span className="reward-candidate-name">{name}</span>
              {winners.has(uid) ? (
                <small className="tag-winner">🎁 Trúng thưởng</small>
              ) : paidUids.has(uid) ? (
                <small className="tag-paid">Đã nộp phạt</small>
              ) : (
                <small className="tag-done">Hoàn thành</small>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function RewardDrawCard({
  challenge,
  reward,
  candidateList,
  names,
}: {
  challenge: Challenge
  reward: RewardTier
  candidateList: RewardCandidate[]
  names: Names
}) {
  const candidates = candidateList.map((c) => c.uid)
  const paidUids = new Set(candidateList.filter((c) => c.via === 'paid').map((c) => c.uid))
  const completedCount = candidates.length - paidUids.size
  const { user, profile } = useAuth()
  const draw = challenge.rewardDraws?.find((d) => d.target === reward.target)
  const [spinName, setSpinName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t)
    },
    [],
  )

  function wait(ms: number) {
    return new Promise<void>((resolve) => {
      timers.current.push(setTimeout(resolve, ms))
    })
  }

  /** Đổi tên ngẫu nhiên, khoảng cách giữa các lần đổi tăng dần (ease-out) */
  async function spin(finalUid: string) {
    const startedAt = Date.now()
    let last = ''
    for (;;) {
      const progress = Math.min(1, (Date.now() - startedAt) / SPIN_MS)
      if (progress >= 1) break
      let uid = pickRandom(candidates) ?? ''
      if (candidates.length > 1) while (uid === last) uid = pickRandom(candidates) ?? ''
      last = uid
      setSpinName(displayName(names, uid))
      const eased = progress * progress
      await wait(TICK_START_MS + (TICK_END_MS - TICK_START_MS) * eased)
    }
    setSpinName(displayName(names, finalUid))
    await wait(HOLD_MS)
  }

  const isAdmin = Boolean(profile?.admin)
  const finished = challenge.status === STATUS_FINISHED
  const targetIndex = challenge.targetDistances.indexOf(reward.target)
  const confirmed = Boolean(draw?.confirmedAt)
  const drawPath = `challenges/${challenge.id}/rewardDraws/${targetIndex}`
  const listChanged =
    draw != null &&
    (draw.candidates.length !== candidates.length ||
      draw.candidates.some((uid) => !candidates.includes(uid)))

  /** Đọc lại từ RTDB phòng Admin khác vừa xác nhận */
  async function lockedNow(): Promise<boolean> {
    const snap = await get(ref(db, `${drawPath}/confirmedAt`))
    if (!(Number(snap.val()) > 0)) return false
    setError('Kết quả đã được xác nhận — không thể quay lại hoặc xóa.')
    return true
  }

  async function runDraw() {
    if (!user || targetIndex < 0 || !candidates.length || confirmed) return
    if (await lockedNow()) return
    if (
      draw &&
      !window.confirm('Đã có kết quả quay số. Quay lại sẽ thay kết quả cũ, tiếp tục?')
    ) {
      return
    }
    setBusy(true)
    setError('')
    const winners = drawWinners(candidates, reward.gifts)
    const prizes = assignPrizes(winners, reward.items)
    try {
      if (candidates.length > reward.gifts && winners.length) await spin(winners[0])
      await set(ref(db, drawPath), {
        target: reward.target,
        gifts: reward.gifts,
        prize: reward.prize,
        candidates,
        winners,
        prizes,
        drawnAt: Date.now(),
        drawnBy: user.uid,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được kết quả')
    } finally {
      setSpinName(null)
      setBusy(false)
    }
  }

  async function clearDraw() {
    if (targetIndex < 0 || confirmed) return
    if (!window.confirm('Xóa kết quả quay số của mục tiêu này?')) return
    setBusy(true)
    setError('')
    try {
      if (await lockedNow()) return
      await set(ref(db, drawPath), null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xóa được')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDraw() {
    if (!user || targetIndex < 0 || !draw || confirmed) return
    if (
      !window.confirm(
        `Xác nhận kết quả quay thưởng mục tiêu "${reward.target}"?\n\n` +
          'Sau khi xác nhận sẽ không thể quay lại hoặc xóa kết quả nữa.',
      )
    ) {
      return
    }
    setBusy(true)
    setError('')
    try {
      await update(ref(db, drawPath), { confirmedAt: Date.now(), confirmedBy: user.uid })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xác nhận được')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="reward-draw-card">
      <div className="reward-draw-head">
        <Gift size={20} aria-hidden />
        <div>
          <strong>{reward.target}</strong>
          <span className="tiny muted">
            {rewardItemsSummary(reward.items)} · {candidates.length} người được quay
            {candidates.length > 0 &&
              ` (${completedCount} hoàn thành${paidUids.size ? ` · ${paidUids.size} đã nộp phạt` : ''})`}
          </span>
        </div>
      </div>

      {spinName == null && (draw ? draw.candidates.length > 0 : candidates.length > 0) && (
        <div className="reward-candidates-wrap">
          <p className="tiny muted">
            {draw ? 'Danh sách đã quay:' : 'Danh sách được quay:'}
          </p>
          <CandidateList
            uids={draw ? draw.candidates : candidates}
            paidUids={paidUids}
            winners={new Set(draw?.winners ?? [])}
            names={names}
          />
        </div>
      )}

      {spinName != null ? (
        <div className="reward-draw-spin" aria-live="polite">
          <span key={spinName}>{spinName}</span>
        </div>
      ) : draw ? (
        <>
          <p className="tiny muted">
            Đã quay lúc {formatDrawTime(draw.drawnAt)} trong {draw.candidates.length} người
            {draw.candidates.length <= draw.gifts ? ' (đủ quà cho tất cả)' : ''}.
          </p>
          <ol className="reward-winners">
            {draw.winners.map((uid, i) => (
              <li key={uid}>
                <span className="hof-avatar">
                  {names[uid]?.avatar ? (
                    <img src={names[uid].avatar} alt="" />
                  ) : (
                    <span>{displayName(names, uid).charAt(0).toUpperCase()}</span>
                  )}
                </span>
                <strong>{displayName(names, uid)}</strong>
                {draw.prizes[i] && <span className="reward-winner-prize">{draw.prizes[i]}</span>}
              </li>
            ))}
          </ol>
          {confirmed ? (
            <p className="reward-draw-confirmed">
              ✓ Kết quả đã xác nhận lúc {formatDrawTime(draw.confirmedAt ?? 0)}
              {draw.confirmedBy && names[draw.confirmedBy]?.name
                ? ` bởi ${names[draw.confirmedBy].name}`
                : ''}
            </p>
          ) : (
            isAdmin && (
              <p className="tiny muted">Chưa xác nhận — Admin có thể quay lại hoặc xóa kết quả.</p>
            )
          )}
          {isAdmin && !confirmed && listChanged && (
            <p className="tiny form-error">
              Danh sách được quay đã thay đổi so với lúc quay ({candidates.length} người hiện
              tại).
            </p>
          )}
        </>
      ) : candidates.length === 0 ? (
        <p className="tiny muted">Chưa có ai đủ điều kiện quay số mục tiêu này.</p>
      ) : (
        <p className="tiny muted">
          {finished
            ? 'Chưa quay số.'
            : 'Quay số sau khi thử thách kết thúc (danh sách đang tạm tính).'}
        </p>
      )}

      {isAdmin && finished && !confirmed && (candidates.length > 0 || draw) && (
        <div className="btn-row">
          {draw && (
            <button
              type="button"
              className="btn primary compact"
              disabled={busy}
              onClick={() => void confirmDraw()}
            >
              Xác nhận kết quả
            </button>
          )}
          {candidates.length > 0 && (
            <button
              type="button"
              className={`btn compact ${draw ? 'ghost' : 'primary'}`}
              disabled={busy}
              onClick={() => void runDraw()}
            >
              {busy
                ? 'Đang xử lý…'
                : candidates.length <= reward.gifts
                  ? 'Trao thưởng cho tất cả'
                  : draw
                    ? 'Quay lại'
                    : 'Quay số'}
            </button>
          )}
          {draw && (
            <button
              type="button"
              className="btn ghost compact danger"
              disabled={busy}
              onClick={() => void clearDraw()}
            >
              Xóa kết quả
            </button>
          )}
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}

/** Các lượt quay thưởng của một thử thách (mỗi mục tiêu có thưởng một lượt). */
export function RewardDrawSection({
  challenge,
  userChallenges,
  names,
  embedded = false,
}: {
  challenge: Challenge
  userChallenges: Record<string, Record<string, unknown> | null>
  names: Names
  /** Hiển thị như một mục con trong khung khác thay vì một section riêng */
  embedded?: boolean
}) {
  const rewards = challenge.rewards ?? []
  if (!rewards.length) return null
  const Wrapper = embedded ? 'div' : 'section'
  return (
    <Wrapper className={embedded ? 'reward-section' : 'section panel reward-section'}>
      {embedded ? (
        <h4 className="goal-rules-subtitle">Quay số trúng thưởng</h4>
      ) : (
        <h2>Quay số trúng thưởng</h2>
      )}
      <p className="tiny muted">
        Mỗi mục tiêu quay ngẫu nhiên trong số thành viên chính thức hoàn thành mục tiêu đó hoặc
        chưa hoàn thành nhưng đã nộp phạt, trao lần lượt từng món theo thứ tự quà đã đặt; số
        người được quay không vượt số quà thì tất cả đều nhận.
      </p>
      <div className="reward-draw-list">
        {rewards.map((r) => (
          <RewardDrawCard
            key={r.target}
            challenge={challenge}
            reward={r}
            candidateList={rewardCandidates(challenge, userChallenges, r.target)}
            names={names}
          />
        ))}
      </div>
    </Wrapper>
  )
}
