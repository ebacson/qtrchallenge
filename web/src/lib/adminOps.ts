import { getDownloadURL, ref as storageRef, uploadBytes, deleteObject } from 'firebase/storage'
import { storage } from './firebase'

const DEFAULT_CHALLENGE_ICON =
  'https://firebasestorage.googleapis.com/v0/b/echiptime.firebasestorage.app/o/full_logo.png'

export { DEFAULT_CHALLENGE_ICON }

async function resizeImageBlob(
  file: File,
  maxSide: number,
  quality = 0.8,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Không tạo được canvas')
  }
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Không xuất được ảnh'))
      },
      'image/jpeg',
      quality,
    )
  })
}

export async function uploadChallengeIcon(file: File): Promise<string> {
  const blob = await resizeImageBlob(file, 800, 0.75)
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}`
  const path = `challenges/${id}.jpg`
  const ref = storageRef(storage, path)
  await uploadBytes(ref, blob, { contentType: 'image/jpeg' })
  return getDownloadURL(ref)
}

export async function deleteUserAvatar(uid: string): Promise<void> {
  try {
    await deleteObject(storageRef(storage, `users/avatar/${uid}.jpg`))
  } catch {
    // Avatar may not exist — ignore
  }
}

/** HTML month input (yyyy-MM) → first/last day as yyyy-MM-dd */
export function monthInputBounds(monthValue: string): {
  start: string
  end: string
} | null {
  const m = monthValue.match(/^(\d{4})-(\d{2})$/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (!year || month < 1 || month > 12) return null
  const lastDay = new Date(year, month, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDay)}`,
  }
}

export function currentMonthInputValue(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function todayInputValue(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** HTML date input (yyyy-MM-dd) → dd-MM-yyyy */
export function inputDateToChallengeDay(isoDay: string): string {
  const [y, m, d] = isoDay.split('-')
  if (!y || !m || !d) return ''
  return `${d}-${m}-${y}`
}
