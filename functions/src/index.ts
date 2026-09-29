import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getDatabase } from 'firebase-admin/database'
import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { setGlobalOptions } from 'firebase-functions/v2'
import * as logger from 'firebase-functions/logger'
import { handleStravaRoute } from './stravaCore'
import { runFullSync, SyncAlreadyRunningError } from './syncAll'

setGlobalOptions({ region: 'us-central1', maxInstances: 10 })
initializeApp()

const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://ebacson.github.io',
  'https://quangtrirunners.online',
  'https://www.quangtrirunners.online',
  'https://quangtrirunners.io.vn',
  'https://www.quangtrirunners.io.vn',
])

function corsOrigin(origin: string | undefined): string | null {
  if (!origin) return null
  if (ALLOWED_ORIGINS.has(origin)) return origin
  return null
}

export const stravaApi = onRequest(
  {
    cors: false,
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async (req, res) => {
    try {
      const origin = corsOrigin(req.get('origin') || undefined)
      res.set('Vary', 'Origin')
      if (origin) {
        res.set('Access-Control-Allow-Origin', origin)
        res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      }

      if (req.method === 'OPTIONS') {
        res.status(204).send('')
        return
      }

      const env = {
        STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID,
        STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET,
        STRAVA_REDIRECT_URI: process.env.STRAVA_REDIRECT_URI,
      }

      const body =
        req.method === 'GET'
          ? {}
          : typeof req.body === 'object' && req.body
            ? (req.body as Record<string, unknown>)
            : {}

      const pathname = req.path || req.url?.split('?')[0] || '/'
      const result = await handleStravaRoute(req.method, pathname, body, env)
      res.status(result.status).json(result.body)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unhandled Strava API error'
      console.error('stravaApi unhandled', err)
      res.status(500).json({ error: message })
    }
  },
)

/** Đồng bộ Strava + tính lại thử thách + level cho toàn bộ user lúc 0:00 mỗi ngày (giờ VN). */
export const syncAllUsers = onSchedule(
  {
    schedule: '0 0 * * *',
    timeZone: 'Asia/Ho_Chi_Minh',
    timeoutSeconds: 540,
    memory: '1GiB',
    maxInstances: 1,
    retryCount: 0,
  },
  async () => {
    await runFullSync('schedule')
  },
)

/** Admin bấm "Đồng bộ toàn bộ" trên web; yêu cầu Firebase ID token của tài khoản admin. */
export const adminSync = onRequest(
  {
    cors: false,
    timeoutSeconds: 540,
    memory: '1GiB',
    maxInstances: 1,
    concurrency: 1,
  },
  async (req, res) => {
    const origin = corsOrigin(req.get('origin') || undefined)
    res.set('Vary', 'Origin')
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin)
      res.set('Access-Control-Allow-Methods', 'POST,OPTIONS')
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    }
    if (req.method === 'OPTIONS') {
      res.status(204).send('')
      return
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    const match = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')
    if (!match) {
      res.status(401).json({ error: 'Chưa đăng nhập.' })
      return
    }
    let uid: string
    try {
      uid = (await getAuth().verifyIdToken(match[1])).uid
    } catch {
      res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ, hãy đăng nhập lại.' })
      return
    }
    const isAdmin = (await getDatabase().ref(`users/${uid}/admin`).get()).val() === true
    if (!isAdmin) {
      res.status(403).json({ error: 'Chỉ Admin mới được đồng bộ toàn bộ.' })
      return
    }

    try {
      res.json(await runFullSync(`admin:${uid}`))
    } catch (err) {
      if (err instanceof SyncAlreadyRunningError) {
        res.status(409).json({ error: err.message })
        return
      }
      logger.error('adminSync failed', err)
      res.status(500).json({ error: err instanceof Error ? err.message : 'Đồng bộ thất bại' })
    }
  },
)
