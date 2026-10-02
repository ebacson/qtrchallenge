import { useEffect, useRef, useState } from 'react'
import { ref, set } from 'firebase/database'
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
} from '../lib/rewardPenalty'
import type { Challenge, RewardTier } from '../types'

const SPIN_MS = 2600
const TICK_MS = 70

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

function RewardDrawCard({
  challenge,
  reward,
  candidates,
  names,
}: {
  challenge: Challenge
  reward: RewardTier
  candidates: string[]
  names: Names
}) {
  const { user, profile } = useAuth()
  const draw = challenge.rewardDraws?.find((d) => d.target === reward.target)
  const [spinName, setSpinName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timers = useRef<ReturnType<typeof setInterval>[]>([])

  useEffect(
    () => () => {
      for (const t of timers.current) clearInterval(t)
    },
    [],
  )

  const isAdmin = Boolean(profile?.admin)
  const finished = challenge.status === STATUS_FINISHED
  const targetIndex = challenge.targetDistances.indexOf(reward.target)
  const listChanged =
    draw != null &&
    (draw.candidates.length !== candidates.length ||
      draw.candidates.some((uid) => !candidates.includes(uid)))

  async function runDraw() {
    if (!user || targetIndex < 0 || !candidates.length) return
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
      if (candidates.length > reward.gifts) {
        await new Promise<void>((resolve) => {
          const tick = setInterval(() => {
            const uid = pickRandom(candidates)
            setSpinName(uid ? displayName(names, uid) : '')
          }, TICK_MS)
          timers.current.push(tick)
          setTimeout(() => {
            clearInterval(tick)
            resolve()
          }, SPIN_MS)
        })
      }
      await set(ref(db, `challenges/${challenge.id}/rewardDraws/${targetIndex}`), {
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
    if (targetIndex < 0 || !window.confirm('Xóa kết quả quay số của mục tiêu này?')) return
    setBusy(true)
    setError('')
    try {
      await set(ref(db, `challenges/${challenge.id}/rewardDraws/${targetIndex}`), null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xóa được')
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
            {rewardItemsSummary(reward.items)} · {candidates.length} người hoàn thành
          </span>
        </div>
      </div>

      {spinName != null ? (
        <div className="reward-draw-spin" aria-live="polite">
          {spinName}
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
          {isAdmin && listChanged && (
            <p className="tiny form-error">
              Danh sách hoàn thành đã thay đổi so với lúc quay ({candidates.length} người hiện
              tại).
            </p>
          )}
        </>
      ) : candidates.length === 0 ? (
        <p className="tiny muted">Chưa có ai hoàn thành mục tiêu này.</p>
      ) : (
        <p className="tiny muted">
          {finished
            ? 'Chưa quay số.'
            : 'Quay số sau khi thử thách kết thúc (danh sách đang tạm tính).'}
        </p>
      )}

      {isAdmin && finished && candidates.length > 0 && (
        <div className="btn-row">
          <button
            type="button"
            className="btn primary compact"
            disabled={busy}
            onClick={() => void runDraw()}
          >
            {busy
              ? 'Đang quay…'
              : candidates.length <= reward.gifts
                ? 'Trao thưởng cho tất cả'
                : draw
                  ? 'Quay lại'
                  : 'Quay số'}
          </button>
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
}: {
  challenge: Challenge
  userChallenges: Record<string, Record<string, unknown> | null>
  names: Names
}) {
  const rewards = challenge.rewards ?? []
  if (!rewards.length) return null
  return (
    <section className="section panel reward-section">
      <h2>Quay số trúng thưởng</h2>
      <p className="tiny muted">
        Mỗi mục tiêu quay ngẫu nhiên trong số thành viên chính thức hoàn thành mục tiêu đó và
        trao lần lượt từng món theo thứ tự quà đã đặt; số người hoàn thành không vượt số quà
        thì tất cả đều nhận.
      </p>
      <div className="reward-draw-list">
        {rewards.map((r) => (
          <RewardDrawCard
            key={r.target}
            challenge={challenge}
            reward={r}
            candidates={rewardCandidates(challenge, userChallenges, r.target)}
            names={names}
          />
        ))}
      </div>
    </section>
  )
}
