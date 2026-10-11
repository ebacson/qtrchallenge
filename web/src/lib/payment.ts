import type { Challenge } from '../types'

/** Tài khoản nhận tiền phạt; admin sửa được, lưu ở `settings/bank`. Link Quỹ MoMo lấy từ `supportLinks` */
export const BANK_PATH = 'settings/bank'

export type BankInfo = {
  bin: string
  bankName: string
  accountNo: string
  accountName: string
}

/** Tài khoản `PSG…` là tài khoản định danh Quỹ MoMo, nhận tiền qua mã BIN của MoMo (971025) */
export const DEFAULT_BANK: BankInfo = {
  bin: '971025',
  bankName: 'MoMo (Quỹ QTR)',
  accountNo: 'PSG2627316100000032',
  accountName: '',
}

export function parseBank(raw: unknown): BankInfo {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const pick = (key: keyof BankInfo) => {
    const value = row[key]
    return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_BANK[key]
  }
  return {
    bin: pick('bin'),
    bankName: pick('bankName'),
    accountNo: pick('accountNo'),
    accountName: typeof row.accountName === 'string' ? row.accountName.trim() : '',
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 5

function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/**
 * Mã nộp phạt cố định cho một thành viên trong một thử thách, dạng `QTR P2610 AB12C`
 * (P + năm/tháng bắt đầu thử thách + 5 ký tự băm từ id thử thách và uid).
 * Dùng khoảng trắng thay gạch nối vì một số ngân hàng bỏ ký tự đặc biệt trong nội dung chuyển khoản.
 */
export function penaltyCode(challenge: Pick<Challenge, 'id' | 'startDate'>, uid: string): string {
  const [, month = '', year = ''] = challenge.startDate.trim().split('-')
  const period = year.length === 4 && month ? `${year.slice(2)}${month.padStart(2, '0')}` : '0000'
  let hash = fnv1a(`${challenge.id}:${uid}`)
  let suffix = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    suffix += CODE_ALPHABET[hash % CODE_ALPHABET.length]
    hash = Math.floor(hash / CODE_ALPHABET.length)
  }
  return `QTR P${period} ${suffix}`
}

function compactCode(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase()
}

/** Tìm theo mã nộp phạt, bỏ qua khoảng trắng / gạch nối / hoa thường; cần ít nhất 4 ký tự */
export function codeMatchesQuery(code: string, query: string): boolean {
  const q = compactCode(query)
  return q.length >= 4 && compactCode(code).includes(q)
}

function tlv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`
}

function crc16(text: string): string {
  let crc = 0xffff
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** Nội dung chuyển khoản trong QR chỉ nên có chữ không dấu, số và khoảng trắng */
function asciiMemo(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'D')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 25)
}

/** Chuỗi VietQR (chuẩn EMVCo / NAPAS) cho app ngân hàng: điền sẵn tài khoản, số tiền, nội dung */
export function vietQrPayload({
  bin,
  accountNo,
  amount,
  memo,
}: {
  bin: string
  accountNo: string
  amount: number
  memo: string
}): string {
  const account = tlv('00', 'A000000727') + tlv('01', tlv('00', bin) + tlv('01', accountNo)) + tlv('02', 'QRIBFTTA')
  const info = asciiMemo(memo)
  let payload =
    tlv('00', '01') +
    tlv('01', amount > 0 ? '12' : '11') +
    tlv('38', account) +
    tlv('53', '704') +
    (amount > 0 ? tlv('54', String(Math.round(amount))) : '') +
    tlv('58', 'VN') +
    (info ? tlv('62', tlv('08', info)) : '')
  payload += '6304'
  return payload + crc16(payload)
}
