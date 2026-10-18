import { useState } from 'react'
import { Bell, BellOff, Smartphone } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  FCM_TOKENS_PATH,
  isIOS,
  isPWAInstalled,
  subscribeUser,
  unsubscribeUser,
} from '../lib/pushNotifications'
import { useSharedValue } from '../lib/sharedValue'

function browserPushStatus(): 'unsupported' | 'ios-install' | 'denied' | 'allowed' | 'default' {
  if (typeof window === 'undefined') return 'unsupported'
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported'
  if (isIOS() && !isPWAInstalled()) return 'ios-install'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission === 'granted') return 'allowed'
  return 'default'
}

function hasAnyToken(raw: unknown): boolean {
  return Boolean(raw && typeof raw === 'object' && Object.keys(raw as object).length > 0)
}

export function EnablePushNotifications() {
  const { user } = useAuth()
  const tokens = useSharedValue(user ? `${FCM_TOKENS_PATH}/${user.uid}` : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const browser = browserPushStatus()
  const subscribed = hasAnyToken(tokens)
  const loadingTokens = Boolean(user) && tokens === undefined

  async function enable() {
    if (!user) return
    setBusy(true)
    setError('')
    try {
      await subscribeUser(user.uid)
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
    try {
      await unsubscribeUser(user.uid)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tắt được')
    } finally {
      setBusy(false)
    }
  }

  if (!user || browser === 'unsupported') {
    return (
      <section className="section panel">
        <h2>Thông báo</h2>
        <p className="tiny muted">
          Nhận nhắc đúng lúc — thách đấu, thử thách, quỹ & tin CLB — ngay cả khi bạn không mở app.
        </p>
        <p className="tiny muted">Trình duyệt hoặc thiết bị này không hỗ trợ thông báo.</p>
      </section>
    )
  }

  return (
    <section className="section panel push-notify-panel">
      <h2>Thông báo</h2>
      <p className="tiny muted push-benefit">
        Nhận nhắc đúng lúc — thách đấu, thử thách, quỹ & tin CLB — ngay cả khi bạn không mở app.
      </p>
      {browser === 'ios-install' && (
        <p className="lede tiny">
          <Smartphone size={16} aria-hidden className="push-inline-icon" />
          Trên iPhone/iPad: bấm <strong>Chia sẻ</strong> → <strong>Thêm vào MH chính</strong>, rồi mở
          app từ icon đó để bật thông báo.
        </p>
      )}
      {browser === 'denied' && (
        <p className="lede tiny">
          Quyền thông báo đang bị chặn. Mở Cài đặt trình duyệt / hệ thống → Thông báo → cho phép QTR
          Challenge, rồi tải lại trang.
        </p>
      )}
      {browser !== 'ios-install' && browser !== 'denied' && (
        <>
          {loadingTokens ? (
            <p className="tiny muted">Đang kiểm tra…</p>
          ) : subscribed ? (
            <div className="btn-row">
              <span className="tiny">Đã bật</span>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => void disable()}>
                <BellOff size={16} aria-hidden /> {busy ? 'Đang tắt…' : 'Tắt'}
              </button>
            </div>
          ) : (
            <button type="button" className="btn primary" disabled={busy} onClick={() => void enable()}>
              <Bell size={16} aria-hidden /> {busy ? 'Đang bật…' : 'Bật'}
            </button>
          )}
        </>
      )}
      {error && <p className="form-error">{error}</p>}
    </section>
  )
}
