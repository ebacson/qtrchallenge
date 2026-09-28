import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ref, update } from 'firebase/database'
import { StravaConnectPanel } from '../components/StravaConnectPanel'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import { consumeOAuthState, exchangeCode, fetchAthlete } from '../lib/stravaClient'

export function StravaCallbackPage() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Đang hoàn tất kết nối Strava…')

  useEffect(() => {
    if (!user) return
    const code = params.get('code')
    const state = params.get('state')
    const oauthError = params.get('error')
    const oauthErrorDesc = params.get('error_description')

    async function finish() {
      if (oauthError) {
        setError(
          `Strava từ chối: ${oauthError}${oauthErrorDesc ? ` — ${oauthErrorDesc}` : ''}`,
        )
        return
      }
      if (!code) {
        setError('Thiếu authorization code.')
        return
      }
      if (!consumeOAuthState(state)) {
        setError('OAuth state không hợp lệ (có thể CSRF). Thử kết nối lại.')
        return
      }

      try {
        setStatus('Đổi code lấy token trên server…')
        const tokens = await exchangeCode(code)
        const athlete =
          tokens.athlete ?? (await fetchAthlete(tokens.access_token))
        const userStrava = [athlete.firstname, athlete.lastname]
          .filter(Boolean)
          .join(' ')

        await update(ref(db, `users/${user!.uid}`), {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: tokens.expires_at,
          id_strava: String(athlete.id),
          user_strava: userStrava,
          // Do not store client_secret on the user node (Strava + security policy).
          client_secret: null,
        })

        setStatus('Đã kết nối. Đang chuyển…')
        navigate('/profile', { replace: true })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Kết nối thất bại')
      }
    }

    void finish()
  }, [user, params, navigate])

  return (
    <div className="page">
      <h1>Strava OAuth</h1>
      {error ? <p className="form-error">{error}</p> : <p className="muted">{status}</p>}
      <Link to="/profile">← Quay lại Profile</Link>
    </div>
  )
}

/** Tạm ẩn khỏi menu; thao tác Strava nằm trong Profile. */
export function StravaPage() {
  return (
    <div className="page">
      <header className="page-header">
        <h1>Strava Sync</h1>
      </header>
      <section className="section panel">
        <StravaConnectPanel />
      </section>
    </div>
  )
}
