import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { HomePage } from './pages/HomePage'
import { ChallengesPage } from './pages/ChallengesPage'
import { ChallengeDetailPage } from './pages/ChallengeDetailPage'
import { ActivitiesPage } from './pages/ActivitiesPage'
import { ProfilePage } from './pages/ProfilePage'
import { StravaCallbackPage, StravaPage } from './pages/StravaPage'
import { HallOfFamePage } from './pages/HallOfFamePage'
import { AthletePrPage } from './pages/AthletePrPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { MembersPage } from './pages/MembersPage'
import { EventsPage, EventDetailPage } from './pages/EventsPage'
import { StatsPage } from './pages/StatsPage'
import type { ReactNode } from 'react'
import { brandLogoSrc, brandTitle } from './lib/brand'

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="boot-screen">
        <img src={brandLogoSrc} alt="" className="brand-logo boot-logo" />
        <p className="brand-name">{brandTitle}</p>
        <p className="muted">Đang tải…</p>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="activities" element={<ActivitiesPage />} />
        <Route path="challenges" element={<ChallengesPage />} />
        <Route path="challenges/:id" element={<ChallengeDetailPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/:eventId" element={<EventDetailPage />} />
        <Route path="hall-of-fame" element={<HallOfFamePage />} />
        <Route path="hall-of-fame/:uid" element={<AthletePrPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="strava" element={<StravaPage />} />
        <Route path="strava/callback" element={<StravaCallbackPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
