import type { ReactNode } from 'react'
import { Gift, Maximize2, Minimize2, Volume2, VolumeX } from 'lucide-react'
import type {
  DrawPhase,
  DrawSpinner,
  Fullscreen,
  StagePerson,
  StageWinner,
} from '../lib/drawSpinner'

export function FullscreenButton({ isFull, supported, toggle }: Omit<Fullscreen, 'ref'>) {
  if (!supported) return null
  const label = isFull ? 'Thoát toàn màn hình' : 'Toàn màn hình'
  return (
    <button type="button" className="draw-mute" onClick={toggle} aria-label={label} title={label}>
      {isFull ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
    </button>
  )
}

export function StageAvatar({ person }: { person: StagePerson }) {
  return (
    <span className="draw-slot-avatar">
      {person.avatar ? (
        <img src={person.avatar} alt="" />
      ) : (
        (person.name.split(' ').pop()?.charAt(0).toUpperCase() ?? '?')
      )}
    </span>
  )
}

/** Sân khấu quay số: đèn, khung tên, nút hành động và danh sách người trúng */
export function DrawStage({
  spinner,
  phase,
  target,
  itemsSummary,
  roundText,
  idleText,
  lastWin,
  winners,
  actions,
  tools,
}: {
  spinner: DrawSpinner
  phase: DrawPhase
  target: string
  itemsSummary: string
  roundText: string
  idleText: string
  lastWin?: StageWinner
  winners: StageWinner[]
  actions: ReactNode
  /** Nút thêm cạnh nút tắt nhạc (VD toàn màn hình) */
  tools?: ReactNode
}) {
  const { spinPerson, confetti, muted, toggleMute } = spinner
  return (
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
      <div className="draw-tools">
        {tools}
        <button
          type="button"
          className="draw-mute"
          onClick={toggleMute}
          aria-label={muted ? 'Bật nhạc' : 'Tắt nhạc'}
          title={muted ? 'Bật nhạc' : 'Tắt nhạc'}
        >
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
      </div>

      <p className="draw-kicker">QTR Challenge</p>
      <h2 className="draw-title">Quay số trúng thưởng</h2>
      <p className="draw-target">
        Mục tiêu <strong>{target}</strong> · {itemsSummary}
      </p>
      <p className="draw-round">{roundText}</p>

      <div className="draw-slot" aria-live="polite">
        {phase === 'spinning' && spinPerson ? (
          <span key={spinPerson.id} className="draw-slot-name">
            <StageAvatar person={spinPerson} />
            {spinPerson.name}
          </span>
        ) : (phase === 'won' || phase === 'done') && lastWin ? (
          <span key={lastWin.person.id} className="draw-slot-name draw-slot-win">
            <StageAvatar person={lastWin.person} />
            {lastWin.person.name}
            <span className="draw-winner-prize">
              <Gift size={14} aria-hidden /> {lastWin.prize}
            </span>
          </span>
        ) : (
          <span className="draw-slot-idle">{idleText}</span>
        )}
      </div>

      <div className="draw-actions">{actions}</div>

      {winners.length > 0 && (
        <ol className="draw-winners">
          {winners.map((w, i) => (
            <li key={w.person.id}>
              <span className="draw-winner-rank">{i + 1}</span>
              <StageAvatar person={w.person} />
              <strong>{w.person.name}</strong>
              {w.prize && (
                <span className="draw-winner-prize">
                  <Gift size={14} aria-hidden /> {w.prize}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
