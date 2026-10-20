import { onDisconnect, onValue, ref, remove, set } from 'firebase/database'
import { db } from './firebase'

export const PRESENCE_PATH = 'presence'

/** Cập nhật `at` để Admin có thể tự coi node quá cũ là offline (phòng node mồ côi) */
const HEARTBEAT_MS = 60_000
/** Node presence quá tuổi này được coi là offline */
export const PRESENCE_STALE_MS = 3 * 60_000

/**
 * Theo dõi online: khi còn kết nối RTDB thì ghi `presence/{uid}`,
 * mất kết nối / đóng tab thì `onDisconnect` tự xóa.
 * Hàm dừng trả về là async — lúc logout phải `await` nó TRƯỚC `signOut`,
 * vì sau khi mất auth, rules sẽ từ chối lệnh xóa presence.
 */
export function startPresence(uid: string): () => Promise<void> {
  const statusRef = ref(db, `${PRESENCE_PATH}/${uid}`)
  const connectedRef = ref(db, '.info/connected')
  let stopped = false
  let heartbeat: ReturnType<typeof setInterval> | null = null

  const stopHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
  }

  const unsub = onValue(connectedRef, (snap) => {
    if (stopped || snap.val() !== true) return
    void onDisconnect(statusRef)
      .remove()
      .then(() => {
        if (stopped) return
        stopHeartbeat()
        heartbeat = setInterval(() => {
          if (stopped) return
          void set(statusRef, { at: Date.now() }).catch((err) => {
            console.warn('presence heartbeat failed', err)
          })
        }, HEARTBEAT_MS)
        return set(statusRef, { at: Date.now() })
      })
      .catch((err) => {
        console.warn('presence set failed', err)
      })
  })

  return async () => {
    stopped = true
    stopHeartbeat()
    unsub()
    // Xóa node trước, hủy onDisconnect sau: nếu mất kết nối giữa chừng,
    // server vẫn tự xóa node thay vì để lại node mồ côi.
    try {
      await remove(statusRef)
    } catch (err) {
      console.warn('presence remove failed', err)
    }
    try {
      await onDisconnect(statusRef).cancel()
    } catch {
      /* best effort */
    }
  }
}
