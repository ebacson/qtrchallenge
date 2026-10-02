import { useState } from 'react'
import { ref, set } from 'firebase/database'
import { useAuth } from '../context/AuthContext'
import { STATUS_FINISHED } from '../lib/challengeRules'
import { db } from '../lib/firebase'
import { formatVnd } from '../lib/rewardPenalty'
import type { Challenge } from '../types'

const REASON_MAX = 120

/**
 * Trạng thái nộp phạt của một thành viên trong một thử thách; admin xác nhận đã nộp,
 * miễn phạt (kèm lý do) hoặc hủy. `amount` là mức phạt gốc (trước khi miễn).
 */
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
  const label = challenge.name || 'thử thách'

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
    if (!window.confirm(`Xác nhận ${name} đã nộp ${formatVnd(amount)} phạt "${label}"?`)) return
    void write({ amount, confirmedAt: Date.now(), confirmedBy: user.uid })
  }

  function waive() {
    if (!user) return
    const input = window.prompt(
      `Miễn phạt ${formatVnd(amount)} cho ${name} ("${label}").\nNhập lý do ngắn gọn:`,
    )
    if (input == null) return
    const reason = input.trim().slice(0, REASON_MAX)
    if (!reason) {
      setError('Cần nhập lý do miễn phạt.')
      return
    }
    void write({ amount, waived: true, reason, confirmedAt: Date.now(), confirmedBy: user.uid })
  }

  function undo() {
    const question = payment?.waived
      ? `Hủy miễn phạt của ${name}? Mức phạt ${formatVnd(amount)} sẽ được tính lại.`
      : `Hủy xác nhận đã nộp của ${name}?`
    if (!window.confirm(question)) return
    void write(null)
  }

  return (
    <span className="penalty-pay">
      {payment?.waived ? (
        <span className="penalty-pay-badge waived" title={payment.reason}>
          Miễn phạt{payment.reason ? `: ${payment.reason}` : ''}
        </span>
      ) : payment ? (
        <span className="penalty-pay-badge paid">
          ✓ Đã nộp{payment.amount && payment.amount !== amount ? ` ${formatVnd(payment.amount)}` : ''}
        </span>
      ) : isAdmin && finished ? (
        <>
          <button
            type="button"
            className="btn primary compact"
            disabled={busy}
            onClick={confirmPaid}
          >
            {busy ? 'Đang lưu…' : 'Xác nhận đã nộp'}
          </button>
          <button type="button" className="btn ghost compact" disabled={busy} onClick={waive}>
            Miễn phạt
          </button>
        </>
      ) : finished ? (
        <span className="penalty-pay-badge">Chưa nộp</span>
      ) : null}
      {payment && isAdmin && (
        <button type="button" className="btn ghost compact" disabled={busy} onClick={undo}>
          Hủy
        </button>
      )}
      {error && <span className="tiny form-error">{error}</span>}
    </span>
  )
}
