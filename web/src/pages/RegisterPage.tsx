import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Lock, Mail, User } from 'lucide-react'
import { AuthAlert, AuthField, AuthLayout } from '../components/AuthLayout'
import { useAuth } from '../context/AuthContext'
import { createUser } from '../lib/userWrites'

function registerErrorMessage(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  if (code === 'auth/email-already-in-use') {
    return 'Email này đã được đăng ký. Hãy đăng nhập hoặc dùng chức năng Quên mật khẩu.'
  }
  if (code === 'auth/invalid-email') return 'Email không hợp lệ.'
  if (code === 'auth/weak-password') return 'Mật khẩu quá yếu, cần ít nhất 6 ký tự.'
  if (code === 'auth/network-request-failed') return 'Không có kết nối mạng. Vui lòng thử lại.'
  if (code === 'auth/too-many-requests') return 'Thao tác quá nhiều lần. Vui lòng thử lại sau.'
  return 'Đăng ký thất bại. Vui lòng thử lại.'
}

export function RegisterPage() {
  const { user, loading, register } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!loading && user) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('Mật khẩu nhập lại không khớp.')
      return
    }
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
      setError(registerErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Tạo tài khoản"
      subtitle="Tham gia cộng đồng Quảng Trị Runners chỉ trong vài giây."
      footer={
        <>
          Đã có tài khoản? <Link to="/login">Đăng nhập</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={onSubmit}>
        <AuthField
          label="Họ tên"
          icon={User}
          autoComplete="name"
          placeholder="Nguyễn Văn A"
          value={fullName}
          onChange={setFullName}
          required
        />
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
        <AuthField
          label="Mật khẩu"
          icon={Lock}
          type="password"
          autoComplete="new-password"
          placeholder="Ít nhất 6 ký tự"
          value={password}
          onChange={setPassword}
          minLength={6}
          required
        />
        <AuthField
          label="Nhập lại mật khẩu"
          icon={Lock}
          type="password"
          autoComplete="new-password"
          placeholder="Nhập lại mật khẩu"
          value={confirm}
          onChange={setConfirm}
          minLength={6}
          required
        />

        {error && <AuthAlert kind="error">{error}</AuthAlert>}

        <button type="submit" className="btn primary wide auth-submit" disabled={busy}>
          {busy ? 'Đang tạo tài khoản…' : 'Đăng ký'}
        </button>
      </form>
    </AuthLayout>
  )
}
