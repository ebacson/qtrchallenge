import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging'
import { get, ref, remove, set } from 'firebase/database'
import { app, db } from './firebase'

export const FCM_TOKENS_PATH = 'fcm_tokens'

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** PWA đã thêm vào MH chính / cửa sổ standalone */
export function isPWAInstalled(): boolean {
  if (typeof window === 'undefined') return false
  const mq = window.matchMedia('(display-mode: standalone)').matches
  const iosStandalone = 'standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  return mq || iosStandalone
}

export async function isPushSupported(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return false
  try {
    return await isSupported()
  } catch {
    return false
  }
}

function vapidKey(): string {
  return (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined)?.trim() || ''
}

async function tokenId(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

async function swRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  return navigator.serviceWorker.ready.catch(() => undefined)
}

export async function currentPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!(await isPushSupported())) return 'unsupported'
  return Notification.permission
}

export async function hasStoredToken(uid: string): Promise<boolean> {
  const snap = await get(ref(db, `${FCM_TOKENS_PATH}/${uid}`))
  if (!snap.exists()) return false
  return Object.keys(snap.val() as Record<string, unknown>).length > 0
}

/** Xin quyền + lấy FCM token + lưu RTDB. Không gọi lúc load trang. */
export async function subscribeUser(uid: string): Promise<string> {
  if (!(await isPushSupported())) throw new Error('Trình duyệt không hỗ trợ thông báo đẩy.')
  if (isIOS() && !isPWAInstalled()) {
    throw new Error('Trên iPhone/iPad cần thêm web vào Màn hình chính rồi mở từ icon đó.')
  }
  const key = vapidKey()
  if (!key) throw new Error('Chưa cấu hình VITE_FIREBASE_VAPID_KEY.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Bạn đã từ chối quyền thông báo.')

  const reg = await swRegistration()
  if (!reg) throw new Error('Service worker chưa sẵn sàng. Tải lại trang rồi thử lại.')

  const messaging = getMessaging(app)
  const token = await getToken(messaging, { vapidKey: key, serviceWorkerRegistration: reg })
  if (!token) throw new Error('Không lấy được mã thiết bị.')

  const id = await tokenId(token)
  await set(ref(db, `${FCM_TOKENS_PATH}/${uid}/${id}`), {
    token,
    updatedAt: Date.now(),
    ua: navigator.userAgent.slice(0, 300),
    platform: 'web',
  })
  return token
}

export async function unsubscribeUser(uid: string): Promise<void> {
  const snap = await get(ref(db, `${FCM_TOKENS_PATH}/${uid}`))
  const rows = snap.val() as Record<string, { token?: string }> | null
  try {
    if (await isPushSupported()) {
      const messaging = getMessaging(app)
      await deleteToken(messaging).catch(() => {})
    }
  } catch {
    /* ignore */
  }
  if (rows) {
    await Promise.all(Object.keys(rows).map((id) => remove(ref(db, `${FCM_TOKENS_PATH}/${uid}/${id}`))))
  }
}

/** Khi app đang mở: hiện thông báo hệ thống nếu được phép */
export function listenForegroundMessages(onPayload?: (title: string, body: string) => void): () => void {
  let unsub = () => {}
  void (async () => {
    if (!(await isPushSupported())) return
    if (Notification.permission !== 'granted') return
    try {
      const messaging = getMessaging(app)
      unsub = onMessage(messaging, (payload) => {
        const title = payload.notification?.title || payload.data?.title || 'QTR Challenge'
        const body = payload.notification?.body || payload.data?.body || ''
        onPayload?.(title, body)
        if (Notification.permission === 'granted') {
          const url = payload.data?.url || '/notifications'
          const n = new Notification(title, { body, icon: '/icon-192.png', data: { url } })
          n.onclick = () => {
            window.focus()
            if (url.startsWith('/')) window.location.assign(url)
            n.close()
          }
        }
      })
    } catch {
      /* ignore */
    }
  })()
  return () => unsub()
}
