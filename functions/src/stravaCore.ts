/**
 * Shared Strava server logic for Vite middleware + Firebase Cloud Functions.
 */
export const STRAVA_API_BASE = 'https://www.api-v3.strava.com'
/** Legacy host — fallback if api-v3 is unreachable from Cloud Functions. */
export const STRAVA_API_BASE_FALLBACK = 'https://www.strava.com/api/v3'
export const STRAVA_OAUTH_TOKEN_URL = 'https://www.strava.com/oauth/token'
export const STRAVA_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize'
export const STRAVA_SCOPE = 'read,activity:read'

export type StravaEnv = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function readStravaEnv(env: Record<string, string | undefined>): StravaEnv | { error: string } {
  const clientId = env.STRAVA_CLIENT_ID?.trim()
  const clientSecret = env.STRAVA_CLIENT_SECRET?.trim()
  const redirectUri =
    env.STRAVA_REDIRECT_URI?.trim() || env.VITE_STRAVA_REDIRECT_URI?.trim()

  if (!clientId || !clientSecret || !redirectUri) {
    return {
      error:
        'Missing STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, or STRAVA_REDIRECT_URI in server env.',
    }
  }
  return { clientId, clientSecret, redirectUri }
}

export type StravaTokenResponse = {
  access_token: string
  refresh_token: string
  expires_at: number
  athlete?: {
    id: number
    firstname?: string
    lastname?: string
  }
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { raw: text }
  }
}

/** Strava oauth/token expects form body (not JSON) — JSON often yields "Unable to verify client". */
async function postStravaToken(
  params: Record<string, string>,
): Promise<{ ok: true; data: StravaTokenResponse } | { ok: false; status: number; error: string }> {
  try {
    const res = await fetch(STRAVA_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    })
    const data = (await parseJson(res)) as StravaTokenResponse & {
      message?: string
      error?: string
      error_description?: string
    }
    if (!res.ok || !data.access_token) {
      const detail =
        data.error_description ||
        data.message ||
        data.error ||
        `Token request failed (${res.status})`
      return { ok: false, status: res.status, error: detail }
    }
    return { ok: true, data }
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? `Token request network error: ${err.message}` : 'Token request network error',
    }
  }
}

export async function exchangeAuthorizationCode(
  env: StravaEnv,
  code: string,
): Promise<{ ok: true; data: StravaTokenResponse } | { ok: false; status: number; error: string }> {
  return postStravaToken({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: env.redirectUri,
  })
}

export async function refreshAccessToken(
  env: StravaEnv,
  refreshToken: string,
): Promise<{ ok: true; data: StravaTokenResponse } | { ok: false; status: number; error: string }> {
  return postStravaToken({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
}

export async function revokeAccessToken(
  accessToken: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const bases = [STRAVA_API_BASE, STRAVA_API_BASE_FALLBACK]
  let lastStatus = 0
  for (const base of bases) {
    try {
      const revokeRes = await fetch(`${base}/oauth/revoke`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      if (revokeRes.ok || revokeRes.status === 204) return { ok: true }

      const deauthRes = await fetch(`${base}/oauth/deauthorize`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ access_token: accessToken }),
      })
      if (deauthRes.ok || deauthRes.status === 204) return { ok: true }
      lastStatus = deauthRes.status || revokeRes.status
    } catch {
      // try next host
    }
  }
  return {
    ok: false,
    status: lastStatus || 502,
    error: 'Revoke failed (network or Strava error)',
  }
}

export function buildAuthorizeUrl(env: StravaEnv, state: string): string {
  const params = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: STRAVA_SCOPE,
    state,
  })
  return `${STRAVA_AUTHORIZE_URL}?${params.toString()}`
}

function fetchErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Strava fetch failed'
  const cause = (err as Error & { cause?: unknown }).cause
  if (cause instanceof Error && cause.message) {
    return `Strava fetch failed: ${err.message} (${cause.message})`
  }
  return `Strava fetch failed: ${err.message}`
}

