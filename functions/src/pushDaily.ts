import * as logger from 'firebase-functions/logger'
import { scanChallengeCalendar } from './pushChallenges'
import { notifyUpcomingDuels, processDuelReminder } from './pushDuels'
import { processDuesReminder, scanUnpaidDues } from './pushDues'
import { processPenaltyReminder, scanUnpaidPenalties } from './pushPenalties'
import { listDueReminders, patchPushState } from './pushState'

/** Chạy mỗi ngày: nhắc đến hạn + thách đấu/thử thách/quỹ sắp tới + quét phạt mới. */
export async function runPushDailyJobs(): Promise<void> {
  const now = Date.now()
  try {
    const upcoming = await notifyUpcomingDuels(now)
    logger.info('pushDaily upcoming duels', { upcoming })
  } catch (err) {
    logger.error('pushDaily upcoming duels failed', err)
  }

  try {
    const calendar = await scanChallengeCalendar(now)
    logger.info('pushDaily challenge calendar', calendar)
  } catch (err) {
    logger.error('pushDaily challenge calendar failed', err)
  }

  try {
    const penalties = await scanUnpaidPenalties(now)
    logger.info('pushDaily penalty scan', penalties)
  } catch (err) {
    logger.error('pushDaily penalty scan failed', err)
  }

  try {
    const dues = await scanUnpaidDues(now)
    logger.info('pushDaily dues scan', dues)
  } catch (err) {
    logger.error('pushDaily dues scan failed', err)
  }

  try {
    const due = await listDueReminders(now)
    let sent = 0
    for (const { key, row } of due) {
      try {
        let ok = false
        if (row.kind === 'penalty') ok = await processPenaltyReminder(key, row)
        else if (row.kind === 'dues') ok = await processDuesReminder(key, row)
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
