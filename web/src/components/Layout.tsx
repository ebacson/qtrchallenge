import { useEffect, useId, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { brandLogoSrc, brandTitle } from '../lib/brand'

const tabs = [
  { to: '/', label: 'Home', end: true },
  { to: '/challenges', label: 'Thử thách' },
  { to: '/events', label: 'Sự kiện' },
  { to: '/hall-of-fame', label: 'Bảng vàng' },
  { to: '/profile', label: 'Hồ sơ' },
]

const menuItems = [
  { to: '/', label: 'Home', end: true },
  { to: '/challenges', label: 'Thử thách' },
  { to: '/activities', label: 'Hoạt động' },
  { to: '/rewards', label: 'Thưởng - Phạt' },
  { to: '/events', label: 'Sự kiện' },
  { to: '/hall-of-fame', label: 'Bảng vàng' },
  { to: '/notifications', label: 'Thông báo' },
  { to: '/members', label: 'Thành viên' },
  { to: '/stats', label: 'Thống kê' },
  { to: '/profile', label: 'Hồ sơ' },
]

export function Layout() {
  const { profile, logout } = useAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const navMenuItems = profile?.admin
    ? [
        ...menuItems.slice(0, 2),
        { to: '/admin/challenges/new', label: 'Tạo thử thách' },
        { to: '/admin/users', label: 'Quản lý thành viên' },
        { to: '/admin/records', label: 'Xác thực thành tích' },
        ...menuItems.slice(2),
      ]
    : menuItems

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!menuOpen) return

    function onPointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-menu" ref={menuRef}>
          <button
            type="button"
            className={`brand-mark brand-trigger${menuOpen ? ' open' : ''}`}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-haspopup="menu"
            aria-label="Mở menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <img src={brandLogoSrc} alt="" className="brand-logo" />
            <p className="brand-name">{brandTitle}</p>
          </button>

          {menuOpen && (
            <nav id={menuId} className="brand-dropdown" aria-label="Menu chức năng">
              <ul className="brand-menu-list" role="menu">
                {navMenuItems.map((item) => (
                  <li key={item.to} role="none">
                    <NavLink
                      to={item.to}
                      end={item.end}
                      role="menuitem"
                      className={({ isActive }) =>
                        isActive ? 'brand-menu-link active' : 'brand-menu-link'
                      }
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="brand-menu-logout"
                role="menuitem"
                onClick={() => void logout()}
              >
                Đăng xuất
              </button>
            </nav>
          )}
        </div>

        <div className="topbar-right">
          {profile && (
            <span className="user-chip">
              {profile.fullName || profile.email || 'Runner'}
              {profile.admin && <span className="admin-badge prominent">Admin</span>}
              {profile.level > 0 && (
                <span
                  className={`level-badge level-${profile.level >= 16 ? 'platinum' : profile.level >= 11 ? 'gold' : profile.level >= 6 ? 'silver' : 'bronze'}`}
                >
                  Lv {profile.level}
                </span>
              )}
            </span>
          )}
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
