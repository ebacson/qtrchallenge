import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { get, push, ref, set, update } from 'firebase/database'
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
  calculateStatus,
  countInclusiveDays,
  formatDay,
  formatDayQuotaLabel,
  formatPaceMinutes,
  joinDeadlineDate,
  parseChallenge,
  parsePaceInput,
  STATUS_FINISHED,
  STATUS_UPCOMING,
} from '../lib/challengeRules'
import { db } from '../lib/firebase'
import {
  DEFAULT_PENALTY_TIERS,
  formatVnd,
  penaltySummary,
  rewardItemsSummary,
} from '../lib/rewardPenalty'
import type { DayQuotaOption, PenaltyTier, RewardItem, RewardTier } from '../types'

const PRESET_DISTANCES = ['50 km', '100 km', '150 km', '200 km', '250 km', '300 km']
type Mode = 'monthly_pace' | 'day_quota'

type QuotaDraft = {
  daysRequired: string
  kmPerDay: string
  perDay: boolean
  dailyKm: string[]
}

type PenaltyDraft = { minPercent: string; amount: string }
type RewardItemDraft = { name: string; quantity: string }
/** Các món quà của một mục tiêu; rỗng = không có thưởng */
type RewardDraft = RewardItemDraft[]

type FormInitial = {
  /** 'legacy': loại thử thách cũ form không hỗ trợ — chỉ sửa thông tin chung, thưởng/phạt */
  mode: Mode | 'legacy'
  name: string
  description: string
  monthValue: string
  startDate: string
  endDate: string
  paceMinInput: string
  paceMaxInput: string
  quotaOptions: QuotaDraft[]
  selected: string[]
  password: string
  joinDeadlineInput: string
  icon: string
  penaltyRows: PenaltyDraft[]
  /** Thử thách khoảng ngày: một mức phạt cho người không hoàn thành ('' = không phạt) */
  flatPenalty: string
  /** Phạt thành viên chính thức không tham gia ('' = không phạt) */
  absentPenalty: string
  rewardDrafts: Record<string, RewardDraft>
}

type EditContext = {
  id: string
  participantCount: number
  targetDistances: string[]
  storedStatus: string
  initial: FormInitial
}

const EMPTY_QUOTA: QuotaDraft = { daysRequired: '', kmPerDay: '5', perDay: false, dailyKm: [] }

function toPenaltyDrafts(tiers: PenaltyTier[]): PenaltyDraft[] {
  return tiers.map((t, i) => ({
    minPercent: i === tiers.length - 1 ? '0' : String(t.minPercent),
    amount: String(t.amount),
  }))
}

function toKm(value: string): number {
  return Number(value.replace(',', '.'))
}

