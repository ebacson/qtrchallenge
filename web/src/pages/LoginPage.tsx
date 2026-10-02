import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ArrowLeft, Lock, Mail } from 'lucide-react'
import { AuthAlert, AuthField, AuthLayout } from '../components/AuthLayout'
import { useAuth } from '../context/AuthContext'

const INVALID_LOGIN_CODES = new Set([
  'auth/invalid-credential',
  'auth/invalid-login-credentials',
  'auth/user-not-found',
  'auth/wrong-password',
  'auth/invalid-email',
])

function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : ''
}

function loginErrorMessage(err: unknown): string {
  const code = errorCode(err)
  if (INVALID_LOGIN_CODES.has(code)) {
    return 'Tài khoản email không tồn tại hoặc mật khẩu không đúng.'
  }
  if (code === 'auth/too-many-requests') {
    return 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau.'
  }
  if (code === 'auth/network-request-failed') {
    return 'Không có kết nối mạng. Vui lòng thử lại.'
  }
  return 'Đăng nhập thất bại'
}

function resetErrorMessage(err: unknown): string {
  const code = errorCode(err)
  if (code === 'auth/invalid-email' || code === 'auth/missing-email') {
    return 'Email không hợp lệ.'
  }
  if (code === 'auth/user-not-found') {
    return 'Không tìm thấy tài khoản với email này.'
  }
  if (code === 'auth/too-many-requests') {
    return 'Gửi yêu cầu quá nhiều lần. Vui lòng thử lại sau ít phút.'
  }
  if (code === 'auth/network-request-failed') {
    return 'Không có kết nối mạng. Vui lòng thử lại.'
  }
  return 'Không gửi được email đặt lại mật khẩu. Vui lòng thử lại.'
}

const registerFooter = (
  <>
    Chưa có tài khoản? <Link to="/register">Đăng ký ngay</Link>
  </>
)

export function LoginPage() {
  const { user, loading, login, resetPassword } = useAuth()
  const [mode, setMode] = useState<'login' | 'forgot'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [busy, setBusy] = useState(false)

  if (!loading && user) return <Navigate to="/" replace />

  function switchMode(next: 'login' | 'forgot') {
    setMode(next)
    setError('')
    setSentTo('')
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email, password)
    } catch (err) {
      setError(loginErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onForgot(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSentTo('')
    setBusy(true)
    try {
      await resetPassword(email)
      setSentTo(email.trim())
    } catch (err) {
      setError(resetErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'forgot') {
    return (
      <AuthLayout
        title="Quên mật khẩu"
        subtitle="Nhập email đã đăng ký, chúng tôi sẽ gửi liên kết để bạn đặt mật khẩu mới."
        footer={registerFooter}
      >
        <form className="auth-form" onSubmit={onForgot}>
          <AuthField
            label="Email"
            icon={Mail}
            type="email"
            autoComplete="email"
            placeholder="ban@email.com"
            value={email}
            onChange={setEmail}
            required
            autoFocus
          />

          {error && <AuthAlert kind="error">{error}</AuthAlert>}
          {sentTo && (
            <AuthAlert kind="success">
              Đã gửi email tới <strong>{sentTo}</strong>. Mở thư và bấm vào liên kết để đặt mật
              khẩu mới (nếu không thấy, hãy kiểm tra mục Spam/Quảng cáo).
            </AuthAlert>
          )}

          <button type="submit" className="btn primary wide auth-submit" disabled={busy}>
            {busy ? 'Đang gửi…' : sentTo ? 'Gửi lại email' : 'Gửi liên kết đặt lại'}
          </button>
          <button type="button" className="auth-back" onClick={() => switchMode('login')}>
            <ArrowLeft size={16} aria-hidden /> Quay lại đăng nhập
          </button>
        </form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Đăng nhập"
      subtitle="Chào mừng trở lại! Đăng nhập để tiếp tục thử thách."
      footer={registerFooter}
    >
      <form className="auth-form" onSubmit={onLogin}>
        <AuthField
          label="Email"
          icon={Mail}
          type="email"
          autoComplete="email"
          placeholder="ban@email.com"
          value={email}
          onChange={setEmail}
          required
        />
        <div className="auth-field-group">
          <AuthField
            label="Mật khẩu"
            icon={Lock}
            type="password"
            autoComplete="current-password"
            placeholder="Nhập mật khẩu"
            value={password}
            onChange={setPassword}
            required
          />
          <button type="button" className="auth-link" onClick={() => switchMode('forgot')}>
            Quên mật khẩu?
          </button>
        </div>

        {error && <AuthAlert kind="error">{error}</AuthAlert>}

        <button type="submit" className="btn primary wide auth-submit" disabled={busy}>
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
    </AuthLayout>
  )
}
