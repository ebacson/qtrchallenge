import type { Connect, Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  fetchMappedActivities,
  readStravaEnv,
  refreshAccessToken,
  revokeAccessToken,
  stravaApiGet,
  type StravaEnv,
} from './strava.ts'

type EnvMap = Record<string, string>
type EnvProvider = EnvMap | (() => EnvMap)

function resolveEnv(provider: EnvProvider): EnvMap {
  const base = typeof provider === 'function' ? provider() : provider
  // Prefer live process.env so edits / shell exports win after restart
  return {
    ...base,
    ...(process.env.STRAVA_CLIENT_ID
      ? { STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID }
      : {}),
    ...(process.env.STRAVA_CLIENT_SECRET
      ? { STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET }
      : {}),
    ...(process.env.STRAVA_REDIRECT_URI
      ? { STRAVA_REDIRECT_URI: process.env.STRAVA_REDIRECT_URI }
      : {}),
    ...(process.env.VITE_STRAVA_REDIRECT_URI
      ? { VITE_STRAVA_REDIRECT_URI: process.env.VITE_STRAVA_REDIRECT_URI }
      : {}),
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function requireEnv(env: EnvMap): StravaEnv | null {
  const result = readStravaEnv(env)
  if ('error' in result) return null
  return result
}

async function handleStravaApi(
  req: IncomingMessage,
  res: ServerResponse,
  envProvider: EnvProvider,
): Promise<boolean> {
  const url = new URL(req.url || '/', 'http://localhost')
  if (!url.pathname.startsWith('/api/strava')) return false

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.end()
    return true
  }

  const env = resolveEnv(envProvider)
  const stravaEnv = requireEnv(env)

  if (url.pathname === '/api/strava/config' && req.method === 'GET') {
    if (!stravaEnv) {
      sendJson(res, 503, {
        configured: false,
        error:
          'Strava server credentials not configured. Set STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REDIRECT_URI in web/.env.local then restart: cd web && npm run dev',
        debug: {
          hasClientId: Boolean(env.STRAVA_CLIENT_ID?.trim()),
          hasClientSecret: Boolean(env.STRAVA_CLIENT_SECRET?.trim()),
          hasRedirectUri: Boolean(
            env.STRAVA_REDIRECT_URI?.trim() || env.VITE_STRAVA_REDIRECT_URI?.trim(),
          ),
        },
      })
      return true
    }
    sendJson(res, 200, {
      configured: true,
      clientId: stravaEnv.clientId,
      redirectUri: stravaEnv.redirectUri,
      scope: 'read,activity:read',
      apiBase: 'https://www.api-v3.strava.com',
      policyNotes: [
        'Direct Strava integration (no intermediary platforms).',
        'Standard Tier requires a Strava subscription (new apps: 2026-06-01; existing: 2026-06-30).',
        'API calls use Authorization headers and www.api-v3.strava.com.',
      ],
    })
    return true
  }

  if (!stravaEnv) {
    sendJson(res, 503, { error: 'Strava not configured on server.' })
    return true
  }

  if (url.pathname === '/api/strava/authorize-url' && req.method === 'POST') {
    const body = (await readBody(req)) as { state?: string }
    const state = body.state || crypto.randomUUID()
    sendJson(res, 200, {
      url: buildAuthorizeUrl(stravaEnv, state),
      state,
    })
    return true
  }

  if (url.pathname === '/api/strava/token' && req.method === 'POST') {
    const body = (await readBody(req)) as { code?: string }
    if (!body.code) {
      sendJson(res, 400, { error: 'Missing authorization code.' })
      return true
    }
    const result = await exchangeAuthorizationCode(stravaEnv, body.code)
    if (!result.ok) {
      sendJson(res, result.status || 400, { error: result.error })
      return true
    }
    sendJson(res, 200, {
      access_token: result.data.access_token,
      refresh_token: result.data.refresh_token,
      expires_at: result.data.expires_at,
      athlete: result.data.athlete
        ? {
            id: result.data.athlete.id,
            firstname: result.data.athlete.firstname,
            lastname: result.data.athlete.lastname,
          }
        : null,
    })
    return true
  }

  if (url.pathname === '/api/strava/refresh' && req.method === 'POST') {
    const body = (await readBody(req)) as { refresh_token?: string }
    if (!body.refresh_token) {
      sendJson(res, 400, { error: 'Missing refresh_token.' })
      return true
    }
    const result = await refreshAccessToken(stravaEnv, body.refresh_token)
    if (!result.ok) {
      sendJson(res, result.status || 400, { error: result.error })
      return true
    }
    sendJson(res, 200, {
      access_token: result.data.access_token,
      refresh_token: result.data.refresh_token,
      expires_at: result.data.expires_at,
    })
    return true
  }

  if (url.pathname === '/api/strava/revoke' && req.method === 'POST') {
    const body = (await readBody(req)) as { access_token?: string }
    if (!body.access_token) {
      sendJson(res, 400, { error: 'Missing access_token.' })
      return true
    }
    const result = await revokeAccessToken(body.access_token)
    if (!result.ok) {
      sendJson(res, result.status || 400, { error: result.error })
      return true
    }
    sendJson(res, 200, { ok: true })
    return true
  }

  // Proxy athlete/activities — Strava has no browser CORS ("Failed to fetch").
  if (url.pathname === '/api/strava/athlete' && req.method === 'POST') {
    const body = (await readBody(req)) as { access_token?: string }
    if (!body.access_token) {
      sendJson(res, 400, { error: 'Missing access_token.' })
      return true
    }
    const result = await stravaApiGet(body.access_token, '/athlete')
    if (!result.ok) {
      sendJson(res, result.status || 400, { error: result.error })
      return true
    }
    const athlete = result.data as {
      id: number
      firstname?: string
      lastname?: string
    }
    sendJson(res, 200, {
      id: athlete.id,
      firstname: athlete.firstname,
      lastname: athlete.lastname,
    })
    return true
  }

  if (url.pathname === '/api/strava/activities' && req.method === 'POST') {
    const body = (await readBody(req)) as {
      access_token?: string
      maxPages?: number
      perPage?: number
    }
    if (!body.access_token) {
      sendJson(res, 400, { error: 'Missing access_token.' })
      return true
    }
    const result = await fetchMappedActivities(body.access_token, {
      maxPages: body.maxPages,
      perPage: body.perPage,
    })
    if (!result.ok) {
      sendJson(res, result.status || 400, { error: result.error })
      return true
    }
    sendJson(res, 200, { activities: result.activities })
    return true
  }

  sendJson(res, 404, { error: 'Unknown Strava API route.' })
  return true
}

export function stravaApiPlugin(envProvider: EnvProvider): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    void handleStravaApi(req, res, envProvider)
      .then((handled) => {
        if (!handled) next()
      })
      .catch((err: unknown) => {
        sendJson(res, 500, {
          error: err instanceof Error ? err.message : 'Strava API error',
        })
      })
  }

  return {
    name: 'strava-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
