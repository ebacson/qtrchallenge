import { getDatabase } from 'firebase-admin/database'
import * as logger from 'firebase-functions/logger'
import {
  fetchMappedActivities,
  readStravaEnv,
  refreshAccessToken,
  type StravaEnv,
} from './stravaCore'
import {
  activityDayMs,
  calculateStatus,
  parseChallengeDayEndInclusiveMs,
  parseChallengeDayStartMs,
  STATUS_FINISHED,
  STATUS_ONGOING,
} from './shared/challengeRules'
import { calculateLevelFromChallenges } from './shared/levelCalculator'
import { computeUserChallengeUpdate } from './shared/progressCompute'
import { pickProfile, PROFILE_FIELDS, USER_PROFILES_PATH } from './shared/userProfile'

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
  profilesUpdated: number
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

function emptySummary(trigger: string, started: number): FullSyncSummary {
  return {
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
    profilesUpdated: 0,
  }
}

/**
 * Đưa `user_profiles` về khớp với `users` (app iOS/Android chỉ ghi vào `users`).
 * Chỉ ghi các trường khác nhau; trả về số user có thay đổi.
 */
async function syncUserProfiles(users: Dict): Promise<number> {
  const db = getDatabase()
  const existing = asDict((await db.ref(USER_PROFILES_PATH).get()).val()) ?? {}
  const updates: Dict = {}
  const changed = new Set<string>()
  const stale: [string, string][] = []
  for (const [uid, raw] of Object.entries(users)) {
    const row = asDict(raw)
    if (!row) continue
    const next = pickProfile(row)
    const prev = asDict(existing[uid]) ?? {}
    for (const field of PROFILE_FIELDS) {
      if (!sameValue(prev[field], next[field])) stale.push([uid, field])
    }
  }
  // `users` được đọc từ đầu lượt sync (vài phút trước) → đọc lại đúng các trường lệch
  await forEachLimit(stale, 20, async ([uid, field]) => {
    const fresh = (await db.ref(`users/${uid}/${field}`).get()).val()
    const prev = asDict(existing[uid]) ?? {}
    if (sameValue(prev[field], fresh)) return
    updates[`${USER_PROFILES_PATH}/${uid}/${field}`] = fresh ?? null
    changed.add(uid)
  })
  let changedUsers = changed.size
  for (const uid of Object.keys(existing)) {
    if (!asDict(users[uid])) {
      updates[`${USER_PROFILES_PATH}/${uid}`] = null
      changedUsers += 1
    }
  }
  await applyRootUpdates(updates)
  return changedUsers
}

/**
 * Tính lại tiến độ các thử thách cần tính (của mọi user, hoặc chỉ `onlyUid`).
 * Ghi đè giá trị mới vào `challenges` để tính level ngay sau đó.
 */
function collectProgressUpdates(
  challenges: Record<string, Dict>,
  activitiesByUid: Map<string, Dict>,
  now: number,
  onlyUid?: string,
): { updates: Dict; challengesProcessed: number; rowsUpdated: number } {
  const updates: Dict = {}
  let challengesProcessed = 0
  let rowsUpdated = 0
  for (const [challengeId, challenge] of Object.entries(challenges)) {
    if (!asDict(challenge) || !shouldRecalculate(challenge, now)) continue
    const rows = asDict(challenge.user_challenges) ?? {}
    const entries = onlyUid
      ? Object.entries(rows).filter(([uid]) => uid === onlyUid)
      : Object.entries(rows)
    if (onlyUid && !entries.length) continue
    challengesProcessed += 1
    for (const [uid, rawRow] of entries) {
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
        updates[`challenges/${challengeId}/user_challenges/${uid}/${field}`] = value
        if (value == null) delete row[field]
        else row[field] = value
        changed = true
      }
      if (changed) rowsUpdated += 1
    }
  }
  return { updates, challengesProcessed, rowsUpdated }
}

export type UserSyncResult = {
  uid: string
  stravaError: string | null
  activitiesFetched: number
  challengesProcessed: number
  progressRowsUpdated: number
  levelChanged: boolean
}

/**
 * `challenges` giữ trong instance bằng một listener: tải đủ một lần khi khởi động, sau đó RTDB
 * chỉ gửi phần thay đổi (mỗi sự kiện Strava khỏi tải lại cả nhánh).
 */
let challengesCache: Record<string, Dict> = {}
let challengesReady: Promise<void> | null = null

function cachedChallenges(): Promise<Record<string, Dict>> {
  if (!challengesReady) {
    challengesReady = new Promise<void>((resolve, reject) => {
      getDatabase()
        .ref('challenges')
        .on(
          'value',
          (snap) => {
            challengesCache = (asDict(snap.val()) ?? {}) as Record<string, Dict>
            resolve()
          },
          (err) => {
            challengesReady = null
            reject(err)
          },
        )
    })
  }
  return challengesReady.then(() => challengesCache)
}

const USER_SYNC_FIELDS = ['access_token', 'refresh_token', 'expires_at', 'fullName', 'email', 'level']

