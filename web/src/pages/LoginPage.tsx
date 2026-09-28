import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { brandLogoSrc, brandTitle } from '../lib/brand'

const INVALID_LOGIN_CODES = new Set([
  'auth/invalid-credential',
  'auth/invalid-login-credentials',
  'auth/user-not-found',
  'auth/wrong-password',
  'auth/invalid-email',
])

function loginErrorMessage(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code === 'string') {
    if (INVALID_LOGIN_CODES.has(code)) {
      return 'Tài khoản email không tồn tại hoặc mật khẩu không đúng.'
    }
    if (code === 'auth/too-many-requests') {
      return 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau.'
    }
    if (code === 'auth/network-request-failed') {
      return 'Không có kết nối mạng. Vui lòng thử lại.'
    }
  }
  return 'Đăng nhập thất bại'
}

export function LoginPage() {
  const { user, loading, login, resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  if (!loading && user) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    try {
      await login(email, password)
    } catch (err) {
      setError(loginErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onForgot() {
    if (!email.trim()) {
      setError('Nhập email trước khi đặt lại mật khẩu.')
      return
    }
    setError('')
    try {
      await resetPassword(email)
      setInfo('Đã gửi email đặt lại mật khẩu.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không gửi được email')
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-atmosphere" aria-hidden />
      <div className="auth-panel">
        <img src={brandLogoSrc} alt="" className="brand-logo auth-logo" />
        <p className="brand-name hero-brand">{brandTitle}</p>
        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Mật khẩu
            <div className="password-row">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="btn ghost compact"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? 'Ẩn' : 'Hiện'}
              </button>
            </div>
          </label>

          <button type="button" className="linkish" onClick={() => void onForgot()}>
            Quên mật khẩu?
          </button>

          {error && <p className="form-error">{error}</p>}
          {info && <p className="form-info">{info}</p>}

          <button type="submit" className="btn primary wide" disabled={busy}>
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>

        <p className="auth-footer">
          Chưa có tài khoản? <Link to="/register">Đăng ký</Link>.
        </p>
      </div>
    </div>
  )
}
