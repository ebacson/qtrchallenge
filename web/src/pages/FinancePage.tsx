import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { push, ref, update } from 'firebase/database'
import { Download, Plus, Search, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import { useSharedValue } from '../lib/sharedValue'
import { useUserProfiles } from '../lib/userWrites'
import { formatVnd } from '../lib/rewardPenalty'
import { parseChallengeDayStartMs } from '../lib/challengeRules'
import {
  categoryLabel,
  compareEntriesDesc,
  dayMonth,
  dayToInputDate,
  dayYear,
  downloadFinanceCsv,
  duesIncomeEntries,
  FINANCE_CATEGORIES,
  FINANCE_PATH,
  inputDateToDay,
  msToDay,
  parseDues,
  parseFinanceSettings,
  parseTransactions,
  penaltyIncomeEntries,
  signedAmount,
  softDeleteFields,
  type FinanceEntry,
  type FinanceType,
} from '../lib/finance'
import { FinanceDues } from '../components/FinanceDues'

type Tab = 'overview' | 'ledger' | 'dues'
type TypeFilter = 'all' | FinanceType

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
}

function signedVnd(amount: number): string {
  return amount > 0 ? `+${formatVnd(amount)}` : amount < 0 ? `−${formatVnd(-amount)}` : formatVnd(0)
}

