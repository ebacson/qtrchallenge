import { useEffect, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { db } from './firebase'

type Entry = {
  value: unknown
  loaded: boolean
  listeners: Set<(value: unknown) => void>
  unsubscribe: (() => void) | null
  lingerTimer: ReturnType<typeof setTimeout> | null
  lingerMs: number
}

const entries = new Map<string, Entry>()

/**
 * Một listener RTDB dùng chung cho mỗi đường dẫn. Khi trang cuối cùng thôi nghe, listener còn
 * giữ thêm `lingerMs` để chuyển qua lại giữa các trang không phải tải lại toàn bộ dữ liệu.
 */
export function subscribeShared(
  path: string,
  listener: (value: unknown) => void,
  lingerMs = 10 * 60_000,
): () => void {
  let entry = entries.get(path)
  if (!entry) {
    entry = {
      value: null,
      loaded: false,
      listeners: new Set(),
      unsubscribe: null,
      lingerTimer: null,
      lingerMs,
    }
    entries.set(path, entry)
  }
  const e = entry
  e.lingerMs = Math.max(e.lingerMs, lingerMs)
  if (e.lingerTimer) {
    clearTimeout(e.lingerTimer)
    e.lingerTimer = null
  }
  e.listeners.add(listener)
  if (e.loaded) listener(e.value)
  if (!e.unsubscribe) {
    e.unsubscribe = onValue(
      ref(db, path),
      (snap) => {
        e.value = snap.val()
        e.loaded = true
        for (const fn of e.listeners) fn(e.value)
      },
      () => {
        // Mất quyền (đăng xuất): bỏ cache, lần sau nghe lại từ đầu
        entries.delete(path)
      },
    )
  }
  return () => {
    e.listeners.delete(listener)
    if (e.listeners.size > 0 || e.lingerTimer) return
    e.lingerTimer = setTimeout(() => {
      e.lingerTimer = null
      if (e.listeners.size > 0) return
      e.unsubscribe?.()
      entries.delete(path)
    }, e.lingerMs)
  }
}

/** Gỡ mọi listener dùng chung (gọi khi đăng xuất). */
export function resetSharedValues(): void {
  for (const e of entries.values()) {
    if (e.lingerTimer) clearTimeout(e.lingerTimer)
    e.unsubscribe?.()
  }
  entries.clear()
}

/** `undefined` khi đang tải lần đầu; `null` khi node không tồn tại. */
export function useSharedValue<T>(path: string | null, lingerMs?: number): T | null | undefined {
  const [state, setState] = useState<{ path: string | null; value: T | null | undefined }>(
    () => {
      const cached = path ? entries.get(path) : undefined
      return { path, value: cached?.loaded ? ((cached.value ?? null) as T | null) : undefined }
    },
  )
  useEffect(() => {
    if (!path) return
    return subscribeShared(
      path,
      (value) => setState({ path, value: (value ?? null) as T | null }),
      lingerMs,
    )
  }, [path, lingerMs])
  return state.path === path ? state.value : undefined
}
