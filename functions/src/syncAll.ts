import { getDatabase } from 'firebase-admin/database'
import * as logger from 'firebase-functions/logger'
import {
  fetchMappedActivities,
  readStravaEnv,
  refreshAccessToken,
  type StravaEnv,
} from './stravaCore'
import {
  calculateStatus,
  parseChallengeDayEndInclusiveMs,
  STATUS_FINISHED,
  STATUS_ONGOING,
} from './shared/challengeRules'
import { calculateLevelFromChallenges } from './shared/levelCalculator'
import { computeUserChallengeUpdate } from './shared/progressCompute'

type Dict = Record<string, unknown>

const TOKEN_SKEW_SEC = 300
const STRAVA_CONCURRENCY = 3
const ACTIVITY_PAGE_SIZE = 100
/** Thử thách vừa kết thúc vẫn được tính lại để nhận hoạt động đồng bộ muộn của ngày cuối. */
const FINISHED_GRACE_MS = 2 * 86_400_000
const UPDATE_CHUNK = 400

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

export class SyncAlreadyRunningError extends Error {
  constructor() {
    super('Đang có một lượt đồng bộ khác chạy.')
  }
}

let running = false

function asDict(value: unknown): Dict | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Dict) : null
}

/** JSON so sánh được: bỏ null/undefined, sắp khóa (RTDB không lưu null và trả khóa theo thứ tự riêng). */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  const dict = asDict(value)
  if (!dict) return value ?? null
  return Object.keys(dict)
    .filter((k) => dict[k] != null)
    .sort()
    .map((k) => [k, canonical(dict[k])])
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

async function forEachLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

async function applyRootUpdates(updates: Dict): Promise<void> {
  const root = getDatabase().ref()
  const entries = Object.entries(updates)
  for (let i = 0; i < entries.length; i += UPDATE_CHUNK) {
    await root.update(Object.fromEntries(entries.slice(i, i + UPDATE_CHUNK)))
  }
}

function shouldRecalculate(challenge: Dict, now: number): boolean {
  if (challenge.status === STATUS_FINISHED) return false
  const start = String(challenge.startDate ?? '')
  const end = String(challenge.endDate ?? '')
  const status = calculateStatus(start, end, now)
  if (status === STATUS_ONGOING) return true
  if (status !== STATUS_FINISHED) return false
  const endMs = parseChallengeDayEndInclusiveMs(end)
  return endMs != null && now - endMs <= FINISHED_GRACE_MS
}

type StravaState = { rateLimited: boolean }

async function syncStravaUser(
  uid: string,
  row: Dict,
  env: StravaEnv,
  state: StravaState,
  activitiesByUid: Map<string, Dict>,
  summary: FullSyncSummary,
): Promise<void> {
  const name = String(row.fullName ?? row.email ?? '')
  if (state.rateLimited) {
    summary.stravaSkipped += 1
    return
  }

  let accessToken = String(row.access_token ?? '')
  let refreshToken = String(row.refresh_token ?? '')
  let expiresAt = Number(row.expires_at ?? 0) || 0
  const updates: Dict = {}

  const nowSec = Math.floor(Date.now() / 1000)
  if (!accessToken || nowSec >= expiresAt - TOKEN_SKEW_SEC) {
    const refreshed = await refreshAccessToken(env, refreshToken)
    if (!refreshed.ok) {
      if (refreshed.status === 429) {
        state.rateLimited = true
        summary.stravaSkipped += 1
      } else {
        summary.stravaFailed.push({ uid, name, error: `Làm mới token: ${refreshed.error}` })
      }
      return
    }
    accessToken = refreshed.data.access_token
    refreshToken = refreshed.data.refresh_token
    expiresAt = refreshed.data.expires_at
    updates.access_token = accessToken
    updates.refresh_token = refreshToken
    updates.expires_at = expiresAt
  }

  const fetched = await fetchMappedActivities(accessToken, {
    maxPages: 1,
    perPage: ACTIVITY_PAGE_SIZE,
  })
  if (!fetched.ok) {
    if (Object.keys(updates).length) await getDatabase().ref(`users/${uid}`).update(updates)
    if (fetched.status === 429) {
      state.rateLimited = true
      summary.stravaSkipped += 1
    } else {
      summary.stravaFailed.push({ uid, name, error: `Lấy hoạt động: ${fetched.error}` })
    }
    return
  }

  const stored = activitiesByUid.get(uid) ?? {}
  for (const activity of fetched.activities) {
    for (const [field, value] of Object.entries(activity)) {
      updates[`strava_activities/${activity.id}/${field}`] = value
    }
    stored[activity.id] = { ...(asDict(stored[activity.id]) ?? {}), ...activity }
  }
  activitiesByUid.set(uid, stored)

  if (Object.keys(updates).length) await getDatabase().ref(`users/${uid}`).update(updates)
  summary.stravaSynced += 1
  summary.activitiesFetched += fetched.activities.length
}

