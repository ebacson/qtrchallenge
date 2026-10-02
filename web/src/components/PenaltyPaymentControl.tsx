import { useState } from 'react'
import { ref, set } from 'firebase/database'
import { useAuth } from '../context/AuthContext'
import { STATUS_FINISHED } from '../lib/challengeRules'
import { db } from '../lib/firebase'
import { formatVnd } from '../lib/rewardPenalty'
import type { Challenge } from '../types'

/** Trạng thái nộp phạt của một thành viên trong một thử thách; admin xác nhận / hủy xác nhận. */
export function PenaltyPaymentControl({
  challenge,
  uid,
  name,
  amount,
}: {
  challenge: Challenge
  uid: string
  name: string
  amount: number
}) {
  const { user, profile } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const payment = challenge.penaltyPayments?.[uid]
  const isAdmin = Boolean(profile?.admin)
  const finished = challenge.status === STATUS_FINISHED
  const path = `challenges/${challenge.id}/penaltyPayments/${uid}`

  if (!(amount > 0) && !payment) return null

  async function write(value: object | null) {
    setBusy(true)
    setError('')
    try {
      await set(ref(db, path), value)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được')
    } finally {
      setBusy(false)
    }
  }

  function confirmPaid() {
    if (!user) return
    const label = challenge.name || 'thử thách'
    if (!window.confirm(`Xác nhận ${name} đã nộp ${formatVnd(amount)} phạt "${label}"?`)) return
    void write({ amount, confirmedAt: Date.now(), confirmedBy: user.uid })
  }

  function undoPaid() {
    if (!window.confirm(`Hủy xác nhận đã nộp của ${name}?`)) return
    void write(null)
  }

  return (
    <span className="penalty-pay">
      {payment ? (
        <>
          <span className="penalty-pay-badge paid">
            ✓ Đã nộp{payment.amount && payment.amount !== amount ? ` ${formatVnd(payment.amount)}` : ''}
          </span>
          {isAdmin && (
            <button
              type="button"
              className="btn ghost compact"
              disabled={busy}
              onClick={undoPaid}
            >
              Hủy
            </button>
          )}
        </>
      ) : isAdmin && finished ? (
        <button
          type="button"
          className="btn primary compact"
          disabled={busy}
          onClick={confirmPaid}
        >
          {busy ? 'Đang lưu…' : 'Xác nhận đã nộp'}
        </button>
      ) : finished ? (
        <span className="penalty-pay-badge">Chưa nộp</span>
      ) : null}
      {error && <span className="tiny form-error">{error}</span>}
    </span>
  )
}
