import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { storage } from './firebase'

const AVATAR_SIZE = 400

/** Crop center-square and resize to 400×400 JPEG (giống iOS Profile). */
export async function prepareAvatarBlob(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2

  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Không tạo được canvas')

  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  bitmap.close()

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

export async function uploadUserAvatar(uid: string, file: File): Promise<string> {
  const blob = await prepareAvatarBlob(file)
  const path = `users/avatar/${uid}.jpg`
  const ref = storageRef(storage, path)
  await uploadBytes(ref, blob, { contentType: 'image/jpeg' })
  return getDownloadURL(ref)
}
