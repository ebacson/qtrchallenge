import type { WeekBucket } from '../lib/activityTrends'

/** Biểu đồ cột SVG nhẹ — km theo tuần */
export function WeekKmChart({ weeks }: { weeks: WeekBucket[] }) {
  if (!weeks.length) return null
  const maxKm = Math.max(...weeks.map((w) => w.km), 1)
  const w = 320
  const h = 120
  const padL = 4
  const padR = 4
  const padT = 12
  const padB = 22
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const gap = 3
  const barW = (innerW - gap * (weeks.length - 1)) / weeks.length

  return (
    <svg
      className="week-km-chart"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="Biểu đồ km theo tuần"
    >
      {weeks.map((week, i) => {
        const bh = (week.km / maxKm) * innerH
        const x = padL + i * (barW + gap)
        const y = padT + innerH - bh
        const recent = i >= weeks.length - 4
        return (
          <g key={week.weekStartMs}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(bh, week.km > 0 ? 2 : 0)}
              rx={2}
              className={recent ? 'week-bar recent' : 'week-bar'}
            />
            {(i === 0 || i === weeks.length - 1 || i % 2 === 0) && (
              <text x={x + barW / 2} y={h - 6} textAnchor="middle" className="week-bar-label">
                {week.label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
