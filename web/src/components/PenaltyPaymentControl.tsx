import { useCallback, useState } from 'react'
import { ref, set } from 'firebase/database'
import { QrCode } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { STATUS_FINISHED } from '../lib/challengeRules'
import { db } from '../lib/firebase'
import { penaltyCode } from '../lib/payment'
import { formatVnd } from '../lib/rewardPenalty'
import type { Challenge } from '../types'
import { PenaltyPayDialog } from './PenaltyPayDialog'

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
  const [paying, setPaying] = useState(false)
  const closePay = useCallback(() => setPaying(false), [])
  const payment = challenge.penaltyPayments?.[uid]
  const isAdmin = Boolean(profile?.admin)
  const finished = challenge.status === STATUS_FINISHED
  const path = `challenges/${challenge.id}/penaltyPayments/${uid}`
  const label = challenge.name || 'thử thách'
  const code = penaltyCode(challenge, uid)
  const unpaid = finished && amount > 0 && !payment
  const canPay = unpaid && (isAdmin || user?.uid === uid)

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
    void write({ amount, code, confirmedAt: Date.now(), confirmedBy: user.uid, memberName: name })
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
    void write({
      amount,
      waived: true,
      reason,
      confirmedAt: Date.now(),
      confirmedBy: user.uid,
      memberName: name,
    })
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
        <span className="penalty-pay-badge unpaid">Chưa nộp</span>
      ) : null}
      {canPay && (
        <button
          type="button"
          className={`btn compact ${isAdmin ? 'ghost' : 'primary'}`}
          onClick={() => setPaying(true)}
        >
          <QrCode size={14} aria-hidden /> {isAdmin ? 'Mã QR' : 'Nộp phạt'}
        </button>
      )}
      {payment && isAdmin && (
        <button type="button" className="btn ghost compact" disabled={busy} onClick={undo}>
          Hủy
        </button>
      )}
      {isAdmin && finished && !payment?.waived && (
        <code className="penalty-code" title="Mã nộp phạt (nội dung chuyển khoản)">
          {payment?.code || code}
        </code>
      )}
      {error && <span className="tiny form-error">{error}</span>}
      {paying && (
        <PenaltyPayDialog
          challenge={challenge}
          uid={uid}
          name={name}
          amount={amount}
          onClose={closePay}
        />
      )}
    </span>
  )
}
