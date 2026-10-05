import { getDatabase } from 'firebase-admin/database'
import * as logger from 'firebase-functions/logger'
import { USER_PROFILES_PATH } from './shared/userProfile'
import { syncSingleUser } from './syncAll'

export const STRAVA_EVENTS_TOPIC = 'strava-events'

export type StravaWebhookEvent = {
  object_type: 'activity' | 'athlete'
  object_id: number
  aspect_type: 'create' | 'update' | 'delete'
  owner_id: number
  subscription_id: number
  event_time: number
  updates: Record<string, unknown>
}

const ASPECTS = new Set(['create', 'update', 'delete'])

export function parseWebhookEvent(body: unknown): StravaWebhookEvent | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (b.object_type !== 'activity' && b.object_type !== 'athlete') return null
  if (!ASPECTS.has(String(b.aspect_type))) return null
  const objectId = Number(b.object_id)
  const ownerId = Number(b.owner_id)
  if (!Number.isSafeInteger(objectId) || !Number.isSafeInteger(ownerId)) return null
  return {
    object_type: b.object_type,
    object_id: objectId,
    aspect_type: b.aspect_type as StravaWebhookEvent['aspect_type'],
    owner_id: ownerId,
    subscription_id: Number(b.subscription_id) || 0,
    event_time: Number(b.event_time) || 0,
    updates:
      b.updates && typeof b.updates === 'object' ? (b.updates as Record<string, unknown>) : {},
  }
}

/** Dựng chỉ mục từ `user_profiles` (hồ sơ gọn), tối đa 1 lần/phút. */
const INDEX_REBUILD_MIN_MS = 60_000
let athleteIndex = new Map<string, string>()
let indexBuiltAt = 0

async function rebuildAthleteIndex(): Promise<void> {
  const db = getDatabase()
  const snap = await db.ref(USER_PROFILES_PATH).get()
  const candidates = new Map<string, string[]>()
  snap.forEach((child) => {
    const athleteId = String(child.child('id_strava').val() ?? '').trim()
    if (!athleteId || !child.key) return
    candidates.set(athleteId, [...(candidates.get(athleteId) ?? []), child.key])
  })

  const next = new Map<string, string>()
  for (const [athleteId, uids] of candidates) {
    let chosen = uids[0]
    if (uids.length > 1) {
      // Trùng athlete ID: ưu tiên tài khoản đang có token Strava
      for (const uid of uids) {
        if ((await db.ref(`users/${uid}/refresh_token`).get()).val()) {
          chosen = uid
          break
        }
      }
    }
    next.set(athleteId, chosen)
  }
  athleteIndex = next
  indexBuiltAt = Date.now()
}

async function findUidByAthlete(athleteId: string): Promise<string | null> {
  const cached = athleteIndex.get(athleteId)
  if (cached) {
    const current = (await getDatabase().ref(`users/${cached}/id_strava`).get()).val()
    if (String(current ?? '').trim() === athleteId) return cached
  }
  if (Date.now() - indexBuiltAt < INDEX_REBUILD_MIN_MS) return null
  await rebuildAthleteIndex()
  return athleteIndex.get(athleteId) ?? null
}

export async function handleStravaEvent(event: StravaWebhookEvent): Promise<void> {
  const athleteId = String(event.owner_id)
  if (event.object_type === 'athlete') {
    logger.info('Strava athlete event', { athleteId, updates: event.updates })
    return
  }

  const uid = await findUidByAthlete(athleteId)
  if (!uid) {
    logger.warn('Strava event for unknown athlete', { athleteId, activityId: event.object_id })
    return
  }

  if (event.aspect_type === 'delete') {
    await getDatabase().ref(`users/${uid}/strava_activities/${event.object_id}`).remove()
  }
  const result = await syncSingleUser(uid, true)
  const log = result.stravaError ? logger.warn : logger.info
  log('Strava event processed', {
    aspect: event.aspect_type,
    activityId: event.object_id,
    athleteId,
    ...result,
  })
}
