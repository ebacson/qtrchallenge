import { getDatabase } from 'firebase-admin/database'
import * as logger from 'firebase-functions/logger'
import { sendPushToUid, sendPushToUids } from './fcmSend'
import {
  clearPushState,
  DUEL_INVITE_REMIND_BEFORE_MS,
  getPushState,
  REMIND_7D_MS,
  setPushState,
} from './pushState'

function asDict(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

async function loadDuel(duelId: string): Promise<Record<string, unknown> | null> {
  return asDict((await getDatabase().ref(`duels/${duelId}`).get()).val())
}

function duelTitle(duel: Record<string, unknown>): string {
  return text(duel.title) || 'Thách đấu'
}

function targetReached(duel: Record<string, unknown>, value: number | null): boolean {
  if (value == null) return false
  const metric = text(duel.metric)
  const target = num(duel.target)
  if (!(target > 0) && metric !== 'best_effort') return false
  if (metric === 'best_effort') return value <= target + 1e-9
  return value >= target - 1e-9
}

/** Người thua phải thực hiện cam kết (không gồm người đạt mục tiêu nhưng không thắng) */
function owesStake(
  duel: Record<string, unknown>,
  row: { won?: boolean; value?: number | null },
): boolean {
  if (row.won === true) return false
  if (text(duel.kind) === 'target') {
    const value = row.value == null ? null : num(row.value)
    if (targetReached(duel, value)) return false
  }
  return true
}

export async function onDuelInvited(duelId: string, uid: string): Promise<void> {
  const duel = await loadDuel(duelId)
  if (!duel) return
  if (text(asDict(duel.approval)?.status) !== 'approved') return
  if (asDict(duel.participants)?.[uid]) return
  const title = 'Lời mời thách đấu'
  const body = `Bạn được mời vào “${duelTitle(duel)}”.`
  const url = `/duels/${duelId}`
  const tag = `duel-invite-${duelId}`
  await sendPushToUid(uid, { title, body, url, tag })
  const startAt = num(duel.startAt)
  const remindAt = startAt > 0 ? startAt - DUEL_INVITE_REMIND_BEFORE_MS : 0
  const now = Date.now()
  await setPushState(`duel_invite_${duelId}_${uid}`, {
    uid,
    kind: 'duel_invite',
    createdAt: now,
    remindAt: remindAt > now + 60_000 ? remindAt : undefined,
    title: 'Nhắc tham gia thách đấu',
    body: `“${duelTitle(duel)}” sắp diễn ra — hãy tham gia hoặc từ chối.`,
    url,
    tag: `${tag}-remind`,
    meta: { duelId },
  })
}

export async function onDuelInviteCleared(duelId: string, uid: string): Promise<void> {
  await clearPushState(`duel_invite_${duelId}_${uid}`)
}

export async function onDuelReinvited(duelId: string, uid: string): Promise<void> {
  // Xóa declined = mời lại
  await onDuelInvited(duelId, uid)
}

export async function onDuelApprovalChanged(
  duelId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  const prev = text(before?.status)
  const next = text(after?.status)
  if (!next || prev === next) return
  if (next !== 'approved' && next !== 'rejected') return
  const duel = await loadDuel(duelId)
  if (!duel) return
  const creator = text(duel.createdBy)
  if (!creator) return
  const name = duelTitle(duel)
  if (next === 'approved') {
    await sendPushToUid(creator, {
      title: 'Thách đấu đã được duyệt',
      body: `“${name}” đã được duyệt — có thể mời thêm người tham gia.`,
      url: `/duels/${duelId}`,
      tag: `duel-approved-${duelId}`,
    })
    // Mời đã có sẵn từ lúc tạo (pending): gửi lời mời khi vừa duyệt
    const invited = asDict(duel.invited) ?? {}
    for (const uid of Object.keys(invited)) {
      if (invited[uid] === true) await onDuelInvited(duelId, uid)
    }
  } else {
    const reason = text(after?.reason)
    await sendPushToUid(creator, {
      title: 'Thách đấu bị từ chối',
      body: reason ? `“${name}”: ${reason}` : `“${name}” đã bị từ chối.`,
      url: `/duels/${duelId}`,
      tag: `duel-rejected-${duelId}`,
    })
  }
}

export async function onWithdrawRequested(duelId: string, uid: string): Promise<void> {
  const duel = await loadDuel(duelId)
  if (!duel) return
  const creator = text(duel.createdBy)
  if (!creator || creator === uid) return
  const who = text(asDict(asDict(duel.participants)?.[uid])?.name) || 'Thành viên'
  await sendPushToUid(creator, {
    title: 'Xin rút lui thách đấu',
    body: `${who} xin rút khỏi “${duelTitle(duel)}”.`,
    url: `/duels/${duelId}`,
    tag: `duel-withdraw-${duelId}-${uid}`,
  })
  const now = Date.now()
  await setPushState(`duel_withdraw_${duelId}_${uid}`, {
    uid: creator,
    kind: 'duel_withdraw',
    createdAt: now,
    remindAt: now + 2 * 86_400_000,
    title: 'Nhắc xử lý rút lui',
    body: `Yêu cầu rút lui của ${who} ở “${duelTitle(duel)}” chưa được xử lý.`,
    url: `/duels/${duelId}`,
    tag: `duel-withdraw-${duelId}-${uid}-remind`,
    meta: { duelId, requester: uid },
  })
}

export async function onWithdrawRequestRemoved(
  duelId: string,
  uid: string,
  stillParticipant: boolean,
): Promise<void> {
  await clearPushState(`duel_withdraw_${duelId}_${uid}`)
  const duel = await loadDuel(duelId)
  if (!duel) return
  const name = duelTitle(duel)
  if (stillParticipant) {
    await sendPushToUid(uid, {
      title: 'Yêu cầu rút lui bị từ chối',
      body: `Yêu cầu rút khỏi “${name}” không được chấp nhận.`,
      url: `/duels/${duelId}`,
      tag: `duel-withdraw-reject-${duelId}`,
    })
  } else {
    await sendPushToUid(uid, {
      title: 'Đã được rút lui',
      body: `Bạn đã được đồng ý rút khỏi “${name}”.`,
      url: `/duels/${duelId}`,
      tag: `duel-withdraw-ok-${duelId}`,
    })
    await clearPushState(`duel_invite_${duelId}_${uid}`)
  }
}

export async function onDuelResultLocked(duelId: string): Promise<void> {
  const duel = await loadDuel(duelId)
  if (!duel) return
  const result = asDict(duel.result)
  const rows = asDict(result?.rows) ?? {}
  const uids = Object.keys(asDict(duel.participants) ?? {})
  if (!uids.length) return
  const name = duelTitle(duel)
  await sendPushToUids(uids, {
    title: 'Thách đấu đã kết thúc',
    body: `Đã có kết quả “${name}”.`,
    url: `/duels/${duelId}`,
    tag: `duel-result-${duelId}`,
  })

  const stakeText = text(duel.stakeText)
  const fundAmount = num(duel.fundAmount)
  if (!stakeText && !(fundAmount > 0)) return
  const now = Date.now()
  for (const uid of uids) {
    const row = asDict(rows[uid])
    if (!row) continue
    const value = row.value == null ? null : num(row.value)
    if (!owesStake(duel, { won: row.won === true, value })) continue
    if (asDict(duel.stakeDone)?.[uid]) continue
    if (fundAmount > 0 && asDict(duel.fundPayments)?.[uid]) continue
    await setPushState(`duel_stake_${duelId}_${uid}`, {
      uid,
      kind: 'duel_stake',
      createdAt: now,
      remindAt: now + REMIND_7D_MS,
      title: 'Nhắc thực hiện cam kết',
      body: `Bạn còn cam kết ở “${name}”.`,
      url: `/duels/${duelId}`,
      tag: `duel-stake-${duelId}-${uid}`,
      meta: { duelId },
    })
  }
}

/** Nhắc thách đấu sắp diễn ra (gọi từ scheduler) */
export async function notifyUpcomingDuels(now = Date.now()): Promise<number> {
  const snap = await getDatabase().ref('duels').get()
  const duels = asDict(snap.val()) ?? {}
  let sent = 0
  const windowEnd = now + DAY_MS_SAFE
  for (const [duelId, raw] of Object.entries(duels)) {
    const duel = asDict(raw)
    if (!duel) continue
    if (text(asDict(duel.approval)?.status) !== 'approved') continue
    const startAt = num(duel.startAt)
    if (!(startAt > now && startAt <= windowEnd)) continue
    const key = `duel_start_${duelId}`
    if (await getPushState(key)) continue
    const uids = Object.keys(asDict(duel.participants) ?? {})
    if (!uids.length) continue
    const name = duelTitle(duel)
    await sendPushToUids(uids, {
      title: 'Thách đấu sắp diễn ra',
      body: `“${name}” bắt đầu trong hôm nay / ngày mai.`,
      url: `/duels/${duelId}`,
      tag: `duel-start-${duelId}`,
    })
    await setPushState(key, {
      uid: text(duel.createdBy) || uids[0],
      kind: 'duel_start',
      createdAt: now,
      title: '',
      body: '',
      url: `/duels/${duelId}`,
      tag: `duel-start-${duelId}`,
      meta: { duelId },
    })
    sent += 1
  }
  return sent
}

const DAY_MS_SAFE = 86_400_000

export async function processDuelReminder(
  key: string,
  row: {
    uid: string
    kind: string
    title?: string
    body?: string
    url?: string
    tag?: string
    meta?: Record<string, string | number | boolean | null>
  },
): Promise<boolean> {
  const duelId = String(row.meta?.duelId ?? '')
  const duel = duelId ? await loadDuel(duelId) : null
  if (!duel) {
    await clearPushState(key)
    return false
  }

  if (row.kind === 'duel_invite') {
    if (asDict(duel.participants)?.[row.uid]) {
      await clearPushState(key)
      return false
    }
    if (asDict(duel.declined)?.[row.uid] != null) {
      await clearPushState(key)
      return false
    }
    if (Date.now() >= num(duel.joinUntil)) {
      await clearPushState(key)
      return false
    }
  }

  if (row.kind === 'duel_withdraw') {
    const requester = String(row.meta?.requester ?? '')
    if (!requester || asDict(duel.withdrawRequests)?.[requester] == null) {
      await clearPushState(key)
      return false
    }
  }

  if (row.kind === 'duel_stake') {
    if (asDict(duel.stakeDone)?.[row.uid]) {
      await clearPushState(key)
      return false
    }
    if (num(duel.fundAmount) > 0 && asDict(duel.fundPayments)?.[row.uid]) {
      await clearPushState(key)
      return false
    }
  }

  await sendPushToUid(row.uid, {
    title: text(row.title) || 'Nhắc thách đấu',
    body: text(row.body) || duelTitle(duel),
    url: text(row.url) || `/duels/${duelId}`,
    tag: text(row.tag) || key,
  })
  return true
}

export function logDuelPushErr(scope: string, err: unknown): void {
  logger.error(scope, err)
}
