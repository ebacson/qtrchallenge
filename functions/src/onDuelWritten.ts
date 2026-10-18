import * as logger from 'firebase-functions/logger'
import {
  onDuelApprovalChanged,
  onDuelInviteCleared,
  onDuelInvited,
  onDuelReinvited,
  onDuelResultLocked,
  onWithdrawRequested,
  onWithdrawRequestRemoved,
} from './pushDuels'
import { clearPushState } from './pushState'

function asDict(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function keysOf(value: unknown): string[] {
  return Object.keys(asDict(value) ?? {})
}

/**
 * Một trigger duy nhất cho mọi thay đổi `duels/{id}` — tránh vượt quota CPU Cloud Run
 * khi tách từng path con thành function riêng.
 */
export async function handleDuelWritten(
  duelId: string,
  beforeRaw: unknown,
  afterRaw: unknown,
): Promise<void> {
  const before = asDict(beforeRaw)
  const after = asDict(afterRaw)
  if (!after) return // xóa thách đấu

  // Duyệt / từ chối
  const prevApproval = asDict(before?.approval)
  const nextApproval = asDict(after.approval)
  if (String(prevApproval?.status ?? '') !== String(nextApproval?.status ?? '')) {
    await onDuelApprovalChanged(duelId, prevApproval, nextApproval)
  }

  // Lời mời mới (sau duyệt; onDuelInvited tự bỏ qua nếu chưa duyệt)
  const prevInvited = asDict(before?.invited) ?? {}
  const nextInvited = asDict(after.invited) ?? {}
  for (const uid of keysOf(nextInvited)) {
    if (nextInvited[uid] === true && prevInvited[uid] !== true) {
      await onDuelInvited(duelId, uid)
    }
  }

  // Tham gia → hủy nhắc mời
  const prevParts = asDict(before?.participants) ?? {}
  const nextParts = asDict(after.participants) ?? {}
  for (const uid of keysOf(nextParts)) {
    if (!prevParts[uid]) await onDuelInviteCleared(duelId, uid)
  }

  // Từ chối / mời lại
  const prevDeclined = asDict(before?.declined) ?? {}
  const nextDeclined = asDict(after.declined) ?? {}
  for (const uid of keysOf(nextDeclined)) {
    if (prevDeclined[uid] == null) await onDuelInviteCleared(duelId, uid)
  }
  for (const uid of keysOf(prevDeclined)) {
    if (nextDeclined[uid] == null) await onDuelReinvited(duelId, uid)
  }

  // Xin rút lui
  const prevWithdraw = asDict(before?.withdrawRequests) ?? {}
  const nextWithdraw = asDict(after.withdrawRequests) ?? {}
  for (const uid of keysOf(nextWithdraw)) {
    if (!prevWithdraw[uid]) await onWithdrawRequested(duelId, uid)
  }
  for (const uid of keysOf(prevWithdraw)) {
    if (!nextWithdraw[uid]) {
      await onWithdrawRequestRemoved(duelId, uid, Boolean(nextParts[uid]))
    }
  }

  // Kết quả
  if (!before?.result && after.result) {
    await onDuelResultLocked(duelId)
  }

  // Cam kết / góp quỹ xong → hủy nhắc
  const prevStake = asDict(before?.stakeDone) ?? {}
  const nextStake = asDict(after.stakeDone) ?? {}
  for (const uid of keysOf(nextStake)) {
    if (!prevStake[uid]) await clearPushState(`duel_stake_${duelId}_${uid}`)
  }
  const prevFund = asDict(before?.fundPayments) ?? {}
  const nextFund = asDict(after.fundPayments) ?? {}
  for (const uid of keysOf(nextFund)) {
    if (!prevFund[uid]) await clearPushState(`duel_stake_${duelId}_${uid}`)
  }
}

export function logDuelWrittenErr(err: unknown): void {
  logger.error('onDuelWritten', err)
}
