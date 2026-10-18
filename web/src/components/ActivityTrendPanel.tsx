import { useMemo, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, Minus } from 'lucide-react'
import { WeekKmChart } from './WeekKmChart'
import {
  buildActivityTrends,
  type ActivityLike,
  type TrendDirection,
  type TrendPeriod,
} from '../lib/activityTrends'

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

const PERIOD_OPTIONS: [TrendPeriod, string][] = [
  ['week', 'Tuần'],
  ['month', 'Tháng'],
  ['year', 'Năm'],
]

export function ActivityTrendPanel({ activities }: { activities: ActivityLike[] }) {
  const [period, setPeriod] = useState<TrendPeriod>('week')
  const trends = useMemo(() => buildActivityTrends(activities, period), [activities, period])
  const hasAnyKm = trends.buckets.some((b) => b.km > 0)

  return (
    <section className="section panel stats-trend-panel">
      <div className="section-head">
        <h2>Xu hướng</h2>
        <div className="filter-row trend-period-filter" role="group" aria-label="Kỳ thống kê">
          {PERIOD_OPTIONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={period === value ? 'chip active' : 'chip'}
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!hasAnyKm ? (
        <p className="tiny muted">Chưa đủ hoạt động Run / TrailRun / Walk để đánh giá xu hướng.</p>
      ) : (
        <>
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
            <p className="tiny muted week-km-caption">{trends.chartCaption}</p>
            <WeekKmChart
              buckets={trends.buckets}
              recentCount={trends.recentBarCount}
              ariaLabel={trends.chartCaption}
            />
          </div>
        </>
      )}
    </section>
  )
}
