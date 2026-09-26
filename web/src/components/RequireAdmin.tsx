import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { brandLogoSrc, brandTitle } from '../lib/brand'

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="boot-screen">
        <img src={brandLogoSrc} alt="" className="brand-logo boot-logo" />
        <p className="brand-name">{brandTitle}</p>
        <p className="muted">Đang tải…</p>
      </div>
    )
  }

  if (!profile?.admin) {
    return <Navigate to="/" replace />
  }

  return children
}
