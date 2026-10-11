import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  signInWithEmailAndPassword,
  verifyPasswordResetCode,
} from 'firebase/auth'
import { ArrowLeft, Lock } from 'lucide-react'
import { AuthAlert, AuthField, AuthLayout } from '../components/AuthLayout'
import { auth } from '../lib/firebase'

/** Mã chỉ dùng được một lần: tránh áp dụng lại khi effect chạy hai lần (StrictMode) */
const appliedCodes = new Map<string, Promise<string>>()

function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : ''
}

function actionErrorMessage(err: unknown): string {
  const code = errorCode(err)
  if (code === 'auth/expired-action-code') {
    return 'Liên kết đã hết hạn. Vui lòng yêu cầu gửi lại email.'
  }
  if (code === 'auth/invalid-action-code') {
    return 'Liên kết không hợp lệ hoặc đã được sử dụng. Vui lòng yêu cầu gửi lại email.'
  }
  if (code === 'auth/user-disabled') return 'Tài khoản này đã bị khóa.'
  if (code === 'auth/user-not-found') return 'Tài khoản không còn tồn tại.'
  if (code === 'auth/weak-password') return 'Mật khẩu quá yếu, cần ít nhất 6 ký tự.'
  if (code === 'auth/too-many-requests') return 'Thao tác quá nhiều lần. Vui lòng thử lại sau.'
  if (code === 'auth/network-request-failed') return 'Không có kết nối mạng. Vui lòng thử lại.'
  return 'Không thực hiện được. Vui lòng thử lại.'
}

/** Áp dụng mã xác thực email / khôi phục email; trả về email liên quan (nếu có) */
function applyEmailCode(mode: string, code: string): Promise<string> {
  let job = appliedCodes.get(code)
  if (!job) {
    job =
      mode === 'recoverEmail'
        ? checkActionCode(auth, code).then(async (info) => {
            await applyActionCode(auth, code)
            return info.data.email ?? ''
          })
        : applyActionCode(auth, code).then(() => '')
    appliedCodes.set(code, job)
  }
  return job
}

const backToLogin = (
  <Link to="/login" className="auth-back">
    <ArrowLeft size={16} aria-hidden /> Về trang đăng nhập
  </Link>
)

/** Đặt lại mật khẩu: kiểm tra mã, nhập mật khẩu mới, rồi đăng nhập luôn */
function ResetPassword({ code }: { code: string }) {
  const navigate = useNavigate()
  const [email, setEmail] = useState<string | null>(null)
  const [loadError, setLoadError] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let alive = true
    verifyPasswordResetCode(auth, code)
      .then((addr) => alive && setEmail(addr))
      .catch((err) => alive && setLoadError(actionErrorMessage(err)))
    return () => {
      alive = false
    }
  }, [code])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Mật khẩu nhập lại không khớp.')
      return
    }
    setError('')
    setBusy(true)
    try {
      await confirmPasswordReset(auth, code, password)
    } catch (err) {
      setError(actionErrorMessage(err))
      setBusy(false)
      return
    }
    setDone(true)
    try {
      if (email) {
        await signInWithEmailAndPassword(auth, email, password)
        navigate('/', { replace: true })
        return
      }
    } catch {
      // Đổi mật khẩu đã xong; đăng nhập lại bằng tay ở trang đăng nhập
    }
    setBusy(false)
  }

  if (loadError) {
    return (
      <AuthLayout title="Đặt lại mật khẩu">
        <div className="auth-form">
          <AuthAlert kind="error">{loadError}</AuthAlert>
          {backToLogin}
        </div>
      </AuthLayout>
    )
  }

  if (email === null) {
    return (
      <AuthLayout title="Đặt lại mật khẩu">
        <p className="muted">Đang kiểm tra liên kết…</p>
      </AuthLayout>
    )
  }

  if (done && !busy) {
    return (
      <AuthLayout title="Đã đổi mật khẩu">
        <div className="auth-form">
          <AuthAlert kind="success">
            Mật khẩu của <strong>{email}</strong> đã được đổi. Hãy đăng nhập bằng mật khẩu mới.
          </AuthAlert>
          <Link to="/login" className="btn primary wide auth-submit">
            Đăng nhập
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Đặt lại mật khẩu"
      subtitle={
        <>
          Nhập mật khẩu mới cho tài khoản <strong>{email}</strong>.
        </>
      }
    >
      <form className="auth-form" onSubmit={(e) => void onSubmit(e)}>
        <AuthField
          label="Mật khẩu mới"
          icon={Lock}
          type="password"
          autoComplete="new-password"
          placeholder="Ít nhất 6 ký tự"
          value={password}
          onChange={setPassword}
          minLength={6}
          required
          autoFocus
        />
        <AuthField
          label="Nhập lại mật khẩu mới"
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
          {busy ? 'Đang lưu…' : 'Đổi mật khẩu'}
        </button>
        {backToLogin}
      </form>
    </AuthLayout>
  )
}

/** Xác thực email / khôi phục email: áp dụng mã ngay khi mở liên kết */
function EmailAction({ mode, code }: { mode: string; code: string }) {
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    applyEmailCode(mode, code)
      .then((email) => {
        if (!alive) return
        setResult({
          ok: true,
          text:
            mode === 'recoverEmail'
              ? `Đã khôi phục email đăng nhập về ${email || 'email cũ'}. Nếu bạn không yêu cầu đổi email, hãy đặt lại mật khẩu ngay.`
              : 'Email của bạn đã được xác thực.',
        })
      })
      .catch((err) => alive && setResult({ ok: false, text: actionErrorMessage(err) }))
    return () => {
      alive = false
    }
  }, [mode, code])

  const title = mode === 'recoverEmail' ? 'Khôi phục email' : 'Xác thực email'
  return (
    <AuthLayout title={title}>
      <div className="auth-form">
        {result ? (
          <AuthAlert kind={result.ok ? 'success' : 'error'}>{result.text}</AuthAlert>
        ) : (
          <p className="muted">Đang xử lý…</p>
        )}
        {backToLogin}
      </div>
    </AuthLayout>
  )
}

/**
 * Trang xử lý liên kết trong email của Firebase Auth (Action URL tùy chỉnh):
 * `/auth/action?mode=resetPassword|verifyEmail|verifyAndChangeEmail|recoverEmail&oobCode=…`
 */
export function AuthActionPage() {
  const [params] = useSearchParams()
  const mode = params.get('mode') ?? ''
  const code = params.get('oobCode') ?? ''

  if (code && mode === 'resetPassword') return <ResetPassword code={code} />
  if (code && (mode === 'verifyEmail' || mode === 'verifyAndChangeEmail' || mode === 'recoverEmail')) {
    return <EmailAction mode={mode} code={code} />
  }
  return (
    <AuthLayout title="Liên kết không hợp lệ">
      <div className="auth-form">
        <AuthAlert kind="error">
          Liên kết không đầy đủ hoặc không được hỗ trợ. Hãy mở lại liên kết trong email hoặc yêu cầu
          gửi lại.
        </AuthAlert>
        {backToLogin}
      </div>
    </AuthLayout>
  )
}
