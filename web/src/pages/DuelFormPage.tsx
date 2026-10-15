import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { push, ref, update } from 'firebase/database'
import { DuelInvitePicker } from '../components/DuelInvitePicker'
import { useAuth } from '../context/AuthContext'
import { inputDateToChallengeDay, todayInputValue } from '../lib/adminOps'
import { countInclusiveDays, formatPaceMinutes, parsePaceInput } from '../lib/challengeRules'
import {
  activeDuelCount,
  DAY_MS,
  DUEL_METRIC_LABELS,
  DUEL_SECRETS_PATH,
  DUELS_PATH,
  duelPhase,
  duelTimes,
  formatJoinDeadline,
  joinUntilFor,
  MAX_ACTIVE_DUELS,
  MAX_DUEL_DAYS,
  MAX_DUEL_FUND,
  parseDuel,
  parseDuels,
  type Duel,
  type DuelKind,
  type DuelMetric,
} from '../lib/duels'
import { db } from '../lib/firebase'
import { formatVnd } from '../lib/rewardPenalty'
import { useSharedValue } from '../lib/sharedValue'

type Draft = {
  title: string
  description: string
  metric: DuelMetric
  kind: DuelKind
  target: string
  minKm: string
  paceMin: string
  paceMax: string
  winnerCount: string
  startInput: string
  endInput: string
  joinDays: number
  stakeText: string
  fundAmount: string
  invited: string[]
  password: string
}

const METRIC_HINTS: Record<DuelMetric, string> = {
  distance: 'Cộng dồn km các buổi chạy trong thời gian thách đấu.',
  pace: 'Cộng dồn km, chỉ tính buổi có pace nằm trong khoảng đặt ra.',
  count: 'Đếm số buổi chạy đạt cự ly tối thiểu.',
  best_effort: 'Pace trung bình của buổi nhanh nhất có cự ly đạt yêu cầu.',
}

