/**
 * Đọc ảnh trong thư mục Google Drive công khai ("Bất kỳ ai có đường liên kết") bằng Drive API v3
 * với API key trình duyệt. Project Google Cloud của key cần bật Google Drive API.
 */
const API_KEY =
  ((import.meta.env.VITE_GOOGLE_API_KEY as string | undefined) ||
    (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined) ||
    '').trim()

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const MAX_DEPTH = 3

export type DriveImage = {
  id: string
  name: string
  /** ms, theo thời điểm chụp (nếu có) hoặc thời điểm tải lên */
  time: number
}

export function parseDriveFolderId(input: string): string | null {
  const value = input.trim()
  const folder = /\/folders\/([\w-]{10,})/.exec(value)
  if (folder) return folder[1]
  const query = /[?&]id=([\w-]{10,})/.exec(value)
  if (query) return query[1]
  return /^[\w-]{20,}$/.test(value) ? value : null
}

export function driveThumbUrl(id: string, width: number): string {
  return `https://drive.google.com/thumbnail?id=${id}&sz=w${width}`
}

export function driveFileUrl(id: string): string {
  return `https://drive.google.com/file/d/${id}/view`
}

export function driveFolderUrl(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`
}

export function driveEmbedUrl(id: string): string {
  return `https://drive.google.com/embeddedfolderview?id=${id}#grid`
}

/** "2024:10:01 07:30:00" (EXIF) → ms */
function exifTimeMs(value: unknown): number {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(value ?? ''))
  if (!m) return 0
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5], +m[6])
}

type DriveFile = {
  id: string
  name: string
  mimeType: string
  createdTime?: string
  imageMediaMetadata?: { time?: string }
}

async function listChildren(folderId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and (mimeType contains 'image/' or mimeType = '${FOLDER_MIME}')`,
      fields: 'nextPageToken,files(id,name,mimeType,createdTime,imageMediaMetadata(time))',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      key: API_KEY,
    })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`)
    const body = (await res.json().catch(() => ({}))) as {
      files?: DriveFile[]
      nextPageToken?: string
      error?: { message?: string }
    }
    if (!res.ok) throw new Error(body.error?.message || `Drive API lỗi ${res.status}`)
    files.push(...(body.files ?? []))
    pageToken = body.nextPageToken ?? ''
  } while (pageToken)
  return files
}

async function collectImages(folderId: string, depth: number, out: DriveImage[]): Promise<void> {
  const children = await listChildren(folderId)
  const subfolders: string[] = []
  for (const f of children) {
    if (f.mimeType === FOLDER_MIME) {
      subfolders.push(f.id)
      continue
    }
    out.push({
      id: f.id,
      name: f.name,
      time: exifTimeMs(f.imageMediaMetadata?.time) || Date.parse(f.createdTime ?? '') || 0,
    })
  }
  if (depth < MAX_DEPTH) {
    for (const id of subfolders) await collectImages(id, depth + 1, out)
  }
}

const cache = new Map<string, Promise<DriveImage[]>>()

/** Ảnh trong thư mục (gồm thư mục con tới MAX_DEPTH cấp), mới nhất trước. Có cache theo phiên. */
export function listDriveImages(folderId: string): Promise<DriveImage[]> {
  if (!API_KEY) return Promise.reject(new Error('Chưa cấu hình API key Google'))
  let pending = cache.get(folderId)
  if (!pending) {
    pending = (async () => {
      const out: DriveImage[] = []
      await collectImages(folderId, 1, out)
      return out.sort((a, b) => b.time - a.time || a.name.localeCompare(b.name))
    })()
    pending.catch(() => cache.delete(folderId))
    cache.set(folderId, pending)
  }
  return pending
}
