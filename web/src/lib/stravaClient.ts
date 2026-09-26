/** Client Strava — routes through local Vite proxy or Cloud Functions. */

const STATE_KEY = 'strava_oauth_state'

export type StravaConfig = {
  configured: boolean
  clientId?: string
  redirectUri?: string
  scope?: string
  apiBase?: string
  policyNotes?: string[]
  error?: string
}

export type StravaTokens = {
  access_token: string
  refresh_token: string
  expires_at: number
  athlete?: {
    id: number
    firstname?: string
    lastname?: string
  } | null
}

export type StravaActivityRecord = {
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

/**
 * Local: `/api/strava/...` via Vite middleware.
 * Pages: `VITE_STRAVA_API_BASE` → Cloud Function, e.g.
 * `https://us-central1-echiptime.cloudfunctions.net/stravaApi`
 */
function apiUrl(path: string): string {
  const remote = (import.meta.env.VITE_STRAVA_API_BASE as string | undefined)?.replace(
    /\/$/,
    '',
  )
  if (remote) return `${remote}${path}`
  // Keep relative to Vite base when on GitHub Pages without remote API
  // (will 404 — caller should handle configured:false)
  const pageBase = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  return `${pageBase}${path}`
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = apiUrl(path)
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    })
  } catch {
    throw new Error(
      'Không gọi được Strava API. Local: chạy npm run dev. Production: cần Cloud Function (VITE_STRAVA_API_BASE).',
    )
  }

  const rawText = await res.text()
  let data: T & { error?: string }
  try {
    data = (rawText ? JSON.parse(rawText) : {}) as T & { error?: string }
  } catch {
    if (res.status === 404) {
      throw new Error(
        'Strava API chưa có trên GitHub Pages (404). Đang dùng Cloud Functions — đợi deploy xong hoặc chạy local.',
      )
    }
    throw new Error(
      rawText
        ? `Server error (${res.status}): ${rawText.slice(0, 180)}`
        : `Server returned non-JSON (${res.status})`,
    )
  }

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`)
  }
  return data
}

export async function fetchStravaConfig(): Promise<StravaConfig> {
  try {
    return await apiJson('/api/strava/config')
  } catch (err) {
    return {
      configured: false,
      error: err instanceof Error ? err.message : 'Strava API unavailable',
    }
  }
}

export async function startStravaConnect(): Promise<void> {
  const state = crypto.randomUUID()
  sessionStorage.setItem(STATE_KEY, state)
  const { url } = await apiJson<{ url: string }>('/api/strava/authorize-url', {
    method: 'POST',
    body: JSON.stringify({ state }),
  })
  window.location.assign(url)
}

export function consumeOAuthState(returnedState: string | null): boolean {
  const expected = sessionStorage.getItem(STATE_KEY)
  sessionStorage.removeItem(STATE_KEY)
  if (!expected || !returnedState) return false
  return expected === returnedState
}

export async function exchangeCode(code: string): Promise<StravaTokens> {
  return apiJson('/api/strava/token', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export async function refreshTokens(refreshToken: string): Promise<StravaTokens> {
  return apiJson('/api/strava/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
}

export async function revokeToken(accessToken: string): Promise<void> {
  await apiJson('/api/strava/revoke', {
    method: 'POST',
    body: JSON.stringify({ access_token: accessToken }),
  })
}

export async function ensureFreshAccessToken(
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
): Promise<StravaTokens> {
  const skewSec = 120
  const now = Math.floor(Date.now() / 1000)
  if (expiresAt && now < expiresAt - skewSec) {
    return { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt }
  }
  return refreshTokens(refreshToken)
}

export async function fetchAthlete(accessToken: string): Promise<{
  id: number
  firstname?: string
  lastname?: string
}> {
  return apiJson('/api/strava/athlete', {
    method: 'POST',
    body: JSON.stringify({ access_token: accessToken }),
  })
}

export async function fetchAthleteActivities(
  accessToken: string,
  opts?: { maxPages?: number; perPage?: number },
): Promise<StravaActivityRecord[]> {
  const data = await apiJson<{ activities: StravaActivityRecord[] }>(
    '/api/strava/activities',
    {
      method: 'POST',
      body: JSON.stringify({
        access_token: accessToken,
        maxPages: opts?.maxPages,
        perPage: opts?.perPage,
      }),
    },
  )
  return data.activities
}
