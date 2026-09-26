import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from 'firebase/storage'
import { storage } from './firebase'

const AVATAR_SIZE = 400
const UPLOAD_TIMEOUT_MS = 25_000

const CLOUDINARY_CLOUD = 'qtrchallenge'
const CLOUDINARY_PRESET = 'qtr_avatars'

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} quá thời gian (${Math.round(ms / 1000)}s).`))
    }, ms)
    promise.then(
      (v) => {
        window.clearTimeout(timer)
        resolve(v)
      },
      (err) => {
        window.clearTimeout(timer)
        reject(err)
      },
    )
  })
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Không đọc được ảnh'))
      el.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Crop center-square and resize to 400×400 JPEG. */
export async function prepareAvatarBlob(file: File): Promise<Blob> {
  let width = 0
  let height = 0
  let draw: (ctx: CanvasRenderingContext2D, sx: number, sy: number, side: number) => void

  try {
    const bitmap = await createImageBitmap(file)
    width = bitmap.width
    height = bitmap.height
    draw = (ctx, sx, sy, side) => {
      ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
      bitmap.close()
    }
  } catch {
    const img = await loadImageElement(file)
    width = img.naturalWidth
    height = img.naturalHeight
    draw = (ctx, sx, sy, side) => {
      ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
    }
  }

  const side = Math.min(width, height)
  if (side <= 0) throw new Error('Ảnh không hợp lệ')
  const sx = (width - side) / 2
  const sy = (height - side) / 2

  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Không tạo được canvas')
  draw(ctx, sx, sy, side)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Không xuất được ảnh'))
      },
      'image/jpeg',
      0.9,
    )
  })
}

async function uploadAvatarToFirebase(uid: string, blob: Blob): Promise<string> {
  const path = `users/avatar/${uid}.jpg`
  const ref = storageRef(storage, path)
  await withTimeout(
    uploadBytes(ref, blob, { contentType: 'image/jpeg' }),
    UPLOAD_TIMEOUT_MS,
    'Firebase Storage',
  )
  return withTimeout(getDownloadURL(ref), 10_000, 'Lấy URL Firebase')
}

async function uploadAvatarToCloudinary(uid: string, blob: Blob): Promise<string> {
  const timestamp = Date.now()
  const publicId = `avatar_${uid}_${timestamp}`
  const form = new FormData()
  form.append('file', blob, `${publicId}.jpg`)
  form.append('upload_preset', CLOUDINARY_PRESET)
  form.append('folder', `avatars/${uid}`)
  form.append('public_id', publicId)

  const res = await withTimeout(
    fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, {
      method: 'POST',
      body: form,
    }),
    UPLOAD_TIMEOUT_MS,
    'Cloudinary',
  )

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Cloudinary lỗi ${res.status}: ${text.slice(0, 160)}`)
  }
  const data = (await res.json()) as { secure_url?: string; url?: string }
  const url = data.secure_url || data.url
  if (!url) throw new Error('Cloudinary không trả URL ảnh')
  return url
}

/** Upload avatar: thử Firebase Storage, fallback Cloudinary (như app). */
export async function uploadUserAvatar(uid: string, file: File): Promise<string> {
  const blob = await prepareAvatarBlob(file)

  try {
    return await uploadAvatarToFirebase(uid, blob)
  } catch (firebaseErr) {
    console.warn('Firebase avatar upload failed, trying Cloudinary:', firebaseErr)
    try {
      return await uploadAvatarToCloudinary(uid, blob)
    } catch (cloudErr) {
      const a = firebaseErr instanceof Error ? firebaseErr.message : String(firebaseErr)
      const b = cloudErr instanceof Error ? cloudErr.message : String(cloudErr)
      throw new Error(`Không tải được avatar.\nFirebase: ${a}\nCloudinary: ${b}`)
    }
  }
}
