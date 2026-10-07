import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { brandLogoSrc, brandTitle } from '../lib/brand'
import type { UserProfile } from '../types'

type Allow = (profile: UserProfile | null) => boolean

const isAdmin: Allow = (profile) => Boolean(profile?.admin)

export function RequireAdmin({ children, allow = isAdmin }: { children: ReactNode; allow?: Allow }) {
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

  if (!allow(profile)) {
    return <Navigate to="/" replace />
  }

  return children
}
