/** Client Strava — all Strava HTTP goes through /api/strava/* (no browser CORS). */

const STATE_KEY = 'strava_oauth_state'

export type StravaConfig = {
  configured: boolean
  clientId?: string
  redirectUri?: string
  scope?: string
  apiBase?: string
  policyNotes?: string[]
  error?: string
  debug?: {
    hasClientId?: boolean
    hasClientSecret?: boolean
    hasRedirectUri?: boolean
  }
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

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    })
  } catch {
    throw new Error(
      'Failed to fetch — mở đúng cổng Vite (thường http://localhost:5173) và đảm bảo npm run dev đang chạy.',
    )
  }

  let data: T & { error?: string }
  try {
    data = (await res.json()) as T & { error?: string }
  } catch {
    throw new Error(`Server returned non-JSON (${res.status})`)
  }

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`)
  }
  return data
}

export async function fetchStravaConfig(): Promise<StravaConfig> {
  return apiJson('/api/strava/config')
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
