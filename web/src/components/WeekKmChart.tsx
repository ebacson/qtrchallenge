import type { PeriodBucket } from '../lib/activityTrends'

/** Biểu đồ cột SVG nhẹ — km theo kỳ */
export function WeekKmChart({
  buckets,
  recentCount,
  ariaLabel = 'Biểu đồ km theo kỳ',
}: {
  buckets: PeriodBucket[]
  recentCount: number
  ariaLabel?: string
}) {
  if (!buckets.length) return null
  const maxKm = Math.max(...buckets.map((b) => b.km), 1)
  const w = 320
  const h = 120
  const padL = 4
  const padR = 4
  const padT = 12
  const padB = 22
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const gap = buckets.length > 8 ? 2 : 3
  const barW = (innerW - gap * (buckets.length - 1)) / buckets.length
  const labelEvery = buckets.length > 8 ? 2 : 1

  return (
    <svg className="week-km-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={ariaLabel}>
      {buckets.map((bucket, i) => {
        const bh = (bucket.km / maxKm) * innerH
        const x = padL + i * (barW + gap)
        const y = padT + innerH - bh
        const recent = i >= buckets.length - recentCount
        const showLabel =
          i === 0 || i === buckets.length - 1 || i % labelEvery === 0
        return (
          <g key={bucket.startMs}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(bh, bucket.km > 0 ? 2 : 0)}
              rx={2}
              className={recent ? 'week-bar recent' : 'week-bar'}
            />
            {showLabel && (
              <text x={x + barW / 2} y={h - 6} textAnchor="middle" className="week-bar-label">
                {bucket.label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
