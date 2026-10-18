import { onDisconnect, onValue, ref, remove, set } from 'firebase/database'
import { db } from './firebase'

export const PRESENCE_PATH = 'presence'

/**
 * Theo dõi online: khi còn kết nối RTDB thì ghi `presence/{uid}`,
 * mất kết nối / đóng tab thì `onDisconnect` tự xóa.
 * Gọi hàm trả về để dừng (logout).
 */
export function startPresence(uid: string): () => void {
  const statusRef = ref(db, `${PRESENCE_PATH}/${uid}`)
  const connectedRef = ref(db, '.info/connected')
  let stopped = false

  const unsub = onValue(connectedRef, (snap) => {
    if (stopped || snap.val() !== true) return
    void onDisconnect(statusRef)
      .remove()
      .then(() => {
        if (stopped) return
        return set(statusRef, { at: Date.now() })
      })
      .catch((err) => {
        console.warn('presence set failed', err)
      })
  })

  return () => {
    stopped = true
    unsub()
    void onDisconnect(statusRef)
      .cancel()
      .catch(() => {})
    void remove(statusRef).catch(() => {})
  }
}
