export type SupportLink = { label: string; url: string }

/** Lưu dạng `{ items, updatedAt, updatedBy }`; chưa có node thì dùng danh sách mặc định. */
export const FUND_PATH = 'settings/support/fundLinks'

export const DEFAULT_FUND_LINKS: SupportLink[] = [
  { label: 'Quỹ CLB (MoMo)', url: 'https://quy.momo.vn/v2/HOkA0tigzT?cover=6749' },
]

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function isMomoUrl(url: string): boolean {
  return /(^|\.)momo\.vn$/.test(hostOf(url))
}

export function parseLinks(raw: unknown): SupportLink[] {
  if (raw == null || typeof raw !== 'object') return []
  const values = Array.isArray(raw)
    ? raw
    : Object.entries(raw as Record<string, unknown>)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, v]) => v)
  return values
    .map((v) => {
      const row = (v ?? {}) as Record<string, unknown>
      return { label: String(row.label ?? '').trim(), url: String(row.url ?? '').trim() }
    })
    .filter((l) => l.url)
}

/** Link Quỹ MoMo đầu tiên trong mục "Quỹ CLB" của trang Liên hệ hỗ trợ */
export function momoFundUrl(fund: { items?: unknown } | null | undefined): string {
  const links = fund ? parseLinks(fund.items) : DEFAULT_FUND_LINKS
  return links.find((l) => isMomoUrl(l.url))?.url ?? ''
}
