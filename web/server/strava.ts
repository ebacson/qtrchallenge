/**
 * Strava API helpers — aligned with Strava Developer Program updates (2026–2027):
 * - Direct integration only (no intermediary platforms)
 * - API base: https://www.api-v3.strava.com
 * - Access tokens sent in Authorization header (not form body)
 * - Prefer oauth/revoke (deauthorize retires 2027-06-01)
 * - client_secret stays on the server — never shipped to the browser
 */

export const STRAVA_API_BASE = 'https://www.api-v3.strava.com'
export const STRAVA_OAUTH_TOKEN_URL = 'https://www.strava.com/oauth/token'
export const STRAVA_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize'
export const STRAVA_SCOPE = 'read,activity:read'

export type StravaEnv = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function readStravaEnv(env: Record<string, string>): StravaEnv | { error: string } {
  const clientId = env.STRAVA_CLIENT_ID?.trim()
  const clientSecret = env.STRAVA_CLIENT_SECRET?.trim()
  const redirectUri =
    env.STRAVA_REDIRECT_URI?.trim() ||
    env.VITE_STRAVA_REDIRECT_URI?.trim()

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
  expires_in?: number
  token_type?: string
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

export async function exchangeAuthorizationCode(
  env: StravaEnv,
  code: string,
): Promise<{ ok: true; data: StravaTokenResponse } | { ok: false; status: number; error: string }> {
  const res = await fetch(STRAVA_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  })
  const data = (await parseJson(res)) as StravaTokenResponse & { message?: string; errors?: unknown }
  if (!res.ok || !data.access_token) {
    return {
      ok: false,
      status: res.status,
      error: data.message || `Token exchange failed (${res.status})`,
    }
  }
  return { ok: true, data }
}

export async function refreshAccessToken(
  env: StravaEnv,
  refreshToken: string,
): Promise<{ ok: true; data: StravaTokenResponse } | { ok: false; status: number; error: string }> {
  const res = await fetch(STRAVA_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = (await parseJson(res)) as StravaTokenResponse & { message?: string }
  if (!res.ok || !data.access_token) {
    return {
      ok: false,
      status: res.status,
      error: data.message || `Token refresh failed (${res.status})`,
    }
  }
  return { ok: true, data }
}

/**
 * Prefer new oauth/revoke with Authorization header (required by June 2027).
 * Fall back to oauth/deauthorize until it retires 2027-06-01.
 */
export async function revokeAccessToken(
  accessToken: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const revokeRes = await fetch(`${STRAVA_API_BASE}/oauth/revoke`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })

  if (revokeRes.ok || revokeRes.status === 204) {
    return { ok: true }
  }

  // Fallback for apps not yet rolled onto revoke
  const deauthRes = await fetch(`${STRAVA_API_BASE}/oauth/deauthorize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ access_token: accessToken }),
  })

  if (deauthRes.ok || deauthRes.status === 204) {
    return { ok: true }
  }

  return {
    ok: false,
    status: deauthRes.status || revokeRes.status,
    error: `Revoke failed (${revokeRes.status}/${deauthRes.status})`,
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

/** Server-side Strava GET — browser must not call api-v3 (no CORS). */
export async function stravaApiGet(
  accessToken: string,
  pathWithQuery: string,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
  const res = await fetch(`${STRAVA_API_BASE}${pathWithQuery}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = await parseJson(res)
  if (!res.ok) {
    const msg =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message: unknown }).message)
        : `Strava API ${res.status}`
    return { ok: false, status: res.status, error: msg }
  }
  return { ok: true, data }
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

function formatStartDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
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