export async function stravaApiGet(
  accessToken: string,
  pathWithQuery: string,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
  const bases = [STRAVA_API_BASE, STRAVA_API_BASE_FALLBACK]
  let lastError = 'Strava fetch failed'

  for (const base of bases) {
    try {
      const res = await fetch(`${base}${pathWithQuery}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })
      const data = await parseJson(res)
      if (!res.ok) {
        const msg =
          typeof data === 'object' && data && 'message' in data
            ? String((data as { message: unknown }).message)
            : `Strava API ${res.status}`
        // Auth and rate-limit errors won't be fixed by host fallback
        if (res.status === 401 || res.status === 403 || res.status === 429) {
          return { ok: false, status: res.status, error: msg }
        }
        lastError = msg
        continue
      }
      return { ok: true, data }
    } catch (err) {
      lastError = fetchErrorMessage(err)
    }
  }

  return { ok: false, status: 502, error: lastError }
}

type RawActivity = {
  id: number
  name?: string
  distance?: number
  moving_time?: number
  elapsed_time?: number
  total_elevation_gain?: number
  sport_type?: string
  type?: string
  start_date?: string
  average_cadence?: number
  average_heartrate?: number
  max_heartrate?: number
}

export type MappedActivity = {
  id: string
  name: string
  distance: string
  movingTime: string
  elapsedTime: string
  totalElevationGain: string
  type: string
  startDate: string
  averageCadence: string
  averageHeartrate: string
  maxHeartrate: string
  pace: string
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function calculatePace(distanceMeters: number, movingTimeSec: number): string {
  if (distanceMeters <= 0 || movingTimeSec <= 0) return '00:00'
  const paceSec = (movingTimeSec / distanceMeters) * 1000
  const minutes = Math.floor(paceSec / 60)
  const seconds = Math.floor(paceSec % 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** `start_date` của Strava là UTC; lưu theo giờ Việt Nam (GMT+7) bất kể múi giờ của server. */
function formatStartDate(iso: string): string {
  const utc = new Date(iso)
  if (Number.isNaN(utc.getTime())) return ''
  const d = new Date(utc.getTime() + 7 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

export function mapStravaActivity(activity: RawActivity): MappedActivity {
  const cadence = Math.round((activity.average_cadence ?? 0) * 2)
  return {
    id: String(activity.id),
    name: activity.name ?? '',
    distance: ((activity.distance ?? 0) / 1000).toFixed(2),
    movingTime: formatTime(activity.moving_time ?? 0),
    elapsedTime: formatTime(activity.elapsed_time ?? 0),
    totalElevationGain: (activity.total_elevation_gain ?? 0).toFixed(1),
    type: activity.sport_type || activity.type || '',
    startDate: formatStartDate(activity.start_date ?? ''),
    averageCadence: cadence === 0 ? 'N/A' : String(cadence),
    averageHeartrate:
      activity.average_heartrate != null ? String(activity.average_heartrate) : 'N/A',
    maxHeartrate: activity.max_heartrate != null ? String(activity.max_heartrate) : 'N/A',
    pace: calculatePace(activity.distance ?? 0, activity.moving_time ?? 0),
  }
}

export async function fetchMappedActivities(
  accessToken: string,
  opts?: { maxPages?: number; perPage?: number },
): Promise<
  | { ok: true; activities: MappedActivity[] }
  | { ok: false; status: number; error: string }
> {
  const maxPages = opts?.maxPages ?? 5
  const perPage = opts?.perPage ?? 100
  const all: MappedActivity[] = []

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await stravaApiGet(
      accessToken,
      `/athlete/activities?page=${page}&per_page=${perPage}`,
    )
    if (!result.ok) return result
    const batch = result.data as RawActivity[]
    if (!Array.isArray(batch) || !batch.length) break
    all.push(...batch.map(mapStravaActivity))
    if (batch.length < perPage) break
  }

  return { ok: true, activities: all }
}

/** Normalize path whether called via Vite (/api/strava/...) or Cloud Function. */
export function normalizeStravaPath(pathname: string): string {
  const idx = pathname.indexOf('/api/strava')
  if (idx >= 0) return pathname.slice(idx)
  if (pathname.endsWith('/config') || pathname === '/config') return '/api/strava/config'
  const map: Record<string, string> = {
    '/authorize-url': '/api/strava/authorize-url',
    '/token': '/api/strava/token',
    '/refresh': '/api/strava/refresh',
    '/revoke': '/api/strava/revoke',
    '/athlete': '/api/strava/athlete',
    '/activities': '/api/strava/activities',
  }
  for (const [suffix, full] of Object.entries(map)) {
    if (pathname.endsWith(suffix)) return full
  }
  return pathname
}

export type JsonResult = { status: number; body: unknown }

export async function handleStravaRoute(
  method: string,
  pathname: string,
  body: Record<string, unknown>,
  env: Record<string, string | undefined>,
): Promise<JsonResult> {
  const path = normalizeStravaPath(pathname)
  const stravaEnvResult = readStravaEnv(env)
  const stravaEnv = 'error' in stravaEnvResult ? null : stravaEnvResult

  if (path === '/api/strava/config' && method === 'GET') {
    if (!stravaEnv) {
      return {
        status: 503,
        body: {
          configured: false,
          error:
            stravaEnvResult && 'error' in stravaEnvResult
              ? stravaEnvResult.error
              : 'Not configured',
        },
      }
    }
    return {
      status: 200,
      body: {
        configured: true,
        clientId: stravaEnv.clientId,
        redirectUri: stravaEnv.redirectUri,
        scope: STRAVA_SCOPE,
        apiBase: STRAVA_API_BASE,
        policyNotes: [
          'Direct Strava integration (no intermediary platforms).',
          'Standard Tier requires a Strava subscription (new apps: 2026-06-01; existing: 2026-06-30).',
          'API calls use Authorization headers and www.api-v3.strava.com.',
        ],
      },
    }
  }

  if (!stravaEnv) {
    return { status: 503, body: { error: 'Strava not configured on server.' } }
  }

  if (path === '/api/strava/authorize-url' && method === 'POST') {
    const state = String(body.state || crypto.randomUUID())
    return {
      status: 200,
      body: { url: buildAuthorizeUrl(stravaEnv, state), state },
    }
  }

  if (path === '/api/strava/token' && method === 'POST') {
    const code = String(body.code || '')
    if (!code) return { status: 400, body: { error: 'Missing authorization code.' } }
    const result = await exchangeAuthorizationCode(stravaEnv, code)
    if (!result.ok) return { status: result.status || 400, body: { error: result.error } }
    return {
      status: 200,
      body: {
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
      },
    }
  }

  if (path === '/api/strava/refresh' && method === 'POST') {
    const refreshToken = String(body.refresh_token || '')
    if (!refreshToken) return { status: 400, body: { error: 'Missing refresh_token.' } }
    const result = await refreshAccessToken(stravaEnv, refreshToken)
    if (!result.ok) return { status: result.status || 400, body: { error: result.error } }
    return {
      status: 200,
      body: {
        access_token: result.data.access_token,
        refresh_token: result.data.refresh_token,
        expires_at: result.data.expires_at,
      },
    }
  }

  if (path === '/api/strava/revoke' && method === 'POST') {
    const accessToken = String(body.access_token || '')
    if (!accessToken) return { status: 400, body: { error: 'Missing access_token.' } }
    const result = await revokeAccessToken(accessToken)
    if (!result.ok) return { status: result.status || 400, body: { error: result.error } }
    return { status: 200, body: { ok: true } }
  }

  if (path === '/api/strava/athlete' && method === 'POST') {
    const accessToken = String(body.access_token || '')
    if (!accessToken) return { status: 400, body: { error: 'Missing access_token.' } }
    const result = await stravaApiGet(accessToken, '/athlete')
    if (!result.ok) return { status: result.status || 400, body: { error: result.error } }
    const athlete = result.data as {
      id: number
      firstname?: string
      lastname?: string
    }
    return {
      status: 200,
      body: {
        id: athlete.id,
        firstname: athlete.firstname,
        lastname: athlete.lastname,
      },
    }
  }

  if (path === '/api/strava/activities' && method === 'POST') {
    const accessToken = String(body.access_token || '')
    if (!accessToken) return { status: 400, body: { error: 'Missing access_token.' } }
    const result = await fetchMappedActivities(accessToken, {
      maxPages: Number(body.maxPages) || undefined,
      perPage: Number(body.perPage) || undefined,
    })
    if (!result.ok) return { status: result.status || 400, body: { error: result.error } }
    return { status: 200, body: { activities: result.activities } }
  }

  return { status: 404, body: { error: 'Unknown Strava API route.' } }
}
