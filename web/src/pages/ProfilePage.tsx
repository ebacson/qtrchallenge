import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ref, update } from 'firebase/database'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import { levelTone } from '../lib/levelCalculator'

export function ProfilePage() {
  const { user, profile } = useAuth()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [gender, setGender] = useState('')
  const [dob, setDob] = useState('')
  const [fmTime, setFmTime] = useState('')
  const [hmTime, setHmTime] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!profile) return
    setFullName(profile.fullName)
    setPhone(profile.phone)
    setGender(profile.gender)
    setDob(profile.dob)
    setFmTime(profile.fullMarathonTime)
    setHmTime(profile.halfMarathonTime)
  }, [profile])

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!user || !profile) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const fmChanged = fmTime.trim() !== (profile.fullMarathonTime || '')
      const hmChanged = hmTime.trim() !== (profile.halfMarathonTime || '')
      await update(ref(db, `users/${user.uid}`), {
        fullName: fullName.trim(),
        phone: phone.trim(),
        gender,
        dob: dob.trim(),
        fullMarathonTime: fmTime.trim(),
        halfMarathonTime: hmTime.trim(),
        ...(fmChanged ? { isFullMarathonVerified: false } : {}),
        ...(hmChanged ? { isHalfMarathonVerified: false } : {}),
      })
      setMessage(
        fmChanged || hmChanged
          ? 'Đã lưu. PR đổi sẽ cần admin xác minh lại để lên Bảng vàng.'
          : 'Đã lưu hồ sơ.',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được')
    } finally {
      setBusy(false)
    }
  }

  if (!profile) {
    return (
      <div className="page">
        <p className="empty">Chưa có hồ sơ trên RTDB.</p>
      </div>
    )
  }

  const tone = levelTone(profile.level)

  return (
    <div className="page">
      <header className="page-header profile-header">
        <div className="avatar-wrap">
          {profile.avatar ? (
            <img src={profile.avatar} alt="" className="avatar" />
          ) : (
            <div className="avatar placeholder">
              {(profile.fullName || 'Q').charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div>
          <h1>{profile.fullName || 'Hồ sơ'}</h1>
          <p className="muted">{profile.email}</p>
          <div className="profile-badges">
            <span className={`level-badge level-${tone}`}>Level {profile.level}</span>
            <span className={`member-badge ${profile.member ? 'yes' : 'no'}`}>
              {profile.member ? 'Thành viên chính thức' : 'Chưa phải member'}
            </span>
            {profile.admin && <span className="admin-badge">Admin</span>}
          </div>
        </div>
      </header>

      <section className="section panel">
        <h2>Strava</h2>
        <p className="body-text">
          {profile.user_strava
            ? `Đã kết nối: ${profile.user_strava}`
            : 'Chưa kết nối Strava.'}
        </p>
        <p style={{ marginTop: 12 }}>
          <Link className="btn ghost" to="/strava">
            Mở Strava Sync
          </Link>
        </p>
      </section>

      <section className="section panel">
        <h2>Chỉnh sửa</h2>
        <form className="auth-form" onSubmit={onSave}>
          <label>
            Họ tên
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>
          <label>
            Số điện thoại
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label>
            Giới tính
            <select value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">—</option>
              <option value="Nam">Nam</option>
              <option value="Nữ">Nữ</option>
              <option value="Khác">Khác</option>
            </select>
          </label>
          <label>
            Ngày sinh
            <input
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              placeholder="dd-MM-yyyy"
            />
          </label>
          <label>
            Full Marathon (hh:mm:ss)
            <input
              value={fmTime}
              onChange={(e) => setFmTime(e.target.value)}
              placeholder="3:45:00"
            />
          </label>
          <label>
            Half Marathon (hh:mm:ss)
            <input
              value={hmTime}
              onChange={(e) => setHmTime(e.target.value)}
              placeholder="1:45:00"
            />
          </label>
          <p className="tiny muted">
            FM verified: {profile.isFullMarathonVerified ? 'có' : 'không'} · HM
            verified: {profile.isHalfMarathonVerified ? 'có' : 'không'}
          </p>
          {error && <p className="form-error">{error}</p>}
          {message && <p className="form-info">{message}</p>}
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Đang lưu…' : 'Lưu'}
          </button>
        </form>
      </section>
    </div>
  )
}
