import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  type User,
} from 'firebase/auth'
import { get, onValue, ref, update } from 'firebase/database'
import { auth, db } from '../lib/firebase'
import { resetSharedValues } from '../lib/sharedValue'
import { PROFILE_FIELDS, USER_PROFILES_PATH } from '../lib/userProfile'
import type { UserProfile } from '../types'

interface AuthContextValue {
  user: User | null
  profile: UserProfile | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<User>
  resetPassword: (email: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Chuỗi thời gian của Firebase Auth ("Fri, 03 Oct 2026 10:15:00 GMT") → ms */
function msFromAuthTime(value: string | undefined): number | null {
  const ms = value ? Date.parse(value) : NaN
  return Number.isFinite(ms) ? ms : null
}

function mapProfile(id: string, data: Record<string, unknown>): UserProfile {
  return {
    id,
    fullName: String(data.fullName ?? ''),
    email: String(data.email ?? ''),
    phone: String(data.phone ?? ''),
    gender: String(data.gender ?? ''),
    fullMarathonTime: String(data.fullMarathonTime ?? ''),
    halfMarathonTime: String(data.halfMarathonTime ?? ''),
    isFullMarathonVerified: Boolean(data.isFullMarathonVerified),
    isHalfMarathonVerified: Boolean(data.isHalfMarathonVerified),
    dob: String(data.dob ?? ''),
    avatar: String(data.avatar ?? ''),
    id_strava: String(data.id_strava ?? ''),
    user_strava: String(data.user_strava ?? ''),
    admin: Boolean(data.admin),
    member: Boolean(data.member),
    memberSince: Number(data.memberSince) || undefined,
    level: Number(data.level ?? 0) || 0,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const healedFor = useRef<string | null>(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (next) => {
      setUser(next)
      if (!next) {
        healedFor.current = null
        resetSharedValues()
        setProfile(null)
        setLoading(false)
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    if (!user) return
    const uid = user.uid
    let healDone = healedFor.current === uid
    let latest: Record<string, unknown> | null = null
    let cancelled = false

    const unsub = onValue(ref(db, `${USER_PROFILES_PATH}/${uid}`), (snap) => {
      latest = snap.val() as Record<string, unknown> | null
      setProfile(latest ? mapProfile(uid, latest) : null)
      // Chưa có hồ sơ gọn (vd. đăng ký từ app iOS): chờ tự đồng bộ xong mới kết luận
      if (latest || healDone) setLoading(false)
    })

    if (!healDone) {
      healedFor.current = uid
      // App iOS/Android chỉ ghi vào users/{uid} → mỗi phiên so lại từng trường hồ sơ (vài KB)
      void Promise.all(
        PROFILE_FIELDS.map(async (field) => {
          const snap = await get(ref(db, `users/${uid}/${field}`))
          return [field, snap.val()] as const
        }),
      )
        .then(async (pairs) => {
          const source = Object.fromEntries(pairs.filter(([, v]) => v != null))
          if (Object.keys(source).length === 0) return
          const current = latest ?? {}
          const updates: Record<string, unknown> = {}
          for (const [field, value] of pairs) {
            if (JSON.stringify(current[field] ?? null) !== JSON.stringify(value ?? null)) {
              updates[`${USER_PROFILES_PATH}/${uid}/${field}`] = value ?? null
            }
          }
          const authTimes = {
            creationTime: msFromAuthTime(user.metadata.creationTime),
            lastSignInTime: msFromAuthTime(user.metadata.lastSignInTime),
          }
          for (const [field, ms] of Object.entries(authTimes)) {
            if (ms && source[field] !== ms) {
              updates[`users/${uid}/${field}`] = ms
              updates[`${USER_PROFILES_PATH}/${uid}/${field}`] = ms
            }
          }
          if (Object.keys(updates).length > 0) await update(ref(db), updates)
        })
        .catch((err) => {
          console.warn('profile mirror sync failed', err)
        })
        .finally(() => {
          healDone = true
          if (!cancelled) setLoading(false)
        })
    }

    return () => {
      cancelled = true
      unsub()
    }
  }, [user])

  const login = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), password)
  }, [])

  const register = useCallback(async (email: string, password: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password)
    return cred.user
  }, [])

  const resetPassword = useCallback(async (email: string) => {
    auth.languageCode = 'vi'
    try {
      await sendPasswordResetEmail(auth, email.trim(), {
        url: `${window.location.origin}/login`,
      })
    } catch (err) {
      // Tên miền chưa nằm trong Authorized domains: gửi không kèm link quay lại
      if ((err as { code?: unknown } | null)?.code !== 'auth/unauthorized-continue-uri') throw err
      await sendPasswordResetEmail(auth, email.trim())
    }
  }, [])

  const logout = useCallback(async () => {
    await signOut(auth)
  }, [])

  const value = useMemo(
    () => ({ user, profile, loading, login, register, resetPassword, logout }),
    [user, profile, loading, login, register, resetPassword, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
