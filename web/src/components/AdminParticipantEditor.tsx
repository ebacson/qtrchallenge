import { useState } from 'react'
import { ref, remove, update } from 'firebase/database'
import {
  challengeGoals,
  parseDayQuotaLabel,
  STATUS_UPCOMING,
  userDayQuotaProgress,
} from '../lib/challengeRules'
import {
  dayQuotaJoinFields,
  recomputeUserChallenge,
  refreshUserLevel,
} from '../lib/challengeProgress'
import { db } from '../lib/firebase'
import type { Challenge } from '../types'

/** Admin đổi mục tiêu đăng ký hoặc xóa một thành viên khỏi thử thách. */
export function AdminParticipantEditor({
  challenge,
  uid,
  name,
  row,
  onClose,
  onDone,
}: {
  challenge: Challenge
  uid: string
  name: string
  row: Record<string, unknown>
  onClose: () => void
  onDone: (message: string) => void
}) {
  const isDayQuota =
    challenge.challengeMode === 'day_quota' && Boolean(challenge.dayQuotaOptions?.length)
  const goals = challengeGoals(challenge)
  const initialIndexes = isDayQuota
    ? userDayQuotaProgress(challenge.dayQuotaOptions, challenge.targetDistances, row)
        .map((q) => q.optionIndex)
        .filter((i) => i >= 0)
    : []
  const initialTarget = String(row.userTarget ?? '')
  const [target, setTarget] = useState(
    challenge.targetDistances.includes(initialTarget)
      ? initialTarget
      : (challenge.targetDistances[0] ?? ''),
  )
  const [indexes, setIndexes] = useState<number[]>(initialIndexes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const started = challenge.status !== STATUS_UPCOMING
  const path = `challenges/${challenge.id}/user_challenges/${uid}`
  const changed = isDayQuota
    ? indexes.join(',') !== initialIndexes.join(',')
    : target !== initialTarget

  function toggle(index: number) {
    setIndexes((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index].sort((a, b) => a - b),
    )
  }

  async function save() {
    if (isDayQuota ? !indexes.length : !target) {
      setError(isDayQuota ? 'Chọn ít nhất một tùy chọn.' : 'Chọn mục tiêu.')
      return
    }
    if (
      started &&
      !window.confirm(
        `Thử thách ${challenge.status.toLowerCase()}. Đổi mục tiêu của "${name}" sẽ tính lại tiến độ theo mục tiêu mới, tiếp tục?`,
      )
    ) {
      return
    }
    setBusy(true)
    setError('')
    try {
      let fields: Record<string, unknown>
      if (isDayQuota) {
        fields = dayQuotaJoinFields(challenge, indexes)
      } else {
        const quota =
          challenge.challengeMode === 'day_quota' ? parseDayQuotaLabel(target) : null
        fields = quota
          ? {
              userTarget: target,
              daysRequired: quota.daysRequired,
              kmPerDay: quota.kmPerDay,
              progress: `0/${quota.daysRequired} ngày`,
            }
          : { userTarget: target }
      }
      await update(ref(db, path), fields)
      await recomputeUserChallenge(challenge.id, uid)
      onDone(`Đã đổi mục tiêu của ${name} thành ${String(fields.userTarget)}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được')
    } finally {
      setBusy(false)
    }
  }

  async function removeParticipant() {
    const warning = started
      ? `\n\nThử thách ${challenge.status.toLowerCase()}: tiến độ của người này trong thử thách sẽ mất và không khôi phục được.`
      : ''
    if (!window.confirm(`Xóa "${name}" khỏi thử thách "${challenge.name}"?${warning}`)) return
    setBusy(true)
    setError('')
    try {
      await remove(ref(db, path))
      await refreshUserLevel(uid)
      onDone(`Đã xóa ${name} khỏi thử thách.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xóa được')
      setBusy(false)
    }
  }

  return (
    <div className="participant-admin-editor">
      <p className="tiny muted">
        Admin: đổi mục tiêu hoặc xóa <strong>{name}</strong> khỏi thử thách
      </p>
      {isDayQuota ? (
        <div className="option-pick-list">
          {challenge.targetDistances.map((label, i) => {
            if (!challenge.dayQuotaOptions?.[i]) return null
            const goal = goals.find((g) => g.index === i)
            const checked = indexes.includes(i)
            return (
              <label key={label} className={checked ? 'option-pick checked' : 'option-pick'}>
                <span className="custom-distance-row">
                  <input type="checkbox" checked={checked} onChange={() => toggle(i)} />
                  <span>
                    <strong>Tùy chọn {i + 1}:</strong> {goal?.summary ?? label}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      ) : (
        <label className="participant-admin-target">
          Mục tiêu
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {challenge.targetDistances.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="btn-row">
        <button
          type="button"
          className="btn primary compact"
          disabled={busy || !changed}
          onClick={() => void save()}
        >
          {busy ? 'Đang xử lý…' : 'Lưu mục tiêu'}
        </button>
        <button
          type="button"
          className="btn danger compact"
          disabled={busy}
          onClick={() => void removeParticipant()}
        >
          Xóa khỏi thử thách
        </button>
        <button type="button" className="btn ghost compact" disabled={busy} onClick={onClose}>
          Đóng
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}
