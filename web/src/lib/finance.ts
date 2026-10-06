import { parseChallenge, parseChallengeDayStartMs } from './challengeRules'

export const FINANCE_PATH = 'finance'

export type FinanceType = 'income' | 'expense'

export const FINANCE_CATEGORIES: Record<FinanceType, { value: string; label: string }[]> = {
  income: [
    { value: 'dues', label: 'Hội phí' },
    { value: 'sponsor', label: 'Tài trợ' },
    { value: 'other_income', label: 'Thu khác' },
  ],
  expense: [
    { value: 'prize', label: 'Quà thưởng' },
    { value: 'event', label: 'Sự kiện' },
    { value: 'gear', label: 'Áo & vật phẩm' },
    { value: 'ops', label: 'Vận hành' },
    { value: 'other_expense', label: 'Chi khác' },
  ],
}

/** Danh mục của các khoản thu tự động (không nhập tay) */
export const PENALTY_CATEGORY = 'penalty'

const CATEGORY_LABELS: Record<string, string> = {
  [PENALTY_CATEGORY]: 'Tiền phạt',
  ...Object.fromEntries(
    [...FINANCE_CATEGORIES.income, ...FINANCE_CATEGORIES.expense].map((c) => [c.value, c.label]),
  ),
}

export function categoryLabel(value: string): string {
  return CATEGORY_LABELS[value] ?? value
}

export type FinanceEntry = {
  id: string
  type: FinanceType
  amount: number
  category: string
  /** `dd-MM-yyyy` như các ngày khác trong app */
  date: string
  dateMs: number
  note: string
  memberUid?: string
  challengeId?: string
  createdAt: number
  createdBy: string
  updatedAt?: number
  updatedBy?: string
  /** Năm lưu trong `finance/transactions/{year}`; không có với khoản tự động */
  storedYear?: number
  /** Khoản tự động (tiền phạt, hội phí đã đóng), chỉ đọc */
  auto?: 'penalty' | 'dues'
}

export type FinanceSettings = { openingBalance: number; openingDate: string }

type Dict = Record<string, unknown>

function asDict(value: unknown): Dict | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Dict) : null
}

/** `yyyy-MM-dd` (ô date) ↔ `dd-MM-yyyy` (lưu trữ) */
export function inputDateToDay(value: string): string {
  const [y, m, d] = value.split('-')
  return y && m && d ? `${d}-${m}-${y}` : ''
}

export function dayToInputDate(day: string): string {
  const [d, m, y] = day.split('-')
  return y && m && d ? `${y}-${m}-${d}` : ''
}

