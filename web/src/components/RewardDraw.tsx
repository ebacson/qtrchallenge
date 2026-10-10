import { Link } from 'react-router-dom'
import { Gift } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { revealedWinners, STATUS_FINISHED } from '../lib/challengeRules'
import {
  rewardCandidates,
  rewardItemsSummary,
  type RewardCandidate,
} from '../lib/rewardPenalty'
import type { Challenge, RewardTier } from '../types'

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
  winnersOnlyWhenConfirmed,
}: {
  challenge: Challenge
  reward: RewardTier
  candidateList: RewardCandidate[]
  names: Names
  winnersOnlyWhenConfirmed: boolean
}) {
  const candidates = candidateList.map((c) => c.uid)
  const paidUids = new Set(candidateList.filter((c) => c.via === 'paid').map((c) => c.uid))
  const completedCount = candidates.length - paidUids.size
  const { profile } = useAuth()
  const draw = challenge.rewardDraws?.find((d) => d.target === reward.target)

  const isAdmin = Boolean(profile?.admin)
  const finished = challenge.status === STATUS_FINISHED
  const confirmed = Boolean(draw?.confirmedAt)
  /** Quay từng phần quà: chưa đủ lượt là đang quay dở */
  const totalRounds = draw ? Math.min(draw.gifts, draw.candidates.length) : 0
  const shown = draw ? revealedWinners(draw) : []
  const spinningNow = draw != null && shown.length < draw.winners.length
  const inProgress = draw != null && shown.length < totalRounds
  const listChanged =
    draw != null &&
    (draw.candidates.length !== candidates.length ||
      draw.candidates.some((uid) => !candidates.includes(uid)))
  const drawScreen = `/admin/challenges/${challenge.id}/draw?target=${encodeURIComponent(reward.target)}`

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

      {!(confirmed && winnersOnlyWhenConfirmed) &&
        (draw ? draw.candidates.length > 0 : candidates.length > 0) && (
        <div className="reward-candidates-wrap">
          <p className="tiny muted">
            {draw ? 'Danh sách đã quay:' : 'Danh sách được quay:'}
          </p>
          <CandidateList
            uids={draw ? draw.candidates : candidates}
            paidUids={paidUids}
            winners={new Set(shown)}
            names={names}
          />
        </div>
      )}

      {draw ? (
        <>
          <p className="tiny muted">
            {spinningNow
              ? `Đang quay phần quà thứ ${shown.length + 1}/${totalRounds}…`
              : inProgress
              ? `Đang quay: ${shown.length}/${totalRounds} phần quà đã có người nhận (lượt gần nhất lúc ${formatDrawTime(draw.drawnAt)}).`
              : `Đã quay xong lúc ${formatDrawTime(draw.drawnAt)} trong ${draw.candidates.length} người${draw.candidates.length <= draw.gifts ? ' (đủ quà cho tất cả)' : ''}.`}
          </p>
          <ol className="reward-winners">
            {shown.map((uid, i) => (
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
              <p className="tiny muted">Chưa xác nhận — Admin có thể quay tiếp hoặc quay lại từ đầu.</p>
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
          <Link className="btn primary compact" to={drawScreen}>
            {draw ? 'Mở màn hình quay số' : 'Quay số'}
          </Link>
        </div>
      )}
      {!isAdmin && finished && !confirmed && (candidates.length > 0 || draw) && (
        <div className="btn-row">
          <Link
            className={spinningNow ? 'btn primary compact' : 'btn ghost compact'}
            to={`/challenges/${challenge.id}/draw?target=${encodeURIComponent(reward.target)}`}
          >
            {spinningNow ? '🔴 Đang quay · Xem trực tiếp' : 'Xem quay số trực tiếp'}
          </Link>
        </div>
      )}
    </div>
  )
}

/** Các lượt quay thưởng của một thử thách (mỗi mục tiêu có thưởng một lượt). */
export function RewardDrawSection({
  challenge,
  userChallenges,
  names,
  embedded = false,
  winnersOnlyWhenConfirmed = false,
}: {
  challenge: Challenge
  userChallenges: Record<string, Record<string, unknown> | null>
  names: Names
  /** Hiển thị như một mục con trong khung khác thay vì một section riêng */
  embedded?: boolean
  /** Kết quả đã xác nhận: chỉ hiện người trúng thưởng, ẩn danh sách được quay */
  winnersOnlyWhenConfirmed?: boolean
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
        chưa hoàn thành nhưng đã nộp phạt. Mỗi phần quà quay một lượt theo thứ tự quà đã đặt,
        người đã trúng không được quay ở lượt sau; số người được quay không vượt số quà thì tất cả
        đều nhận, quay để chọn ai nhận phần quà nào.
      </p>
      <div className="reward-draw-list">
        {rewards.map((r) => (
          <RewardDrawCard
            key={r.target}
            challenge={challenge}
            reward={r}
            candidateList={rewardCandidates(challenge, userChallenges, r.target)}
            names={names}
            winnersOnlyWhenConfirmed={winnersOnlyWhenConfirmed}
          />
        ))}
      </div>
    </Wrapper>
  )
}
