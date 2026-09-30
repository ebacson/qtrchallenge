import { useState } from 'react'
import { X } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'

const UPDATE_CHECK_MS = 30 * 60 * 1000

export function PwaUpdatePrompt() {
  const [updating, setUpdating] = useState(false)
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return
      const check = () => {
        if (navigator.onLine) void reg.update().catch(() => {})
      }
      setInterval(check, UPDATE_CHECK_MS)
      // iOS giữ trang trong bộ nhớ khi chuyển app, nên kiểm tra lại mỗi lần quay về
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    },
  })

  if (!needRefresh) return null

  return (
    <div className="pwa-update" role="status">
      <span>Có phiên bản mới</span>
      <button
        type="button"
        className="btn primary compact"
        disabled={updating}
        onClick={() => {
          setUpdating(true)
          void updateServiceWorker(true)
          setTimeout(() => window.location.reload(), 4000)
        }}
      >
        {updating ? 'Đang cập nhật…' : 'Cập nhật'}
      </button>
      <button
        type="button"
        className="pwa-update-close"
        aria-label="Để sau"
        onClick={() => setNeedRefresh(false)}
      >
        <X size={18} aria-hidden />
      </button>
    </div>
  )
}
