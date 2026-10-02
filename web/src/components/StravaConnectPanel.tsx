import { useEffect, useState } from 'react'
import { get, ref, update } from 'firebase/database'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import { syncOngoingChallengeProgress } from '../lib/challengeProgress'
import { updateUser } from '../lib/userWrites'
import {
  ensureFreshAccessToken,
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
}

/** Trạng thái kết nối Strava + 3 nút Kết nối / Đồng bộ dữ liệu / Huỷ kết nối. */
export function StravaConnectPanel() {
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
    const base = `users/${user.uid}`
    const [access, refresh, expires] = await Promise.all([
      get(ref(db, `${base}/access_token`)),
      get(ref(db, `${base}/refresh_token`)),
      get(ref(db, `${base}/expires_at`)),
    ])
    return {
      access_token: access.val() ?? undefined,
      refresh_token: refresh.val() ?? undefined,
      expires_at: expires.val() ?? undefined,
    }
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
      await updateUser(user.uid, {
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
      await updateUser(user.uid, {
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
    <div className="strava-panel">
      {isConnected ? (
        <p className="body-text">
          Đã kết nối: <strong>{profile?.user_strava || profile?.id_strava}</strong>
        </p>
      ) : (
        <p className="body-text muted">Chưa kết nối Strava.</p>
      )}
      {config && !config.configured && (
        <p className="form-error">{config.error || 'Chưa cấu hình Strava trên server.'}</p>
      )}
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
    </div>
  )
}
