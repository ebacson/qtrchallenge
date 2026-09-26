import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { brandLogoSrc, brandTitle } from '../lib/brand'

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
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại')
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
        <p className="auth-tagline">Club challenge · Strava</p>

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
          Chưa có tài khoản? Dùng app iOS/Android để đăng ký, hoặc{' '}
          <Link to="/register">đăng ký web</Link>.
        </p>
      </div>
    </div>
  )
}
