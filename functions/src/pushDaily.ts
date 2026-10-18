import * as logger from 'firebase-functions/logger'
import { notifyUpcomingDuels, processDuelReminder } from './pushDuels'
import { processPenaltyReminder, scanUnpaidPenalties } from './pushPenalties'
import { listDueReminders, patchPushState } from './pushState'

/** Chạy mỗi ngày: nhắc đến hạn + thách đấu sắp diễn ra + quét phạt mới. */
export async function runPushDailyJobs(): Promise<void> {
  const now = Date.now()
  try {
    const upcoming = await notifyUpcomingDuels(now)
    logger.info('pushDaily upcoming duels', { upcoming })
  } catch (err) {
    logger.error('pushDaily upcoming duels failed', err)
  }

  try {
    const penalties = await scanUnpaidPenalties(now)
    logger.info('pushDaily penalty scan', penalties)
  } catch (err) {
    logger.error('pushDaily penalty scan failed', err)
  }

  try {
    const due = await listDueReminders(now)
    let sent = 0
    for (const { key, row } of due) {
      try {
        let ok = false
        if (row.kind === 'penalty') ok = await processPenaltyReminder(key, row)
        else if (
          row.kind === 'duel_invite' ||
          row.kind === 'duel_withdraw' ||
          row.kind === 'duel_stake'
        ) {
          ok = await processDuelReminder(key, row)
        } else {
          await patchPushState(key, { remindedAt: now })
          continue
        }
        await patchPushState(key, { remindedAt: now })
        if (ok) sent += 1
      } catch (err) {
        logger.error('pushDaily reminder failed', { key, err })
      }
    }
    logger.info('pushDaily reminders', { due: due.length, sent })
  } catch (err) {
    logger.error('pushDaily reminders failed', err)
  }
}
