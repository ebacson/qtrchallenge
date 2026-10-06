import { useState, type FormEvent } from 'react'
import { ref, set, update } from 'firebase/database'
import { Search, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import { duesPaymentFields, FINANCE_PATH, msToDay, type DuesYear } from '../lib/finance'
import { formatVnd } from '../lib/rewardPenalty'

type Member = { uid: string; name: string; avatar: string; member: boolean }
type DuesFilter = 'all' | 'unpaid' | 'paid'

function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
}

/** Hội phí năm: admin đặt mức, xác nhận từng thành viên chính thức đã đóng. */
export function FinanceDues({
  year,
  dues,
  members,
  nameOf,
}: {
  year: number
  dues: DuesYear | undefined
  members: Member[]
  nameOf: (uid: string) => string
}) {
  const { user } = useAuth()
  const amount = dues?.amount ?? 0
  const paidMap = dues?.members ?? {}
  const [amountDraft, setAmountDraft] = useState('')
  const [editingAmount, setEditingAmount] = useState(false)
  const [filter, setFilter] = useState<DuesFilter>('all')
  const [search, setSearch] = useState('')
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const [error, setError] = useState('')
  const base = `${FINANCE_PATH}/dues/${year}`

  // Thành viên chính thức + người đã đóng nhưng nay không còn chính thức
  const rows = [
    ...members.filter((m) => m.member),
    ...Object.keys(paidMap)
      .filter((uid) => !members.some((m) => m.uid === uid && m.member))
      .map((uid) => members.find((m) => m.uid === uid) ?? { uid, name: nameOf(uid), avatar: '', member: false }),
  ]
  const paidCount = rows.filter((m) => paidMap[m.uid]).length
  const paidTotal = Object.values(paidMap).reduce((s, p) => s + p.amount, 0)
  const unpaidCount = rows.filter((m) => m.member && !paidMap[m.uid]).length
  const query = foldText(search)
  const visible = rows.filter((m) => {
    const paid = Boolean(paidMap[m.uid])
    if (filter === 'paid' && !paid) return false
    if (filter === 'unpaid' && (paid || !m.member)) return false
    return !query || foldText(m.name).includes(query)
  })

  async function saveAmount(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    const value = Math.round(Number(amountDraft.replace(/[.,\s]/g, '')))
    if (!(value > 0)) {
      setError('Nhập mức hội phí lớn hơn 0.')
      return
    }
    setError('')
    try {
      await update(ref(db, `${base}/settings`), {
        amount: value,
        updatedAt: Date.now(),
        updatedBy: user.uid,
      })
      setEditingAmount(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được')
    }
  }

  async function markPaid(m: Member) {
    if (!user || !(amount > 0)) return
    if (!window.confirm(`Xác nhận ${m.name} đã đóng hội phí ${year}: ${formatVnd(amount)}?`)) return
    setBusyUid(m.uid)
    setError('')
    try {
      await set(ref(db, `${base}/members/${m.uid}`), duesPaymentFields(amount, user.uid))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được')
    } finally {
      setBusyUid(null)
    }
  }

  async function undo(m: Member) {
    if (!window.confirm(`Hủy xác nhận hội phí ${year} của ${m.name}?`)) return
    setBusyUid(m.uid)
    setError('')
    try {
      await set(ref(db, `${base}/members/${m.uid}`), null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được')
    } finally {
      setBusyUid(null)
    }
  }

  return (
    <section className="section panel">
      <h2>Hội phí {year}</h2>
      {editingAmount || !(amount > 0) ? (
        <form className="auth-form finance-dues-amount" onSubmit={(e) => void saveAmount(e)}>
          <label>
            Mức hội phí năm {year} (đ / người)
            <input
              inputMode="numeric"
              value={amountDraft}
              onChange={(e) => setAmountDraft(e.target.value)}
              placeholder="VD: 200000"
            />
          </label>
          <div className="btn-row">
            <button type="submit" className="btn primary compact">
              Lưu mức hội phí
            </button>
            {amount > 0 && (
              <button
                type="button"
                className="btn ghost compact"
                onClick={() => setEditingAmount(false)}
              >
                Hủy
              </button>
            )}
          </div>
        </form>
      ) : (
        <p className="tiny muted">
          Mức hội phí: <strong>{formatVnd(amount)}</strong> / người{' '}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setAmountDraft(String(amount))
              setEditingAmount(true)
            }}
          >
            Sửa
          </button>
          <br />
          Đổi mức chỉ áp dụng cho lần xác nhận sau; khoản đã xác nhận giữ nguyên số tiền.
        </p>
      )}

      <div className="stat-row">
        <div className="stat">
          <strong>{paidCount}</strong>
          <span>Đã đóng</span>
        </div>
        <div className="stat">
          <strong>{unpaidCount}</strong>
          <span>Chưa đóng</span>
        </div>
        <div className="stat">
          <strong className="stat-money stat-paid">{formatVnd(paidTotal)}</strong>
          <span>Đã thu</span>
        </div>
      </div>

      <div className="filter-row">
        {(
          [
            ['all', `Tất cả (${rows.length})`],
            ['unpaid', `Chưa đóng (${unpaidCount})`],
            ['paid', `Đã đóng (${paidCount})`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={filter === value ? 'chip active' : 'chip'}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="reward-search finance-dues-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm thành viên"
          aria-label="Tìm thành viên"
        />
        {search && (
          <button type="button" aria-label="Xóa tìm kiếm" onClick={() => setSearch('')}>
            <X size={16} />
          </button>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}

      {visible.length === 0 ? (
        <p className="empty">Không có thành viên phù hợp.</p>
      ) : (
        <ul className="participant-list">
          {visible.map((m) => {
            const paid = paidMap[m.uid]
            return (
              <li key={m.uid} className="participant-row">
                <div className="hof-avatar">
                  {m.avatar ? (
                    <img src={m.avatar} alt="" />
                  ) : (
                    <span>{(m.name || '?').charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="participant-meta">
                  <strong>{m.name}</strong>
                  {paid ? (
                    <span className="tiny muted">
                      Đóng {formatVnd(paid.amount)} ngày {msToDay(paid.paidAt)} · xác nhận bởi{' '}
                      {nameOf(paid.confirmedBy)}
                      {!m.member && ' · không còn là thành viên chính thức'}
                    </span>
                  ) : null}
                  <span className="penalty-pay">
                    {paid ? (
                      <>
                        <span className="penalty-pay-badge paid">✓ Đã đóng</span>
                        <button
                          type="button"
                          className="btn ghost compact"
                          disabled={busyUid === m.uid}
                          onClick={() => void undo(m)}
                        >
                          Hủy
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="penalty-pay-badge unpaid">Chưa đóng</span>
                        <button
                          type="button"
                          className="btn primary compact"
                          disabled={busyUid === m.uid || !(amount > 0)}
                          onClick={() => void markPaid(m)}
                        >
                          {busyUid === m.uid ? 'Đang lưu…' : 'Xác nhận đã đóng'}
                        </button>
                      </>
                    )}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
