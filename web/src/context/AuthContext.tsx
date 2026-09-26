import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
import { onValue, ref } from 'firebase/database'
import { auth, db } from '../lib/firebase'
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
    level: Number(data.level ?? 0) || 0,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (next) => {
      setUser(next)
      if (!next) {
        setProfile(null)
        setLoading(false)
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    if (!user) return
    const userRef = ref(db, `users/${user.uid}`)
    const unsub = onValue(userRef, (snap) => {
      const val = snap.val() as Record<string, unknown> | null
      setProfile(val ? mapProfile(user.uid, val) : null)
      setLoading(false)
    })
    return unsub
  }, [user])

  const login = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), password)
  }, [])

  const register = useCallback(async (email: string, password: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password)
    return cred.user
  }, [])

  const resetPassword = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim())
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
