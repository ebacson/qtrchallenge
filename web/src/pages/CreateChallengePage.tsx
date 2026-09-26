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
  countInclusiveDays,
  formatDayQuotaLabel,
  formatPaceMinutes,
  parsePaceInput,
  STATUS_UPCOMING,
} from '../lib/challengeRules'
import { db } from '../lib/firebase'
import type { DayQuotaOption } from '../types'

const PRESET_DISTANCES = ['50 km', '100 km', '150 km', '200 km', '250 km', '300 km']
const JOIN_DEADLINE_OPTIONS = [3, 7, 14, 21, 30, 45, 60]

type Mode = 'monthly_pace' | 'day_quota'

type QuotaDraft = { daysRequired: string; kmPerDay: string }

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
  const [quotaOptions, setQuotaOptions] = useState<QuotaDraft[]>([
    { daysRequired: '', kmPerDay: '5' },
  ])
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

  const totalDays = useMemo(() => {
    if (mode !== 'day_quota') return 0
    if (!startDate || !endDate || endDate < startDate) return 0
    return countInclusiveDays(
      inputDateToChallengeDay(startDate),
      inputDateToChallengeDay(endDate),
    )
  }, [mode, startDate, endDate])

  useEffect(() => {
    if (mode !== 'day_quota' || totalDays <= 0) return
    setQuotaOptions((prev) =>
      prev.map((o, i) =>
        i === 0 && !o.daysRequired
          ? { ...o, daysRequired: String(totalDays) }
          : o,
      ),
    )
  }, [mode, totalDays])

  const distances = useMemo(() => {
    if (mode === 'day_quota') {
      if (totalDays <= 0) return []
      return quotaOptions
        .map((o) => {
          const days = Number(o.daysRequired)
          const km = Number(o.kmPerDay.replace(',', '.'))
          if (!Number.isFinite(days) || days < 1 || !Number.isFinite(km) || km <= 0) {
            return null
          }
          return formatDayQuotaLabel(days, totalDays, km)
        })
        .filter((x): x is string => Boolean(x))
    }
    const list = [...selected]
    if (customOn && customKm.trim()) {
      const n = Number(customKm.replace(',', '.'))
      if (n > 0) list.push(`${n} km`)
    }
    return list
  }, [mode, selected, customOn, customKm, quotaOptions, totalDays])

  const parsedQuotaOptions: DayQuotaOption[] = useMemo(() => {
    return quotaOptions
      .map((o) => ({
        daysRequired: Number(o.daysRequired),
        kmPerDay: Number(o.kmPerDay.replace(',', '.')),
      }))
      .filter(
        (o) =>
          Number.isFinite(o.daysRequired) &&
          o.daysRequired > 0 &&
          Number.isFinite(o.kmPerDay) &&
          o.kmPerDay > 0,
      )
  }, [quotaOptions])

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
    return `${startLabel} → ${endLabel} (${totalDays} ngày) · ${distances.join(' | ') || 'chưa có tùy chọn'}`
  }, [
    mode,
    startDate,
    endDate,
    paceMinInput,
    paceMaxInput,
    distances,
    totalDays,
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

  function updateQuota(index: number, patch: Partial<QuotaDraft>) {
    setQuotaOptions((prev) =>
      prev.map((o, i) => (i === index ? { ...o, ...patch } : o)),
    )
  }

  function addQuotaOption() {
    setQuotaOptions((prev) => [
      ...prev,
      {
        daysRequired: totalDays > 0 ? String(Math.max(1, totalDays - prev.length)) : '',
        kmPerDay: '5',
      },
    ])
  }

  function removeQuotaOption(index: number) {
    setQuotaOptions((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index),
    )
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
      if (totalDays < 1) {
        setError('Khoảng ngày không hợp lệ.')
        return
      }
      if (parsedQuotaOptions.length === 0) {
        setError('Thêm ít nhất một tùy chọn (số ngày / km mỗi ngày).')
        return
      }
      for (const [i, o] of parsedQuotaOptions.entries()) {
        if (o.daysRequired > totalDays) {
          setError(`Tùy chọn ${i + 1}: số ngày hoàn thành không được vượt ${totalDays}.`)
          return
        }
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
        payload.totalDays = totalDays
        payload.dayQuotaOptions = parsedQuotaOptions
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
              className={mode === 'day_quota' ? 'chip active' : 'chip'}
              onClick={() => setMode('day_quota')}
            >
              Khoảng ngày + tùy chọn ngày/km
            </button>
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            {mode === 'monthly_pace'
              ? 'Tự lấy ngày đầu → cuối tháng; chỉ tính hoạt động trong khoảng pace A–B.'
              : 'Từ ngày → đến ngày; nhiều tùy chọn như 15/15 ngày × 5 km/ngày, 13/15 × 8 km/ngày…'}
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
            <p className="tiny muted">
              Tổng số ngày trong khoảng: <strong>{totalDays || '—'}</strong>
            </p>

            <fieldset className="distance-fieldset">
              <legend>Các tùy chọn hoàn thành</legend>
              <p className="tiny muted" style={{ marginBottom: 10 }}>
                Ví dụ 15 ngày: tùy chọn 1 = 15/15 ngày × 5 km/ngày; tùy chọn 2 =
                13/15 ngày × 8 km/ngày.
              </p>
              {quotaOptions.map((o, index) => (
                <div key={index} className="quota-option-row">
                  <span className="quota-option-label">Tùy chọn {index + 1}</span>
                  <label>
                    Số ngày phải hoàn thành
                    <input
                      type="number"
                      min={1}
                      max={totalDays || undefined}
                      step={1}
                      value={o.daysRequired}
                      onChange={(e) =>
                        updateQuota(index, { daysRequired: e.target.value })
                      }
                      placeholder={totalDays ? String(totalDays) : '15'}
                      required
                    />
                  </label>
                  <label>
                    Km mỗi ngày
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={o.kmPerDay}
                      onChange={(e) =>
                        updateQuota(index, { kmPerDay: e.target.value })
                      }
                      placeholder="5"
                      required
                    />
                  </label>
                  <button
                    type="button"
                    className="btn ghost compact danger"
                    disabled={quotaOptions.length <= 1}
                    onClick={() => removeQuotaOption(index)}
                  >
                    Xóa
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn ghost"
                onClick={addQuotaOption}
              >
                + Thêm tùy chọn
              </button>
            </fieldset>
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
