import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { push, ref, set } from 'firebase/database'
import { useAuth } from '../context/AuthContext'
import {
  DEFAULT_CHALLENGE_ICON,
  inputDateToChallengeDay,
  todayInputValue,
  uploadChallengeIcon,
} from '../lib/adminOps'
import { STATUS_UPCOMING } from '../lib/challengeRules'
import { db } from '../lib/firebase'

const PRESET_DISTANCES = ['50 km', '100 km', '150 km', '200 km', '250 km', '300 km']
const JOIN_DEADLINE_OPTIONS = [3, 7, 14, 21, 30, 45, 60]

export function CreateChallengePage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState(todayInputValue)
  const [endDate, setEndDate] = useState(todayInputValue)
  const [selected, setSelected] = useState<string[]>([])
  const [customKm, setCustomKm] = useState('')
  const [customOn, setCustomOn] = useState(false)
  const [password, setPassword] = useState('')
  const [joinDeadlineDays, setJoinDeadlineDays] = useState(7)
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [iconPreview, setIconPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const distances = useMemo(() => {
    const list = [...selected]
    if (customOn && customKm.trim()) {
      const n = Number(customKm.replace(',', '.'))
      if (n > 0) list.push(`${n} km`)
    }
    return list
  }, [selected, customOn, customKm])

  function toggleDistance(d: string) {
    setSelected((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    )
  }

  function onIconPick(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Chọn file ảnh.')
      return
    }
    setIconFile(file)
    setIconPreview(URL.createObjectURL(file))
    setError('')
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setError('')

    if (!name.trim()) {
      setError('Tên thử thách không được để trống.')
      return
    }
    if (distances.length === 0) {
      setError('Chọn ít nhất một cự ly.')
      return
    }
    if (endDate < startDate) {
      setError('Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.')
      return
    }
    if (!window.confirm('Bạn có chắc chắn muốn tạo thử thách này không?')) return

    setBusy(true)
    try {
      let icon = DEFAULT_CHALLENGE_ICON
      if (iconFile) {
        icon = await uploadChallengeIcon(iconFile)
      }
      const payload = {
        creator: user.uid,
        name: name.trim(),
        description: description.trim(),
        startDate: inputDateToChallengeDay(startDate),
        endDate: inputDateToChallengeDay(endDate),
        targetDistances: distances,
        status: STATUS_UPCOMING,
        icon,
        password: password.trim(),
        joinDeadlineDays,
      }
      const newRef = push(ref(db, 'challenges'))
      await set(newRef, payload)
      navigate(`/challenges/${newRef.key}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được thử thách')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <Link className="back-link" to="/challenges">
        ← Thử thách
      </Link>
      <header className="page-header">
        <p className="eyebrow">Admin</p>
        <h1>Tạo thử thách</h1>
      </header>

      <form className="auth-form panel section" onSubmit={onSubmit}>
        <div className="challenge-icon-picker">
          <img
            src={iconPreview || DEFAULT_CHALLENGE_ICON}
            alt=""
            className="challenge-icon-preview"
          />
          <label className="btn ghost compact">
            Chọn ảnh
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => onIconPick(e.target.files?.[0])}
            />
          </label>
        </div>

        <label>
          Tên thử thách
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label>
          Nội dung và quy định
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
          />
        </label>

        <div className="pr-edit-grid">
          <label>
            Ngày bắt đầu
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </label>
          <label>
            Ngày kết thúc
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </label>
        </div>

        <label>
          Hạn tham gia (sau ngày bắt đầu)
          <select
            value={joinDeadlineDays}
            onChange={(e) => setJoinDeadlineDays(Number(e.target.value))}
          >
            {JOIN_DEADLINE_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} ngày
              </option>
            ))}
          </select>
        </label>

        <fieldset className="distance-fieldset">
          <legend>Cự ly</legend>
          <div className="distance-chips">
            {PRESET_DISTANCES.map((d) => (
              <button
                key={d}
                type="button"
                className={selected.includes(d) ? 'chip active' : 'chip'}
                onClick={() => toggleDistance(d)}
              >
                {d}
              </button>
            ))}
          </div>
          <label className="custom-distance-row">
            <input
              type="checkbox"
              checked={customOn}
              onChange={(e) => setCustomOn(e.target.checked)}
            />
            <span>Cự ly tùy chọn (km)</span>
            <input
              type="number"
              min={1}
              step={0.1}
              value={customKm}
              disabled={!customOn}
              onChange={(e) => setCustomKm(e.target.value)}
              placeholder="VD: 75"
            />
          </label>
        </fieldset>

        <label>
          Mật khẩu tham gia (tùy chọn)
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
          />
        </label>

        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn primary wide" disabled={busy}>
          {busy ? 'Đang tạo…' : 'Tạo thử thách'}
        </button>
      </form>
    </div>
  )
}