/**
 * Đồng bộ Strava cho mọi user có token, tính lại tiến độ các thử thách đang diễn ra
 * (và vừa kết thúc) theo đúng logic của web, rồi cập nhật level.
 */
export async function runFullSync(trigger: string): Promise<FullSyncSummary> {
  if (running) throw new SyncAlreadyRunningError()
  running = true
  const started = Date.now()
  const summary: FullSyncSummary = {
    trigger,
    startedAt: new Date(started).toISOString(),
    durationMs: 0,
    usersWithStrava: 0,
    stravaSynced: 0,
    stravaSkipped: 0,
    stravaFailed: [],
    rateLimited: false,
    activitiesFetched: 0,
    challengesProcessed: 0,
    progressRowsUpdated: 0,
    levelsUpdated: 0,
  }

  try {
    const db = getDatabase()
    const users = asDict((await db.ref('users').get()).val()) ?? {}

    const activitiesByUid = new Map<string, Dict>()
    for (const [uid, raw] of Object.entries(users)) {
      const row = asDict(raw)
      const acts = row && asDict(row.strava_activities)
      if (acts) activitiesByUid.set(uid, { ...acts })
    }

    const stravaUsers = Object.entries(users).filter(([, raw]) => {
      const row = asDict(raw)
      return Boolean(row && typeof row.refresh_token === 'string' && row.refresh_token)
    }) as [string, Dict][]
    summary.usersWithStrava = stravaUsers.length

    const envResult = readStravaEnv(process.env)
    if ('error' in envResult) {
      logger.error('runFullSync: Strava env missing', envResult.error)
      summary.stravaSkipped = stravaUsers.length
    } else {
      const state: StravaState = { rateLimited: false }
      await forEachLimit(stravaUsers, STRAVA_CONCURRENCY, ([uid, row]) =>
        syncStravaUser(uid, row, envResult, state, activitiesByUid, summary).catch((err) => {
          summary.stravaFailed.push({
            uid,
            name: String(row.fullName ?? row.email ?? ''),
            error: err instanceof Error ? err.message : String(err),
          })
        }),
      )
      summary.rateLimited = state.rateLimited
    }

    const challenges = (asDict((await db.ref('challenges').get()).val()) ?? {}) as Record<
      string,
      Dict
    >
    const now = Date.now()
    const progressUpdates: Dict = {}
    for (const [challengeId, challenge] of Object.entries(challenges)) {
      if (!asDict(challenge) || !shouldRecalculate(challenge, now)) continue
      summary.challengesProcessed += 1
      const rows = asDict(challenge.user_challenges) ?? {}
      for (const [uid, rawRow] of Object.entries(rows)) {
        const row = asDict(rawRow)
        if (!row) continue
        const activities = Object.values(activitiesByUid.get(uid) ?? {}).filter(
          (a): a is Dict => asDict(a) != null,
        )
        const next = computeUserChallengeUpdate(challenge, row, activities)
        if (!next) continue
        let changed = false
        for (const [field, value] of Object.entries(next)) {
          if (sameValue(row[field], value)) continue
          progressUpdates[`challenges/${challengeId}/user_challenges/${uid}/${field}`] = value
          if (value == null) delete row[field]
          else row[field] = value
          changed = true
        }
        if (changed) summary.progressRowsUpdated += 1
      }
    }
    await applyRootUpdates(progressUpdates)

    const levelUpdates: Dict = {}
    for (const [uid, raw] of Object.entries(users)) {
      const row = asDict(raw)
      if (!row || row.email == null) continue
      const level = calculateLevelFromChallenges(uid, challenges)
      if (level !== (Number(row.level ?? 0) || 0)) {
        levelUpdates[`users/${uid}/level`] = level
        summary.levelsUpdated += 1
      }
    }
    await applyRootUpdates(levelUpdates)

    summary.durationMs = Date.now() - started
    logger.info('runFullSync done', {
      ...summary,
      stravaFailed: summary.stravaFailed.map((f) => `${f.uid}: ${f.error}`),
    })
    return summary
  } finally {
    running = false
  }
}
