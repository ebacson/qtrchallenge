import { useState } from 'react'
import { BadgeCheck, RotateCcw } from 'lucide-react'
import { DrawStage } from '../components/DrawStage'
import { drawPhase, prizeSlots, useDrawSpinner } from '../lib/drawSpinner'
import { pickRandom, rewardItemsSummary } from '../lib/rewardPenalty'
import type { RewardItem } from '../types'

type Candidate = { id: string; name: string; paid: boolean }
type TestTier = { target: string; offset: number; count: number; items: RewardItem[] }
/** Kết quả riêng của từng mốc; chuyển mốc không làm mất kết quả mốc khác */
type TierResult = { count: number; winners: string[]; confirmed: boolean }

const SAMPLE_NAMES = [
  'Nguyễn Văn An',
  'Trần Thị Bích',
  'Lê Hoàng Cường',
  'Phạm Minh Đức',
  'Hoàng Thị Hà',
  'Võ Quốc Huy',
  'Đặng Thu Hương',
  'Bùi Gia Khánh',
  'Đỗ Thị Lan',
  'Hồ Văn Long',
  'Ngô Thị Mai',
  'Dương Công Minh',
  'Lý Thị Ngọc',
  'Phan Văn Nam',
  'Trương Thị Oanh',
  'Huỳnh Tấn Phát',
  'Cao Thị Quyên',
  'Mai Xuân Sơn',
  'Tô Thị Tâm',
  'Lương Văn Thắng',
  'Đinh Thị Thảo',
  'Kiều Minh Tiến',
  'Vương Thị Trang',
  'Chu Văn Tuấn',
  'La Thị Uyên',
  'Thái Quang Vinh',
  'Quách Thị Xuân',
  'Giang Văn Yên',
  'Tạ Thị Ánh',
  'Lâm Đức Bảo',
  'Phùng Thị Châu',
  'Triệu Văn Dũng',
  'Âu Thị Diệp',
  'Mạc Văn Giang',
  'Văn Thị Hạnh',
  'Doãn Minh Hiếu',
  'Khúc Thị Kim',
  'Ninh Văn Lực',
  'Hà Thị Mỹ',
  'Tôn Thất Nhân',
]

const SAMPLE: Candidate[] = SAMPLE_NAMES.map((name, i) => ({
  id: `test-${i + 1}`,
  name,
  // Khoảng 1/5 là người chưa hoàn thành nhưng đã nộp phạt, như danh sách quay thật
  paid: i % 5 === 4,
}))

/** offset/count: mỗi mốc lấy một đoạn khác nhau trong danh sách mẫu, như người về các mốc khác nhau */
const TEST_TIERS: TestTier[] = [
  {
    target: '300 km',
    offset: 0,
    count: 10,
    items: [
      { name: 'Áo QTR', quantity: 1 },
      { name: 'Tất xỏ ngón', quantity: 2 },
    ],
  },
  { target: '200 km', offset: 10, count: 14, items: [{ name: 'Tất xỏ ngón', quantity: 3 }] },
  { target: '100 km', offset: 24, count: 16, items: [{ name: 'Băng đô chạy bộ', quantity: 2 }] },
]

function tierCandidates(tier: TestTier, count: number): Candidate[] {
  return Array.from({ length: count }, (_, i) => SAMPLE[(tier.offset + i) % SAMPLE.length])
}

const byId = new Map(SAMPLE.map((c) => [c.id, c]))