function FinanceForm({
  entry,
  members,
  challenges,
  onClose,
  onSaved,
}: {
  entry: FinanceEntry | null
  members: { uid: string; name: string }[]
  challenges: { id: string; name: string }[]
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { user } = useAuth()
  const [type, setType] = useState<FinanceType>(entry?.type ?? 'expense')
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '')
  const [category, setCategory] = useState(entry?.category ?? FINANCE_CATEGORIES.expense[0].value)
  const [date, setDate] = useState(() => dayToInputDate(entry?.date ?? msToDay(Date.now())))
  const [note, setNote] = useState(entry?.note ?? '')
  const [memberUid, setMemberUid] = useState(entry?.memberUid ?? '')
  const [challengeId, setChallengeId] = useState(entry?.challengeId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function changeType(next: FinanceType) {
    setType(next)
    if (!FINANCE_CATEGORIES[next].some((c) => c.value === category)) {
      setCategory(FINANCE_CATEGORIES[next][0].value)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    const value = Math.round(Number(amount.replace(/[.,\s]/g, '')))
    const day = inputDateToDay(date)
    if (!(value > 0)) {
      setError('Nhập số tiền lớn hơn 0.')
      return
    }
    if (!day) {
      setError('Chọn ngày.')
      return
    }
    if (!note.trim()) {
      setError('Nhập nội dung.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const year = dayYear(day)
      const now = Date.now()
      const fields = {
        type,
        amount: value,
        category,
        date: day,
        note: note.trim(),
        memberUid: memberUid || null,
        challengeId: challengeId || null,
      }
      if (entry) {
        const updates: Record<string, unknown> = {}
        const base = `${FINANCE_PATH}/transactions/${year}/${entry.id}`
        if (entry.storedYear !== year) {
          // Đổi sang năm khác: chuyển bản ghi sang nhánh năm mới
          updates[`${FINANCE_PATH}/transactions/${entry.storedYear}/${entry.id}`] = null
          updates[base] = {
            ...fields,
            createdAt: entry.createdAt,
            createdBy: entry.createdBy,
            updatedAt: now,
            updatedBy: user.uid,
          }
        } else {
          for (const [k, v] of Object.entries(fields)) updates[`${base}/${k}`] = v
          updates[`${base}/updatedAt`] = now
          updates[`${base}/updatedBy`] = user.uid
        }
        await update(ref(db), updates)
        onSaved('Đã cập nhật khoản thu chi.')
      } else {
        await push(ref(db, `${FINANCE_PATH}/transactions/${year}`), {
          ...fields,
          createdAt: now,
          createdBy: user.uid,
        })
        onSaved(`Đã thêm khoản ${type === 'income' ? 'thu' : 'chi'} ${formatVnd(value)}.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được')
      setBusy(false)
    }
  }

  return (
    <form className="auth-form panel finance-form" onSubmit={(e) => void onSubmit(e)}>
      <h2>{entry ? 'Sửa khoản thu chi' : 'Thêm khoản thu chi'}</h2>
      <div className="filter-row">
        <button
          type="button"
          className={type === 'income' ? 'chip active' : 'chip'}
          onClick={() => changeType('income')}
        >
          Thu
        </button>
        <button
          type="button"
          className={type === 'expense' ? 'chip active' : 'chip'}
          onClick={() => changeType('expense')}
        >
          Chi
        </button>
      </div>
      <div className="finance-form-grid">
        <label>
          Số tiền (đ)
          <input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="VD: 500000"
            required
          />
        </label>
        <label>
          Ngày
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          Danh mục
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {FINANCE_CATEGORIES[type].map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Thành viên (tùy chọn)
          <select value={memberUid} onChange={(e) => setMemberUid(e.target.value)}>
            <option value="">—</option>
            {members.map((m) => (
              <option key={m.uid} value={m.uid}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Thử thách (tùy chọn)
          <select value={challengeId} onChange={(e) => setChallengeId(e.target.value)}>
            <option value="">—</option>
            {challenges.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Nội dung
        <textarea
          rows={2}
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="VD: Mua 20 huy chương thử thách tháng 10"
          required
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="btn-row">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Đang lưu…' : entry ? 'Lưu thay đổi' : 'Thêm'}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>
          Hủy
        </button>
      </div>
    </form>
  )
}

function OpeningBalanceEditor({
  openingBalance,
  openingDate,
  onDone,
}: {
  openingBalance: number
  openingDate: string
  onDone: (message: string) => void
}) {
  const { user } = useAuth()
  const [amount, setAmount] = useState(String(openingBalance || ''))
  const [date, setDate] = useState(dayToInputDate(openingDate))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    const value = Math.round(Number(amount.replace(/[.,\s]/g, '') || '0'))
    if (!Number.isFinite(value)) {
      setError('Số tiền không hợp lệ.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await update(ref(db, `${FINANCE_PATH}/settings`), {
        openingBalance: value,
        openingDate: inputDateToDay(date) || null,
        updatedAt: Date.now(),
        updatedBy: user.uid,
      })
      onDone(`Đã đặt số dư đầu kỳ ${formatVnd(value)}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được')
      setBusy(false)
    }
  }

  return (
    <form className="auth-form panel finance-form" onSubmit={(e) => void onSubmit(e)}>
      <h2>Số dư đầu kỳ</h2>
      <p className="tiny muted">Tiền quỹ đang có trước khi bắt đầu ghi sổ trên app.</p>
      <div className="finance-form-grid">
        <label>
          Số tiền (đ)
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          Tính từ ngày
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="btn-row">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Đang lưu…' : 'Lưu'}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => onDone('')}>
          Hủy
        </button>
      </div>
    </form>
  )
}

export function FinancePage() {
  const { user, profile } = useAuth()
  const canEdit = profile?.admin === true
  const financeValue = useSharedValue<Record<string, unknown>>(FINANCE_PATH)
  const challengesValue = useSharedValue<Record<string, Record<string, unknown>>>('challenges')
  const profiles = useUserProfiles()
  const loading = financeValue === undefined || challengesValue === undefined

  const [tab, setTab] = useState<Tab>('overview')
  const [thisYear] = useState(() => dayYear(msToDay(Date.now())))
  const [year, setYear] = useState(thisYear)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [categoryTypeFilter, setCategoryTypeFilter] = useState<TypeFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<FinanceEntry | 'new' | null>(null)
  const [editingOpening, setEditingOpening] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const nameOf = useMemo(() => {
    return (uid: string) => String(profiles?.[uid]?.fullName ?? '') || 'Người dùng ẩn danh'
  }, [profiles])

  const challengeList = useMemo(
    () =>
      Object.entries(challengesValue ?? {})
        .map(([id, c]) => ({ id, name: String(c.name ?? '') || 'Thử thách' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    [challengesValue],
  )
  const challengeName = useMemo(() => {
    const map = new Map(challengeList.map((c) => [c.id, c.name]))
    return (id: string) => map.get(id) ?? 'Thử thách đã xóa'
  }, [challengeList])

  const memberList = useMemo(
    () =>
      Object.entries(profiles ?? {})
        .filter(([, p]) => String(p.email ?? '').toLowerCase() !== 'echiptime@gmail.com')
        .map(([uid, p]) => ({
          uid,
          name: String(p.fullName ?? '') || String(p.email ?? uid),
          avatar: String(p.avatar ?? ''),
          member: p.member === true,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    [profiles],
  )

  const settings = useMemo(() => parseFinanceSettings(financeValue?.settings), [financeValue])
  const dues = useMemo(() => parseDues(financeValue?.dues), [financeValue])

  const entries = useMemo(
    () =>
      [
        ...parseTransactions(financeValue?.transactions),
        ...penaltyIncomeEntries(challengesValue, nameOf),
        ...duesIncomeEntries(dues, nameOf),
      ].sort(compareEntriesDesc),
    [financeValue, challengesValue, dues, nameOf],
  )

  const years = useMemo(() => {
    const set = new Set(entries.map((e) => dayYear(e.date)).filter(Boolean))
    for (const y of Object.keys(dues)) set.add(Number(y))
    set.add(thisYear)
    return [...set].sort((a, b) => b - a)
  }, [entries, dues, thisYear])

  const yearEntries = useMemo(() => entries.filter((e) => dayYear(e.date) === year), [entries, year])

  // Số dư đầu kỳ là tiền quỹ tại ngày bắt đầu: các khoản trước ngày đó đã nằm trong số dư này
  const openingMs = parseChallengeDayStartMs(settings.openingDate)
  const openingYear = settings.openingDate ? dayYear(settings.openingDate) : null
  const openingMonth = settings.openingDate ? dayMonth(settings.openingDate) : null
  const inPeriod = useMemo(
    () => (e: FinanceEntry) => openingMs == null || e.dateMs >= openingMs,
    [openingMs],
  )
  const countedYearEntries = useMemo(() => yearEntries.filter(inPeriod), [yearEntries, inPeriod])

  const totals = useMemo(() => {
    const counted = entries.filter(inPeriod)
    const income = countedYearEntries
      .filter((e) => e.type === 'income')
      .reduce((s, e) => s + e.amount, 0)
    const expense = countedYearEntries
      .filter((e) => e.type === 'expense')
      .reduce((s, e) => s + e.amount, 0)
    const beforeYear = counted
      .filter((e) => dayYear(e.date) < year)
      .reduce((s, e) => s + signedAmount(e), 0)
    return {
      income,
      expense,
      openingOfYear: settings.openingBalance + beforeYear,
      balance: settings.openingBalance + counted.reduce((s, e) => s + signedAmount(e), 0),
    }
  }, [entries, countedYearEntries, inPeriod, year, settings.openingBalance])

  /** Năm đang xem nằm trước kỳ ghi sổ: chỉ xem tham khảo, không có số dư */
  const beforeOpening = openingYear != null && year < openingYear
  const isOpeningYear = openingYear != null && year === openingYear

  const months = useMemo(() => {
    const rows = MONTHS.map((month) => {
      const list = countedYearEntries.filter((e) => dayMonth(e.date) === month)
      const income = list.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0)
      const expense = list.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0)
      return { month, income, expense, count: list.length }
    })
    return rows.map((m, i) => ({
      ...m,
      closing:
        beforeOpening || (isOpeningYear && openingMonth != null && m.month < openingMonth)
          ? null
          : totals.openingOfYear +
            rows.slice(0, i + 1).reduce((s, r) => s + r.income - r.expense, 0),
    }))
  }, [countedYearEntries, totals.openingOfYear, beforeOpening, isOpeningYear, openingMonth])
  const isOpeningMonth = (month: number) => isOpeningYear && month === openingMonth
  const activeMonths = months.filter((m) => m.count > 0 || isOpeningMonth(m.month))

  const byCategory = useMemo(() => {
    const map = new Map<string, { type: FinanceType; amount: number; count: number }>()
    for (const e of countedYearEntries) {
      const key = `${e.type}:${e.category}`
      const item = map.get(key) ?? { type: e.type, amount: 0, count: 0 }
      item.amount += e.amount
      item.count += 1
      map.set(key, item)
    }
    return [...map.entries()]
      .map(([key, v]) => ({ category: key.split(':')[1], ...v }))
      .sort((a, b) => (a.type === b.type ? b.amount - a.amount : a.type === 'income' ? -1 : 1))
  }, [countedYearEntries])
  const visibleCategories = byCategory.filter(
    (c) => categoryTypeFilter === 'all' || c.type === categoryTypeFilter,
  )
  const visibleCategoryTotal = visibleCategories.reduce(
    (s, c) => s + (c.type === 'income' ? c.amount : -c.amount),
    0,
  )

  const query = foldText(search)
  const filtered = useMemo(
    () =>
      yearEntries.filter(
        (e) =>
          (typeFilter === 'all' || e.type === typeFilter) &&
          (!categoryFilter || e.category === categoryFilter) &&
          (!query ||
            foldText(
              `${e.note} ${e.memberUid ? nameOf(e.memberUid) : ''} ${categoryLabel(e.category)}`,
            ).includes(query)),
      ),
    [yearEntries, typeFilter, categoryFilter, query, nameOf],
  )
  const filteredTotal = filtered.filter(inPeriod).reduce((s, e) => s + signedAmount(e), 0)
  const filteredBefore = filtered.filter((e) => !inPeriod(e)).length
  const categoryOptions = useMemo(
    () => [...new Set(yearEntries.map((e) => e.category))].sort(),
    [yearEntries],
  )

  function done(text: string) {
    setEditing(null)
    setEditingOpening(false)
    setError('')
    setMessage(text)
  }

  async function removeEntry(entry: FinanceEntry) {
    if (!user || entry.auto) return
    if (
      !window.confirm(
        `Xóa khoản ${entry.type === 'income' ? 'thu' : 'chi'} ${formatVnd(entry.amount)} "${entry.note}"?`,
      )
    ) {
      return
    }
    setMessage('')
    setError('')
    try {
      await update(
        ref(db, `${FINANCE_PATH}/transactions/${entry.storedYear}/${entry.id}`),
        softDeleteFields(user.uid),
      )
      setMessage('Đã xóa khoản thu chi.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xóa được')
    }
  }

  function exportCsv() {
    downloadFinanceCsv(
      `thu-chi-qtr-${year}.csv`,
      [...filtered].reverse(),
      nameOf,
      challengeName,
      inPeriod,
    )
  }

  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">Câu lạc bộ</p>
        <h1>Tài chính</h1>
        <p className="lede">
          Thu chi quỹ CLB. Tiền phạt và tiền quỹ đã xác nhận được cộng tự động.
        </p>
      </header>

      {loading ? (
        <p className="empty">Đang tải…</p>
      ) : (
        <>
          <div className="finance-toolbar">
            <label className="search-field">
              <span className="sr-only">Năm</span>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    Năm {y}
                  </option>
                ))}
              </select>
            </label>
            {canEdit && (
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setMessage('')
                  setEditingOpening(false)
                  setEditing('new')
                }}
              >
                <Plus size={16} aria-hidden /> Thêm thu chi
              </button>
            )}
          </div>

          <p className="tiny muted finance-opening">
            {beforeOpening ? (
              <>
                Năm {year} trước kỳ ghi sổ ({settings.openingDate}): các khoản chỉ để tham khảo,
                không tính vào số dư.
              </>
            ) : isOpeningYear ? (
              <>
                Số dư đầu kỳ <strong>{formatVnd(settings.openingBalance)}</strong> tại ngày{' '}
                {settings.openingDate}. Các khoản trước ngày này đã nằm trong số dư đầu kỳ nên
                không cộng thêm.
              </>
            ) : (
              <>
                Số dư đầu năm {year}: <strong>{formatVnd(totals.openingOfYear)}</strong> · Số dư
                đầu kỳ {formatVnd(settings.openingBalance)}
                {settings.openingDate ? ` (từ ${settings.openingDate})` : ''}
              </>
            )}
            {canEdit && (
              <>
                {' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setMessage('')
                    setEditing(null)
                    setEditingOpening(true)
                  }}
                >
                  Sửa
                </button>
              </>
            )}
          </p>
          <div className="stat-row finance-stats">
            <div className="stat">
              <strong className="stat-money">{formatVnd(totals.balance)}</strong>
              <span>Số dư hiện tại</span>
            </div>
            <div className="stat">
              <strong className="stat-money stat-paid">{formatVnd(totals.income)}</strong>
              <span>{isOpeningYear ? `Thu từ ${settings.openingDate}` : `Thu ${year}`}</span>
            </div>
            <div className="stat">
              <strong className="stat-money stat-unpaid">{formatVnd(totals.expense)}</strong>
              <span>{isOpeningYear ? `Chi từ ${settings.openingDate}` : `Chi ${year}`}</span>
            </div>
          </div>

          {message && <p className="form-info">{message}</p>}
          {error && <p className="form-error">{error}</p>}

          {canEdit && editingOpening && (
            <OpeningBalanceEditor
              openingBalance={settings.openingBalance}
              openingDate={settings.openingDate}
              onDone={done}
            />
          )}
          {canEdit && editing && (
            <FinanceForm
              key={editing === 'new' ? 'new' : editing.id}
              entry={editing === 'new' ? null : editing}
              members={memberList}
              challenges={challengeList}
              onClose={() => setEditing(null)}
              onSaved={done}
            />
          )}

          <div className="filter-row">
            <button
              type="button"
              className={tab === 'overview' ? 'chip active' : 'chip'}
              onClick={() => setTab('overview')}
            >
              Tổng quan
            </button>
            <button
              type="button"
              className={tab === 'ledger' ? 'chip active' : 'chip'}
              onClick={() => setTab('ledger')}
            >
              Sổ thu chi ({yearEntries.length})
            </button>
            <button
              type="button"
              className={tab === 'dues' ? 'chip active' : 'chip'}
              onClick={() => setTab('dues')}
            >
              Quỹ
            </button>
          </div>

          {tab === 'dues' ? (
            <FinanceDues
              year={year}
              dues={dues[year]}
              members={memberList}
              nameOf={nameOf}
              canEdit={canEdit}
            />
          ) : tab === 'overview' ? (
            <>
              <section className="section panel">
                <h2>Theo tháng</h2>
                {activeMonths.length === 0 ? (
                  <p className="empty">Chưa có tháng nào có thu chi trong năm {year}.</p>
                ) : (
                  <div className="finance-table-wrap">
                    <table className="finance-table">
                      <thead>
                        <tr>
                          <th>Tháng</th>
                          <th>Thu</th>
                          <th>Chi</th>
                          <th>Tồn</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeMonths.map((m) => (
                          <tr key={m.month}>
                            <td>
                              {m.month}
                              {isOpeningMonth(m.month) && (
                                <span className="tiny muted finance-month-note">
                                  Đầu kỳ {formatVnd(settings.openingBalance)}
                                </span>
                              )}
                            </td>
                            <td className="finance-in">{m.income ? formatVnd(m.income) : '—'}</td>
                            <td className="finance-out">
                              {m.expense ? formatVnd(m.expense) : '—'}
                            </td>
                            <td>{m.closing == null ? '—' : formatVnd(m.closing)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="section panel">
                <h2>Theo danh mục</h2>
                <div className="filter-row">
                  {(
                    [
                      ['all', 'Tất cả'],
                      ['income', 'Thu'],
                      ['expense', 'Chi'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={categoryTypeFilter === value ? 'chip active' : 'chip'}
                      onClick={() => setCategoryTypeFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {visibleCategories.length === 0 ? (
                  <p className="empty">
                    Chưa có khoản{' '}
                    {categoryTypeFilter === 'income'
                      ? 'thu'
                      : categoryTypeFilter === 'expense'
                        ? 'chi'
                        : 'thu chi'}{' '}
                    nào trong năm {year}.
                  </p>
                ) : (
                  <ul className="participant-list">
                    {visibleCategories.map((c) => (
                      <li key={`${c.type}-${c.category}`} className="participant-row">
                        <div className="participant-meta">
                          <strong>{categoryLabel(c.category)}</strong>
                          <span className="tiny muted">
                            {c.type === 'income' ? 'Thu' : 'Chi'} · {c.count} khoản
                          </span>
                        </div>
                        <span
                          className={`reward-amount ${c.type === 'income' ? 'completed' : 'underHalf'}`}
                        >
                          {signedVnd(c.type === 'income' ? c.amount : -c.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {visibleCategories.length > 0 && (
                  <p className="tiny muted">
                    {categoryTypeFilter === 'income'
                      ? 'Tổng thu'
                      : categoryTypeFilter === 'expense'
                        ? 'Tổng chi'
                        : 'Chênh lệch'}
                    : <strong>{signedVnd(visibleCategoryTotal)}</strong>
                  </p>
                )}
              </section>
            </>
          ) : (
            <section className="section panel">
              <div className="filter-row">
                {(
                  [
                    ['all', 'Tất cả'],
                    ['income', 'Thu'],
                    ['expense', 'Chi'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={typeFilter === value ? 'chip active' : 'chip'}
                    onClick={() => setTypeFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="finance-ledger-tools">
                <label className="search-field">
                  <span className="sr-only">Danh mục</span>
                  <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                    <option value="">Mọi danh mục</option>
                    {categoryOptions.map((c) => (
                      <option key={c} value={c}>
                        {categoryLabel(c)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="reward-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tìm nội dung, thành viên"
                    aria-label="Tìm nội dung, thành viên"
                  />
                  {search && (
                    <button type="button" aria-label="Xóa tìm kiếm" onClick={() => setSearch('')}>
                      <X size={16} />
                    </button>
                  )}
                </div>
              </div>
              <div className="finance-ledger-summary">
                <span className="tiny muted">
                  {filtered.length} khoản · Chênh lệch <strong>{signedVnd(filteredTotal)}</strong>
                  {filteredBefore > 0 &&
                    ` (không tính ${filteredBefore} khoản trước ngày ${settings.openingDate})`}
                </span>
                <button
                  type="button"
                  className="btn ghost compact"
                  disabled={!filtered.length}
                  onClick={exportCsv}
                >
                  <Download size={14} aria-hidden /> Xuất CSV
                </button>
              </div>
              {filtered.length === 0 ? (
                <p className="empty">Không có khoản thu chi phù hợp.</p>
              ) : (
                <ul className="participant-list">
                  {filtered.map((e) => (
                    <li
                      key={e.id}
                      className={`participant-row finance-row${inPeriod(e) ? '' : ' finance-before'}`}
                    >
                      <div className="participant-meta">
                        <strong>{e.note || categoryLabel(e.category)}</strong>
                        {!inPeriod(e) && (
                          <span className="tiny">
                            <span className="penalty-pay-badge">Trước kỳ</span> đã nằm trong số dư
                            đầu kỳ, không cộng thêm
                          </span>
                        )}
                        <span className="tiny muted">
                          {e.date} · {categoryLabel(e.category)}
                          {e.memberUid && !e.auto ? ` · ${nameOf(e.memberUid)}` : ''}
                          {e.challengeId && !e.auto ? ` · ${challengeName(e.challengeId)}` : ''}
                        </span>
                        <span className="tiny muted">
                          {e.auto ? (
                            <>
                              <span className="penalty-pay-badge paid">Tự động</span> xác nhận bởi{' '}
                              {nameOf(e.createdBy)} ·{' '}
                              {e.auto === 'penalty' ? (
                                <Link to="/rewards">Thưởng - Phạt</Link>
                              ) : (
                                <button type="button" className="link-btn" onClick={() => setTab('dues')}>
                                  Quỹ
                                </button>
                              )}
                            </>
                          ) : (
                            <>
                              Nhập bởi {nameOf(e.createdBy)}
                              {e.updatedBy ? ` · sửa bởi ${nameOf(e.updatedBy)}` : ''}
                            </>
                          )}
                        </span>
                        {canEdit && !e.auto && (
                          <span className="finance-row-actions">
                            <button
                              type="button"
                              className="btn ghost compact"
                              onClick={() => {
                                setMessage('')
                                setEditingOpening(false)
                                setEditing(e)
                                window.scrollTo({ top: 0, behavior: 'smooth' })
                              }}
                            >
                              Sửa
                            </button>
                            <button
                              type="button"
                              className="btn ghost compact danger"
                              onClick={() => void removeEntry(e)}
                            >
                              Xóa
                            </button>
                          </span>
                        )}
                      </div>
                      <span
                        className={`reward-amount ${e.type === 'income' ? 'completed' : 'underHalf'}`}
                      >
                        {signedVnd(signedAmount(e))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
