import { useMemo } from 'react'
import { predictRaceTimes, type ActivityLike } from '../lib/racePredict'

export function RacePredictPanel({ activities }: { activities: ActivityLike[] }) {
  const result = useMemo(() => predictRaceTimes(activities), [activities])

  return (
    <section className="section panel race-predict-panel">
      <h2>Dự đoán thành tích</h2>
      {!result ? (
        <p className="tiny muted">
          Chưa đủ dữ liệu để ước tính.
        </p>
      ) : (
        <div className="race-predict-grid">
          {result.predictions.map((p) => (
            <article key={p.id} className="race-predict-card">
              <h3>{p.label}</h3>
              <dl>
                <div>
                  <dt>Thời gian</dt>
                  <dd>{p.timeLabel}</dd>
                </div>
                <div>
                  <dt>Pace TB</dt>
                  <dd>{p.paceLabel}/km</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
