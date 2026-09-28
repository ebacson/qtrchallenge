import { onRequest } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'
import { handleStravaRoute } from './stravaCore'

setGlobalOptions({ region: 'us-central1', maxInstances: 10 })

const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://ebacson.github.io',
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
      if (origin) {
        res.set('Access-Control-Allow-Origin', origin)
        res.set('Vary', 'Origin')
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
