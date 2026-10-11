import { useMemo, useState, type FormEvent } from 'react'
import { ref, set } from 'firebase/database'
import { ArrowDown, ArrowUp, ExternalLink, Link2, Phone, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import { useSharedValue } from '../lib/sharedValue'
import {
  DEFAULT_FUND_LINKS,
  FUND_PATH,
  hostOf,
  isMomoUrl,
  parseLinks,
  type SupportLink,
} from '../lib/supportLinks'
import { USER_PROFILES_PATH } from '../lib/userProfile'

type Contact = { uid?: string; name: string; role: string; phone: string; avatar?: string }

/** Lưu dạng `{ items, updatedAt, updatedBy }`; chưa có node thì dùng danh sách mặc định. */
const BOARD_PATH = 'settings/support/board'
const IT_PATH = 'settings/support/it'

const DEFAULT_BOARD: Contact[] = [
  { name: 'Hoàng Minh An', role: 'Chủ nhiệm', phone: '0973.234.555' },
  { name: 'Nguyễn Ngọc Chiến', role: 'PCN TT', phone: '0914.185.285' },
  { name: 'Trần Mạnh Thường', role: 'PCN Đối ngoại', phone: '0914.145.575' },
  { name: 'Trương Công Tuyên', role: 'PCN Hậu cần', phone: '0907.779.995' },
  { name: 'Lê Thị Đoài', role: 'Thủ quỹ', phone: '0918.190.555' },
]

const DEFAULT_IT: Contact[] = [{ name: 'Tạ Bắc Sơn', role: '', phone: '0913.485.889' }]

const PHONE_RE = /^[0-9+().\s-]{6,20}$/

const GROUPS_PATH = 'settings/support/groupLinks'
/** Link Zalo đơn lẻ của bản trước, gộp vào danh sách group nếu Admin đã nhập */
const LEGACY_ZALO_PATH = 'settings/support/zaloGroupUrl'

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

type Brand = 'zalo' | 'momo' | 'facebook' | 'strava' | 'other'

function brandOf(url: string): Brand {
  const host = hostOf(url)
  if (/(^|\.)zalo\.(me|vn)$/.test(host)) return 'zalo'
  if (isMomoUrl(url)) return 'momo'
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

function parseContacts(raw: unknown): Contact[] {
  if (raw == null || typeof raw !== 'object') return []
  const values = Array.isArray(raw)
    ? raw
    : Object.entries(raw as Record<string, unknown>)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, v]) => v)
  return values
    .map((v) => {
      const row = (v ?? {}) as Record<string, unknown>
      const contact: Contact = {
        name: String(row.name ?? '').trim(),
        role: String(row.role ?? '').trim(),
        phone: String(row.phone ?? '').trim(),
      }
      if (typeof row.uid === 'string' && row.uid) contact.uid = row.uid
      if (typeof row.avatar === 'string' && row.avatar) contact.avatar = row.avatar
      return contact
    })
    .filter((c) => c.name)
}

type Profiles = Record<string, Record<string, unknown>>

