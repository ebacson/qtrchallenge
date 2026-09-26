import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { brandLogoSrc, brandTitle } from '../lib/brand'

const tabs = [
  { to: '/', label: 'Home', end: true },
  { to: '/challenges', label: 'Challenge' },
  { to: '/events', label: 'Events' },
  { to: '/hall-of-fame', label: 'Bảng vàng' },
  { to: '/profile', label: 'Profile' },
]

export function Layout() {
  const { profile, logout } = useAuth()

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark">
          <img src={brandLogoSrc} alt="" className="brand-logo" />
          <p className="brand-name">{brandTitle}</p>
        </div>
        <div className="topbar-right">
          {profile && (
            <span className="user-chip">
              {profile.fullName || profile.email || 'Runner'}
              {profile.level > 0 && (
                <span
                  className={`level-badge level-${profile.level >= 16 ? 'platinum' : profile.level >= 11 ? 'gold' : profile.level >= 6 ? 'silver' : 'bronze'}`}
                >
                  Lv {profile.level}
                </span>
              )}
            </span>
          )}
          <button type="button" className="btn ghost" onClick={() => void logout()}>
            Đăng xuất
          </button>
        </div>
      </header>

      <main className="main-content">
        <Outlet />
      </main>

      <nav className="tabbar tabbar-5" aria-label="Điều hướng chính">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => (isActive ? 'tab active' : 'tab')}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
