import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { runAdminSendPush } from '../lib/adminSync'
import { DuelInvitePicker } from '../components/DuelInvitePicker'
import { EnablePushNotifications } from '../components/EnablePushNotifications'

type Audience = 'selected' | 'all'

export function TestPushPage() {
  const { user } = useAuth()
  const [title, setTitle] = useState('QTR Challenge')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<Audience>('selected')
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    if (audience === 'selected' && !selected.length) {
      setError('Chọn ít nhất một thành viên.')
      return
    }
    setBusy(true)
    setError('')
    setResult('')
    try {
      const token = await user.getIdToken()
      const res = await runAdminSendPush(token, {
        title: title.trim(),
        body: body.trim(),
        url: '/notifications',
        ...(audience === 'all' ? { broadcast: true } : { uids: selected }),
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
        <h1>Gửi thông báo</h1>
        <p className="lede">Gửi thông báo đẩy tới thành viên đã bật thông báo trên thiết bị.</p>
      </header>

      <EnablePushNotifications />

      <form className="auth-form panel" onSubmit={(e) => void onSubmit(e)}>
        <h2>Nội dung</h2>
        <label>
          Tiêu đề
          <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          Nội dung
          <textarea rows={3} maxLength={300} value={body} onChange={(e) => setBody(e.target.value)} required />
        </label>

        <fieldset className="push-audience">
          <legend>Người nhận</legend>
          <label className="admin-pr-verify">
            <input
              type="radio"
              name="audience"
              checked={audience === 'selected'}
              onChange={() => setAudience('selected')}
            />
            Chọn thành viên
          </label>
          <label className="admin-pr-verify">
            <input
              type="radio"
              name="audience"
              checked={audience === 'all'}
              onChange={() => setAudience('all')}
            />
            Tất cả người đã bật thông báo
          </label>
        </fieldset>

        {audience === 'selected' && (
          <DuelInvitePicker selected={selected} onChange={setSelected} exclude={[]} />
        )}

        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Đang gửi…' : 'Gửi thông báo'}
        </button>
        {error && <p className="form-error">{error}</p>}
        {result && <p className="form-info">{result}</p>}
      </form>
    </div>
  )
}
