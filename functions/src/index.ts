import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getDatabase } from 'firebase-admin/database'
import type { PubSub } from '@google-cloud/pubsub'
import { onRequest } from 'firebase-functions/v2/https'
import { onMessagePublished } from 'firebase-functions/v2/pubsub'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { setGlobalOptions } from 'firebase-functions/v2'
import * as logger from 'firebase-functions/logger'
import { handleStravaRoute } from './stravaCore'
import {
  handleStravaEvent,
  parseWebhookEvent,
  STRAVA_EVENTS_TOPIC,
  type StravaWebhookEvent,
} from './stravaWebhook'
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

let pubsub: PubSub | null = null

async function publishStravaEvent(event: StravaWebhookEvent): Promise<void> {
  if (!pubsub) {
    // Nạp muộn để thư viện Pub/Sub không làm chậm khởi động các function khác
    const { PubSub } = await import('@google-cloud/pubsub')
    pubsub = new PubSub()
  }
  await pubsub.topic(STRAVA_EVENTS_TOPIC).publishMessage({ json: event })
}

/**
 * Callback của Strava Webhook Events API. Strava đòi trả 200 trong 2 giây, nên chỉ
 * đẩy sự kiện vào Pub/Sub; processStravaEvent làm phần đồng bộ.
 */
export const stravaWebhook = onRequest(
  {
    cors: false,
    minInstances: 1,
    maxInstances: 3,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (req, res) => {
    if (req.method === 'GET') {
      const params = new URL(req.originalUrl || req.url, 'https://localhost').searchParams
      const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN
      if (
        verifyToken &&
        params.get('hub.mode') === 'subscribe' &&
        params.get('hub.verify_token') === verifyToken
      ) {
        res.status(200).json({ 'hub.challenge': params.get('hub.challenge') ?? '' })
      } else {
        res.status(403).json({ error: 'Forbidden' })
      }
      return
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    const event = parseWebhookEvent(req.body)
    if (!event) {
      res.status(400).json({ error: 'Invalid event' })
      return
    }
    const expectedSubscription = Number(process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID || 0)
    if (expectedSubscription && event.subscription_id !== expectedSubscription) {
      logger.warn('stravaWebhook: unexpected subscription_id', {
        subscriptionId: event.subscription_id,
      })
      res.status(403).json({ error: 'Unknown subscription' })
      return
    }

    try {
      await publishStravaEvent(event)
      res.status(200).json({ ok: true })
    } catch (err) {
      logger.error('stravaWebhook: publish failed', err)
      res.status(500).json({ error: 'Publish failed' })
    }
  },
)

/** Xử lý tuần tự từng sự kiện Strava: đồng bộ hoạt động, tính lại thử thách và level của user đó. */
export const processStravaEvent = onMessagePublished(
  {
    topic: STRAVA_EVENTS_TOPIC,
    maxInstances: 1,
    concurrency: 1,
    memory: '512MiB',
    timeoutSeconds: 120,
    retry: false,
  },
  async (message) => {
    const event = parseWebhookEvent(message.data.message.json)
    if (!event) {
      logger.warn('processStravaEvent: invalid message')
      return
    }
    await handleStravaEvent(event)
  },
)
