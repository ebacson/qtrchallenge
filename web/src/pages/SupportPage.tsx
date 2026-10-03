import { useState, type FormEvent } from 'react'
import { ref, set } from 'firebase/database'
import { ExternalLink, Link2, Phone, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import { useSharedValue } from '../lib/sharedValue'

type Contact = { name: string; role?: string; phone: string }

const groups: { title: string; contacts: Contact[] }[] = [
  {
    title: 'Ban chủ nhiệm',
    contacts: [
      { name: 'Hoàng Minh An', role: 'Chủ nhiệm', phone: '0973.234.555' },
      { name: 'Nguyễn Ngọc Chiến', role: 'PCN TT', phone: '0914.185.285' },
      { name: 'Trần Mạnh Thường', role: 'PCN Đối ngoại', phone: '0914.145.575' },
      { name: 'Trương Công Tuyên', role: 'PCN Hậu cần', phone: '0907.779.995' },
      { name: 'Lê Thị Đoài', role: 'Thủ quỹ', phone: '0918.190.555' },
    ],
  },
  {
    title: 'CNTT - Quản lý Web app',
    contacts: [{ name: 'Tạ Bắc Sơn', phone: '0913.485.889' }],
  },
]

type SupportLink = { label: string; url: string }

/** Lưu dạng `{ items, updatedAt, updatedBy }`; chưa có node thì dùng danh sách mặc định. */
const FUND_PATH = 'settings/support/fundLinks'
const GROUPS_PATH = 'settings/support/groupLinks'
/** Link Zalo đơn lẻ của bản trước, gộp vào danh sách group nếu Admin đã nhập */
const LEGACY_ZALO_PATH = 'settings/support/zaloGroupUrl'

const DEFAULT_FUND_LINKS: SupportLink[] = [
  { label: 'Quỹ CLB (MoMo)', url: 'https://quy.momo.vn/v2/HOkA0tigzT?cover=6749' },
]

const DEFAULT_GROUP_LINKS: SupportLink[] = [
  { label: 'Group TVCT', url: 'https://zalo.me/g/8ks3ctezjpj7gsz2yzlv' },
  { label: 'Group Picture & News', url: 'https://zalo.me/g/uhdzhh743' },
  { label: 'Facebook', url: 'https://www.facebook.com/groups/quangtrirunners' },
  { label: 'Fanpage', url: 'https://www.facebook.com/QuangTriRunners' },
  { label: 'Group Strava', url: 'https://www.strava.com/clubs/quangtrirunners' },
]

const URL_RE = /^https?:\/\/\S+$/i

function initials(name: string): string {
  return name.split(' ').pop()?.charAt(0).toUpperCase() ?? '?'
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

type Brand = 'zalo' | 'momo' | 'facebook' | 'strava' | 'other'

function brandOf(url: string): Brand {
  const host = hostOf(url)
  if (/(^|\.)zalo\.(me|vn)$/.test(host)) return 'zalo'
  if (/(^|\.)momo\.vn$/.test(host)) return 'momo'
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me|m\.me)$/.test(host)) return 'facebook'
  if (/(^|\.)strava\.(com|app\.link)$/.test(host)) return 'strava'
  return 'other'
}

function BrandIcon({ url }: { url: string }) {
  const brand = brandOf(url)
  return (
    <span className={`brand-icon brand-${brand}`} aria-hidden>
      {brand === 'zalo' && 'Zalo'}
      {brand === 'momo' && 'MoMo'}
      {brand === 'facebook' && (
        <svg viewBox="0 0 24 24" width="22" height="22">
          <path
            fill="currentColor"
            d="M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.5V4.4c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.4H8.1v3h2.5V21h2.9z"
          />
        </svg>
      )}
      {brand === 'strava' && (
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            fill="currentColor"
            d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"
          />
        </svg>
      )}
      {brand === 'other' && <Link2 size={18} />}
    </span>
  )
}

