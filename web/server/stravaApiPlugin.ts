import type { Connect, Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleStravaRoute } from './stravaCore.ts'

type EnvMap = Record<string, string>
type EnvProvider = EnvMap | (() => EnvMap)

function resolveEnv(provider: EnvProvider): EnvMap {
  const base = typeof provider === 'function' ? provider() : provider
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

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function handle(
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

  const body = req.method === 'GET' ? {} : await readBody(req)
  const result = await handleStravaRoute(
    req.method || 'GET',
    url.pathname,
    body,
    resolveEnv(envProvider),
  )
  sendJson(res, result.status, result.body)
  return true
}

export function stravaApiPlugin(envProvider: EnvProvider): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    void handle(req, res, envProvider)
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
