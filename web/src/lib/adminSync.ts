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

/** Cloud Function `adminSync` nằm cạnh `stravaApi` (cùng project/region). */
function adminSyncUrl(): string | null {
  const base = (import.meta.env.VITE_STRAVA_API_BASE as string | undefined)?.replace(/\/$/, '')
  if (!base || !/\/stravaApi$/.test(base)) return null
  return base.replace(/\/stravaApi$/, '/adminSync')
}

export async function runAdminFullSync(idToken: string): Promise<FullSyncSummary> {
  const url = adminSyncUrl()
  if (!url) {
    throw new Error('Chưa cấu hình Cloud Function (VITE_STRAVA_API_BASE) — chỉ chạy được trên bản production.')
  }
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: '{}',
    })
  } catch {
    throw new Error('Không gọi được máy chủ đồng bộ. Kiểm tra kết nối mạng.')
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
    throw new Error(message || `Đồng bộ thất bại (${res.status}).`)
  }
  return data as FullSyncSummary
}
