import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { HomePage } from './pages/HomePage'
import { RequireAdmin } from './components/RequireAdmin'
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt'
import { brandLogoSrc, brandTitle } from './lib/brand'

/** Mỗi trang một chunk riêng; trang nằm trong named export. */
function lazyPage<M extends Record<string, unknown>>(
  load: () => Promise<M>,
  name: keyof M,
) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }))
}

const RegisterPage = lazyPage(() => import('./pages/RegisterPage'), 'RegisterPage')
const ChallengesPage = lazyPage(() => import('./pages/ChallengesPage'), 'ChallengesPage')
const ChallengeDetailPage = lazyPage(
  () => import('./pages/ChallengeDetailPage'),
  'ChallengeDetailPage',
)
const ActivitiesPage = lazyPage(() => import('./pages/ActivitiesPage'), 'ActivitiesPage')
const ProfilePage = lazyPage(() => import('./pages/ProfilePage'), 'ProfilePage')
const StravaPage = lazyPage(() => import('./pages/StravaPage'), 'StravaPage')
const StravaCallbackPage = lazyPage(() => import('./pages/StravaPage'), 'StravaCallbackPage')
const HallOfFamePage = lazyPage(() => import('./pages/HallOfFamePage'), 'HallOfFamePage')
const AthletePrPage = lazyPage(() => import('./pages/AthletePrPage'), 'AthletePrPage')
const NotificationsPage = lazyPage(
  () => import('./pages/NotificationsPage'),
  'NotificationsPage',
)
const MembersPage = lazyPage(() => import('./pages/MembersPage'), 'MembersPage')
const EventsPage = lazyPage(() => import('./pages/EventsPage'), 'EventsPage')
const EventDetailPage = lazyPage(() => import('./pages/EventsPage'), 'EventDetailPage')
const StatsPage = lazyPage(() => import('./pages/StatsPage'), 'StatsPage')
const RewardsPage = lazyPage(() => import('./pages/RewardsPage'), 'RewardsPage')
const SupportPage = lazyPage(() => import('./pages/SupportPage'), 'SupportPage')
const GalleryPage = lazyPage(() => import('./pages/GalleryPage'), 'GalleryPage')
const CreateChallengePage = lazyPage(
  () => import('./pages/CreateChallengePage'),
  'CreateChallengePage',
)
const EditChallengePage = lazyPage(
  () => import('./pages/CreateChallengePage'),
  'EditChallengePage',
)
const AdminUsersPage = lazyPage(() => import('./pages/AdminUsersPage'), 'AdminUsersPage')
const AdminRecordsPage = lazyPage(() => import('./pages/AdminRecordsPage'), 'AdminRecordsPage')
const FinancePage = lazyPage(() => import('./pages/FinancePage'), 'FinancePage')

function BootScreen() {
  return (
    <div className="boot-screen">
      <img src={brandLogoSrc} alt="" className="brand-logo boot-logo" />
      <p className="brand-name">{brandTitle}</p>
      <p className="muted">Đang tải…</p>
    </div>
  )
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <BootScreen />
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
        <Route path="activities/:uid" element={<ActivitiesPage />} />
        <Route path="challenges" element={<ChallengesPage />} />
        <Route path="challenges/:id" element={<ChallengeDetailPage />} />
        <Route
          path="admin/challenges/new"
          element={
            <RequireAdmin>
              <CreateChallengePage />
            </RequireAdmin>
          }
        />
        <Route
          path="admin/challenges/:id/edit"
          element={
            <RequireAdmin>
              <EditChallengePage />
            </RequireAdmin>
          }
        />
        <Route
          path="admin/users"
          element={
            <RequireAdmin>
              <AdminUsersPage />
            </RequireAdmin>
          }
        />
        <Route
          path="admin/records"
          element={
            <RequireAdmin>
              <AdminRecordsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="finance"
          element={
            <RequireAdmin>
              <FinancePage />
            </RequireAdmin>
          }
        />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/:eventId" element={<EventDetailPage />} />
        <Route path="hall-of-fame" element={<HallOfFamePage />} />
        <Route path="hall-of-fame/:uid" element={<AthletePrPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="rewards" element={<RewardsPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="gallery" element={<GalleryPage />} />
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
      <Suspense fallback={<BootScreen />}>
        <AppRoutes />
      </Suspense>
      <PwaUpdatePrompt />
    </AuthProvider>
  )
}
