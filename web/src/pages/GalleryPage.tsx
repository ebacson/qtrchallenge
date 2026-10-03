import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ref, set } from 'firebase/database'
import { ChevronLeft, ChevronRight, ExternalLink, Plus, Trash2, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import { useSharedValue } from '../lib/sharedValue'
import {
  driveEmbedUrl,
  driveFileUrl,
  driveFolderUrl,
  driveThumbUrl,
  listDriveImages,
  parseDriveFolderId,
  type DriveImage,
} from '../lib/googleDrive'

/** `{ items: [{ label, url }], updatedAt, updatedBy }` */
const ALBUMS_PATH = 'settings/gallery/albums'
const PAGE_SIZE = 60

type Album = { label: string; url: string }

function parseAlbums(raw: unknown): Album[] {
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
    .filter((a) => a.url)
}

function AlbumEditor({ albums, onDone }: { albums: Album[]; onDone: () => void }) {
  const { user } = useAuth()
  const [draft, setDraft] = useState<Album[]>(albums.length ? albums : [{ label: '', url: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function updateRow(index: number, patch: Partial<Album>) {
    setDraft((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    const items = draft
      .map((r) => ({ label: r.label.trim(), url: r.url.trim() }))
      .filter((r) => r.label || r.url)
    const invalid = items.find((r) => !parseDriveFolderId(r.url))
    if (invalid) {
      setError(
        `Link thư mục Google Drive không hợp lệ${invalid.label ? ` (${invalid.label})` : ''}. VD: https://drive.google.com/drive/folders/…`,
      )
      return
    }
    setBusy(true)
    setError('')
    try {
      await set(ref(db, ALBUMS_PATH), {
        items: items.map((r, i) => ({ label: r.label || `Album ${i + 1}`, url: r.url })),
        updatedAt: Date.now(),
        updatedBy: user.uid,
      })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được')
      setBusy(false)
    }
  }

  return (
    <form className="support-link-form panel gallery-editor" onSubmit={(e) => void save(e)}>
      <p className="tiny muted">
        Thư mục Drive cần chia sẻ “Bất kỳ ai có đường liên kết đều xem được”. Ảnh trong thư mục con
        cũng được hiển thị.
      </p>
      {draft.map((row, i) => (
        <div key={i} className="support-link-edit">
          <div className="support-link-inputs">
            <input
              value={row.label}
              onChange={(e) => updateRow(i, { label: e.target.value })}
              placeholder="Tên album (VD: Giải chạy 10/2026)"
              maxLength={80}
            />
            <input
              type="url"
              inputMode="url"
              value={row.url}
              onChange={(e) => updateRow(i, { url: e.target.value })}
              placeholder="https://drive.google.com/drive/folders/…"
            />
          </div>
          <button
            type="button"
            className="btn ghost compact danger"
            aria-label="Xóa album"
            onClick={() => setDraft((rows) => rows.filter((_, j) => j !== i))}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn ghost compact support-link-add"
        onClick={() => setDraft((rows) => [...rows, { label: '', url: '' }])}
      >
        <Plus size={16} aria-hidden /> Thêm link thư mục
      </button>
      {error && <p className="form-error">{error}</p>}
      <div className="cta-row">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Đang lưu…' : 'Lưu'}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onDone}>
          Hủy
        </button>
      </div>
    </form>
  )
}

type AlbumState =
  | { status: 'loading' }
  | { status: 'ready'; images: DriveImage[] }
  | { status: 'error'; message: string }

function AlbumView({
  album,
  onOpen,
}: {
  album: Album
  onOpen: (images: DriveImage[], index: number) => void
}) {
  const folderId = parseDriveFolderId(album.url)
  const [state, setState] = useState<AlbumState>({ status: 'loading' })
  const [limit, setLimit] = useState(PAGE_SIZE)

  useEffect(() => {
    if (!folderId) return
    let alive = true
    setState({ status: 'loading' })
    listDriveImages(folderId)
      .then((images) => alive && setState({ status: 'ready', images }))
      .catch((err: unknown) =>
        alive &&
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Không tải được ảnh',
        }),
      )
    return () => {
      alive = false
    }
  }, [folderId])

  if (!folderId) return null

  return (
    <section className="section gallery-album">
      <div className="section-head">
        <h2>
          {album.label}
          {state.status === 'ready' && (
            <span className="tiny muted"> · {state.images.length} ảnh</span>
          )}
        </h2>
        <a href={driveFolderUrl(folderId)} target="_blank" rel="noreferrer" className="tiny">
          Mở Drive <ExternalLink size={12} aria-hidden />
        </a>
      </div>

      {state.status === 'loading' ? (
        <p className="empty">Đang tải ảnh…</p>
      ) : state.status === 'error' ? (
        <>
          <p className="tiny form-error">Không đọc được danh sách ảnh: {state.message}</p>
          <iframe
            className="gallery-embed"
            src={driveEmbedUrl(folderId)}
            title={album.label}
            loading="lazy"
          />
        </>
      ) : state.images.length === 0 ? (
        <p className="empty">Thư mục chưa có ảnh.</p>
      ) : (
        <>
          <ul className="gallery-grid">
            {state.images.slice(0, limit).map((img, i) => (
              <li key={img.id}>
                <button
                  type="button"
                  className="gallery-thumb"
                  onClick={() => onOpen(state.images, i)}
                  aria-label={img.name}
                >
                  <img
                    src={driveThumbUrl(img.id, 400)}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                </button>
              </li>
            ))}
          </ul>
          {state.images.length > limit && (
            <button
              type="button"
              className="btn ghost gallery-more"
              onClick={() => setLimit((n) => n + PAGE_SIZE)}
            >
              Xem thêm ({state.images.length - limit} ảnh)
            </button>
          )}
        </>
      )}
    </section>
  )
}

function Lightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: DriveImage[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
}) {
  const touchX = useRef<number | null>(null)
  const img = images[index]
  const prev = useCallback(
    () => onIndex((index - 1 + images.length) % images.length),
    [index, images.length, onIndex],
  )
  const next = useCallback(
    () => onIndex((index + 1) % images.length),
    [index, images.length, onIndex],
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose, prev, next])

  if (!img) return null

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={img.name}
      onClick={onClose}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null
      }}
      onTouchEnd={(e) => {
        const start = touchX.current
        const end = e.changedTouches[0]?.clientX
        touchX.current = null
        if (start == null || end == null || Math.abs(end - start) < 50) return
        if (end < start) next()
        else prev()
      }}
    >
      <img
        key={img.id}
        className="lightbox-img"
        src={driveThumbUrl(img.id, 2000)}
        alt={img.name}
        referrerPolicy="no-referrer"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="tiny">
          {index + 1}/{images.length}
        </span>
        <a href={driveFileUrl(img.id)} target="_blank" rel="noreferrer" className="tiny">
          Ảnh gốc <ExternalLink size={12} aria-hidden />
        </a>
      </div>
      <button type="button" className="lightbox-btn close" aria-label="Đóng" onClick={onClose}>
        <X size={24} />
      </button>
      {images.length > 1 && (
        <>
          <button
            type="button"
            className="lightbox-btn prev"
            aria-label="Ảnh trước"
            onClick={(e) => {
              e.stopPropagation()
              prev()
            }}
          >
            <ChevronLeft size={28} />
          </button>
          <button
            type="button"
            className="lightbox-btn next"
            aria-label="Ảnh sau"
            onClick={(e) => {
              e.stopPropagation()
              next()
            }}
          >
            <ChevronRight size={28} />
          </button>
        </>
      )}
    </div>
  )
}

const ALL = -1

export function GalleryPage() {
  const { profile } = useAuth()
  const isAdmin = Boolean(profile?.admin)
  const value = useSharedValue<{ items?: unknown }>(ALBUMS_PATH)
  const albums = useMemo(() => (value ? parseAlbums(value.items) : []), [value])
  const [editing, setEditing] = useState(false)
  const [filter, setFilter] = useState(ALL)
  const [viewer, setViewer] = useState<{ images: DriveImage[]; index: number } | null>(null)

  const visible = filter === ALL ? albums : albums.filter((_, i) => i === filter)
  const closeViewer = useCallback(() => setViewer(null), [])
  const setViewerIndex = useCallback(
    (index: number) => setViewer((v) => (v ? { ...v, index } : v)),
    [],
  )

  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">Câu lạc bộ</p>
        <h1>Hình ảnh hoạt động</h1>
      </header>

      {isAdmin && !editing && value !== undefined && (
        <div className="cta-row gallery-admin">
          <button type="button" className="btn ghost compact" onClick={() => setEditing(true)}>
            Quản lý album ({albums.length})
          </button>
        </div>
      )}
      {editing && <AlbumEditor albums={albums} onDone={() => setEditing(false)} />}

      {value === undefined ? (
        <p className="empty">Đang tải…</p>
      ) : albums.length === 0 ? (
        <p className="empty">Chưa có album nào.</p>
      ) : (
        <>
          {albums.length > 1 && (
            <div className="gallery-filter" role="tablist">
              {[{ label: 'Tất cả', index: ALL }, ...albums.map((a, index) => ({ label: a.label, index }))].map(
                (chip) => (
                  <button
                    key={chip.index}
                    type="button"
                    role="tab"
                    aria-selected={filter === chip.index}
                    className={filter === chip.index ? 'chip active' : 'chip'}
                    onClick={() => setFilter(chip.index)}
                  >
                    {chip.label}
                  </button>
                ),
              )}
            </div>
          )}
          {visible.map((album) => (
            <AlbumView
              key={album.url}
              album={album}
              onOpen={(images, index) => setViewer({ images, index })}
            />
          ))}
        </>
      )}

      {viewer && (
        <Lightbox
          images={viewer.images}
          index={viewer.index}
          onIndex={setViewerIndex}
          onClose={closeViewer}
        />
      )}
    </div>
  )
}