function parseLinks(raw: unknown): SupportLink[] {
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

function LinkSection({
  title,
  path,
  defaults,
}: {
  title: string
  path: string
  defaults: SupportLink[]
}) {
  const { user, profile } = useAuth()
  const isAdmin = Boolean(profile?.admin)
  const value = useSharedValue<{ items?: unknown }>(path)
  const links = value ? parseLinks(value.items) : defaults
  const [draft, setDraft] = useState<SupportLink[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function updateRow(index: number, patch: Partial<SupportLink>) {
    setDraft((rows) => rows?.map((r, i) => (i === index ? { ...r, ...patch } : r)) ?? null)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!draft || !user) return
    const items = draft
      .map((r) => ({ label: r.label.trim(), url: r.url.trim() }))
      .filter((r) => r.label || r.url)
    const invalid = items.find((r) => !URL_RE.test(r.url))
    if (invalid) {
      setError(`Link không hợp lệ${invalid.label ? ` (${invalid.label})` : ''}: cần bắt đầu bằng https://`)
      return
    }
    setBusy(true)
    setError('')
    try {
      await set(ref(db, path), {
        items: items.map((r) => ({ label: r.label || hostOf(r.url), url: r.url })),
        updatedAt: Date.now(),
        updatedBy: user.uid,
      })
      setDraft(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="section panel">
      <div className="section-head">
        <h2>{title}</h2>
        {isAdmin && !draft && value !== undefined && (
          <button
            type="button"
            className="btn ghost compact"
            onClick={() => {
              setDraft(links.length ? links : [{ label: '', url: '' }])
              setError('')
            }}
          >
            Sửa
          </button>
        )}
      </div>

      {value === undefined ? (
        <p className="empty">Đang tải…</p>
      ) : draft ? (
        <form className="support-link-form" onSubmit={(e) => void save(e)}>
          {draft.map((row, i) => (
            <div key={i} className="support-link-edit">
              <BrandIcon url={row.url} />
              <div className="support-link-inputs">
                <input
                  value={row.label}
                  onChange={(e) => updateRow(i, { label: e.target.value })}
                  placeholder="Tên hiển thị"
                  maxLength={60}
                />
                <input
                  type="url"
                  inputMode="url"
                  value={row.url}
                  onChange={(e) => updateRow(i, { url: e.target.value })}
                  placeholder="https://…"
                />
              </div>
              <button
                type="button"
                className="btn ghost compact danger"
                aria-label="Xóa link"
                onClick={() => setDraft((rows) => rows?.filter((_, j) => j !== i) ?? null)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn ghost compact support-link-add"
            onClick={() => setDraft((rows) => [...(rows ?? []), { label: '', url: '' }])}
          >
            <Plus size={16} aria-hidden /> Thêm link
          </button>
          {error && <p className="form-error">{error}</p>}
          <div className="cta-row">
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Đang lưu…' : 'Lưu'}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Hủy
            </button>
          </div>
        </form>
      ) : links.length === 0 ? (
        <p className="empty">Chưa có link.</p>
      ) : (
        <ul className="support-links">
          {links.map((l, i) => (
            <li key={`${l.url}-${i}`}>
              <a className="support-link" href={l.url} target="_blank" rel="noreferrer">
                <BrandIcon url={l.url} />
                <span className="support-link-text">
                  <strong>{l.label || hostOf(l.url)}</strong>
                  <span className="tiny muted">{hostOf(l.url)}</span>
                </span>
                <ExternalLink size={16} className="support-link-open" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function SupportPage() {
  const legacyZalo = useSharedValue<string>(LEGACY_ZALO_PATH)
  const legacyUrl = typeof legacyZalo === 'string' ? legacyZalo.trim() : ''
  const groupDefaults =
    legacyUrl && !DEFAULT_GROUP_LINKS.some((l) => l.url === legacyUrl)
      ? [{ label: 'Nhóm Zalo CLB', url: legacyUrl }, ...DEFAULT_GROUP_LINKS]
      : DEFAULT_GROUP_LINKS

  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">Câu lạc bộ</p>
        <h1>☎ Liên hệ hỗ trợ</h1>
      </header>

      {groups.map((g) => (
        <section key={g.title} className="section panel">
          <h2>{g.title}</h2>
          <ul className="participant-list support-list">
            {g.contacts.map((c) => (
              <li key={c.phone} className="participant-row">
                <div className="hof-avatar">
                  <span>{initials(c.name)}</span>
                </div>
                <div className="participant-meta">
                  <strong>{c.name}</strong>
                  {c.role && <span className="tiny muted">{c.role}</span>}
                </div>
                <a
                  className="btn ghost compact support-call"
                  href={`tel:${c.phone.replace(/\D/g, '')}`}
                  aria-label={`Gọi ${c.name}`}
                >
                  <Phone size={16} aria-hidden />
                  {c.phone}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <LinkSection title="Quỹ CLB" path={FUND_PATH} defaults={DEFAULT_FUND_LINKS} />
      <LinkSection title="Các group của QTR" path={GROUPS_PATH} defaults={groupDefaults} />
    </div>
  )
}
