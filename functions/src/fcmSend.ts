import { getDatabase } from 'firebase-admin/database'
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging'
import * as logger from 'firebase-functions/logger'

export type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
}

type TokenRow = { uid: string; tokenId: string; token: string }

async function collectTokens(opts?: { onlyUid?: string; onlyUids?: string[] }): Promise<TokenRow[]> {
  const db = getDatabase()
  let root: Record<string, unknown> | null
  if (opts?.onlyUid) {
    root = { [opts.onlyUid]: (await db.ref(`fcm_tokens/${opts.onlyUid}`).get()).val() }
  } else if (opts?.onlyUids?.length) {
    const unique = [...new Set(opts.onlyUids.filter(Boolean))]
    const entries = await Promise.all(
      unique.map(async (uid) => [uid, (await db.ref(`fcm_tokens/${uid}`).get()).val()] as const),
    )
    root = Object.fromEntries(entries)
  } else {
    root = (await db.ref('fcm_tokens').get()).val() as Record<string, unknown> | null
  }
  const out: TokenRow[] = []
  const seen = new Set<string>()
  for (const [uid, byId] of Object.entries(root ?? {})) {
    if (!byId || typeof byId !== 'object') continue
    for (const [tokenId, raw] of Object.entries(byId as Record<string, unknown>)) {
      const row = raw && typeof raw === 'object' ? (raw as { token?: unknown }) : null
      const token = typeof row?.token === 'string' ? row.token.trim() : ''
      if (!token || seen.has(token)) continue
      seen.add(token)
      out.push({ uid, tokenId, token })
    }
  }
  return out
}

async function removeToken(uid: string, tokenId: string): Promise<void> {
  await getDatabase().ref(`fcm_tokens/${uid}/${tokenId}`).remove()
}

/** Gửi FCM tới một uid (mọi thiết bị của họ). */
export async function sendPushToUid(
  uid: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number; removed: number; devices: number }> {
  return sendPushToUsers(payload, { onlyUid: uid })
}

/** Gửi FCM tới nhiều uid (gộp token, tránh trùng). */
export async function sendPushToUids(
  uids: string[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number; removed: number; devices: number }> {
  return sendPushToUsers(payload, { onlyUids: uids })
}

/** Gửi FCM tới mọi thiết bị đã đăng ký (hoặc một / vài uid). Xóa token chết (404/410/unregistered). */
export async function sendPushToUsers(
  payload: PushPayload,
  opts?: { onlyUid?: string; onlyUids?: string[] },
): Promise<{ sent: number; failed: number; removed: number; devices: number }> {
  const title = payload.title.trim() || 'QTR Challenge'
  const body = payload.body.trim()
  const url = payload.url?.trim() || '/notifications'
  const tag = payload.tag?.trim() || 'qtr-push'
  const rows = await collectTokens(opts)
  if (!rows.length) return { sent: 0, failed: 0, removed: 0, devices: 0 }

  const messaging = getMessaging()
  let sent = 0
  let failed = 0
  let removed = 0

  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500)
    // Chỉ gửi `data` — không kèm `notification` để trình duyệt/FCM không tự hiện thêm một bản
    // (SW `onBackgroundMessage` / client `onMessage` tự showNotification).
    const message: MulticastMessage = {
      tokens: batch.map((r) => r.token),
      data: { title, body, url, tag },
      webpush: {
        fcmOptions: { link: url },
        headers: { Urgency: 'high' },
      },
    }
    const res = await messaging.sendEachForMulticast(message)
    sent += res.successCount
    failed += res.failureCount
    res.responses.forEach((r, idx) => {
      if (r.success) return
      const code = r.error?.code || ''
      const dead =
        code.includes('registration-token-not-registered') ||
        code.includes('invalid-registration-token') ||
        code.includes('not-found')
      if (dead) {
        const row = batch[idx]
        void removeToken(row.uid, row.tokenId).catch((err) =>
          logger.warn('remove dead fcm token failed', { uid: row.uid, err }),
        )
        removed += 1
      } else {
        logger.warn('fcm send failed', { code, message: r.error?.message })
      }
    })
  }

  return { sent, failed, removed, devices: rows.length }
}
