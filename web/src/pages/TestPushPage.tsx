import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { runAdminSendPush } from '../lib/adminSync'
import { EnablePushNotifications } from '../components/EnablePushNotifications'

export function TestPushPage() {
  const { user } = useAuth()
  const [title, setTitle] = useState('QTR Challenge — thử')
  const [body, setBody] = useState('Đây là thông báo thử. Đóng tab rồi xem có hiện không.')
  const [onlySelf, setOnlySelf] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setBusy(true)
    setError('')
    setResult('')
    try {
      const token = await user.getIdToken()
      const res = await runAdminSendPush(token, {
        title: title.trim(),
        body: body.trim(),
        url: '/notifications',
        onlySelf,
      })
      setResult(
        `Đã gửi: ${res.sent}/${res.devices} thiết bị thành công` +
          (res.failed ? `, lỗi ${res.failed}` : '') +
          (res.removed ? `, đã xóa ${res.removed} token hết hạn` : '') +
          '.',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gửi thất bại')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <Link className="back-link" to="/profile">
        ← Hồ sơ
      </Link>
      <header className="page-header">
        <h1>Thử thông báo</h1>
        <p className="lede">Admin gửi thử. Bật thông báo trên thiết bị này trước, rồi đóng tab và gửi.</p>
      </header>

      <EnablePushNotifications />

      <form className="auth-form panel" onSubmit={(e) => void onSubmit(e)}>
        <h2>Gửi thử</h2>
        <label>
          Tiêu đề
          <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          Nội dung
          <textarea rows={3} maxLength={300} value={body} onChange={(e) => setBody(e.target.value)} required />
        </label>
        <label className="admin-pr-verify">
          <input type="checkbox" checked={onlySelf} onChange={(e) => setOnlySelf(e.target.checked)} />
          Chỉ gửi cho thiết bị của tôi (an toàn khi thử)
        </label>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Đang gửi…' : 'Gửi thông báo thử'}
        </button>
        {error && <p className="form-error">{error}</p>}
        {result && <p className="form-info">{result}</p>}
      </form>
    </div>
  )
}
