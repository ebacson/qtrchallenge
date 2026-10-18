import { useState } from 'react'
import { Bell, BellOff, Smartphone } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  isIOS,
  isPWAInstalled,
  subscribeUser,
  unsubscribeUser,
} from '../lib/pushNotifications'

function syncPushStatus(hasUser: boolean): 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on' {
  if (!hasUser || typeof window === 'undefined') return 'unsupported'
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported'
  if (isIOS() && !isPWAInstalled()) return 'ios-install'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission === 'granted') return 'on'
  return 'off'
}

export function EnablePushNotifications() {
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  /** null = chưa thao tác trong phiên; đồng bộ lại sau bật/tắt */
  const [override, setOverride] = useState<'on' | 'off' | null>(null)
  const status = override ?? syncPushStatus(Boolean(user))

  async function enable() {
    if (!user) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await subscribeUser(user.uid)
      setOverride('on')
      setMessage('Đã bật thông báo đẩy.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không bật được thông báo')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    if (!user) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await unsubscribeUser(user.uid)
      setOverride('off')
      setMessage('Đã tắt thông báo đẩy trên thiết bị này.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tắt được')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'unsupported') {
    return (
      <section className="section panel">
        <h2>Thông báo đẩy</h2>
        <p className="tiny muted">Trình duyệt hoặc thiết bị này không hỗ trợ thông báo đẩy.</p>
      </section>
    )
  }

  return (
    <section className="section panel push-notify-panel">
      <h2>Thông báo đẩy</h2>
      {status === 'ios-install' && (
        <>
          <p className="lede tiny">
            <Smartphone size={16} aria-hidden className="push-inline-icon" />
            Trên iPhone/iPad: bấm <strong>Chia sẻ</strong> → <strong>Thêm vào MH chính</strong>, rồi mở
            app từ icon đó để bật thông báo.
          </p>
          <p className="tiny muted">Cần iOS 16.4 trở lên.</p>
        </>
      )}
      {status === 'denied' && (
        <p className="lede tiny">
          Quyền thông báo đang bị chặn. Mở Cài đặt trình duyệt / hệ thống → Thông báo → cho phép QTR
          Challenge, rồi tải lại trang.
        </p>
      )}
      {status === 'off' && (
        <>
          <p className="tiny muted">
            Nhận thông báo CLB ngay cả khi đã đóng tab (Firebase Cloud Messaging).
          </p>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void enable()}>
            <Bell size={16} aria-hidden /> {busy ? 'Đang bật…' : 'Bật thông báo'}
          </button>
        </>
      )}
      {status === 'on' && (
        <>
          <p className="tiny">
            Trình duyệt đã cho phép thông báo.
            {override === 'on' ? ' Thiết bị này đã đăng ký nhận.' : ' Bấm lưu lại nếu bạn chưa đăng ký thiết bị này.'}
          </p>
          <div className="btn-row">
            {override !== 'on' && (
              <button type="button" className="btn primary" disabled={busy} onClick={() => void enable()}>
                <Bell size={16} aria-hidden /> {busy ? 'Đang lưu…' : 'Lưu thiết bị này'}
              </button>
            )}
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void disable()}>
              <BellOff size={16} aria-hidden /> {busy ? 'Đang tắt…' : 'Tắt thông báo'}
            </button>
          </div>
        </>
      )}
      {error && <p className="form-error">{error}</p>}
      {message && <p className="form-info">{message}</p>}
    </section>
  )
}