function ContactSection({
  title,
  path,
  defaults,
}: {
  title: string
  path: string
  defaults: Contact[]
}) {
  const { user, profile } = useAuth()
  const isAdmin = Boolean(profile?.admin)
  const value = useSharedValue<{ items?: unknown }>(path)
  const contacts = value ? parseContacts(value.items) : defaults
  const [draft, setDraft] = useState<Contact[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Chỉ tải hồ sơ thành viên khi Admin đang sửa
  const profiles = useSharedValue<Profiles>(draft ? USER_PROFILES_PATH : null, 24 * 60 * 60_000)

  const candidates = useMemo(() => {
    if (!draft || !profiles) return []
    const taken = new Set(draft.map((c) => c.uid).filter(Boolean))
    return Object.entries(profiles)
      .filter(([uid, p]) => p?.member === true && !taken.has(uid))
      .map(([uid, p]) => ({ uid, name: String(p.fullName ?? '').trim() || 'Thành viên', profile: p }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  }, [draft, profiles])

  function updateRow(index: number, patch: Partial<Contact>) {
    setDraft((rows) => rows?.map((r, i) => (i === index ? { ...r, ...patch } : r)) ?? null)
  }

  function moveRow(index: number, delta: number) {
    setDraft((rows) => {
      if (!rows) return rows
      const target = index + delta
      if (target < 0 || target >= rows.length) return rows
      const next = [...rows]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function addMember(uid: string) {
    const picked = candidates.find((c) => c.uid === uid)
    if (!picked) return
    const avatar = typeof picked.profile.avatar === 'string' ? picked.profile.avatar : ''
    setDraft((rows) => [
      ...(rows ?? []),
      {
        uid,
        name: picked.name,
        role: '',
        phone: String(picked.profile.phone ?? '').trim(),
        ...(avatar ? { avatar } : {}),
      },
    ])
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!draft || !user) return
    const items = draft.map((c) => ({ ...c, name: c.name.trim(), role: c.role.trim(), phone: c.phone.trim() }))
    const unnamed = items.find((c) => !c.name)
    if (unnamed) {
      setError('Mỗi người cần có tên hiển thị')
      return
    }
    const badPhone = items.find((c) => c.phone && !PHONE_RE.test(c.phone))
    if (badPhone) {
      setError(`Số điện thoại không hợp lệ (${badPhone.name})`)
      return
    }
    setBusy(true)
    setError('')
    try {
      await set(ref(db, path), {
        items: items.map((c) => ({
          name: c.name,
          role: c.role,
          phone: c.phone,
          ...(c.uid ? { uid: c.uid } : {}),
          ...(c.avatar ? { avatar: c.avatar } : {}),
        })),
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
              setDraft(contacts)
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
          {draft.length === 0 && <p className="empty">Chưa có ai. Thêm từ danh sách thành viên chính thức bên dưới.</p>}
          {draft.map((c, i) => (
            <div key={c.uid ?? `row-${i}`} className="support-link-edit">
              <div className="hof-avatar">
                {c.avatar ? <img src={c.avatar} alt="" /> : <span>{initials(c.name)}</span>}
              </div>
              <div className="support-link-inputs">
                <input
                  value={c.name}
                  onChange={(e) => updateRow(i, { name: e.target.value })}
                  placeholder="Họ tên"
                  maxLength={60}
                />
                <div className="support-contact-inputs">
                  <input
                    value={c.role}
                    onChange={(e) => updateRow(i, { role: e.target.value })}
                    placeholder="Chức vụ (tùy chọn)"
                    maxLength={40}
                  />
                  <input
                    type="tel"
                    inputMode="tel"
                    value={c.phone}
                    onChange={(e) => updateRow(i, { phone: e.target.value })}
                    placeholder="Số điện thoại"
                    maxLength={20}
                  />
                </div>
              </div>
              <div className="support-contact-actions">
                <button
                  type="button"
                  className="btn ghost compact"
                  aria-label="Lên trên"
                  disabled={i === 0}
                  onClick={() => moveRow(i, -1)}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  type="button"
                  className="btn ghost compact"
                  aria-label="Xuống dưới"
                  disabled={i === draft.length - 1}
                  onClick={() => moveRow(i, 1)}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  type="button"
                  className="btn ghost compact danger"
                  aria-label={`Bỏ ${c.name}`}
                  onClick={() => setDraft((rows) => rows?.filter((_, j) => j !== i) ?? null)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
          <label className="search-field support-contact-add">
            <span className="sr-only">Thêm thành viên chính thức</span>
            <select
              value=""
              disabled={!profiles}
              onChange={(e) => addMember(e.target.value)}
            >
              <option value="">
                {profiles ? '+ Thêm thành viên chính thức…' : 'Đang tải danh sách thành viên…'}
              </option>
              {candidates.map((m) => (
                <option key={m.uid} value={m.uid}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
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
      ) : contacts.length === 0 ? (
        <p className="empty">Chưa có thông tin.</p>
      ) : (
        <ul className="participant-list support-list">
          {contacts.map((c, i) => (
            <li key={c.uid ?? `${c.name}-${i}`} className="participant-row">
              <div className="hof-avatar">
                {c.avatar ? <img src={c.avatar} alt="" /> : <span>{initials(c.name)}</span>}
              </div>
              <div className="participant-meta">
                <strong>{c.name}</strong>
                {c.role && <span className="tiny muted">{c.role}</span>}
              </div>
              {c.phone && (
                <a
                  className="btn ghost compact support-call"
                  href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}
                  aria-label={`Gọi ${c.name}`}
                >
                  <Phone size={16} aria-hidden />
                  {c.phone}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
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

      <ContactSection title="Ban chủ nhiệm" path={BOARD_PATH} defaults={DEFAULT_BOARD} />
      <ContactSection title="CNTT - Quản lý Web app" path={IT_PATH} defaults={DEFAULT_IT} />
      <LinkSection title="Quỹ CLB" path={FUND_PATH} defaults={DEFAULT_FUND_LINKS} />
      <LinkSection title="Các group của QTR" path={GROUPS_PATH} defaults={groupDefaults} />
    </div>
  )
}
