import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { brandLogoSrc, brandTitle } from '../lib/brand'
import { createUser } from '../lib/userWrites'

export function RegisterPage() {
  const { user, loading, register } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!loading && user) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const newUser = await register(email, password)
      await createUser(newUser.uid, {
        fullName: fullName.trim(),
        email: email.trim(),
        phone: '',
        gender: '',
        fullMarathonTime: '',
        halfMarathonTime: '',
        isFullMarathonVerified: false,
        isHalfMarathonVerified: false,
        dob: '',
        avatar: '',
        id_strava: '',
        user_strava: '',
        admin: false,
        member: false,
        level: 0,
        access_token: '',
        refresh_token: '',
      })
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng ký thất bại')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-atmosphere" aria-hidden />
      <div className="auth-panel">
        <img src={brandLogoSrc} alt="" className="brand-logo auth-logo" />
        <p className="brand-name hero-brand">{brandTitle}</p>
        <p className="auth-tagline">Tạo tài khoản</p>

        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            Họ tên
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Mật khẩu
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn primary wide" disabled={busy}>
            {busy ? 'Đang tạo…' : 'Đăng ký'}
          </button>
        </form>

        <p className="auth-footer">
          Đã có tài khoản? <Link to="/login">Đăng nhập</Link>
        </p>
      </div>
    </div>
  )
}
