import { ArrowDown, ArrowRight, ArrowUp, Minus } from 'lucide-react'
import { WeekKmChart } from './WeekKmChart'
import type { TrendDirection, TrendSummary } from '../lib/activityTrends'

function TrendIcon({ direction }: { direction: TrendDirection }) {
  if (direction === 'up') return <ArrowUp size={16} aria-hidden />
  if (direction === 'down') return <ArrowDown size={16} aria-hidden />
  if (direction === 'stable') return <ArrowRight size={16} aria-hidden />
  return <Minus size={16} aria-hidden />
}

function TrendRow({
  title,
  direction,
  label,
  detail,
}: {
  title: string
  direction: TrendDirection
  label: string
  detail: string
}) {
  const tone =
    direction === 'up' || direction === 'down' || direction === 'stable' ? direction : 'unknown'

  return (
    <li className={`trend-row tone-${tone}`}>
      <span className="trend-icon">
        <TrendIcon direction={direction} />
      </span>
      <div>
        <strong>
          {title}: {label}
        </strong>
        <p className="tiny muted">{detail}</p>
      </div>
    </li>
  )
}

export function ActivityTrendPanel({ trends }: { trends: TrendSummary }) {
  const hasAnyKm = trends.weeks.some((w) => w.km > 0)
  if (!hasAnyKm) {
    return (
      <section className="section panel">
        <h2>Xu hướng</h2>
        <p className="tiny muted">Chưa đủ hoạt động Run / TrailRun / Walk để đánh giá xu hướng.</p>
      </section>
    )
  }

  return (
    <section className="section panel stats-trend-panel">
      <h2>Xu hướng</h2>
      <p className="tiny muted">
        So 4 tuần gần nhất với 4 tuần trước (km, số buổi, pace). Cột đậm = 4 tuần gần đây.
      </p>
      <ul className="trend-list">
        <TrendRow
          title="Khối lượng"
          direction={trends.volume.direction}
          label={trends.volume.label}
          detail={trends.volume.detail}
        />
        <TrendRow
          title="Tần suất"
          direction={trends.sessions.direction}
          label={trends.sessions.label}
          detail={trends.sessions.detail}
        />
        <TrendRow
          title="Pace"
          direction={trends.pace.direction}
          label={trends.pace.label}
          detail={trends.pace.detail}
        />
      </ul>
      <div className="week-km-chart-wrap">
        <p className="tiny muted week-km-caption">Km / tuần (12 tuần)</p>
        <WeekKmChart weeks={trends.weeks} />
      </div>
    </section>
  )
}
