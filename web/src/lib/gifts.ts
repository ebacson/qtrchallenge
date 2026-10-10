import { timeToSeconds } from './prRanking'

/** `gifts/config` (quy định) và `gifts/awards/{id}` (người nhận quà); chỉ Admin đọc/ghi. */
export const GIFTS_PATH = 'gifts'

export type GiftSection = 'race' | 'yearEnd'
/** once: mỗi mức chỉ nhận một lần; perYear: mỗi năm một lần; unlimited: không giới hạn */
export type GiftRepeat = 'once' | 'perYear' | 'unlimited'
export type GiftGender = 'Nam' | 'Nữ'

export type GiftTier = {
  id: string
  /** Tên mức khi không xét theo thời gian (podium, khen thưởng cuối năm) */
  label: string
  /** Mốc thời gian dạng `sub3h30` */
  male: string
  female: string
  gift: string
  value: number
  cash: number
}

export type GiftCategory = {
  id: string
  section: GiftSection
  title: string
  note: string
  repeat: GiftRepeat
  /** Mức xét theo thời gian chip Nam/Nữ */
  timed: boolean
  tiers: GiftTier[]
}

export type GiftConfig = {
  effectiveFrom: string
  categories: GiftCategory[]
}

export type GiftStatus = 'pending' | 'given'

export type GiftAward = {
  id: string
  uid: string
  memberName: string
  gender: string
  category: string
  tierId: string
  tierLabel: string
  gift: string
  value: number
  cash: number
  year: number
  raceName: string
  raceDate: string
  chipTime: string
  status: GiftStatus
  givenDate: string
  note: string
  createdAt: number
  createdBy: string
  updatedAt?: number
  updatedBy?: string
}

function tier(
  id: string,
  male: string,
  female: string,
  gift: string,
  value: number,
  cash = 0,
): GiftTier {
  return { id, label: '', male, female, gift, value, cash }
}

function labeled(id: string, label: string, gift: string, value: number): GiftTier {
  return { id, label, male: '', female: '', gift, value, cash: 0 }
}

export const DEFAULT_GIFT_CONFIG: GiftConfig = {
  effectiveFrom: '01-01-2027',
  categories: [
    {
      id: 'hm',
      section: 'race',
      title: 'Race Half Marathon',
      note: 'Lần đầu đạt thành tích.',
      repeat: 'once',
      timed: true,
      tiers: [
        tier('hm1', 'sub1h45', 'sub2h00', 'Tất xỏ ngón', 150_000),
        tier('hm2', 'sub1h30', 'sub1h45', 'Kỷ niệm chương', 200_000),
      ],
    },
    {
      id: 'fm',
      section: 'race',
      title: 'Race Full Marathon',
      note: 'Lần đầu đạt thành tích kể từ khi tham gia TVCT (thời gian tính lũy kế).',
      repeat: 'once',
      timed: true,
      tiers: [
        tier('fm1', 'sub4h00', 'sub4h30', 'Cúp chạy bộ', 200_000),
        tier('fm2', 'sub3h45', 'sub4h15', 'Cúp chạy bộ', 250_000),
        tier('fm3', 'sub3h30', 'sub4h00', 'Bảng gỗ', 300_000),
        tier('fm4', 'sub3h15', 'sub3h45', 'Bảng gỗ', 400_000),
        tier('fm5', 'sub3h10', 'sub3h30', 'Bảng gỗ', 400_000),
        tier('fm6', 'sub3h05', 'sub3h20', 'Bảng gỗ', 500_000),
        tier('fm7', 'sub3h00', 'sub3h15', 'Kỷ niệm chương + tiền mặt', 500_000, 2_000_000),
      ],
    },
    {
      id: 'hattrick',
      section: 'race',
      title: 'Lập Hattrick PR FM',
      note: 'PR từ 3 race liên tục trở lên, trong 1 năm hoặc nhiều năm, miễn là 3 PR không bị ngắt quãng.',
      repeat: 'once',
      timed: true,
      tiers: [
        tier('ht1', 'sub4h00', 'sub4h15', 'Kỷ niệm chương', 500_000),
        tier('ht2', 'sub3h30', 'sub4h00', 'Kỷ niệm chương', 500_000),
      ],
    },
    {
      id: 'pr',
      section: 'race',
      title: 'Mỗi lần race FM có PR',
      note: 'Mỗi lần race FM có PR được nhận 1 quà (race không cần liên tục).',
      repeat: 'unlimited',
      timed: true,
      tiers: [
        tier('pr1', 'sub3h30', 'sub4h00', 'Kỷ niệm chương', 200_000),
        tier('pr2', 'sub3h15', 'sub3h45', 'Kỷ niệm chương', 300_000),
        tier('pr3', 'sub3h00', 'sub3h15', 'Kỷ niệm chương + tiền mặt', 500_000, 1_000_000),
      ],
    },
    {
      id: 'podium',
      section: 'race',
      title: 'Lần đầu lên podium',
      note: 'Nhận giải của BTC (Nhất - Nhì - Ba) theo công bố của BTC, gồm cả giải lứa tuổi.',
      repeat: 'once',
      timed: false,
      tiers: [
        labeled(
          'po1',
          'Giải có quy mô > 2000 VĐV',
          'Đĩa kim loại (20cm) màu vàng, bạc, đồng tương ứng với giải thưởng cá nhân đạt được',
          500_000,
        ),
      ],
    },
    {
      id: 'yearEnd',
      section: 'yearEnd',
      title: 'Khen thưởng cuối năm',
      note: 'Mỗi người trong top 3 nhận một cúp vinh danh.',
      repeat: 'perYear',
      timed: false,
      tiers: [
        labeled('ye1', 'Top 3 bứt phá', 'Cúp vinh danh', 500_000),
        labeled('ye2', 'Top 3 bền bỉ', 'Cúp vinh danh', 500_000),
        labeled('ye3', 'Top 3 nhiệt huyết', 'Cúp vinh danh', 500_000),
      ],
    },
  ],
}