function addDaysInput(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

/** dd-MM-yyyy → yyyy-MM-dd */
function dayToInput(day: string): string {
  const [d, m, y] = day.split('-')
  return y && m && d ? `${y}-${m}-${d}` : ''
}

function nowMs(): number {
  return Date.now()
}

function toNumber(value: string): number {
  return Number(value.replace(',', '.'))
}

function parseMoney(value: string): number {
  const n = Math.round(Number(value.replace(/[.,\s]/g, '') || '0'))
  return Number.isFinite(n) && n > 0 ? n : 0
}

function emptyDraft(): Draft {
  const start = addDaysInput(todayInputValue(), 1)
  return {
    title: '',
    description: '',
    metric: 'distance',
    kind: 'target',
    target: '100',
    minKm: '5',
    paceMin: '05:00',
    paceMax: '07:00',
    winnerCount: '1',
    startInput: start,
    endInput: addDaysInput(start, 13),
    joinDays: 0,
    stakeText: '',
    fundAmount: '',
    invited: [],
    password: '',
  }
}

function draftFromDuel(duel: Duel, password: string): Draft {
  return {
    title: duel.title,
    description: duel.description,
    metric: duel.metric,
    kind: duel.kind,
    target:
      duel.metric === 'best_effort'
        ? duel.kind === 'target'
          ? formatPaceMinutes(duel.target)
          : ''
        : String(duel.target || ''),
    minKm: String(duel.minKm || ''),
    paceMin: duel.paceMin ? formatPaceMinutes(duel.paceMin) : '05:00',
    paceMax: duel.paceMax ? formatPaceMinutes(duel.paceMax) : '07:00',
    winnerCount: String(duel.winnerCount),
    startInput: dayToInput(duel.startDate),
    endInput: dayToInput(duel.endDate),
    joinDays: duel.joinDays,
    stakeText: duel.stakeText,
    fundAmount: duel.fundAmount ? String(duel.fundAmount) : '',
    invited: duel.invited,
    password,
  }
}

function DuelForm({ initial, editing }: { initial: Draft; editing: Duel | null }) {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const isAdmin = Boolean(profile?.admin)
  const allDuels = parseDuels(useSharedValue(DUELS_PATH))
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function patch(next: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...next }))
  }

  const startDate = inputDateToChallengeDay(draft.startInput)
  const endDate = inputDateToChallengeDay(draft.endInput)
  const times = duelTimes(startDate, endDate)
  const totalDays = times ? countInclusiveDays(startDate, endDate) : 0
  // Thách đấu 1 ngày chỉ cho đăng ký trước ngày đó
  const joinOptions = Array.from({ length: Math.max(1, Math.min(totalDays, 8)) }, (_, i) => i)
  const joinDays = Math.min(draft.joinDays, joinOptions.length - 1)
  const isBestEffort = draft.metric === 'best_effort'
  const fund = parseMoney(draft.fundAmount)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    const title = draft.title.trim()
    if (!title) return setError('Nhập tên thách đấu.')
    if (!times) return setError('Chọn ngày bắt đầu và kết thúc hợp lệ.')
    if (times.startAt + DAY_MS <= nowMs()) return setError('Ngày bắt đầu phải từ hôm nay trở đi.')
    if (totalDays > MAX_DUEL_DAYS) return setError(`Thách đấu dài tối đa ${MAX_DUEL_DAYS} ngày.`)
    if (joinUntilFor(times.startAt, times.endAt, joinDays) <= nowMs()) {
      return setError('Hạn tham gia đã qua. Chọn ngày bắt đầu muộn hơn hoặc hạn tham gia dài hơn.')
    }

    let target = 0
    if (draft.kind === 'target') {
      target = isBestEffort ? (parsePaceInput(draft.target) ?? 0) : toNumber(draft.target)
      if (!(target > 0)) {
        return setError(isBestEffort ? 'Nhập pace mục tiêu (mm:ss).' : 'Nhập mục tiêu lớn hơn 0.')
      }
      if (draft.metric === 'count' && !Number.isInteger(target)) {
        return setError('Số buổi phải là số nguyên.')
      }
    }
    const minKm = toNumber(draft.minKm || '0')
    if ((draft.metric === 'count' || isBestEffort) && !(minKm > 0)) {
      return setError('Nhập cự ly tối thiểu mỗi buổi.')
    }
    if (!(minKm >= 0) || minKm > 1000) return setError('Cự ly tối thiểu không hợp lệ.')
    let paceMin: number | null = null
    let paceMax: number | null = null
    if (draft.metric === 'pace') {
      paceMin = parsePaceInput(draft.paceMin)
      paceMax = parsePaceInput(draft.paceMax)
      if (!paceMin || !paceMax || paceMin >= paceMax || paceMax > 30) {
        return setError('Khoảng pace không hợp lệ (VD: 05:00 đến 07:00).')
      }
    }
    const winnerCount = draft.kind === 'ranking' ? Math.floor(toNumber(draft.winnerCount)) : 1
    if (!(winnerCount >= 1 && winnerCount <= 50)) return setError('Số người thắng từ 1 đến 50.')
    if (fund > MAX_DUEL_FUND) return setError(`Góp quỹ tối đa ${formatVnd(MAX_DUEL_FUND)} mỗi người.`)
    const password = draft.password.trim()
    if (password.length > 50) return setError('Mật khẩu tối đa 50 ký tự.')
    if (!editing && !isAdmin && activeDuelCount(allDuels, user.uid) >= MAX_ACTIVE_DUELS) {
      return setError(`Mỗi người tối đa ${MAX_ACTIVE_DUELS} thách đấu chờ duyệt hoặc đang chạy.`)
    }

    const fields: Record<string, unknown> = {
      title,
      description: draft.description.trim(),
      metric: draft.metric,
      kind: draft.kind,
      target: draft.kind === 'target' ? target : 0,
      minKm,
      paceMin,
      paceMax,
      winnerCount,
      startDate,
      endDate,
      startAt: times.startAt,
      endAt: times.endAt,
      joinDays,
      joinUntil: joinUntilFor(times.startAt, times.endAt, joinDays),
      stakeText: draft.stakeText.trim(),
      fundAmount: fund,
      hasPassword: password ? true : null,
      invited: draft.invited.length
        ? Object.fromEntries(draft.invited.map((uid) => [uid, true]))
        : null,
      approval: { status: 'pending' },
    }

    setBusy(true)
    setError('')
    try {
      if (editing) {
        const updates: Record<string, unknown> = { [`${DUEL_SECRETS_PATH}/${editing.id}`]: password ? { password } : null }
        for (const [k, v] of Object.entries(fields)) updates[`${DUELS_PATH}/${editing.id}/${k}`] = v
        updates[`${DUELS_PATH}/${editing.id}/updatedAt`] = nowMs()
        await update(ref(db), updates)
        navigate(`/duels/${editing.id}`)
      } else {
        const id = push(ref(db, DUELS_PATH)).key
        if (!id) throw new Error('Không tạo được mã thách đấu')
        const name = profile?.fullName || user.email || 'Thành viên'
        const now = nowMs()
        const updates: Record<string, unknown> = {
          [`${DUELS_PATH}/${id}`]: {
            ...fields,
            createdBy: user.uid,
            createdByName: name,
            createdAt: now,
            participants: { [user.uid]: { name, joinedAt: now } },
          },
        }
        if (password) updates[`${DUEL_SECRETS_PATH}/${id}`] = { password }
        await update(ref(db), updates)
        navigate(`/duels/${id}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được')
      setBusy(false)
    }
  }

  const metricChip = (m: DuelMetric) => (
    <button
      key={m}
      type="button"
      className={draft.metric === m ? 'chip active' : 'chip'}
      onClick={() => patch({ metric: m })}
    >
      {DUEL_METRIC_LABELS[m]}
    </button>
  )

  return (
    <form className="auth-form panel duel-form" onSubmit={(e) => void onSubmit(e)}>
      <h2>1. Kiểu thách đấu</h2>
      <div className="distance-chips">
        {(['distance', 'pace', 'count', 'best_effort'] as DuelMetric[]).map(metricChip)}
      </div>
      <p className="tiny muted">{METRIC_HINTS[draft.metric]}</p>
      <div className="distance-chips">
        <button
          type="button"
          className={draft.kind === 'target' ? 'chip active' : 'chip'}
          onClick={() => patch({ kind: 'target' })}
        >
          Đạt mục tiêu
        </button>
        <button
          type="button"
          className={draft.kind === 'ranking' ? 'chip active' : 'chip'}
          onClick={() => patch({ kind: 'ranking' })}
        >
          Xếp hạng
        </button>
      </div>
      <p className="tiny muted">
        {draft.kind === 'target'
          ? 'Ai đạt mục tiêu là thắng, có thể nhiều người cùng thắng.'
          : 'Kết thúc thì xếp hạng, người đứng đầu thắng.'}
      </p>

      <h2>2. Mục tiêu và thời gian</h2>
      <label>
        Tên thách đấu
        <input
          value={draft.title}
          maxLength={100}
          placeholder="VD: Kèo 100 km tháng 11"
          onChange={(e) => patch({ title: e.target.value })}
          required
        />
      </label>
      <label>
        Mô tả (không bắt buộc)
        <textarea
          rows={3}
          maxLength={2000}
          value={draft.description}
          onChange={(e) => patch({ description: e.target.value })}
        />
      </label>
      <div className="pr-edit-grid">
        {draft.kind === 'target' && (
          <label>
            {draft.metric === 'count'
              ? 'Số buổi cần chạy'
              : isBestEffort
                ? 'Pace mục tiêu (mm:ss)'
                : 'Mục tiêu (km)'}
            <input
              value={draft.target}
              inputMode={isBestEffort ? 'text' : 'decimal'}
              placeholder={isBestEffort ? '05:30' : draft.metric === 'count' ? '10' : '100'}
              onChange={(e) => patch({ target: e.target.value })}
            />
          </label>
        )}
        {draft.kind === 'ranking' && (
          <label>
            Số người thắng
            <input
              type="number"
              min={1}
              max={50}
              value={draft.winnerCount}
              onChange={(e) => patch({ winnerCount: e.target.value })}
            />
          </label>
        )}
        <label>
          {isBestEffort ? 'Cự ly buổi chạy ≥ (km)' : 'Mỗi buổi tối thiểu (km)'}
          <input
            value={draft.minKm}
            inputMode="decimal"
            placeholder={draft.metric === 'distance' || draft.metric === 'pace' ? '1' : '5'}
            onChange={(e) => patch({ minKm: e.target.value })}
          />
        </label>
      </div>
      {draft.metric === 'pace' && (
        <div className="pr-edit-grid">
          <label>
            Pace từ (mm:ss)
            <input value={draft.paceMin} onChange={(e) => patch({ paceMin: e.target.value })} />
          </label>
          <label>
            Pace đến (mm:ss)
            <input value={draft.paceMax} onChange={(e) => patch({ paceMax: e.target.value })} />
          </label>
        </div>
      )}
      <div className="pr-edit-grid">
        <label>
          Từ ngày
          <input
            type="date"
            value={draft.startInput}
            min={todayInputValue()}
            onChange={(e) => patch({ startInput: e.target.value })}
            required
          />
        </label>
        <label>
          Đến ngày
          <input
            type="date"
            value={draft.endInput}
            min={draft.startInput}
            onChange={(e) => patch({ endInput: e.target.value })}
            required
          />
        </label>
      </div>
      <p className="tiny muted">
        {totalDays ? `${totalDays} ngày` : '—'} (tối đa {MAX_DUEL_DAYS} ngày). Admin phải duyệt trước
        ngày bắt đầu.
      </p>
      <label>
        Hạn tham gia
        <select value={joinDays} onChange={(e) => patch({ joinDays: Number(e.target.value) })}>
          {joinOptions.map((n) => (
            <option key={n} value={n}>
              {`${n === 0 ? 'Trước khi bắt đầu' : `Đến hết ngày thứ ${n}`}${
                times ? ` (${formatJoinDeadline(joinUntilFor(times.startAt, times.endAt, n))})` : ''
              }`}
            </option>
          ))}
        </select>
      </label>
      {totalDays === 1 && (
        <p className="tiny muted">Thách đấu 1 ngày: phải đăng ký trước ngày diễn ra.</p>
      )}

      <h2>3. Cam kết thưởng – phạt</h2>
      <label>
        Cam kết (không bắt buộc)
        <input
          value={draft.stakeText}
          maxLength={300}
          placeholder="VD: Người thua mời cả nhóm cà phê"
          onChange={(e) => patch({ stakeText: e.target.value })}
        />
      </label>
      <label>
        Góp quỹ CLB mỗi người thua / không đạt (đ, không bắt buộc)
        <input
          value={draft.fundAmount}
          inputMode="numeric"
          placeholder="VD: 50000"
          onChange={(e) => patch({ fundAmount: e.target.value })}
        />
      </label>
      <p className="tiny muted">
        {fund > 0 ? `${formatVnd(fund)} / người. ` : ''}Tiền góp chuyển vào quỹ CLB qua mã QR, thủ quỹ
        xác nhận. Web không giữ tiền và không xử lý cược giữa cá nhân.
      </p>

      <h2>4. Mời người tham gia</h2>
      <DuelInvitePicker
        selected={draft.invited}
        exclude={[editing?.createdBy ?? user?.uid ?? '']}
        onChange={(invited) => patch({ invited })}
      />
      <label>
        Mật khẩu tham gia (không bắt buộc)
        <input
          value={draft.password}
          maxLength={50}
          placeholder="Để trống: thành viên nào cũng tham gia được"
          onChange={(e) => patch({ password: e.target.value })}
        />
      </label>
      <p className="tiny muted">
        Người được mời tham gia không cần mật khẩu. Người khác phải nhập đúng mật khẩu (nếu có).
      </p>

      {error && <p className="form-error">{error}</p>}
      <div className="btn-row">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Đang lưu…' : editing ? 'Lưu và gửi duyệt lại' : 'Gửi Admin duyệt'}
        </button>
        <Link className="btn ghost" to={editing ? `/duels/${editing.id}` : '/duels'}>
          Hủy
        </Link>
      </div>
    </form>
  )
}

export function DuelFormPage() {
  const { id } = useParams()
  const { user, profile } = useAuth()
  const raw = useSharedValue(id ? `${DUELS_PATH}/${id}` : null)
  const duel = id && raw ? parseDuel(id, raw) : null
  const canEdit =
    duel &&
    (profile?.admin || duel.createdBy === user?.uid) &&
    ['pending', 'rejected', 'expired'].includes(duelPhase(duel))
  const secret = useSharedValue<{ password?: string }>(canEdit && id ? `${DUEL_SECRETS_PATH}/${id}` : null)

  let body
  if (!id) {
    body = <DuelForm initial={emptyDraft()} editing={null} />
  } else if (raw === undefined || (canEdit && secret === undefined)) {
    body = <p className="empty">Đang tải…</p>
  } else if (!duel) {
    body = <p className="empty">Không tìm thấy thách đấu.</p>
  } else if (!canEdit) {
    body = <p className="empty">Chỉ sửa được thách đấu đang chờ duyệt hoặc bị từ chối.</p>
  } else {
    body = <DuelForm key={id} initial={draftFromDuel(duel, secret?.password ?? '')} editing={duel} />
  }

  return (
    <div className="page">
      <Link className="back-link" to={id ? `/duels/${id}` : '/duels'}>
        ← Thách đấu
      </Link>
      <header className="page-header">
        <p className="eyebrow">Thách đấu</p>
        <h1>{id ? 'Sửa thách đấu' : 'Tạo thách đấu'}</h1>
      </header>
      {body}
    </div>
  )
}