export function DrawTestPage() {
  const [tierIndex, setTierIndex] = useState(0)
  const [results, setResults] = useState<TierResult[]>(() =>
    TEST_TIERS.map((t) => ({ count: t.count, winners: [], confirmed: false })),
  )
  const spinner = useDrawSpinner()

  const tier = TEST_TIERS[tierIndex]
  const slots = prizeSlots(tier.items)
  const { count, winners, confirmed } = results[tierIndex]
  const candidates = tierCandidates(tier, count)
  const winnerSet = new Set(winners)
  /** Người đã trúng bị loại khỏi các lượt sau */
  const pool = candidates.filter((c) => !winnerSet.has(c.id))
  const totalRounds = Math.min(slots.length, candidates.length)
  const round = winners.length
  const busy = spinner.spinning
  const phase = drawPhase(busy, round, totalRounds)
  const nextTierIndex = TEST_TIERS.findIndex((_, i) => i !== tierIndex && !results[i].confirmed)
  const stageWinners = winners.map((id, i) => ({
    person: { id, name: byId.get(id)?.name ?? '?' },
    prize: slots[i] ?? '',
  }))

  function updateResult(index: number, update: (r: TierResult) => TierResult) {
    setResults((list) => list.map((r, i) => (i === index ? update(r) : r)))
  }

  function selectTier(index: number) {
    spinner.stop()
    setTierIndex(index)
  }

  function resetTier() {
    spinner.stop()
    updateResult(tierIndex, (r) => ({ ...r, winners: [] }))
  }

  /** Quay một phần quà trong số người chưa trúng */
  async function runRound() {
    if (busy || confirmed || round >= totalRounds || !pool.length) return
    const index = tierIndex
    const picked = pickRandom(pool)
    if (!picked) return
    const done = await spinner.spin(pool, picked)
    if (!done) return
    updateResult(index, (r) => ({ ...r, winners: [...r.winners, picked.id] }))
  }

  function confirmTier() {
    if (
      !window.confirm(
        `Xác nhận kết quả mốc ${tier.target} (${winners.length} người trúng thưởng)? Sau khi xác nhận sẽ không thể quay lại mốc này.`,
      )
    )
      return
    updateResult(tierIndex, (r) => ({ ...r, confirmed: true }))
  }

  return (
    <div className="page draw-test">
      <header className="page-header">
        <p className="eyebrow">Admin</p>
        <h1>Quay số thử</h1>
        <p className="lede">
          Chạy thử kịch bản quay số trúng thưởng bằng dữ liệu mẫu. Kết quả không được lưu.
        </p>
      </header>

      <section className="section panel draw-setup">
        <div className="filter-row">
          {TEST_TIERS.map((t, i) => {
            const r = results[i]
            return (
              <button
                key={t.target}
                type="button"
                className={tierIndex === i ? 'chip active' : 'chip'}
                disabled={busy}
                onClick={() => selectTier(i)}
              >
                {t.target}
                {r.confirmed ? (
                  <BadgeCheck size={14} aria-label="Đã xác nhận" />
                ) : r.winners.length > 0 ? (
                  ` · ${r.winners.length} đã trúng`
                ) : null}
              </button>
            )
          })}
        </div>
        <label className="draw-count">
          <span>
            Số người được quay: <strong>{count}</strong>
            {winners.length > 0 && !confirmed && (
              <small className="muted"> (quay lại từ đầu để đổi số người)</small>
            )}
          </span>
          <input
            type="range"
            min={1}
            max={SAMPLE.length}
            value={count}
            disabled={busy || winners.length > 0}
            onChange={(e) => {
              const next = Number(e.target.value)
              updateResult(tierIndex, (r) => ({ ...r, count: next }))
            }}
          />
        </label>
      </section>

      <DrawStage
        spinner={spinner}
        phase={phase}
        target={tier.target}
        itemsSummary={rewardItemsSummary(tier.items)}
        roundText={
          phase === 'done'
            ? `${confirmed ? 'Đã xác nhận' : 'Đã quay xong'} · ${winners.length}/${slots.length} phần quà`
            : `Lượt ${round + 1}/${totalRounds} · ${slots[round] ?? ''} · còn ${pool.length} người`
        }
        idleText={`${candidates.length} người · ${slots.length} phần quà`}
        lastWin={stageWinners[stageWinners.length - 1]}
        winners={stageWinners}
        actions={
          <>
            {confirmed ? (
              <>
                <span className="draw-confirmed">
                  <BadgeCheck size={18} aria-hidden /> Đã xác nhận kết quả mốc {tier.target}
                </span>
                {nextTierIndex >= 0 && (
                  <button
                    type="button"
                    className="draw-go"
                    onClick={() => selectTier(nextTierIndex)}
                  >
                    Quay mốc {TEST_TIERS[nextTierIndex].target} →
                  </button>
                )}
              </>
            ) : phase === 'done' ? (
              <button type="button" className="draw-go" onClick={confirmTier}>
                Xác nhận kết quả {tier.target}
              </button>
            ) : (
              <button
                type="button"
                className="draw-go"
                disabled={busy || !pool.length}
                onClick={() => void runRound()}
              >
                {busy ? 'Đang quay…' : round === 0 ? 'Quay số' : 'Quay tiếp'}
              </button>
            )}
            {winners.length > 0 && !busy && !confirmed && (
              <button
                type="button"
                className="draw-reset"
                onClick={() => {
                  if (
                    window.confirm(
                      `Xóa kết quả ${winners.length} người đã trúng mốc ${tier.target} và quay lại từ đầu?`,
                    )
                  )
                    resetTier()
                }}
              >
                <RotateCcw size={16} aria-hidden /> Quay lại từ đầu
              </button>
            )}
          </>
        }
      />

      <section className="section panel">
        <h2>Danh sách được quay ({candidates.length})</h2>
        <p className="tiny muted">
          {candidates.filter((c) => !c.paid).length} hoàn thành ·{' '}
          {candidates.filter((c) => c.paid).length} chưa hoàn thành nhưng đã nộp phạt
        </p>
        <ol className="reward-candidates">
          {candidates.map((c) => (
            <li
              key={c.id}
              className={[
                'reward-candidate',
                c.paid ? 'paid' : '',
                winnerSet.has(c.id) ? 'winner' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={c.name}
            >
              <span className="reward-candidate-avatar" aria-hidden>
                {c.name.split(' ').pop()?.charAt(0).toUpperCase()}
              </span>
              <span className="reward-candidate-text">
                <span className="reward-candidate-name">{c.name}</span>
                {winnerSet.has(c.id) ? (
                  <small className="tag-winner">🎁 Trúng thưởng</small>
                ) : c.paid ? (
                  <small className="tag-paid">Đã nộp phạt</small>
                ) : (
                  <small className="tag-done">Hoàn thành</small>
                )}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
