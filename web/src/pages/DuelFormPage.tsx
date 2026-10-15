import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { push, ref, update } from 'firebase/database'
import { DuelInvitePicker } from '../components/DuelInvitePicker'
import { useAuth } from '../context/AuthContext'
import { inputDateToChallengeDay, todayInputValue } from '../lib/adminOps'
import { formatPaceMinutes, parsePaceInput } from '../lib/challengeRules'
import {
  activeDuelCount,
  DUEL_METRIC_LABELS,
  DUEL_SECRETS_PATH,
  DUELS_PATH,
  duelPaceRange,
  duelPhase,
  duelTimes,
  duelWinRule,
  formatJoinDeadline,
  joinUntilFor,
  MAX_ACTIVE_DUELS,
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
  single: boolean
  target: string
  minKm: string
  paceMin: string
  paceMax: string
  winnerCount: string
  dayInput: string
  stakeText: string
  fundAmount: string
  invited: string[]
  password: string
}

const FORM_METRICS: DuelMetric[] = ['distance', 'best_effort']

const METRIC_HINTS: Record<DuelMetric, string> = {
  distance: 'Tính km chạy trong ngày, chỉ những hoạt động có pace nằm trong khoảng đặt ra.',
  pace: 'Tính km chạy trong ngày, chỉ những hoạt động có pace nằm trong khoảng đặt ra.',
  count: 'Đếm số hoạt động đạt cự ly tối thiểu.',
  best_effort: 'Pace trung bình của hoạt động nhanh nhất có cự ly đạt yêu cầu.',
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
  return {
    title: '',
    description: '',
    metric: 'distance',
    kind: 'target',
    single: false,
    target: '21',
    minKm: '1',
    paceMin: '03:30',
    paceMax: '15:00',
    winnerCount: '1',
    dayInput: addDaysInput(todayInputValue(), 1),
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
    metric: duel.metric === 'pace' ? 'distance' : duel.metric,
    kind: duel.kind,
    single: duel.single,
    target:
      duel.metric === 'best_effort'
        ? duel.kind === 'target'
          ? formatPaceMinutes(duel.target)
          : ''
        : String(duel.target || ''),
    minKm: String(duel.minKm || ''),
    paceMin: formatPaceMinutes(duelPaceRange(duel)[0]),
    paceMax: formatPaceMinutes(duelPaceRange(duel)[1]),
    winnerCount: String(duel.winnerCount),
    dayInput: dayToInput(duel.startDate),
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

  const day = inputDateToChallengeDay(draft.dayInput)
  const times = duelTimes(day, day)
  const isBestEffort = draft.metric === 'best_effort'
  const single = draft.single && !isBestEffort
  const fund = parseMoney(draft.fundAmount)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    const title = draft.title.trim()
    if (!title) return setError('Nhập tên thách đấu.')
    if (!times) return setError('Chọn ngày diễn ra.')
    if (times.startAt <= nowMs()) {
      return setError('Ngày diễn ra phải từ ngày mai trở đi để mọi người kịp đăng ký.')
    }

    let target = 0
    if (draft.kind === 'target') {
      target = isBestEffort ? (parsePaceInput(draft.target) ?? 0) : toNumber(draft.target)
      if (!(target > 0)) {
        return setError(isBestEffort ? 'Nhập pace mục tiêu (mm:ss).' : 'Nhập mục tiêu lớn hơn 0.')
      }
      if (draft.metric === 'count' && !Number.isInteger(target)) {
        return setError('Số hoạt động phải là số nguyên.')
      }
    }
    const minKm = single ? 0 : toNumber(draft.minKm || '0')
    if ((draft.metric === 'count' || isBestEffort) && !(minKm > 0)) {
      return setError('Nhập cự ly tối thiểu mỗi hoạt động.')
    }
    if (!(minKm >= 0) || minKm > 1000) return setError('Cự ly tối thiểu không hợp lệ.')
    const paceMin = parsePaceInput(draft.paceMin)
    const paceMax = parsePaceInput(draft.paceMax)
    if (!paceMin || !paceMax || paceMin >= paceMax || paceMax > 30) {
      return setError('Khoảng pace không hợp lệ (VD: 03:30 đến 15:00).')
    }
    const winnerCount = Math.floor(toNumber(draft.winnerCount))
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
      single: single || null,
      target: draft.kind === 'target' ? target : 0,
      minKm,
      paceMin,
      paceMax,
      winnerCount,
      startDate: day,
      endDate: day,
      startAt: times.startAt,
      endAt: times.endAt,
      joinDays: 0,
      joinUntil: joinUntilFor(times.startAt, times.endAt, 0),
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
      <div className="distance-chips">{FORM_METRICS.map(metricChip)}</div>
      <p className="tiny muted">{METRIC_HINTS[draft.metric]}</p>
      {!isBestEffort && (
        <>
          <div className="distance-chips">
            <button
              type="button"
              className={!draft.single ? 'chip active' : 'chip'}
              onClick={() => patch({ single: false })}
            >
              Cộng dồn các hoạt động
            </button>
            <button
              type="button"
              className={draft.single ? 'chip active' : 'chip'}
              onClick={() => patch({ single: true })}
            >
              Chỉ một hoạt động
            </button>
          </div>
          <p className="tiny muted">
            {draft.single
              ? 'Chỉ tính hoạt động dài nhất trong ngày.'
              : 'Cộng km của tất cả các hoạt động trong ngày.'}
          </p>
        </>
      )}
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
        {duelWinRule({
          kind: draft.kind,
          metric: draft.metric,
          winnerCount: Math.max(1, Math.floor(toNumber(draft.winnerCount)) || 1),
        })}
      </p>

      <h2>2. Mục tiêu và ngày diễn ra</h2>
      <label>
        Tên thách đấu
        <input
          value={draft.title}
          maxLength={100}
          placeholder="VD: Kèo 50 km ngày 16/10"
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
            {isBestEffort ? 'Pace mục tiêu (mm:ss)' : 'Cự ly (km)'}
            <input
              value={draft.target}
              inputMode={isBestEffort ? 'text' : 'decimal'}
              placeholder={isBestEffort ? '05:30' : '21'}
              onChange={(e) => patch({ target: e.target.value })}
            />
          </label>
        )}
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
        {(isBestEffort || !single) && (
          <label>
            {isBestEffort ? 'Cự ly hoạt động ≥ (km)' : 'Mỗi hoạt động tối thiểu (km)'}
            <input
              value={draft.minKm}
              inputMode="decimal"
              placeholder={isBestEffort ? '10' : '1'}
              onChange={(e) => patch({ minKm: e.target.value })}
            />
          </label>
        )}
      </div>
      <div className="pr-edit-grid">
        <label>
          Pace từ (mm:ss)
          <input
            value={draft.paceMin}
            placeholder="03:30"
            onChange={(e) => patch({ paceMin: e.target.value })}
          />
        </label>
        <label>
          Pace đến (mm:ss)
          <input
            value={draft.paceMax}
            placeholder="15:00"
            onChange={(e) => patch({ paceMax: e.target.value })}
          />
        </label>
      </div>
      <p className="tiny muted">
        Chỉ tính hoạt động có pace trung bình trong khoảng này. Mặc định 03:30–15:00.
      </p>
      <label>
        Ngày diễn ra
        <input
          type="date"
          value={draft.dayInput}
          min={addDaysInput(todayInputValue(), 1)}
          onChange={(e) => patch({ dayInput: e.target.value })}
          required
        />
      </label>
      <p className="tiny muted">
        Thách đấu diễn ra trong 1 ngày (00:00–23:59).
        {times && ` Hạn đăng ký: ${formatJoinDeadline(joinUntilFor(times.startAt, times.endAt, 0))}.`}{' '}
        Admin phải duyệt trước ngày diễn ra.
      </p>

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
        {fund > 0 ? `${formatVnd(fund)} / người. ` : ''}Tiền góp chuyển vào quỹ CLB, thủ quỹ xác nhận.
        CLB không giữ tiền và không xử lý cược giữa cá nhân.
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
