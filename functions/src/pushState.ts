import { getDatabase } from 'firebase-admin/database'

export const PUSH_STATE_PATH = 'push_state'
export const DAY_MS = 86_400_000
export const REMIND_7D_MS = 7 * DAY_MS
/** Nhắc lời mời thách đấu: 18:00 ngày trước (startAt = 00:00 ngày diễn ra) */
export const DUEL_INVITE_REMIND_BEFORE_MS = 6 * 60 * 60 * 1000

export type PushStateRow = {
  uid: string
  kind: string
  createdAt: number
  remindAt?: number
  remindedAt?: number
  title?: string
  body?: string
  url?: string
  tag?: string
  /** Dữ liệu phụ để scheduler kiểm tra còn hiệu lực */
  meta?: Record<string, string | number | boolean | null>
}

export async function getPushState(key: string): Promise<PushStateRow | null> {
  const val = (await getDatabase().ref(`${PUSH_STATE_PATH}/${key}`).get()).val()
  return val && typeof val === 'object' ? (val as PushStateRow) : null
}

export async function setPushState(key: string, row: PushStateRow): Promise<void> {
  await getDatabase().ref(`${PUSH_STATE_PATH}/${key}`).set(row)
}

export async function patchPushState(key: string, patch: Partial<PushStateRow>): Promise<void> {
  await getDatabase().ref(`${PUSH_STATE_PATH}/${key}`).update(patch)
}

export async function clearPushState(key: string): Promise<void> {
  await getDatabase().ref(`${PUSH_STATE_PATH}/${key}`).remove()
}

export async function listDueReminders(now: number): Promise<{ key: string; row: PushStateRow }[]> {
  const snap = await getDatabase().ref(PUSH_STATE_PATH).get()
  const all = (snap.val() as Record<string, PushStateRow> | null) ?? {}
  const out: { key: string; row: PushStateRow }[] = []
  for (const [key, row] of Object.entries(all)) {
    if (!row || typeof row !== 'object') continue
    if (row.remindedAt) continue
    if (typeof row.remindAt !== 'number' || row.remindAt > now) continue
    out.push({ key, row })
  }
  return out
}
