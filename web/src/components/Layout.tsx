import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const tabs = [
  { to: '/', label: 'Home', end: true },
  { to: '/activities', label: 'Activities' },
  { to: '/challenges', label: 'Challenges' },
  { to: '/strava', label: 'Strava' },
  { to: '/profile', label: 'Profile' },
]

export function Layout() {
  const { profile, logout } = useAuth()

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark">
          <span className="brand-dot" aria-hidden />
          <div>
            <p className="brand-name">QTR</p>
            <p className="brand-sub">echiptime</p>
          </div>
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
