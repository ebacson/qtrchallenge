import { useEffect, useRef, useState } from 'react'
import { Gift, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { pickRandom, rewardItemLabel, rewardItemsSummary } from '../lib/rewardPenalty'
import type { RewardItem } from '../types'

/** Mỗi lượt: tên đổi nhanh rồi chậm dần, dừng trên người trúng phần quà đó */
const SPIN_MS = 7000
const TICK_START_MS = 90
const TICK_END_MS = 650
const HOLD_MS = 1200

const MUSIC_URL = `${import.meta.env.BASE_URL}sounds/quayso.mp3`

type Candidate = { id: string; name: string; paid: boolean }
type TestTier = { target: string; items: RewardItem[] }
/** won: vừa công bố người trúng một phần quà, chờ quay phần tiếp theo */
type Phase = 'idle' | 'spinning' | 'won' | 'done'
type Confetti = { id: number; left: number; delay: number; duration: number; color: string; size: number }

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

const TEST_TIERS: TestTier[] = [
  {
    target: '300 km',
    items: [
      { name: 'Áo QTR', quantity: 1 },
      { name: 'Tất xỏ ngón', quantity: 2 },
    ],
  },
  { target: '200 km', items: [{ name: 'Tất xỏ ngón', quantity: 3 }] },
  { target: '100 km', items: [{ name: 'Băng đô chạy bộ', quantity: 2 }] },
]

const CONFETTI_COLORS = ['#ffd54a', '#ff4d6d', '#ffffff', '#4dd0e1', '#ffb300', '#7cff6b']

function initial(name: string): string {
  return name.split(' ').pop()?.charAt(0).toUpperCase() ?? '?'
}

function makeConfetti(): Confetti[] {
  return Array.from({ length: 70 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 1.2,
    duration: 2.4 + Math.random() * 2,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    size: 6 + Math.random() * 6,
  }))
}

function nowMs(): number {
  return Date.now()
}

