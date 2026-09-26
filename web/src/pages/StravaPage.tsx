import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { get, ref, update } from 'firebase/database'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import { syncOngoingChallengeProgress } from '../lib/challengeProgress'
import {
  consumeOAuthState,
  ensureFreshAccessToken,
  exchangeCode,
  fetchAthlete,
  fetchAthleteActivities,
  fetchStravaConfig,
  revokeToken,
  startStravaConnect,
  type StravaConfig,
} from '../lib/stravaClient'

type Connection = {
  access_token?: string
  refresh_token?: string
  expires_at?: number
  id_strava?: string
  user_strava?: string
}

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

    async function finish() {
      if (oauthError) {
        setError(`Strava từ chối: ${oauthError}`)
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
        navigate('/strava', { replace: true })
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
      <Link to="/strava">← Quay lại Sync</Link>
    </div>
  )
}

export function StravaPage() {
  const { user, profile } = useAuth()
  const [config, setConfig] = useState<StravaConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [syncedCount, setSyncedCount] = useState<number | null>(null)

  const isConnected = Boolean(profile?.id_strava || profile?.user_strava)

  useEffect(() => {
    void fetchStravaConfig()
      .then(setConfig)
      .catch((err: unknown) =>
        setConfig({
          configured: false,
          error: err instanceof Error ? err.message : 'Config error',
        }),
      )
  }, [])

  async function readConnection(): Promise<Connection> {
    if (!user) return {}
    const snap = await get(ref(db, `users/${user.uid}`))
    return (snap.val() ?? {}) as Connection
  }

  async function onConnect() {
    setError('')
    setMessage('')
    try {
      if (!config?.configured) {
        setError(config?.error || 'Chưa cấu hình Strava trên server.')
        return
      }
      await startStravaConnect()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không mở được OAuth')
    }
  }

  async function onSync() {
    if (!user) return
    setBusy(true)
    setError('')
    setMessage('')
    setSyncedCount(null)
    try {
      const conn = await readConnection()
      if (!conn.access_token || !conn.refresh_token) {
        throw new Error('Chưa kết nối Strava.')
      }

      const fresh = await ensureFreshAccessToken(
        conn.access_token,
        conn.refresh_token,
        Number(conn.expires_at ?? 0),
      )

      if (
        fresh.access_token !== conn.access_token ||
        fresh.refresh_token !== conn.refresh_token
      ) {
        await update(ref(db, `users/${user.uid}`), {
          access_token: fresh.access_token,
          refresh_token: fresh.refresh_token,
          expires_at: fresh.expires_at,
        })
      }

      const athlete = await fetchAthlete(fresh.access_token)
      await update(ref(db, `users/${user.uid}`), {
        id_strava: String(athlete.id),
        user_strava: [athlete.firstname, athlete.lastname].filter(Boolean).join(' '),
      })

      const activities = await fetchAthleteActivities(fresh.access_token)
      const updates: Record<string, string> = {}
      for (const a of activities) {
        const base = `strava_activities/${a.id}`
        updates[`${base}/id`] = a.id
        updates[`${base}/name`] = a.name
        updates[`${base}/distance`] = a.distance
        updates[`${base}/movingTime`] = a.movingTime
        updates[`${base}/elapsedTime`] = a.elapsedTime
        updates[`${base}/totalElevationGain`] = a.totalElevationGain
        updates[`${base}/type`] = a.type
        updates[`${base}/startDate`] = a.startDate
        updates[`${base}/averageCadence`] = a.averageCadence
        updates[`${base}/averageHeartrate`] = a.averageHeartrate
        updates[`${base}/maxHeartrate`] = a.maxHeartrate
        updates[`${base}/pace`] = a.pace
      }
      await update(ref(db, `users/${user.uid}`), updates)

      const progress = await syncOngoingChallengeProgress(user.uid, true)
      setSyncedCount(activities.length)
      setMessage(
        `Đã sync ${activities.length} activities` +
          (progress.didWrite
            ? `, cập nhật ${progress.updatedChallengeIds.length} thử thách.`
            : '.'),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync thất bại')
    } finally {
      setBusy(false)
    }
  }

  async function onDisconnect() {
    if (!user) return
    if (!window.confirm('Huỷ kết nối Strava?')) return
    setBusy(true)
    setError('')
    try {
      const conn = await readConnection()
      if (conn.access_token) {
        try {
          await revokeToken(conn.access_token)
        } catch {
          // Still clear local tokens if revoke fails
        }
      }
      await update(ref(db, `users/${user.uid}`), {
        access_token: null,
        refresh_token: null,
        expires_at: null,
        id_strava: '',
        user_strava: '',
        client_secret: null,
      })
      setMessage('Đã huỷ kết nối Strava.')
      setSyncedCount(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Huỷ kết nối thất bại')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Strava Sync</h1>
        <p className="lede">
          Kết nối trực tiếp với Strava (không qua intermediary). Token đổi trên server;
          API dùng <code>www.api-v3.strava.com</code> + header Authorization.
        </p>
      </header>

      <section className="section panel">
        <h2>Trạng thái</h2>
        {isConnected ? (
          <p>
            Đã kết nối:{' '}
            <strong>{profile?.user_strava || profile?.id_strava}</strong>
          </p>
        ) : (
          <p className="muted">Chưa kết nối Strava trên web.</p>
        )}
        {config && !config.configured && (
          <p className="form-error">
            {config.error ||
              'Thêm STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / STRAVA_REDIRECT_URI vào .env.local rồi restart dev server.'}
          </p>
        )}
        {config?.policyNotes && (
          <ul className="policy-list">
            {config.policyNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="section panel">
        <h2>Thao tác</h2>
        <div className="cta-row">
          <button
            type="button"
            className="btn primary"
            disabled={busy || isConnected || !config?.configured}
            onClick={() => void onConnect()}
          >
            {isConnected ? 'Đã kết nối' : 'Kết nối Strava'}
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={busy || !isConnected}
            onClick={() => void onSync()}
          >
            {busy ? 'Đang sync…' : 'Đồng bộ dữ liệu'}
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={busy || !isConnected}
            onClick={() => void onDisconnect()}
          >
            Huỷ kết nối
          </button>
        </div>
        {syncedCount != null && (
          <p className="tiny muted" style={{ marginTop: 12 }}>
            Lần sync gần nhất: {syncedCount} activities
          </p>
        )}
        {error && <p className="form-error">{error}</p>}
        {message && <p className="form-info">{message}</p>}
      </section>

      <section className="section panel">
        <h2>Strava Developer Program (tóm tắt)</h2>
        <ul className="policy-list">
          <li>
            <strong>Standard Tier</strong>: cần Strava subscription (dev mới từ 1/6/2026;
            existing từ 30/6/2026). Có thể self-upgrade tới ~10 athletes.
          </li>
          <li>
            <strong>Extended Access</strong>: không bắt buộc subscription; rate/limit cao hơn.
          </li>
          <li>
            Không dùng intermediary platform; echiptime gọi Strava trực tiếp.
          </li>
          <li>
            Từ 1/6/2027: bắt buộc base URL api-v3 + token trong header; app web đã tuân thủ.
          </li>
          <li>Không dùng Club endpoints (sắp deprecate 1/9/2026).</li>
        </ul>
        <p className="tiny muted">
          Redeem 3 tháng subscription (active Standard Tier): xem email Strava / API settings.
          Mã trong email: <code>5464f4e5b6</code>.
        </p>
      </section>
    </div>
  )
}
