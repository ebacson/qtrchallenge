import { useEffect, useRef, useState } from 'react'
import { pickRandom, rewardItemLabel } from './rewardPenalty'
import type { RewardItem } from '../types'

/** Mỗi lượt: tên đổi nhanh rồi chậm dần, dừng trên người trúng phần quà đó */
const SPIN_MS = 14000
const TICK_START_MS = 90
const TICK_END_MS = 650
const HOLD_MS = 1200

const MUSIC_URL = `${import.meta.env.BASE_URL}sounds/quayso.mp3`

const CONFETTI_COLORS = ['#ffd54a', '#ff4d6d', '#ffffff', '#4dd0e1', '#ffb300', '#7cff6b']

/** won: vừa công bố người trúng một phần quà, chờ quay phần tiếp theo */
export type DrawPhase = 'idle' | 'spinning' | 'won' | 'done'

export type StagePerson = { id: string; name: string; avatar?: string }

export type StageWinner = { person: StagePerson; prize: string }

export type Confetti = {
  id: number
  left: number
  delay: number
  duration: number
  color: string
  size: number
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

/** Các phần quà theo thứ tự đã đặt, mỗi phần một lượt quay: "1 Áo, 2 Tất" → [Áo, Tất, Tất] */
export function prizeSlots(items: RewardItem[]): string[] {
  return items.flatMap((it) => Array<string>(it.quantity).fill(rewardItemLabel(it.name)))
}

export function drawPhase(spinning: boolean, round: number, totalRounds: number): DrawPhase {
  if (spinning) return 'spinning'
  if (round === 0) return 'idle'
  return round >= totalRounds ? 'done' : 'won'
}

/** Hiệu ứng quay (đổi tên chậm dần), nhạc và pháo giấy của sân khấu quay số */
export function useDrawSpinner() {
  const [spinning, setSpinning] = useState(false)
  const [spinPerson, setSpinPerson] = useState<StagePerson | null>(null)
  const [confetti, setConfetti] = useState<Confetti[]>([])
  const [muted, setMuted] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const audio = useRef<HTMLAudioElement | null>(null)
  const runId = useRef(0)

  useEffect(() => {
    const t = timers
    const a = audio
    const r = runId
    return () => {
      r.current += 1
      for (const id of t.current) clearTimeout(id)
      a.current?.pause()
    }
  }, [])

  function wait(ms: number) {
    return new Promise<void>((resolve) => {
      timers.current.push(setTimeout(resolve, ms))
    })
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

  /** Dừng mọi hiệu ứng đang chạy */
  function stop() {
    runId.current += 1
    for (const t of timers.current) clearTimeout(t)
    timers.current = []
    audio.current?.pause()
    setSpinning(false)
    setSpinPerson(null)
    setConfetti([])
  }

  /** Quay qua các tên trong `people` rồi dừng ở `winner`; false nếu bị dừng giữa chừng */
  async function spin(
    people: StagePerson[],
    winner: StagePerson,
    { music = true }: { music?: boolean } = {},
  ): Promise<boolean> {
    runId.current += 1
    const run = runId.current
    setConfetti([])
    setSpinning(true)
    if (music) playMusic()
    if (people.length > 1) {
      const startedAt = nowMs()
      let last = ''
      for (;;) {
        if (runId.current !== run) return false
        const progress = Math.min(1, (nowMs() - startedAt) / SPIN_MS)
        if (progress >= 1) break
        let next = pickRandom(people)
        while (next && next.id === last) next = pickRandom(people)
        last = next?.id ?? ''
        setSpinPerson(next ?? null)
        await wait(TICK_START_MS + (TICK_END_MS - TICK_START_MS) * progress * progress)
      }
    }
    if (runId.current !== run) return false
    setSpinPerson(winner)
    await wait(HOLD_MS)
    if (runId.current !== run) return false
    setSpinPerson(null)
    setSpinning(false)
    setConfetti(makeConfetti())
    return true
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    if (audio.current) audio.current.muted = next
  }

  return { spinning, spinPerson, confetti, muted, toggleMute, spin, stop }
}

export type DrawSpinner = ReturnType<typeof useDrawSpinner>

const canFullscreen = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled)

/** Chiếu toàn màn hình một khối (không hỗ trợ trên iPhone) */
export function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [isFull, setIsFull] = useState(false)

  useEffect(() => {
    const onChange = () => setIsFull(document.fullscreenElement === ref.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  function toggle() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void ref.current?.requestFullscreen().catch(() => {})
  }

  return { ref, isFull, supported: canFullscreen, toggle }
}

export type Fullscreen = ReturnType<typeof useFullscreen>