function asDict(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function listOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const dict = asDict(value)
  if (!dict) return []
  return Object.entries(dict)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, v]) => v)
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function money(value: unknown): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n > 0 ? n : 0
}

function parseTier(raw: unknown, index: number): GiftTier | null {
  const row = asDict(raw)
  if (!row) return null
  return {
    id: text(row.id) || `t${index + 1}`,
    label: text(row.label),
    male: text(row.male),
    female: text(row.female),
    gift: text(row.gift),
    value: money(row.value),
    cash: money(row.cash),
  }
}

/** Danh mục và kiểu xét giữ theo mặc định; tên, ghi chú, các mức lấy từ RTDB nếu Admin đã sửa. */
export function parseGiftConfig(raw: unknown): GiftConfig {
  const dict = asDict(raw)
  if (!dict) return DEFAULT_GIFT_CONFIG
  const stored = asDict(dict.categories) ?? {}
  return {
    effectiveFrom: text(dict.effectiveFrom) || DEFAULT_GIFT_CONFIG.effectiveFrom,
    categories: DEFAULT_GIFT_CONFIG.categories.map((base) => {
      const row = asDict(stored[base.id])
      if (!row) return base
      const tiers = listOf(row.tiers)
        .map(parseTier)
        .filter((t): t is GiftTier => t != null)
      return {
        ...base,
        title: text(row.title) || base.title,
        note: row.note == null ? base.note : text(row.note),
        tiers,
      }
    }),
  }
}

export function serializeGiftConfig(config: GiftConfig): Record<string, unknown> {
  return {
    effectiveFrom: config.effectiveFrom,
    categories: Object.fromEntries(
      config.categories.map((c) => [
        c.id,
        {
          title: c.title,
          note: c.note,
          tiers: c.tiers.map((t) => ({
            id: t.id,
            label: t.label,
            male: t.male,
            female: t.female,
            gift: t.gift,
            value: t.value,
            cash: t.cash,
          })),
        },
      ]),
    ),
  }
}

export function parseAwards(raw: unknown): GiftAward[] {
  const dict = asDict(raw) ?? {}
  const out: GiftAward[] = []
  for (const [id, value] of Object.entries(dict)) {
    const row = asDict(value)
    if (!row || !text(row.uid)) continue
    out.push({
      id,
      uid: text(row.uid),
      memberName: text(row.memberName),
      gender: text(row.gender),
      category: text(row.category),
      tierId: text(row.tierId),
      tierLabel: text(row.tierLabel),
      gift: text(row.gift),
      value: money(row.value),
      cash: money(row.cash),
      year: Number(row.year) || 0,
      raceName: text(row.raceName),
      raceDate: text(row.raceDate),
      chipTime: text(row.chipTime),
      status: row.status === 'given' ? 'given' : 'pending',
      givenDate: text(row.givenDate),
      note: text(row.note),
      createdAt: Number(row.createdAt) || 0,
      createdBy: text(row.createdBy),
      updatedAt: Number(row.updatedAt) || undefined,
      updatedBy: text(row.updatedBy) || undefined,
    })
  }
  return out
}

/** `sub3h30` → 12600 giây; không đúng dạng → null */
export function subSeconds(threshold: string): number | null {
  const m = /sub\s*(\d{1,2})\s*h\s*(\d{1,2})/i.exec(threshold)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60
}

export function chipSeconds(chipTime: string): number | null {
  const sec = timeToSeconds(chipTime)
  return Number.isFinite(sec) ? sec : null
}

export function thresholdOf(t: GiftTier, gender: string): string {
  return gender === 'Nữ' ? t.female : t.male
}

/** Tên mức để hiển thị và lưu kèm bản ghi, ví dụ "sub3h30 (Nam)" */
export function tierLabel(category: GiftCategory, t: GiftTier, gender: string): string {
  if (!category.timed) return t.label || t.gift
  const threshold = thresholdOf(t, gender)
  return gender === 'Nam' || gender === 'Nữ' ? `${threshold} (${gender})` : `${t.male} / ${t.female}`
}

/** Mức cao nhất đạt được với thời gian chip (mốc sub nhỏ nhất vẫn lớn hơn thời gian chạy). */
export function suggestTier(
  category: GiftCategory,
  gender: string,
  chipTime: string,
): GiftTier | null {
  if (!category.timed || (gender !== 'Nam' && gender !== 'Nữ')) return null
  const sec = chipSeconds(chipTime)
  if (sec == null) return null
  let best: { tier: GiftTier; limit: number } | null = null
  for (const t of category.tiers) {
    const limit = subSeconds(thresholdOf(t, gender))
    if (limit == null || sec >= limit) continue
    if (!best || limit < best.limit) best = { tier: t, limit }
  }
  return best?.tier ?? null
}

/** Các lần nhận trước đó khiến bản ghi mới trùng quy định "chỉ nhận một lần" */
export function duplicateAwards(
  awards: GiftAward[],
  category: GiftCategory,
  draft: { id?: string; uid: string; tierId: string; year: number },
): GiftAward[] {
  if (category.repeat === 'unlimited') return []
  return awards.filter(
    (a) =>
      a.id !== draft.id &&
      a.uid === draft.uid &&
      a.category === category.id &&
      (category.id === 'podium' || a.tierId === draft.tierId) &&
      (category.repeat === 'once' || a.year === draft.year),
  )
}

export function awardTotal(a: Pick<GiftAward, 'value' | 'cash'>): number {
  return a.value + a.cash
}