/** Ngày theo giờ Việt Nam dạng `dd-MM-yyyy` */
export function msToDay(ms: number): string {
  const d = new Date(ms + 7 * 3_600_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`
}

export function dayYear(day: string): number {
  return Number(day.split('-')[2]) || 0
}

export function dayMonth(day: string): number {
  return Number(day.split('-')[1]) || 0
}

export function parseFinanceSettings(value: unknown): FinanceSettings {
  const dict = asDict(value) ?? {}
  return {
    openingBalance: Number(dict.openingBalance) || 0,
    openingDate: String(dict.openingDate ?? ''),
  }
}

/** Giao dịch nhập tay trong `finance/transactions/{year}/{id}`, bỏ các khoản đã xóa mềm. */
export function parseTransactions(value: unknown): FinanceEntry[] {
  const out: FinanceEntry[] = []
  for (const [yearKey, yearValue] of Object.entries(asDict(value) ?? {})) {
    for (const [id, raw] of Object.entries(asDict(yearValue) ?? {})) {
      const row = asDict(raw)
      if (!row || row.deletedAt) continue
      const type: FinanceType = row.type === 'expense' ? 'expense' : 'income'
      const date = String(row.date ?? '')
      out.push({
        id,
        type,
        amount: Number(row.amount) || 0,
        category: String(row.category ?? ''),
        date,
        dateMs: parseChallengeDayStartMs(date) ?? 0,
        note: String(row.note ?? ''),
        memberUid: row.memberUid ? String(row.memberUid) : undefined,
        challengeId: row.challengeId ? String(row.challengeId) : undefined,
        createdAt: Number(row.createdAt) || 0,
        createdBy: String(row.createdBy ?? ''),
        updatedAt: Number(row.updatedAt) || undefined,
        updatedBy: row.updatedBy ? String(row.updatedBy) : undefined,
        storedYear: Number(yearKey) || dayYear(date),
      })
    }
  }
  return out
}

/** Tiền phạt admin đã xác nhận nộp (không tính miễn phạt), ghi nhận vào ngày xác nhận. */
export function penaltyIncomeEntries(
  challenges: Record<string, Dict> | null | undefined,
  nameOf: (uid: string) => string,
): FinanceEntry[] {
  const out: FinanceEntry[] = []
  for (const [challengeId, raw] of Object.entries(challenges ?? {})) {
    const challenge = parseChallenge(challengeId, raw)
    for (const [uid, payment] of Object.entries(challenge.penaltyPayments ?? {})) {
      if (payment.waived || !(payment.amount > 0)) continue
      const date = msToDay(payment.confirmedAt)
      out.push({
        id: `penalty-${challengeId}-${uid}`,
        type: 'income',
        amount: payment.amount,
        category: PENALTY_CATEGORY,
        date,
        dateMs: parseChallengeDayStartMs(date) ?? 0,
        note: `Phạt "${challenge.name || 'Thử thách'}" — ${nameOf(uid)}`,
        memberUid: uid,
        challengeId,
        createdAt: payment.confirmedAt,
        createdBy: payment.confirmedBy,
        auto: 'penalty',
      })
    }
  }
  return out
}

export type DuesPayment = { amount: number; paidAt: number; confirmedBy: string }

export type DuesYear = { amount: number; members: Record<string, DuesPayment> }

export function duesPaymentFields(amount: number, confirmedBy: string): DuesPayment {
  return { amount, paidAt: Date.now(), confirmedBy }
}

/** `finance/dues/{year}`: `settings/amount` và `members/{uid}` (ai đã đóng). */
export function parseDues(value: unknown): Record<number, DuesYear> {
  const out: Record<number, DuesYear> = {}
  for (const [yearKey, raw] of Object.entries(asDict(value) ?? {})) {
    const year = Number(yearKey)
    const dict = asDict(raw)
    if (!year || !dict) continue
    const members: Record<string, DuesPayment> = {}
    for (const [uid, p] of Object.entries(asDict(dict.members) ?? {})) {
      const row = asDict(p)
      if (!row || !(Number(row.amount) > 0)) continue
      members[uid] = {
        amount: Number(row.amount),
        paidAt: Number(row.paidAt) || 0,
        confirmedBy: String(row.confirmedBy ?? ''),
      }
    }
    out[year] = { amount: Number(asDict(dict.settings)?.amount) || 0, members }
  }
  return out
}

/** Hội phí đã đóng, ghi nhận vào ngày xác nhận. */
export function duesIncomeEntries(
  dues: Record<number, DuesYear>,
  nameOf: (uid: string) => string,
): FinanceEntry[] {
  const out: FinanceEntry[] = []
  for (const [year, info] of Object.entries(dues)) {
    for (const [uid, p] of Object.entries(info.members)) {
      const date = msToDay(p.paidAt)
      out.push({
        id: `dues-${year}-${uid}`,
        type: 'income',
        amount: p.amount,
        category: 'dues',
        date,
        dateMs: parseChallengeDayStartMs(date) ?? 0,
        note: `Hội phí ${year} — ${nameOf(uid)}`,
        memberUid: uid,
        createdAt: p.paidAt,
        createdBy: p.confirmedBy,
        auto: 'dues',
      })
    }
  }
  return out
}

/** Xóa mềm: giữ lại bản ghi để đối soát */
export function softDeleteFields(uid: string): { deletedAt: number; deletedBy: string } {
  return { deletedAt: Date.now(), deletedBy: uid }
}

export function signedAmount(entry: FinanceEntry): number {
  return entry.type === 'income' ? entry.amount : -entry.amount
}

export function compareEntriesDesc(a: FinanceEntry, b: FinanceEntry): number {
  return b.dateMs - a.dateMs || b.createdAt - a.createdAt
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV có BOM để Excel đọc đúng tiếng Việt. */
export function downloadFinanceCsv(
  filename: string,
  entries: FinanceEntry[],
  nameOf: (uid: string) => string,
  challengeName: (id: string) => string,
  counted: (entry: FinanceEntry) => boolean,
): void {
  const header = [
    'Ngày',
    'Loại',
    'Danh mục',
    'Số tiền',
    'Ghi chú',
    'Thành viên',
    'Thử thách',
    'Nguồn',
    'Người nhập',
    'Tính vào số dư',
  ]
  const lines = entries.map((e) =>
    [
      e.date,
      e.type === 'income' ? 'Thu' : 'Chi',
      categoryLabel(e.category),
      signedAmount(e),
      e.note,
      e.memberUid ? nameOf(e.memberUid) : '',
      e.challengeId ? challengeName(e.challengeId) : '',
      e.auto ? 'Tự động' : 'Nhập tay',
      e.createdBy ? nameOf(e.createdBy) : '',
      counted(e) ? 'Có' : 'Không (trước kỳ)',
    ]
      .map(csvCell)
      .join(','),
  )
  const blob = new Blob([`\uFEFF${[header.join(','), ...lines].join('\n')}`], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
