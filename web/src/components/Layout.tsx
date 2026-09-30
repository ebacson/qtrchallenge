import { Suspense, useEffect, useId, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Activity,
  Bell,
  CalendarDays,
  CirclePlus,
  Flag,
  House,
  LogOut,
  ShieldCheck,
  Trophy,
  UserCog,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { brandLogoSrc, brandTitle } from '../lib/brand'

type MenuItem = { to: string; label: string; icon: LucideIcon; end?: boolean }
type MenuGroup = { key: string; title?: string; items: MenuItem[] }

const tabs: MenuItem[] = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/challenges', label: 'Thử thách', icon: Flag },
  { to: '/events', label: 'Sự kiện', icon: CalendarDays },
  { to: '/hall-of-fame', label: 'Bảng vàng', icon: Trophy },
  { to: '/profile', label: 'Hồ sơ', icon: UserRound },
]

const menuGroups: MenuGroup[] = [
  { key: 'home', items: [{ to: '/', label: 'Home', icon: House, end: true }] },
  {
    key: 'personal',
    title: 'Cá nhân',
    items: [
      { to: '/activities', label: 'Hoạt động', icon: Activity },
      { to: '/profile', label: 'Hồ sơ', icon: UserRound },
    ],
  },
  {
    key: 'club',
    title: 'Câu lạc bộ',
    items: [
      { to: '/notifications', label: 'Thông báo', icon: Bell },
      { to: '/challenges', label: 'Thử thách', icon: Flag },
      { to: '/events', label: 'Sự kiện', icon: CalendarDays },
      { to: '/members', label: 'Thành viên', icon: Users },
      { to: '/hall-of-fame', label: 'Bảng vàng', icon: Trophy },
      { to: '/rewards', label: 'Thưởng - Phạt', icon: Wallet },
    ],
  },
]

const adminGroup: MenuGroup = {
  key: 'admin',
  title: 'Admin',
  items: [
    { to: '/admin/challenges/new', label: 'Tạo thử thách', icon: CirclePlus },
    { to: '/admin/users', label: 'Quản lý thành viên', icon: UserCog },
    { to: '/admin/records', label: 'Xác thực thành tích', icon: ShieldCheck },
  ],
}

export function Layout() {
  const { profile, logout } = useAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const navGroups = profile?.admin ? [...menuGroups, adminGroup] : menuGroups

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
              {navGroups.map((group) => (
                <div
                  key={group.key}
                  className={`brand-menu-group ${group.key}`}
                  role="group"
                  aria-label={group.title}
                >
                  {group.title && (
                    <p className={`brand-menu-group-title ${group.key}`}>{group.title}</p>
                  )}
                  <ul className="brand-menu-list" role="menu">
                    {group.items.map((item) => (
                      <li key={item.to} role="none">
                        <NavLink
                          to={item.to}
                          end={item.end}
                          role="menuitem"
                          className={({ isActive }) =>
                            isActive ? 'brand-menu-link active' : 'brand-menu-link'
                          }
                        >
                          <item.icon className="menu-icon" size={18} strokeWidth={2} aria-hidden />
                          <span>{item.label}</span>
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <button
                type="button"
                className="brand-menu-logout"
                role="menuitem"
                onClick={() => void logout()}
              >
                <LogOut className="menu-icon" size={18} strokeWidth={2} aria-hidden />
                <span>Đăng xuất</span>
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
        <Suspense
          fallback={
            <div className="page">
              <p className="empty">Đang tải…</p>
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>

      <nav className="tabbar tabbar-5" aria-label="Điều hướng chính">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => (isActive ? 'tab active' : 'tab')}
          >
            <tab.icon className="tab-icon" size={20} strokeWidth={2} aria-hidden />
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
