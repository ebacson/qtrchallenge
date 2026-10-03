export type FullSyncSummary = {
  trigger: string
  startedAt: string
  durationMs: number
  usersWithStrava: number
  stravaSynced: number
  stravaSkipped: number
  stravaFailed: { uid: string; name: string; error: string }[]
  rateLimited: boolean
  activitiesFetched: number
  challengesProcessed: number
  progressRowsUpdated: number
  levelsUpdated: number
}

export type DeleteUserSummary = {
  strava: 'revoked' | 'not_connected' | 'already_revoked'
  challenges: number
  penaltyPayments: number
  rewardDraws: number
  notifications: number
  authDeleted: boolean
}

/** Cloud Function admin nằm cạnh `stravaApi` (cùng project/region). */
function adminFunctionUrl(name: string): string | null {
  const base = (import.meta.env.VITE_STRAVA_API_BASE as string | undefined)?.replace(/\/$/, '')
  if (!base || !/\/stravaApi$/.test(base)) return null
  return base.replace(/\/stravaApi$/, `/${name}`)
}

async function callAdminFunction(
  name: string,
  idToken: string,
  body: Record<string, unknown>,
  failure: string,
): Promise<unknown> {
  const url = adminFunctionUrl(name)
  if (!url) {
    throw new Error('Chưa cấu hình Cloud Function (VITE_STRAVA_API_BASE) — chỉ chạy được trên bản production.')
  }
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Không gọi được máy chủ. Kiểm tra kết nối mạng.')
  }
  const text = await res.text()
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Máy chủ trả lỗi (${res.status}).`)
  }
  if (!res.ok) {
    const message = (data as { error?: string }).error
    throw new Error(message || `${failure} (${res.status}).`)
  }
  return data
}

export async function runAdminFullSync(idToken: string): Promise<FullSyncSummary> {
  return (await callAdminFunction('adminSync', idToken, {}, 'Đồng bộ thất bại')) as FullSyncSummary
}

export async function runAdminDeleteUser(idToken: string, uid: string): Promise<DeleteUserSummary> {
  return (await callAdminFunction(
    'adminDeleteUser',
    idToken,
    { uid },
    'Xóa thất bại',
  )) as DeleteUserSummary
}
