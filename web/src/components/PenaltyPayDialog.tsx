import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { ref, set } from 'firebase/database'
import { Check, Copy, Download, Wallet, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import { BANK_PATH, parseBank, penaltyCode, vietQrPayload, type BankInfo } from '../lib/payment'
import { formatVnd } from '../lib/rewardPenalty'
import { useSharedValue } from '../lib/sharedValue'
import type { Challenge } from '../types'

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <button
      type="button"
      className="btn ghost compact pay-copy"
      aria-label={`Sao chép ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true))
      }}
    >
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {copied ? 'Đã chép' : 'Sao chép'}
    </button>
  )
}

function BankEditor({ bank }: { bank: BankInfo }) {
  const [form, setForm] = useState(bank)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  function field(key: keyof BankInfo, label: string, placeholder = '') {
    return (
      <label className="search-field">
        {label}
        <input
          value={form[key]}
          placeholder={placeholder}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        />
      </label>
    )
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const next = {
      bin: form.bin.trim(),
      bankName: form.bankName.trim(),
      accountNo: form.accountNo.replace(/\s+/g, ''),
      accountName: form.accountName.trim().toUpperCase(),
      momoUrl: form.momoUrl.trim(),
    }
    if (!/^\d{6}$/.test(next.bin)) return setMessage('Mã BIN ngân hàng gồm 6 chữ số.')
    if (!/^[A-Za-z0-9]{1,19}$/.test(next.accountNo)) {
      return setMessage('Số tài khoản chỉ gồm chữ và số, tối đa 19 ký tự.')
    }
    if (next.momoUrl && !/^https:\/\//.test(next.momoUrl)) {
      return setMessage('Link Quỹ MoMo phải bắt đầu bằng https://')
    }
    setBusy(true)
    setMessage('')
    try {
      await set(ref(db, BANK_PATH), next)
      setMessage('Đã lưu.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Không lưu được')
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="pay-admin">
      <summary>Sửa tài khoản nhận tiền phạt</summary>
      <form onSubmit={save}>
        {field('bankName', 'Tên ngân hàng')}
        {field('bin', 'Mã BIN ngân hàng (6 số)')}
        {field('accountNo', 'Số tài khoản')}
        {field('accountName', 'Chủ tài khoản', 'Để trống nếu không hiển thị')}
        {field('momoUrl', 'Link Quỹ MoMo')}
        <button type="submit" className="btn primary compact" disabled={busy}>
          {busy ? 'Đang lưu…' : 'Lưu'}
        </button>
        {message && <p className="tiny muted">{message}</p>}
      </form>
    </details>
  )
}

/** Mã VietQR nộp phạt: điền sẵn tài khoản quỹ, số tiền và mã nộp phạt để thủ quỹ đối chiếu */
export function PenaltyPayDialog({
  challenge,
  uid,
  name,
  amount,
  onClose,
}: {
  challenge: Challenge
  uid: string
  name: string
  amount: number
  onClose: () => void
}) {
  const { profile } = useAuth()
  const isAdmin = Boolean(profile?.admin)
  const bankRaw = useSharedValue<unknown>(BANK_PATH)
  const bank = parseBank(bankRaw)
  const code = penaltyCode(challenge, uid)
  const payload = vietQrPayload({ bin: bank.bin, accountNo: bank.accountNo, amount, memo: code })
  const [qr, setQr] = useState<{ payload: string; url: string } | null>(null)
  const qrUrl = qr?.payload === payload ? qr.url : ''

  useEffect(() => {
    let cancelled = false
    void import('qrcode')
      .then((QR) => QR.toDataURL(payload, { width: 560, margin: 2, errorCorrectionLevel: 'M' }))
      .then((url) => {
        if (!cancelled) setQr({ payload, url })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [payload])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div
      className="pay-overlay"
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <div
        className="pay-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pay-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pay-head">
          <h3 id="pay-title">Nộp phạt {formatVnd(amount)}</h3>
          <button type="button" className="btn ghost compact" aria-label="Đóng" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <p className="tiny muted">
          {challenge.name || 'Thử thách'} · {name}
        </p>

        <div className="pay-qr">
          {qrUrl ? <img src={qrUrl} alt={`Mã VietQR nộp phạt ${code}`} /> : <span>Đang tạo mã…</span>}
        </div>
        <p className="tiny muted pay-hint">
          Mở app ngân hàng hoặc MoMo, chọn Quét mã QR. Số tiền và nội dung đã được điền sẵn, vui
          lòng giữ nguyên nội dung.
        </p>

        <dl className="pay-info">
          <dt>Số tiền</dt>
          <dd>
            <strong>{formatVnd(amount)}</strong>
          </dd>
          <dt>Nội dung</dt>
          <dd>
            <code>{code}</code>
            <CopyButton value={code} label="nội dung chuyển khoản" />
          </dd>
          <dt>Ngân hàng</dt>
          <dd>{bank.bankName}</dd>
          <dt>Số tài khoản</dt>
          <dd>
            <code>{bank.accountNo}</code>
            <CopyButton value={bank.accountNo} label="số tài khoản" />
          </dd>
          {bank.accountName && (
            <>
              <dt>Chủ tài khoản</dt>
              <dd>{bank.accountName}</dd>
            </>
          )}
        </dl>

        <div className="pay-actions">
          {qrUrl && (
            <a
              className="btn ghost compact"
              href={qrUrl}
              download={`nop-phat-${code.replace(/^QTR /, '').replace(/\s+/g, '-')}.png`}
            >
              <Download size={14} aria-hidden /> Lưu ảnh QR
            </a>
          )}
          {bank.momoUrl && (
            <a className="btn ghost compact" href={bank.momoUrl} target="_blank" rel="noreferrer">
              <Wallet size={14} aria-hidden /> Nộp qua Quỹ MoMo
            </a>
          )}
        </div>
        <p className="tiny muted">
          Nộp qua link Quỹ MoMo thì nhập đúng số tiền và dán nội dung <strong>{code}</strong>. Thủ
          quỹ sẽ xác nhận sau khi đối chiếu.
        </p>

        {isAdmin && <BankEditor key={JSON.stringify(bank)} bank={bank} />}
      </div>
    </div>,
    document.body,
  )
}
