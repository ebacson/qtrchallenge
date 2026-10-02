import { useState, type ComponentType, type ReactNode } from 'react'
import {
  Activity,
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
  Medal,
  Trophy,
} from 'lucide-react'
import { brandLogoSrc, brandTitle } from '../lib/brand'

type IconType = ComponentType<{ size?: number; 'aria-hidden'?: boolean }>

const HIGHLIGHTS: { icon: IconType; text: string }[] = [
  { icon: Trophy, text: 'Thử thách chạy bộ hằng tháng' },
  { icon: Activity, text: 'Tự động đồng bộ hoạt động từ Strava' },
  { icon: Medal, text: 'Bảng xếp hạng và vinh danh thành viên' },
]

/** Khung chung cho các màn đăng nhập, đăng ký, quên mật khẩu. */
export function AuthLayout({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string
  subtitle?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="auth-page">
      <div className="auth-atmosphere" aria-hidden />
      <div className="auth-shell">
        <aside className="auth-hero">
          <div className="auth-hero-brand">
            <img src={brandLogoSrc} alt="" className="auth-hero-logo" />
            <div>
              <p className="auth-hero-title">{brandTitle}</p>
              <p className="auth-hero-sub">Quảng Trị Runners</p>
            </div>
          </div>
          <ul className="auth-hero-list">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text}>
                <span className="auth-hero-icon">
                  <Icon size={18} aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
          <p className="auth-hero-foot">Chạy cùng nhau, mạnh mẽ hơn mỗi ngày.</p>
        </aside>

        <main className="auth-card">
          <header className="auth-card-head">
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </header>
          {children}
          {footer && <p className="auth-footer">{footer}</p>}
        </main>
      </div>
    </div>
  )
}

/** Ô nhập có biểu tượng bên trái; type="password" có nút hiện/ẩn mật khẩu. */
export function AuthField({
  label,
  icon: Icon,
  type = 'text',
  value,
  onChange,
  autoComplete,
  required,
  minLength,
  autoFocus,
  placeholder,
}: {
  label: string
  icon: IconType
  type?: 'text' | 'email' | 'password'
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  required?: boolean
  minLength?: number
  autoFocus?: boolean
  placeholder?: string
}) {
  const [visible, setVisible] = useState(false)
  const isPassword = type === 'password'
  return (
    <label className="auth-field">
      <span className="auth-field-label">{label}</span>
      <span className="auth-input">
        <span className="auth-input-icon">
          <Icon size={18} aria-hidden />
        </span>
        <input
          type={isPassword && visible ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          autoFocus={autoFocus}
          placeholder={placeholder}
        />
        {isPassword && (
          <button
            type="button"
            className="auth-input-toggle"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          >
            {visible ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
          </button>
        )}
      </span>
    </label>
  )
}

export function AuthAlert({ kind, children }: { kind: 'error' | 'success'; children: ReactNode }) {
  const Icon = kind === 'error' ? CircleAlert : CircleCheck
  return (
    <div className={`auth-alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden />
      <span>{children}</span>
    </div>
  )
}