/** dd-MM-yyyy → yyyy-MM-dd (HTML date input) */
function challengeDayToInput(day: string): string {
  const [d, m, y] = day.split('-')
  if (!y || !m || !d) return ''
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/** Số ô km theo ngày = số ngày phải hoàn thành (giới hạn để tránh nhập nhầm số lớn). */
function dailySlotCount(o: QuotaDraft): number {
  const n = Number(o.daysRequired)
  return Number.isInteger(n) && n > 0 ? Math.min(n, 366) : 0
}

function syncDailySlots(o: QuotaDraft): QuotaDraft {
  if (!o.perDay) return o
  const size = dailySlotCount(o)
  if (o.dailyKm.length === size) return o
  const dailyKm =
    o.dailyKm.length > size
      ? o.dailyKm.slice(0, size)
      : [...o.dailyKm, ...Array<string>(size - o.dailyKm.length).fill(o.kmPerDay)]
  return { ...o, dailyKm }
}

function draftToOption(o: QuotaDraft): DayQuotaOption | null {
  const daysRequired = Number(o.daysRequired)
  const kmPerDay = toKm(o.kmPerDay)
  if (!Number.isInteger(daysRequired) || daysRequired < 1 || !(kmPerDay > 0)) {
    return null
  }
  if (!o.perDay) return { daysRequired, kmPerDay }
  const dailyKm = o.dailyKm.map(toKm)
  if (dailyKm.length !== daysRequired || dailyKm.some((km) => !(km > 0))) return null
  return { daysRequired, kmPerDay: Math.min(...dailyKm), dailyKm }
}

/** Mức phạt hợp lệ (giảm dần theo %, mức cuối từ 0%) hoặc thông báo lỗi. */
function parsePenaltyRows(rows: PenaltyDraft[]): PenaltyTier[] | string {
  const tiers: PenaltyTier[] = []
  for (const [i, row] of rows.entries()) {
    const minPercent = i === rows.length - 1 ? 0 : Number(row.minPercent)
    const amount = Number(row.amount.replace(/[.\s]/g, ''))
    if (!Number.isInteger(minPercent) || minPercent < 0 || minPercent > 99) {
      return `Mức phạt ${i + 1}: tỉ lệ phải là số nguyên từ 0 đến 99.`
    }
    if (i > 0 && minPercent >= tiers[i - 1].minPercent) {
      return `Mức phạt ${i + 1}: tỉ lệ phải nhỏ hơn mức phía trên (${tiers[i - 1].minPercent}%).`
    }
    if (!Number.isInteger(amount) || amount < 0) {
      return `Mức phạt ${i + 1}: số tiền phải là số nguyên ≥ 0.`
    }
    tiers.push({ minPercent, amount })
  }
  return tiers
}

/** Một mức cho mọi người không hoàn thành; trống hoặc 0 = không phạt. */
function parseFlatPenalty(raw: string): PenaltyTier[] | string {
  const text = raw.replace(/[.\s]/g, '')
  if (!text) return []
  const amount = Number(text)
  if (!Number.isInteger(amount) || amount < 0) return 'Mức phạt: số tiền phải là số nguyên ≥ 0.'
  return amount > 0 ? [{ minPercent: 0, amount }] : []
}

function parseRewardDrafts(
  targets: string[],
  drafts: Record<string, RewardDraft>,
): RewardTier[] | string {
  const rewards: RewardTier[] = []
  for (const target of targets) {
    const items: RewardItem[] = []
    for (const [i, d] of (drafts[target] ?? []).entries()) {
      const name = d.name.trim()
      const raw = d.quantity.trim()
      if (!name && !raw) continue
      const quantity = Number(raw)
      if (!name) return `Phần thưởng "${target}", quà ${i + 1}: nhập tên quà.`
      if (!raw || !Number.isInteger(quantity) || quantity < 1) {
        return `Phần thưởng "${target}", quà "${name}": số lượng phải là số nguyên ≥ 1.`
      }
      items.push({ name, quantity })
    }
    if (!items.length) continue
    rewards.push({
      target,
      gifts: items.reduce((sum, it) => sum + it.quantity, 0),
      prize: rewardItemsSummary(items),
      items,
    })
  }
  return rewards
}

function defaultInitial(): FormInitial {
  const today = todayInputValue()
  return {
    mode: 'monthly_pace',
    name: '',
    description: '',
    monthValue: currentMonthInputValue(),
    startDate: today,
    endDate: today,
    paceMinInput: '04:00',
    paceMaxInput: '08:00',
    quotaOptions: [EMPTY_QUOTA],
    selected: [],
    password: '',
    joinDeadlineInput: '7',
    icon: '',
    penaltyRows: toPenaltyDrafts(DEFAULT_PENALTY_TIERS),
    flatPenalty: '100000',
    absentPenalty: '50000',
    rewardDrafts: {},
  }
}

function editContextFrom(id: string, raw: Record<string, unknown>): EditContext {
  const c = parseChallenge(id, raw)
  const mode: FormInitial['mode'] =
    c.challengeMode === 'monthly_pace' || c.challengeMode === 'day_quota'
      ? c.challengeMode
      : 'legacy'
  const base = defaultInitial()
  const start = challengeDayToInput(c.startDate)
  const end = challengeDayToInput(c.endDate)
  const participants = raw.user_challenges
  return {
    id,
    participantCount:
      participants && typeof participants === 'object' ? Object.keys(participants).length : 0,
    targetDistances: c.targetDistances,
    storedStatus: String(raw.status ?? ''),
    initial: {
      mode,
      name: c.name,
      description: c.description,
      monthValue: start ? start.slice(0, 7) : base.monthValue,
      startDate: start || base.startDate,
      endDate: end || base.endDate,
      paceMinInput:
        c.paceMinMinutes != null ? formatPaceMinutes(c.paceMinMinutes) : base.paceMinInput,
      paceMaxInput:
        c.paceMaxMinutes != null ? formatPaceMinutes(c.paceMaxMinutes) : base.paceMaxInput,
      quotaOptions: c.dayQuotaOptions?.map((o) => ({
        daysRequired: String(o.daysRequired),
        kmPerDay: String(o.kmPerDay),
        perDay: Boolean(o.dailyKm?.length),
        dailyKm: o.dailyKm?.map(String) ?? [],
      })) ?? [EMPTY_QUOTA],
      selected: mode === 'monthly_pace' ? c.targetDistances : [],
      password: c.password ?? '',
      joinDeadlineInput: String(c.joinDeadlineDays),
      icon: c.icon ?? '',
      penaltyRows: toPenaltyDrafts(c.penaltyTiers ?? []),
      flatPenalty: c.penaltyTiers?.length
        ? String(c.penaltyTiers[c.penaltyTiers.length - 1].amount)
        : '',
      absentPenalty: c.absentPenalty ? String(c.absentPenalty) : '',
      rewardDrafts: Object.fromEntries(
        (c.rewards ?? []).map((r) => [
          r.target,
          r.items.map((it) => ({ name: it.name, quantity: String(it.quantity) })),
        ]),
      ),
    },
  }
}

function ChallengeForm({ edit }: { edit?: EditContext }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const init = edit?.initial ?? defaultInitial()
  const legacy = init.mode === 'legacy'
  const participantCount = edit?.participantCount ?? 0

  const [mode, setMode] = useState<Mode>(init.mode === 'legacy' ? 'monthly_pace' : init.mode)
  const [name, setName] = useState(init.name)
  const [description, setDescription] = useState(init.description)
  const [monthValue, setMonthValue] = useState(init.monthValue)
  const [startDate, setStartDate] = useState(init.startDate)
  const [endDate, setEndDate] = useState(init.endDate)
  const [paceMinInput, setPaceMinInput] = useState(init.paceMinInput)
  const [paceMaxInput, setPaceMaxInput] = useState(init.paceMaxInput)
  const [quotaOptions, setQuotaOptions] = useState<QuotaDraft[]>(init.quotaOptions)
  const [selected, setSelected] = useState<string[]>(init.selected)
  const [customKm, setCustomKm] = useState('')
  const [customOn, setCustomOn] = useState(false)
  const [password, setPassword] = useState(init.password)
  const [joinDeadlineInput, setJoinDeadlineInput] = useState(init.joinDeadlineInput)
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [iconPreview, setIconPreview] = useState<string | null>(init.icon || null)
  const [penaltyRows, setPenaltyRows] = useState<PenaltyDraft[]>(init.penaltyRows)
  const [flatPenalty, setFlatPenalty] = useState(init.flatPenalty)
  const [absentPenalty, setAbsentPenalty] = useState(init.absentPenalty)
  const [rewardDrafts, setRewardDrafts] = useState<Record<string, RewardDraft>>(
    init.rewardDrafts,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /** Đã có người tham gia: giữ nguyên loại và mục tiêu để tiến độ/nhãn userTarget còn đúng */
  const lockTargets = Boolean(edit) && (legacy || participantCount > 0)
  const lockDates = legacy || (lockTargets && mode === 'day_quota')

  useEffect(() => {
    if (mode !== 'monthly_pace' || legacy) return
    const bounds = monthInputBounds(monthValue)
    if (!bounds) return
    setStartDate(bounds.start)
    setEndDate(bounds.end)
  }, [mode, monthValue, legacy])

  const challengeDays = useMemo(() => {
    if (!startDate || !endDate || endDate < startDate) return 0
    return countInclusiveDays(
      inputDateToChallengeDay(startDate),
      inputDateToChallengeDay(endDate),
    )
  }, [startDate, endDate])
  const totalDays = mode === 'day_quota' ? challengeDays : 0

  /** Ngày đăng ký cuối = ngày bắt đầu + N, không được sau ngày kết thúc */
  const maxJoinDeadlineDays = Math.max(1, challengeDays - 1)
  const joinDeadlineDays = /^\d+$/.test(joinDeadlineInput.trim())
    ? Number(joinDeadlineInput.trim())
    : NaN
  const joinDeadlineLastDay =
    Number.isInteger(joinDeadlineDays) && joinDeadlineDays >= 1 && startDate
      ? joinDeadlineDate(inputDateToChallengeDay(startDate), joinDeadlineDays)
      : null

  useEffect(() => {
    if (mode !== 'day_quota' || totalDays <= 0) return
    setQuotaOptions((prev) =>
      prev.map((o, i) =>
        i === 0 && !o.daysRequired
          ? syncDailySlots({ ...o, daysRequired: String(totalDays) })
          : o,
      ),
    )
  }, [mode, totalDays])

  const parsedQuotaOptions: DayQuotaOption[] = useMemo(() => {
    if (totalDays <= 0) return []
    return quotaOptions
      .map((o) => draftToOption(o))
      .filter((o): o is DayQuotaOption => o != null)
  }, [quotaOptions, totalDays])

  const distances = useMemo(() => {
    if (lockTargets && edit) return edit.targetDistances
    if (mode === 'day_quota') {
      return parsedQuotaOptions.map((o, i) =>
        formatDayQuotaLabel(o.daysRequired, totalDays, o.kmPerDay, o.dailyKm, i + 1),
      )
    }
    const list = [...selected]
    if (customOn && customKm.trim()) {
      const n = Number(customKm.replace(',', '.'))
      if (n > 0 && !list.includes(`${n} km`)) list.push(`${n} km`)
    }
    return list
  }, [lockTargets, edit, mode, selected, customOn, customKm, parsedQuotaOptions, totalDays])

  const distanceChips = useMemo(
    () => [...PRESET_DISTANCES, ...selected.filter((d) => !PRESET_DISTANCES.includes(d))],
    [selected],
  )

  const flatPenaltyMode = mode === 'day_quota'
  const parsedPenalty = useMemo(
    () => (flatPenaltyMode ? parseFlatPenalty(flatPenalty) : parsePenaltyRows(penaltyRows)),
    [flatPenaltyMode, flatPenalty, penaltyRows],
  )
  const parsedAbsentPenalty = useMemo(() => {
    const tiers = parseFlatPenalty(absentPenalty)
    if (typeof tiers === 'string') return 'Phạt không tham gia: số tiền phải là số nguyên ≥ 0.'
    return tiers[0]?.amount ?? 0
  }, [absentPenalty])

  const preview = useMemo(() => {
    const startLabel = inputDateToChallengeDay(startDate)
    const endLabel = inputDateToChallengeDay(endDate)
    if (legacy) return `${startLabel} → ${endLabel} · ${distances.join(', ')}`
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
  }, [legacy, mode, startDate, endDate, paceMinInput, paceMaxInput, distances, totalDays])

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
      prev.map((o, i) => (i === index ? syncDailySlots({ ...o, ...patch }) : o)),
    )
  }

  function togglePerDay(index: number, on: boolean) {
    updateQuota(index, { perDay: on })
  }

  function updateDailyKm(index: number, day: number, value: string) {
    setQuotaOptions((prev) =>
      prev.map((o, i) =>
        i === index
          ? { ...o, dailyKm: o.dailyKm.map((v, d) => (d === day ? value : v)) }
          : o,
      ),
    )
  }

  function fillDailyKm(index: number) {
    setQuotaOptions((prev) =>
      prev.map((o, i) =>
        i === index
          ? { ...o, dailyKm: Array<string>(dailySlotCount(o)).fill(o.kmPerDay) }
          : o,
      ),
    )
  }

  function addQuotaOption() {
    setQuotaOptions((prev) => [
      ...prev,
      {
        daysRequired: totalDays > 0 ? String(Math.max(1, totalDays - prev.length)) : '',
        kmPerDay: '5',
        perDay: false,
        dailyKm: [],
      },
    ])
  }

  function removeQuotaOption(index: number) {
    setQuotaOptions((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index),
    )
  }

  function updatePenalty(index: number, patch: Partial<PenaltyDraft>) {
    setPenaltyRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  /** Chèn một mức ngay trên mức cuối (0%), tỉ lệ bằng nửa mức kế trên */
  function addPenaltyRow() {
    setPenaltyRows((prev) => {
      if (!prev.length) return [{ minPercent: '0', amount: '100000' }]
      const above = prev.length >= 2 ? Number(prev[prev.length - 2].minPercent) || 100 : 100
      const row = {
        minPercent: String(Math.max(1, Math.floor(above / 2))),
        amount: prev[prev.length - 1]?.amount ?? '0',
      }
      return [...prev.slice(0, -1), row, ...prev.slice(-1)]
    })
  }

  function removePenaltyRow(index: number) {
    setPenaltyRows((prev) => {
      const next = prev.filter((_, i) => i !== index)
      if (next.length) next[next.length - 1] = { ...next[next.length - 1], minPercent: '0' }
      return next
    })
  }

  function updateRewardItem(target: string, index: number, patch: Partial<RewardItemDraft>) {
    setRewardDrafts((prev) => ({
      ...prev,
      [target]: (prev[target] ?? []).map((it, i) => (i === index ? { ...it, ...patch } : it)),
    }))
  }

  function addRewardItem(target: string) {
    setRewardDrafts((prev) => ({
      ...prev,
      [target]: [...(prev[target] ?? []), { name: '', quantity: '1' }],
    }))
  }

  function removeRewardItem(target: string, index: number) {
    setRewardDrafts((prev) => ({
      ...prev,
      [target]: (prev[target] ?? []).filter((_, i) => i !== index),
    }))
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
    if (!Number.isInteger(joinDeadlineDays) || joinDeadlineDays < 1) {
      setError('Hạn tham gia phải là số ngày nguyên từ 1 trở lên.')
      return
    }
    if (challengeDays > 0 && joinDeadlineDays > maxJoinDeadlineDays) {
      setError(
        `Hạn tham gia tối đa ${maxJoinDeadlineDays} ngày (không được sau ngày kết thúc thử thách).`,
      )
      return
    }

    let paceMinMinutes: number | undefined
    let paceMaxMinutes: number | undefined

    if (!legacy && mode === 'monthly_pace') {
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
      if (!lockTargets && distances.length === 0) {
        setError('Chọn ít nhất một cự ly mục tiêu.')
        return
      }
    } else if (!legacy && !lockTargets) {
      if (totalDays < 1) {
        setError('Khoảng ngày không hợp lệ.')
        return
      }
      for (const [i, draft] of quotaOptions.entries()) {
        if (Number(draft.daysRequired) > totalDays) {
          setError(`Tùy chọn ${i + 1}: số ngày hoàn thành không được vượt ${totalDays}.`)
          return
        }
        if (!draftToOption(draft)) {
          setError(
            draft.perDay
              ? `Tùy chọn ${i + 1}: nhập km (> 0) cho tất cả ${draft.daysRequired || '…'} ngày hoạt động.`
              : `Tùy chọn ${i + 1}: nhập số ngày và km mỗi ngày hợp lệ.`,
          )
          return
        }
      }
      if (new Set(distances).size !== distances.length) {
        setError('Có hai tùy chọn trùng nhau.')
        return
      }
    }

    if (typeof parsedPenalty === 'string') {
      setError(parsedPenalty)
      return
    }
    if (typeof parsedAbsentPenalty === 'string') {
      setError(parsedAbsentPenalty)
      return
    }
    const rewards = parseRewardDrafts(distances, rewardDrafts)
    if (typeof rewards === 'string') {
      setError(rewards)
      return
    }

    const question = edit ? 'Lưu thay đổi thử thách?' : 'Tạo thử thách?'
    if (!window.confirm(`${question}\n\n${preview}`)) return

    setBusy(true)
    try {
      const startLabel = inputDateToChallengeDay(startDate)
      const endLabel = inputDateToChallengeDay(endDate)
      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        password: password.trim(),
        joinDeadlineDays,
        penaltyTiers: parsedPenalty.length ? parsedPenalty : null,
        absentPenalty: parsedAbsentPenalty > 0 ? parsedAbsentPenalty : null,
        rewards: rewards.length ? rewards : null,
      }
      if (iconFile) payload.icon = await uploadChallengeIcon(iconFile)

      if (!legacy) {
        if (!lockDates) {
          payload.startDate = startLabel
          payload.endDate = endLabel
        }
        if (!lockTargets) {
          payload.challengeMode = mode
          payload.targetDistances = distances
        }
        if (mode === 'monthly_pace') {
          payload.paceMinMinutes = paceMinMinutes
          payload.paceMaxMinutes = paceMaxMinutes
          if (!lockTargets) {
            payload.totalDays = null
            payload.dayQuotaOptions = null
          }
        } else if (!lockTargets) {
          payload.totalDays = totalDays
          payload.dayQuotaOptions = parsedQuotaOptions
          payload.paceMinMinutes = null
          payload.paceMaxMinutes = null
        }
      }

      if (edit) {
        // Gia hạn thử thách đã đánh dấu kết thúc: mở lại để được tính tiến độ tiếp
        const computed = calculateStatus(startLabel, endLabel)
        if (edit.storedStatus === STATUS_FINISHED && computed !== STATUS_FINISHED) {
          payload.status = computed
        }
        await update(ref(db, `challenges/${edit.id}`), payload)
        navigate(`/challenges/${edit.id}`, { replace: true })
        return
      }

      const created: Record<string, unknown> = {
        ...payload,
        creator: user.uid,
        status: STATUS_UPCOMING,
        icon: payload.icon ?? DEFAULT_CHALLENGE_ICON,
      }
      for (const [k, v] of Object.entries(created)) if (v == null) delete created[k]
      const newRef = push(ref(db, 'challenges'))
      await set(newRef, created)
      navigate(`/challenges/${newRef.key}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được thử thách')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <Link className="back-link" to={edit ? `/challenges/${edit.id}` : '/challenges'}>
        ← Thử thách
      </Link>
      <header className="page-header">
        <p className="eyebrow">Admin</p>
        <h1>{edit ? 'Sửa thử thách' : 'Tạo thử thách'}</h1>
      </header>

      <form className="auth-form panel section" onSubmit={onSubmit}>
        {edit && lockTargets && (
          <p className="tiny form-info">
            {legacy
              ? 'Thử thách loại cũ: chỉ sửa được thông tin chung, mức phạt và phần thưởng.'
              : `Đã có ${participantCount} người tham gia nên không đổi loại thử thách và mục tiêu${mode === 'day_quota' ? ', khoảng ngày' : ''} (để giữ đúng tiến độ).`}
          </p>
        )}

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

        {!legacy && (
          <fieldset className="distance-fieldset" disabled={lockTargets}>
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
        )}

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

        {legacy ? (
          <p className="challenge-preview">{preview}</p>
        ) : mode === 'monthly_pace' ? (
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

            <fieldset className="distance-fieldset" disabled={lockTargets}>
              <legend>Cự ly mục tiêu (km tích lũy)</legend>
              <div className="distance-chips">
                {distanceChips.map((d) => (
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
              {!lockTargets && (
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
              )}
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
                  readOnly={lockDates}
                  required
                />
              </label>
              <label>
                Đến ngày
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  readOnly={lockDates}
                  required
                />
              </label>
            </div>
            <p className="tiny muted">
              Tổng số ngày trong khoảng: <strong>{totalDays || '—'}</strong>
            </p>

            {lockTargets ? (
              <fieldset className="distance-fieldset">
                <legend>Các tùy chọn hoàn thành</legend>
                <ul className="goal-details">
                  {distances.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </fieldset>
            ) : (
              <fieldset className="distance-fieldset">
                <legend>Các tùy chọn hoàn thành</legend>
                <p className="tiny muted" style={{ marginBottom: 10 }}>
                  Ví dụ 15 ngày: tùy chọn 1 = 15/15 ngày × 5 km/ngày; tùy chọn 2 =
                  10/15 ngày, mỗi ngày hoạt động một mức km riêng. Mỗi ngày cần một hoạt
                  động có cự ly bằng mức km đã đặt (sai số ±0,1 km).
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
                      {o.perDay ? 'Km mặc định' : 'Km mỗi ngày'}
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
                    <div className="quota-option-extra">
                      <label className="custom-distance-row">
                        <input
                          type="checkbox"
                          checked={o.perDay}
                          disabled={totalDays <= 0}
                          onChange={(e) => togglePerDay(index, e.target.checked)}
                        />
                        <span>Đặt km riêng cho từng ngày hoạt động</span>
                      </label>
                      {o.perDay && totalDays > 0 && (
                        <>
                          <p className="tiny muted">
                            Nhập km cho {o.dailyKm.length || '…'} ngày hoạt động. Mỗi mức cần
                            một hoạt động có cự ly bằng mức đó (sai số ±0,1 km), vào ngày nào
                            trong khoảng cũng được (liên tục hoặc ngắt quãng, không theo thứ
                            tự); mỗi ngày chỉ tính cho một mức.
                          </p>
                          <div className="daily-km-grid">
                            {o.dailyKm.map((_, day) => (
                              <label key={day} className="daily-km-cell">
                                <span>Ngày hoạt động {day + 1}</span>
                                <input
                                  type="number"
                                  min={0.1}
                                  step={0.1}
                                  value={o.dailyKm[day] ?? ''}
                                  onChange={(e) =>
                                    updateDailyKm(index, day, e.target.value)
                                  }
                                  required
                                />
                              </label>
                            ))}
                          </div>
                          <button
                            type="button"
                            className="btn ghost compact"
                            onClick={() => fillDailyKm(index)}
                          >
                            Điền tất cả = {o.kmPerDay || '…'} km
                          </button>
                        </>
                      )}
                    </div>
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
            )}
          </>
        )}

        <fieldset className="distance-fieldset">
          <legend>Mức phạt khi không hoàn thành</legend>
          {flatPenaltyMode ? (
            <>
              <p className="tiny muted" style={{ marginBottom: 10 }}>
                Chỉ áp dụng cho thành viên chính thức: hoàn thành đủ số ngày của các tùy chọn đã
                chọn thì không phạt, không hoàn thành thì phạt một mức. Để trống hoặc 0 nếu thử
                thách không phạt.
              </p>
              <label>
                Phạt khi không hoàn thành (đồng)
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1000}
                  value={flatPenalty}
                  placeholder="0"
                  onChange={(e) => setFlatPenalty(e.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <p className="tiny muted" style={{ marginBottom: 10 }}>
                Tính theo tỉ lệ hoàn thành mục tiêu, chỉ áp dụng cho thành viên chính thức; đạt 100%
                không bị phạt. Đặt số tiền 0 nếu mức đó không phạt; xóa hết các mức nếu thử thách
                không phạt.
              </p>
              {penaltyRows.length === 0 && <p className="empty">Không phạt.</p>}
              {penaltyRows.map((row, index) => {
                const last = index === penaltyRows.length - 1
                const upper = index === 0 ? '100' : penaltyRows[index - 1].minPercent || '…'
                return (
                  <div key={index} className="penalty-row">
                    <label>
                      {last ? `Dưới ${upper}%` : `Từ (%) đến dưới ${upper}%`}
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={99}
                        step={1}
                        value={last ? '0' : row.minPercent}
                        disabled={last}
                        onChange={(e) => updatePenalty(index, { minPercent: e.target.value })}
                      />
                    </label>
                    <label>
                      Phạt (đồng)
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1000}
                        value={row.amount}
                        onChange={(e) => updatePenalty(index, { amount: e.target.value })}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn ghost compact danger"
                      onClick={() => removePenaltyRow(index)}
                    >
                      Xóa
                    </button>
                  </div>
                )
              })}
              <button type="button" className="btn ghost" onClick={addPenaltyRow}>
                + Thêm mức phạt
              </button>
            </>
          )}
          <p className="tiny muted" style={{ marginTop: 8 }}>
            {typeof parsedPenalty === 'string' ? parsedPenalty : penaltySummary(parsedPenalty)}
          </p>
          <label style={{ marginTop: 12 }}>
            Phạt thành viên chính thức không tham gia (đồng)
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1000}
              value={absentPenalty}
              placeholder="0"
              onChange={(e) => setAbsentPenalty(e.target.value)}
            />
          </label>
          <p className="tiny muted" style={{ marginTop: 6 }}>
            Áp dụng cho thành viên chính thức không đăng ký thử thách (trừ người được duyệt chính
            thức từ ngày bắt đầu thử thách trở về sau). Để trống hoặc 0 nếu không phạt.
          </p>
        </fieldset>

        <fieldset className="distance-fieldset">
          <legend>Phần thưởng khi hoàn thành (quay số)</legend>
          <p className="tiny muted" style={{ marginBottom: 10 }}>
            Mỗi mục tiêu có thể có nhiều món quà, VD 1 áo và 2 đôi tất (không thêm quà = không có
            thưởng). Khi thử thách kết thúc, admin quay số ngẫu nhiên trong những thành viên chính
            thức hoàn thành mục tiêu đó và trao lần lượt theo thứ tự quà bên dưới (quà giá trị
            cao đặt trước); nếu số người hoàn thành không vượt tổng số quà thì tất cả đều nhận.
          </p>
          {distances.length === 0 ? (
            <p className="empty">Chọn mục tiêu trước.</p>
          ) : (
            distances.map((target) => {
              const items = rewardDrafts[target] ?? []
              const total = items.reduce((sum, it) => {
                const q = Number(it.quantity)
                return sum + (Number.isInteger(q) && q > 0 ? q : 0)
              }, 0)
              return (
                <div key={target} className="reward-row">
                  <strong className="reward-row-target">
                    {target}
                    <span className="tiny muted">
                      {total ? ` · ${total} phần quà` : ' · không có thưởng'}
                    </span>
                  </strong>
                  {items.map((it, index) => (
                    <div key={index} className="reward-item-row">
                      <label>
                        Tên quà
                        <input
                          value={it.name}
                          placeholder="VD: Áo QTR"
                          maxLength={80}
                          onChange={(e) =>
                            updateRewardItem(target, index, { name: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Số lượng
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          step={1}
                          value={it.quantity}
                          onChange={(e) =>
                            updateRewardItem(target, index, { quantity: e.target.value })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="btn ghost compact danger"
                        onClick={() => removeRewardItem(target, index)}
                      >
                        Xóa
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn ghost compact"
                    onClick={() => addRewardItem(target)}
                  >
                    + Thêm quà
                  </button>
                </div>
              )
            })
          )}
        </fieldset>

        <label>
          Hạn tham gia (số ngày sau ngày bắt đầu)
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={challengeDays > 0 ? maxJoinDeadlineDays : undefined}
            step={1}
            value={joinDeadlineInput}
            onChange={(e) => setJoinDeadlineInput(e.target.value)}
            placeholder="VD: 7"
          />
          <span className="tiny muted">
            {joinDeadlineLastDay
              ? `Thành viên đăng ký được đến hết ngày ${formatDay(joinDeadlineLastDay)}.`
              : 'Nhập số ngày nguyên từ 1 trở lên.'}
          </span>
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

        <p className="challenge-preview">
          {preview}
          {typeof parsedPenalty !== 'string' && (
            <>
              <br />
              Phạt: {penaltySummary(parsedPenalty)}
              {typeof parsedAbsentPenalty === 'number' &&
                ` · Không tham gia: ${parsedAbsentPenalty ? formatVnd(parsedAbsentPenalty) : 'không phạt'}`}
            </>
          )}
        </p>

        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn primary wide" disabled={busy}>
          {busy
            ? edit
              ? 'Đang lưu…'
              : 'Đang tạo…'
            : edit
              ? 'Lưu thay đổi'
              : 'Tạo thử thách'}
        </button>
      </form>
    </div>
  )
}

export function CreateChallengePage() {
  return <ChallengeForm />
}

export function EditChallengePage() {
  const { id } = useParams<{ id: string }>()
  const [edit, setEdit] = useState<EditContext | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    let cancelled = false
    void get(ref(db, `challenges/${id}`))
      .then((snap) => {
        if (cancelled) return
        const raw = snap.val() as Record<string, unknown> | null
        if (!raw) setError('Không tìm thấy thử thách.')
        else setEdit(editContextFrom(id, raw))
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Không tải được thử thách')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (error) {
    return (
      <div className="page">
        <Link className="back-link" to="/challenges">
          ← Thử thách
        </Link>
        <p className="form-error">{error}</p>
      </div>
    )
  }
  if (!edit) {
    return (
      <div className="page">
        <p className="empty">Đang tải…</p>
      </div>
    )
  }
  return <ChallengeForm key={edit.id} edit={edit} />
}
