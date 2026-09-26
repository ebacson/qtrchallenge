import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { push, ref, set } from 'firebase/database'
import { useAuth } from '../context/AuthContext'
import {
  DEFAULT_CHALLENGE_ICON,
  currentMonthInputValue,
  inputDateToChallengeDay,
  monthInputBounds,
  todayInputValue,
  uploadChallengeIcon,
} from '../lib/adminOps'
import {
  formatPaceMinutes,
  parsePaceInput,
  STATUS_UPCOMING,
} from '../lib/challengeRules'
import { db } from '../lib/firebase'
import type { Challenge } from '../types'

const PRESET_DISTANCES = ['50 km', '100 km', '150 km', '200 km', '250 km', '300 km']
const JOIN_DEADLINE_OPTIONS = [3, 7, 14, 21, 30, 45, 60]

type Mode = Challenge['challengeMode']

export function CreateChallengePage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [mode, setMode] = useState<Mode>('monthly_pace')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [monthValue, setMonthValue] = useState(currentMonthInputValue)
  const [startDate, setStartDate] = useState(todayInputValue)
  const [endDate, setEndDate] = useState(todayInputValue)
  const [paceMinInput, setPaceMinInput] = useState('04:00')
  const [paceMaxInput, setPaceMaxInput] = useState('08:00')
  const [requiredActivities, setRequiredActivities] = useState('12')
  const [minActivityKm, setMinActivityKm] = useState('5')
  const [selected, setSelected] = useState<string[]>([])
  const [customKm, setCustomKm] = useState('')
  const [customOn, setCustomOn] = useState(false)
  const [password, setPassword] = useState('')
  const [joinDeadlineDays, setJoinDeadlineDays] = useState(7)
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [iconPreview, setIconPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (mode !== 'monthly_pace') return
    const bounds = monthInputBounds(monthValue)
    if (!bounds) return
    setStartDate(bounds.start)
    setEndDate(bounds.end)
  }, [mode, monthValue])

  const distances = useMemo(() => {
    if (mode === 'activity_count') {
      const n = Number(requiredActivities)
      const d = Number(minActivityKm.replace(',', '.'))
      if (n > 0 && d > 0) return [`${n} hoạt động × ${d} km`]
      return []
    }
    const list = [...selected]
    if (customOn && customKm.trim()) {
      const n = Number(customKm.replace(',', '.'))
      if (n > 0) list.push(`${n} km`)
    }
    return list
  }, [mode, selected, customOn, customKm, requiredActivities, minActivityKm])

  const preview = useMemo(() => {
    const startLabel = inputDateToChallengeDay(startDate)
    const endLabel = inputDateToChallengeDay(endDate)
    if (mode === 'monthly_pace') {
      const a = parsePaceInput(paceMinInput)
      const b = parsePaceInput(paceMaxInput)
      const pace =
        a != null && b != null
          ? `pace ${formatPaceMinutes(a)}–${formatPaceMinutes(b)}`
          : 'pace …'
      return `${startLabel} → ${endLabel} · ${pace} · mục tiêu ${distances.join(', ') || '…'}`
    }
    return `${startLabel} → ${endLabel} · ${requiredActivities || '?'} hoạt động ≥ ${minActivityKm || '?'} km`
  }, [
    mode,
    startDate,
    endDate,
    paceMinInput,
    paceMaxInput,
    distances,
    requiredActivities,
    minActivityKm,
  ])

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
    if (endDate < startDate) {
      setError('Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.')
      return
    }

    let paceMinMinutes: number | undefined
    let paceMaxMinutes: number | undefined
    let required: number | undefined
    let minKm: number | undefined

    if (mode === 'monthly_pace') {
      paceMinMinutes = parsePaceInput(paceMinInput) ?? undefined
      paceMaxMinutes = parsePaceInput(paceMaxInput) ?? undefined
      if (paceMinMinutes == null || paceMaxMinutes == null) {
        setError('Nhập pace hợp lệ (vd 04:00 hoặc 4.5).')
        return
      }
      if (paceMinMinutes >= paceMaxMinutes) {
        setError('Pace tối thiểu phải nhỏ hơn pace tối đa.')
        return
      }
      if (distances.length === 0) {
        setError('Chọn ít nhất một cự ly mục tiêu.')
        return
      }
    } else {
      required = Number(requiredActivities)
      minKm = Number(minActivityKm.replace(',', '.'))
      if (!Number.isFinite(required) || required < 1) {
        setError('Số hoạt động phải ≥ 1.')
        return
      }
      if (!Number.isFinite(minKm) || minKm <= 0) {
        setError('Cự ly mỗi hoạt động phải > 0 km.')
        return
      }
    }

    if (!window.confirm(`Tạo thử thách?\n\n${preview}`)) return

    setBusy(true)
    try {
      let icon = DEFAULT_CHALLENGE_ICON
      if (iconFile) icon = await uploadChallengeIcon(iconFile)

      const payload: Record<string, unknown> = {
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
        challengeMode: mode,
      }

      if (mode === 'monthly_pace') {
        payload.paceMinMinutes = paceMinMinutes
        payload.paceMaxMinutes = paceMaxMinutes
      } else {
        payload.requiredActivities = required
        payload.minActivityDistanceKm = minKm
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

        <fieldset className="distance-fieldset">
          <legend>Loại thử thách</legend>
          <div className="distance-chips">
            <button
              type="button"
              className={mode === 'monthly_pace' ? 'chip active' : 'chip'}
              onClick={() => setMode('monthly_pace')}
            >
              Theo tháng + pace
            </button>
            <button
              type="button"
              className={mode === 'activity_count' ? 'chip active' : 'chip'}
              onClick={() => setMode('activity_count')}
            >
              Khoảng ngày + số hoạt động
            </button>
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            {mode === 'monthly_pace'
              ? 'Tự lấy ngày đầu → cuối tháng; chỉ tính hoạt động trong khoảng pace A–B.'
              : 'Từ ngày → đến ngày; phải hoàn thành N hoạt động, mỗi lần ≥ D km.'}
          </p>
        </fieldset>

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
            rows={4}
          />
        </label>

        {mode === 'monthly_pace' ? (
          <>
            <label>
              Tháng
              <input
                type="month"
                value={monthValue}
                onChange={(e) => setMonthValue(e.target.value)}
                required
              />
            </label>
            <div className="pr-edit-grid">
              <label>
                Ngày bắt đầu
                <input type="date" value={startDate} readOnly />
              </label>
              <label>
                Ngày kết thúc
                <input type="date" value={endDate} readOnly />
              </label>
            </div>
            <div className="pr-edit-grid">
              <label>
                Pace từ (mm:ss hoặc phút)
                <input
                  value={paceMinInput}
                  onChange={(e) => setPaceMinInput(e.target.value)}
                  placeholder="04:00"
                  required
                />
              </label>
              <label>
                Pace đến (mm:ss hoặc phút)
                <input
                  value={paceMaxInput}
                  onChange={(e) => setPaceMaxInput(e.target.value)}
                  placeholder="08:00"
                  required
                />
              </label>
            </div>

            <fieldset className="distance-fieldset">
              <legend>Cự ly mục tiêu (km tích lũy)</legend>
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
          </>
        ) : (
          <>
            <div className="pr-edit-grid">
              <label>
                Từ ngày
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </label>
              <label>
                Đến ngày
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </label>
            </div>
            <div className="pr-edit-grid">
              <label>
                Số hoạt động phải hoàn thành
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={requiredActivities}
                  onChange={(e) => setRequiredActivities(e.target.value)}
                  required
                />
              </label>
              <label>
                Cự ly tối thiểu mỗi hoạt động (km)
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={minActivityKm}
                  onChange={(e) => setMinActivityKm(e.target.value)}
                  required
                />
              </label>
            </div>
          </>
        )}

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

        <label>
          Mật khẩu tham gia (tùy chọn)
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
          />
        </label>

        <p className="challenge-preview">{preview}</p>

        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn primary wide" disabled={busy}>
          {busy ? 'Đang tạo…' : 'Tạo thử thách'}
        </button>
      </form>
    </div>
  )
}