/** Đồng bộ Strava (nếu `fetchStrava`) rồi tính lại tiến độ thử thách + level cho một user. */
export async function syncSingleUser(uid: string, fetchStrava: boolean): Promise<UserSyncResult> {
  const db = getDatabase()
  const values = await Promise.all(
    USER_SYNC_FIELDS.map(async (field) => (await db.ref(`users/${uid}/${field}`).get()).val()),
  )
  const row: Dict = Object.fromEntries(
    USER_SYNC_FIELDS.map((field, i) => [field, values[i]]).filter(([, v]) => v != null),
  )
  if (!Object.keys(row).length) throw new Error(`Không tìm thấy user ${uid}`)

  // Dòng tiến độ của user này đọc mới từ RTDB; phần còn lại của thử thách lấy từ bộ nhớ đệm
  const now = Date.now()
  const cached = await cachedChallenges()
  const challenges: Record<string, Dict> = { ...cached }
  let windowStartMs = Number.POSITIVE_INFINITY
  await Promise.all(
    Object.entries(cached).map(async ([challengeId, challenge]) => {
      if (!asDict(challenge) || !shouldRecalculate(challenge, now)) return
      const fresh = asDict(
        (await db.ref(`challenges/${challengeId}/user_challenges/${uid}`).get()).val(),
      )
      const rows = { ...(asDict(challenge.user_challenges) ?? {}) }
      if (fresh) rows[uid] = fresh
      else delete rows[uid]
      challenges[challengeId] = { ...challenge, user_challenges: rows }
      if (fresh) {
        const start = parseChallengeDayStartMs(String(challenge.startDate ?? ''))
        if (start != null) windowStartMs = Math.min(windowStartMs, start)
      }
    }),
  )
  const needsActivities = Number.isFinite(windowStartMs)

  const activitiesByUid = new Map<string, Dict>()
  const summary = emptySummary(`user:${uid}`, now)
  let stravaError: string | null = null
  if (fetchStrava) {
    const env = readStravaEnv(process.env)
    if ('error' in env) {
      stravaError = env.error
    } else {
      const state: StravaState = { rateLimited: false }
      await syncStravaUser(uid, row, env, state, activitiesByUid, summary)
      if (state.rateLimited) stravaError = 'Strava rate limit (429)'
      else if (summary.stravaFailed.length) stravaError = summary.stravaFailed[0].error
    }
  }

  // Các hoạt động mới nhất vừa lấy từ Strava đã phủ hết khoảng ngày cần tính thì khỏi đọc
  // `strava_activities` (phần lớn dung lượng của `users`) từ RTDB
  if (needsActivities) {
    const fetched = Object.values(activitiesByUid.get(uid) ?? {}).map(asDict)
    const oldestMs = Math.min(
      ...fetched.map((a) => activityDayMs(String(a?.startDate ?? '')) ?? Number.POSITIVE_INFINITY),
    )
    const covered =
      summary.stravaSynced > 0 &&
      (fetched.length < ACTIVITY_PAGE_SIZE || oldestMs < windowStartMs)
    if (!covered) {
      const stored = asDict((await db.ref(`users/${uid}/strava_activities`).get()).val()) ?? {}
      activitiesByUid.set(uid, { ...stored, ...(activitiesByUid.get(uid) ?? {}) })
    }
  }

  const progress = collectProgressUpdates(challenges, activitiesByUid, now, uid)
  await applyRootUpdates(progress.updates)

  let levelChanged = false
  if (row.email != null) {
    const level = calculateLevelFromChallenges(uid, challenges)
    if (level !== (Number(row.level ?? 0) || 0)) {
      await db.ref().update({
        [`users/${uid}/level`]: level,
        [`${USER_PROFILES_PATH}/${uid}/level`]: level,
      })
      levelChanged = true
    }
  }

  return {
    uid,
    stravaError,
    activitiesFetched: summary.activitiesFetched,
    challengesProcessed: progress.challengesProcessed,
    progressRowsUpdated: progress.rowsUpdated,
    levelChanged,
  }
}

/**
 * Đồng bộ Strava cho mọi user có token, tính lại tiến độ các thử thách đang diễn ra
 * (và vừa kết thúc) theo đúng logic của web, rồi cập nhật level.
 */
export async function runFullSync(trigger: string): Promise<FullSyncSummary> {
  if (running) throw new SyncAlreadyRunningError()
  running = true
  const started = Date.now()
  const summary = emptySummary(trigger, started)

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
    const progress = collectProgressUpdates(challenges, activitiesByUid, Date.now())
    summary.challengesProcessed = progress.challengesProcessed
    summary.progressRowsUpdated = progress.rowsUpdated
    await applyRootUpdates(progress.updates)

    const levelUpdates: Dict = {}
    for (const [uid, raw] of Object.entries(users)) {
      const row = asDict(raw)
      if (!row || row.email == null) continue
      const level = calculateLevelFromChallenges(uid, challenges)
      if (level !== (Number(row.level ?? 0) || 0)) {
        levelUpdates[`users/${uid}/level`] = level
        row.level = level
        summary.levelsUpdated += 1
      }
    }
    await applyRootUpdates(levelUpdates)

    summary.profilesUpdated = await syncUserProfiles(users)

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