export function DrawTestPage() {
  const [tierIndex, setTierIndex] = useState(0)
  const [count, setCount] = useState(24)
  const [phase, setPhase] = useState<Phase>('idle')
  const [spinName, setSpinName] = useState<string | null>(null)
  const [winners, setWinners] = useState<string[]>([])
  const [confetti, setConfetti] = useState<Confetti[]>([])
  const [muted, setMuted] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const audio = useRef<HTMLAudioElement | null>(null)
  const runId = useRef(0)

  const tier = TEST_TIERS[tierIndex]
  /** Từng phần quà theo thứ tự đã đặt; mỗi phần quà một lượt quay */
  const slots = tier.items.flatMap((it) =>
    Array<string>(it.quantity).fill(rewardItemLabel(it.name)),
  )
  const candidates = SAMPLE.slice(0, count)
  const byId = new Map(SAMPLE.map((c) => [c.id, c]))
  const winnerSet = new Set(winners)
  /** Người đã trúng bị loại khỏi các lượt sau */
  const pool = candidates.filter((c) => !winnerSet.has(c.id))
  const totalRounds = Math.min(slots.length, candidates.length)
  const round = winners.length
  const nextPrize = slots[round] ?? ''
  const lastWinner = winners.length ? byId.get(winners[winners.length - 1]) : undefined
  const busy = phase === 'spinning'

  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t)
      audio.current?.pause()
    },
    [],
  )

  function wait(ms: number) {
    return new Promise<void>((resolve) => {
      timers.current.push(setTimeout(resolve, ms))
    })
  }

  function stopMusic() {
    audio.current?.pause()
  }

  function playMusic() {
    if (!audio.current) {
      audio.current = new Audio(MUSIC_URL)
      audio.current.preload = 'auto'
    }
    const a = audio.current
    a.muted = muted
    a.currentTime = 0
    a.volume = 1
    void a.play().catch(() => {})
  }

  function reset() {
    runId.current += 1
    for (const t of timers.current) clearTimeout(t)
    timers.current = []
    stopMusic()
    setPhase('idle')
    setSpinName(null)
    setWinners([])
    setConfetti([])
  }

  async function spin(ids: string[], finalId: string, run: number) {
    const startedAt = nowMs()
    let last = ''
    for (;;) {
      if (runId.current !== run) return
      const progress = Math.min(1, (nowMs() - startedAt) / SPIN_MS)
      if (progress >= 1) break
      let id = pickRandom(ids) ?? ''
      if (ids.length > 1) while (id === last) id = pickRandom(ids) ?? ''
      last = id
      setSpinName(byId.get(id)?.name ?? '')
      const eased = progress * progress
      await wait(TICK_START_MS + (TICK_END_MS - TICK_START_MS) * eased)
    }
    setSpinName(byId.get(finalId)?.name ?? '')
    await wait(HOLD_MS)
  }

  /** Quay một phần quà trong số người chưa trúng */
  async function runRound() {
    if (busy || round >= totalRounds || !pool.length) return
    runId.current += 1
    const run = runId.current
    const ids = pool.map((c) => c.id)
    const picked = pickRandom(ids)
    if (!picked) return
    setConfetti([])
    setPhase('spinning')
    playMusic()
    if (ids.length > 1) await spin(ids, picked, run)
    if (runId.current !== run) return
    setSpinName(null)
    setWinners((list) => [...list, picked])
    setConfetti(makeConfetti())
    setPhase(round + 1 >= totalRounds ? 'done' : 'won')
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    if (audio.current) audio.current.muted = next
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
          {TEST_TIERS.map((t, i) => (
            <button
              key={t.target}
              type="button"
              className={tierIndex === i ? 'chip active' : 'chip'}
              disabled={busy}
              onClick={() => {
                reset()
                setTierIndex(i)
              }}
            >
              {t.target}
            </button>
          ))}
        </div>
        <label className="draw-count">
          <span>
            Số người được quay: <strong>{count}</strong>
          </span>
          <input
            type="range"
            min={1}
            max={SAMPLE.length}
            value={count}
            disabled={busy}
            onChange={(e) => {
              reset()
              setCount(Number(e.target.value))
            }}
          />
        </label>
      </section>

      <section className={`draw-stage draw-${phase}`}>
        <div className="draw-lights" aria-hidden />
        {confetti.length > 0 && (
          <div className="draw-confetti" aria-hidden>
            {confetti.map((c) => (
              <span
                key={c.id}
                style={{
                  left: `${c.left}%`,
                  width: c.size,
                  height: c.size * 0.45,
                  background: c.color,
                  animationDelay: `${c.delay}s`,
                  animationDuration: `${c.duration}s`,
                }}
              />
            ))}
          </div>
        )}
        <button
          type="button"
          className="draw-mute"
          onClick={toggleMute}
          aria-label={muted ? 'Bật nhạc' : 'Tắt nhạc'}
          title={muted ? 'Bật nhạc' : 'Tắt nhạc'}
        >
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>

        <p className="draw-kicker">QTR Challenge</p>
        <h2 className="draw-title">Quay số trúng thưởng</h2>
        <p className="draw-target">
          Mục tiêu <strong>{tier.target}</strong> · {rewardItemsSummary(tier.items)}
        </p>

        <p className="draw-round">
          {phase === 'done'
            ? `Đã trao ${winners.length}/${slots.length} phần quà`
            : `Lượt ${round + 1}/${totalRounds} · ${nextPrize} · còn ${pool.length} người`}
        </p>

        <div className="draw-slot" aria-live="polite">
          {phase === 'spinning' && spinName ? (
            <span key={spinName} className="draw-slot-name">
              <span className="draw-slot-avatar">{initial(spinName)}</span>
              {spinName}
            </span>
          ) : (phase === 'won' || phase === 'done') && lastWinner ? (
            <span key={lastWinner.id} className="draw-slot-name draw-slot-win">
              <span className="draw-slot-avatar">{initial(lastWinner.name)}</span>
              {lastWinner.name}
              <span className="draw-winner-prize">
                <Gift size={14} aria-hidden /> {slots[winners.length - 1]}
              </span>
            </span>
          ) : (
            <span className="draw-slot-idle">
              {candidates.length} người · {slots.length} phần quà
            </span>
          )}
        </div>

        <div className="draw-actions">
          {phase !== 'done' && (
            <button
              type="button"
              className="draw-go"
              disabled={busy || !pool.length}
              onClick={() => void runRound()}
            >
              {busy ? 'Đang quay…' : round === 0 ? 'Quay số' : 'Quay tiếp'}
            </button>
          )}
          {(winners.length > 0 || phase === 'done') && !busy && (
            <button
              type="button"
              className="draw-reset"
              onClick={() => {
                if (
                  window.confirm(
                    `Xóa kết quả ${winners.length} người đã trúng và quay lại từ đầu?`,
                  )
                )
                  reset()
              }}
            >
              <RotateCcw size={16} aria-hidden /> Quay lại từ đầu
            </button>
          )}
        </div>

        {winners.length > 0 && (
          <ol className="draw-winners">
            {winners.map((id, i) => {
              const c = byId.get(id)
              return (
                <li key={id}>
                  <span className="draw-winner-rank">{i + 1}</span>
                  <span className="draw-slot-avatar">{initial(c?.name ?? '?')}</span>
                  <strong>{c?.name}</strong>
                  <span className="draw-winner-prize">
                    <Gift size={14} aria-hidden /> {slots[i]}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </section>

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
                {initial(c.name)}
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
