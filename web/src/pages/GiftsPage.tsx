import { useMemo, useState, type FormEvent } from 'react'
import { push, ref, remove, set, update } from 'firebase/database'
import { Plus, Search, Trash2, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import { useSharedValue } from '../lib/sharedValue'
import { USER_PROFILES_PATH } from '../lib/userProfile'
import { formatVnd } from '../lib/rewardPenalty'
import { dayToInputDate, dayYear, inputDateToDay, msToDay } from '../lib/finance'
import { formatRankTime, parsePersonalRecord } from '../lib/prRanking'
import {
  awardTotal,
  duplicateAwards,
  GIFTS_PATH,
  parseAwards,
  parseGiftConfig,
  serializeGiftConfig,
  suggestTier,
  thresholdOf,
  tierLabel,
  type GiftAward,
  type GiftCategory,
  type GiftConfig,
  type GiftSection,
  type GiftStatus,
  type GiftTier,
} from '../lib/gifts'

type Tab = 'rules' | 'awards'
type Profiles = Record<string, Record<string, unknown>>
type Member = { uid: string; name: string; gender: string; profile: Record<string, unknown> }

const SECTION_TITLES: Record<GiftSection, string> = {
  race: 'Thành tích cao trong các Race',
  yearEnd: 'Khen thưởng cuối năm',
}

function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
}

function nowMs(): number {
  return Date.now()
}

function today(): string {
  return msToDay(nowMs())
}

function parseMoney(value: string): number {
  const n = Math.round(Number(value.replace(/[.,\s]/g, '') || '0'))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** "Kỷ niệm chương (500.000đ) + 2.000.000đ tiền mặt" */
function prizeText(t: Pick<GiftTier, 'gift' | 'value' | 'cash'>): string {
  const goods = t.gift ? `${t.gift}${t.value ? ` (${formatVnd(t.value)})` : ''}` : ''
  const cash = t.cash ? `${formatVnd(t.cash)} tiền mặt` : ''
  return [goods, cash].filter(Boolean).join(' + ') || '—'
}

function GiftRulesView({ config }: { config: GiftConfig }) {
  return (
    <>
      {(['race', 'yearEnd'] as const).map((section) => (
        <section key={section} className="section panel">
          <h2>{SECTION_TITLES[section]}</h2>
          {config.categories
            .filter((c) => c.section === section)
            .map((c) => (
              <div key={c.id} className="gift-category">
                {section === 'race' && <h3>{c.title}</h3>}
                {c.note && <p className="tiny muted">{c.note}</p>}
                {c.tiers.length === 0 ? (
                  <p className="empty">Chưa có mức quà.</p>
                ) : (
                  <div className="finance-table-wrap">
                    <table className="finance-table gift-table">
                      <thead>
                        <tr>
                          {c.timed ? (
                            <>
                              <th>Nam</th>
                              <th>Nữ</th>
                            </>
                          ) : (
                            <th>Nội dung</th>
                          )}
                          <th>Quà tặng</th>
                          <th>Giá trị</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.tiers.flatMap((t) => {
                          // Hiện vật và tiền mặt mỗi thứ một dòng, chung ô mốc/nội dung
                          const lines = [
                            ...(t.gift || !t.cash
                              ? [{ key: 'goods', name: t.gift || '—', value: t.value, cash: false }]
                              : []),
                            ...(t.cash
                              ? [{ key: 'cash', name: 'Tiền mặt', value: t.cash, cash: true }]
                              : []),
                          ]
                          return lines.map((line, i) => (
                            <tr
                              key={`${t.id}-${line.key}`}
                              className={i < lines.length - 1 ? 'gift-row-joined' : undefined}
                            >
                              {i === 0 &&
                                (c.timed ? (
                                  <>
                                    <td rowSpan={lines.length}>{t.male || '—'}</td>
                                    <td rowSpan={lines.length}>{t.female || '—'}</td>
                                  </>
                                ) : (
                                  <td rowSpan={lines.length}>{t.label || '—'}</td>
                                ))}
                              <td className={line.cash ? 'gift-name gift-cash' : 'gift-name'}>
                                {line.name}
                              </td>
                              <td className={line.cash ? 'gift-cash' : undefined}>
                                {line.value ? formatVnd(line.value) : '—'}
                              </td>
                            </tr>
                          ))
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
        </section>
      ))}
    </>
  )
}

function GiftRulesEditor({
  config,
  onDone,
}: {
  config: GiftConfig
  onDone: (message: string) => void
}) {
  const { user } = useAuth()
  const [draft, setDraft] = useState<GiftConfig>(config)
  const [effective, setEffective] = useState(dayToInputDate(config.effectiveFrom))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function patchCategory(id: string, patch: Partial<GiftCategory>) {
    setDraft((d) => ({
      ...d,
      categories: d.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }))
  }

  function patchTier(categoryId: string, index: number, patch: Partial<GiftTier>) {
    setDraft((d) => ({
      ...d,
      categories: d.categories.map((c) =>
        c.id === categoryId
          ? { ...c, tiers: c.tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)) }
          : c,
      ),
    }))
  }

  function addTier(category: GiftCategory) {
    const used = new Set(category.tiers.map((t) => t.id))
    let n = category.tiers.length + 1
    while (used.has(`${category.id}-${n}`)) n += 1
    patchCategory(category.id, {
      tiers: [
        ...category.tiers,
        { id: `${category.id}-${n}`, label: '', male: '', female: '', gift: '', value: 0, cash: 0 },
      ],
    })
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    const effectiveFrom = inputDateToDay(effective)
    if (!effectiveFrom) {
      setError('Chọn ngày áp dụng.')
      return
    }
    for (const c of draft.categories) {
      const missing = c.tiers.find(
        (t) =>
          (!t.gift.trim() && !t.cash) ||
          (c.timed ? !t.male.trim() && !t.female.trim() : !t.label.trim()),
      )
      if (missing) {
        setError(
          `${c.title}: mỗi mức cần có ${c.timed ? 'mốc thời gian' : 'nội dung'} và hiện vật hoặc tiền mặt.`,
        )
        return
      }
      if (c.tiers.some((t) => !t.gift.trim() && t.value > 0)) {
        setError(`${c.title}: có giá trị hiện vật thì cần nhập tên hiện vật.`)
        return
      }
    }
    setBusy(true)
    setError('')
    try {
      await set(ref(db, `${GIFTS_PATH}/config`), {
        ...serializeGiftConfig({ ...draft, effectiveFrom }),
        updatedAt: Date.now(),
        updatedBy: user.uid,
      })
      onDone('Đã lưu quy định quà tặng.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được')
      setBusy(false)
    }
  }

  return (
    <form className="auth-form gift-editor" onSubmit={(e) => void onSubmit(e)}>
      <section className="section panel">
        <label className="gift-effective">
          Áp dụng từ ngày
          <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
        </label>
      </section>
      {draft.categories.map((c) => (
        <section key={c.id} className="section panel">
          <p className="eyebrow">{SECTION_TITLES[c.section]}</p>
          <div className="finance-form-grid">
            <label>
              Tên hạng mục
              <input
                value={c.title}
                maxLength={80}
                onChange={(e) => patchCategory(c.id, { title: e.target.value })}
              />
            </label>
            <label>
              Ghi chú
              <input
                value={c.note}
                maxLength={300}
                onChange={(e) => patchCategory(c.id, { note: e.target.value })}
              />
            </label>
          </div>
          <div className="gift-tier-list">
            {c.tiers.map((t, i) => (
              <div key={t.id} className="gift-tier-edit">
                {c.timed ? (
                  <>
                    <label>
                      Nam
                      <input
                        value={t.male}
                        placeholder="sub3h30"
                        maxLength={20}
                        onChange={(e) => patchTier(c.id, i, { male: e.target.value })}
                      />
                    </label>
                    <label>
                      Nữ
                      <input
                        value={t.female}
                        placeholder="sub4h00"
                        maxLength={20}
                        onChange={(e) => patchTier(c.id, i, { female: e.target.value })}
                      />
                    </label>
                  </>
                ) : (
                  <label className="gift-tier-wide">
                    Nội dung
                    <input
                      value={t.label}
                      maxLength={80}
                      onChange={(e) => patchTier(c.id, i, { label: e.target.value })}
                    />
                  </label>
                )}
                <label className="gift-tier-wide">
                  Hiện vật
                  <input
                    value={t.gift}
                    maxLength={200}
                    placeholder="Để trống nếu chỉ thưởng tiền mặt"
                    onChange={(e) => patchTier(c.id, i, { gift: e.target.value })}
                  />
                </label>
                <label>
                  Giá trị hiện vật (đ)
                  <input
                    inputMode="numeric"
                    value={t.value ? String(t.value) : ''}
                    onChange={(e) => patchTier(c.id, i, { value: parseMoney(e.target.value) })}
                  />
                </label>
                <label>
                  Tiền mặt (đ)
                  <input
                    inputMode="numeric"
                    value={t.cash ? String(t.cash) : ''}
                    placeholder="0"
                    onChange={(e) => patchTier(c.id, i, { cash: parseMoney(e.target.value) })}
                  />
                </label>
                <button
                  type="button"
                  className="btn ghost compact danger gift-tier-remove"
                  aria-label="Xóa mức"
                  onClick={() => patchCategory(c.id, { tiers: c.tiers.filter((_, j) => j !== i) })}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="btn ghost compact support-link-add" onClick={() => addTier(c)}>
            <Plus size={16} aria-hidden /> Thêm mức
          </button>
        </section>
      ))}
      {error && <p className="form-error">{error}</p>}
      <div className="btn-row">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Đang lưu…' : 'Lưu quy định'}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => onDone('')}>
          Hủy
        </button>
      </div>
    </form>
  )
}

function AwardForm({
  award,
  config,
  awards,
  members,
  onClose,
  onSaved,
}: {
  award: GiftAward | null
  config: GiftConfig
  awards: GiftAward[]
  members: Member[]
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { user } = useAuth()
  const [uid, setUid] = useState(award?.uid ?? '')
  const [gender, setGender] = useState(award?.gender ?? '')
  const [categoryId, setCategoryId] = useState(award?.category ?? config.categories[0].id)
  const [tierId, setTierId] = useState(award?.tierId ?? '')
  const [raceName, setRaceName] = useState(award?.raceName ?? '')
  const [raceDate, setRaceDate] = useState(dayToInputDate(award?.raceDate ?? ''))
  const [chipTime, setChipTime] = useState(award?.chipTime ?? '')
  const [year, setYear] = useState(() => String(award?.year || dayYear(today())))
  const [status, setStatus] = useState<GiftStatus>(award?.status ?? 'pending')
  const [givenDate, setGivenDate] = useState(() => dayToInputDate(award?.givenDate || today()))
  const [note, setNote] = useState(award?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const category = config.categories.find((c) => c.id === categoryId) ?? config.categories[0]
  const selectedTier = category.tiers.find((t) => t.id === tierId) ?? null
  const isRace = category.section === 'race'
  const member = members.find((m) => m.uid === uid)
  const pr = member ? parsePersonalRecord(member.profile.personalRecord as Record<string, unknown>) : null
  const suggestion = suggestTier(category, gender, chipTime)
  const awardYear = isRace ? dayYear(inputDateToDay(raceDate)) : Number(year) || 0
  const duplicates =
    uid && selectedTier
      ? duplicateAwards(awards, category, { id: award?.id, uid, tierId: selectedTier.id, year: awardYear })
      : []

  function pickTier(nextCategory: GiftCategory, nextGender: string, nextChip: string) {
    const suggested = suggestTier(nextCategory, nextGender, nextChip)
    if (suggested) setTierId(suggested.id)
    else if (!nextCategory.tiers.some((t) => t.id === tierId)) setTierId(nextCategory.tiers[0]?.id ?? '')
  }

  function changeMember(next: string) {
    setUid(next)
    const g = members.find((m) => m.uid === next)?.gender ?? ''
    if (g === 'Nam' || g === 'Nữ') {
      setGender(g)
      pickTier(category, g, chipTime)
    }
  }

  function changeCategory(next: string) {
    const c = config.categories.find((x) => x.id === next)
    if (!c) return
    setCategoryId(next)
    pickTier(c, gender, chipTime)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    if (!uid) {
      setError('Chọn thành viên.')
      return
    }
    if (!selectedTier) {
      setError('Chọn mức quà.')
      return
    }
    if (category.timed && gender !== 'Nam' && gender !== 'Nữ') {
      setError('Chọn giới tính để xác định mốc thời gian.')
      return
    }
    const raceDay = inputDateToDay(raceDate)
    if (isRace && !raceDay) {
      setError('Chọn ngày race.')
      return
    }
    if (!(awardYear >= 2000)) {
      setError('Năm không hợp lệ.')
      return
    }
    const givenDay = status === 'given' ? inputDateToDay(givenDate) : ''
    if (status === 'given' && !givenDay) {
      setError('Chọn ngày trao quà.')
      return
    }
    if (
      duplicates.length &&
      !window.confirm(
        `${member?.name ?? 'Thành viên này'} đã được ghi nhận "${category.title}" (${duplicates
          .map((d) => d.tierLabel || d.gift)
          .join(', ')}). Quy định chỉ nhận ${category.repeat === 'perYear' ? 'một lần mỗi năm' : 'lần đầu đạt'}. Vẫn lưu?`,
      )
    ) {
      return
    }
    setBusy(true)
    setError('')
    const now = nowMs()
    const fields = {
      uid,
      memberName: member?.name ?? award?.memberName ?? '',
      gender: gender || null,
      category: category.id,
      tierId: selectedTier.id,
      tierLabel: tierLabel(category, selectedTier, gender),
      gift: selectedTier.gift,
      value: selectedTier.value,
      cash: selectedTier.cash,
      year: awardYear,
      raceName: isRace ? raceName.trim() || null : null,
      raceDate: isRace ? raceDay : null,
      chipTime: isRace && category.timed ? chipTime.trim() || null : null,
      status,
      givenDate: givenDay || null,
      note: note.trim() || null,
    }
    try {
      if (award) {
        await update(ref(db, `${GIFTS_PATH}/awards/${award.id}`), {
          ...fields,
          updatedAt: now,
          updatedBy: user.uid,
        })
        onSaved('Đã cập nhật quà tặng.')
      } else {
        await push(ref(db, `${GIFTS_PATH}/awards`), { ...fields, createdAt: now, createdBy: user.uid })
        onSaved(`Đã ghi nhận quà cho ${fields.memberName}.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được')
      setBusy(false)
    }
  }

  return (
    <form className="auth-form panel finance-form" onSubmit={(e) => void onSubmit(e)}>
      <h2>{award ? 'Sửa quà tặng' : 'Ghi nhận quà tặng'}</h2>
      <div className="finance-form-grid">
        <label>
          Thành viên chính thức
          <select value={uid} onChange={(e) => changeMember(e.target.value)} required>
            <option value="">— Chọn —</option>
            {uid && !member && <option value={uid}>{award?.memberName || 'Thành viên'}</option>}
            {members.map((m) => (
              <option key={m.uid} value={m.uid}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Giới tính
          <select
            value={gender}
            onChange={(e) => {
              setGender(e.target.value)
              pickTier(category, e.target.value, chipTime)
            }}
          >
            <option value="">—</option>
            <option value="Nam">Nam</option>
            <option value="Nữ">Nữ</option>
          </select>
        </label>
        <label>
          Hạng mục
          <select value={categoryId} onChange={(e) => changeCategory(e.target.value)}>
            {(['race', 'yearEnd'] as const).map((section) => (
              <optgroup key={section} label={SECTION_TITLES[section]}>
                {config.categories
                  .filter((c) => c.section === section)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        {isRace ? (
          <>
            <label>
              Tên race
              <input
                value={raceName}
                maxLength={120}
                onChange={(e) => setRaceName(e.target.value)}
                placeholder="VD: VnExpress Marathon Quy Nhơn"
              />
            </label>
            <label>
              Ngày race
              <input type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)} />
            </label>
            {category.timed && (
              <label>
                Thời gian chip
                <input
                  value={chipTime}
                  maxLength={12}
                  placeholder="hh:mm:ss"
                  onChange={(e) => {
                    setChipTime(e.target.value)
                    pickTier(category, gender, e.target.value)
                  }}
                />
              </label>
            )}
          </>
        ) : (
          <label>
            Năm
            <input
              inputMode="numeric"
              value={year}
              maxLength={4}
              onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))}
            />
          </label>
        )}
        <label>
          Mức quà
          <select value={tierId} onChange={(e) => setTierId(e.target.value)} required>
            <option value="">— Chọn —</option>
            {category.tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {category.timed
                  ? gender === 'Nam' || gender === 'Nữ'
                    ? thresholdOf(t, gender)
                    : `${t.male} / ${t.female}`
                  : t.label}{' '}
                · {prizeText(t)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {category.timed && (
        <p className="tiny muted">
          {chipTime && suggestion
            ? `Thời gian ${formatRankTime(chipTime)} đạt mốc ${thresholdOf(suggestion, gender)} (${gender}).`
            : chipTime && (gender === 'Nam' || gender === 'Nữ')
              ? 'Thời gian chip chưa đạt mốc nào (hoặc chưa đúng dạng hh:mm:ss).'
              : 'Nhập giới tính và thời gian chip để tự chọn mức.'}
          {pr && (pr.fullMarathonTime || pr.halfMarathonTime) && (
            <>
              {' '}
              PR hồ sơ: FM {pr.fullMarathonTime ? formatRankTime(pr.fullMarathonTime) : '—'}
              {pr.fullMarathonTime && !pr.isFullMarathonVerified ? ' (chưa xác thực)' : ''} · HM{' '}
              {pr.halfMarathonTime ? formatRankTime(pr.halfMarathonTime) : '—'}
              {pr.halfMarathonTime && !pr.isHalfMarathonVerified ? ' (chưa xác thực)' : ''}.
            </>
          )}
        </p>
      )}
      {category.note && <p className="tiny muted">Quy định: {category.note}</p>}
      {duplicates.length > 0 && (
        <p className="form-error">
          Đã ghi nhận trước đó:{' '}
          {duplicates
            .map((d) => `${d.tierLabel || d.gift}${d.raceName ? ` – ${d.raceName}` : ''} (${d.year})`)
            .join('; ')}
          .
        </p>
      )}
      <div className="filter-row">
        {(
          [
            ['pending', 'Chờ trao'],
            ['given', 'Đã trao'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={status === value ? 'chip active' : 'chip'}
            onClick={() => setStatus(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {status === 'given' && (
        <label>
          Ngày trao
          <input type="date" value={givenDate} onChange={(e) => setGivenDate(e.target.value)} />
        </label>
      )}
      <label>
        Ghi chú
        <textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="btn-row">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Đang lưu…' : award ? 'Lưu thay đổi' : 'Ghi nhận'}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>
          Hủy
        </button>
      </div>
    </form>
  )
}

export function GiftsPage() {
  const { user, profile } = useAuth()
  const canEdit = profile?.admin === true
  const giftsValue = useSharedValue<Record<string, unknown>>(GIFTS_PATH)
  // Tên người nhận đã lưu kèm bản ghi; chỉ Admin cần cả danh sách thành viên để ghi nhận
  const profiles = useSharedValue<Profiles>(canEdit ? USER_PROFILES_PATH : null, 24 * 60 * 60_000)
  const loading = giftsValue === undefined

  const [tab, setTab] = useState<Tab>('rules')
  const [editingRules, setEditingRules] = useState(false)
  const [editing, setEditing] = useState<GiftAward | 'new' | null>(null)
  const [yearFilter, setYearFilter] = useState(0)
  const [sectionFilter, setSectionFilter] = useState<'all' | GiftSection>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | GiftStatus>('all')
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const config = useMemo(() => parseGiftConfig(giftsValue?.config), [giftsValue])
  const awards = useMemo(
    () =>
      parseAwards(giftsValue?.awards).sort(
        (a, b) => b.year - a.year || b.createdAt - a.createdAt,
      ),
    [giftsValue],
  )
  const categoryById = useMemo(
    () => new Map(config.categories.map((c) => [c.id, c])),
    [config],
  )

  const members = useMemo<Member[]>(
    () =>
      Object.entries((profiles ?? {}) as Profiles)
        .filter(([, p]) => p?.member === true)
        .map(([uid, p]) => ({
          uid,
          name: String(p.fullName ?? '').trim() || 'Thành viên',
          gender: String(p.gender ?? ''),
          profile: p,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    [profiles],
  )

  const nameOf = (a: GiftAward) =>
    String(profiles?.[a.uid]?.fullName ?? '').trim() || a.memberName || 'Thành viên'

  const years = useMemo(
    () => [...new Set(awards.map((a) => a.year).filter(Boolean))].sort((a, b) => b - a),
    [awards],
  )

  const query = foldText(search)
  const filtered = awards.filter((a) => {
    const c = categoryById.get(a.category)
    return (
      (!yearFilter || a.year === yearFilter) &&
      (sectionFilter === 'all' || c?.section === sectionFilter) &&
      (statusFilter === 'all' || a.status === statusFilter) &&
      (!query ||
        foldText(`${nameOf(a)} ${a.raceName} ${a.gift} ${a.tierLabel} ${c?.title ?? ''}`).includes(query))
    )
  })
  const goodsValue = filtered.reduce((s, a) => s + (a.gift ? a.value : 0), 0)
  const cashValue = filtered.reduce((s, a) => s + a.cash, 0)
  const pendingCount = filtered.filter((a) => a.status === 'pending').length

  function done(text: string) {
    setEditing(null)
    setEditingRules(false)
    setError('')
    setMessage(text)
  }

  async function toggleGiven(a: GiftAward) {
    if (!user) return
    setMessage('')
    setError('')
    try {
      await update(ref(db, `${GIFTS_PATH}/awards/${a.id}`), {
        status: a.status === 'given' ? 'pending' : 'given',
        givenDate: a.status === 'given' ? null : today(),
        updatedAt: nowMs(),
        updatedBy: user.uid,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được')
    }
  }

  async function removeAward(a: GiftAward) {
    if (!window.confirm(`Xóa quà "${prizeText(a)}" của ${nameOf(a)}?`)) return
    setMessage('')
    setError('')
    try {
      await remove(ref(db, `${GIFTS_PATH}/awards/${a.id}`))
      setMessage('Đã xóa bản ghi quà tặng.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xóa được')
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">Câu lạc bộ</p>
        <h1>Quà tặng</h1>
        <p className="lede">
          Quà tặng cho thành tích cao trong race và khen thưởng cuối năm, áp dụng từ ngày{' '}
          {config.effectiveFrom.replace(/-/g, '/')}.
        </p>
      </header>

      {loading ? (
        <p className="empty">Đang tải…</p>
      ) : (
        <>
          <div className="filter-row">
            <button
              type="button"
              className={tab === 'rules' ? 'chip active' : 'chip'}
              onClick={() => setTab('rules')}
            >
              Quy định
            </button>
            <button
              type="button"
              className={tab === 'awards' ? 'chip active' : 'chip'}
              onClick={() => setTab('awards')}
            >
              Danh sách nhận quà ({awards.length})
            </button>
          </div>

          {message && <p className="form-info">{message}</p>}
          {error && <p className="form-error">{error}</p>}

          {tab === 'rules' ? (
            canEdit && editingRules ? (
              <GiftRulesEditor config={config} onDone={done} />
            ) : (
              <>
                {canEdit && (
                  <div className="finance-toolbar gift-toolbar">
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        setMessage('')
                        setEditingRules(true)
                      }}
                    >
                      Sửa quy định
                    </button>
                  </div>
                )}
                <GiftRulesView config={config} />
              </>
            )
          ) : (
            <>
              <div className="finance-toolbar">
                <label className="search-field">
                  <span className="sr-only">Năm</span>
                  <select value={yearFilter} onChange={(e) => setYearFilter(Number(e.target.value))}>
                    <option value={0}>Mọi năm</option>
                    {years.map((y) => (
                      <option key={y} value={y}>
                        Năm {y}
                      </option>
                    ))}
                  </select>
                </label>
                {canEdit && (
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => {
                      setMessage('')
                      setEditing('new')
                    }}
                  >
                    <Plus size={16} aria-hidden /> Ghi nhận quà
                  </button>
                )}
              </div>

              {canEdit && editing && (
                <AwardForm
                  key={editing === 'new' ? 'new' : editing.id}
                  award={editing === 'new' ? null : editing}
                  config={config}
                  awards={awards}
                  members={members}
                  onClose={() => setEditing(null)}
                  onSaved={done}
                />
              )}

              <div className="stat-row finance-stats">
                <div className="stat">
                  <strong>{filtered.length}</strong>
                  <span>Quà tặng</span>
                </div>
                <div className="stat">
                  <strong className="stat-unpaid">{pendingCount}</strong>
                  <span>Chờ trao</span>
                </div>
                <div className="stat">
                  <strong className="stat-money">{formatVnd(goodsValue)}</strong>
                  <span>Giá trị hiện vật</span>
                </div>
                <div className="stat">
                  <strong className="stat-money">{formatVnd(cashValue)}</strong>
                  <span>Tiền mặt</span>
                </div>
              </div>

              <section className="section panel">
                <div className="filter-row">
                  {(
                    [
                      ['all', 'Tất cả'],
                      ['race', 'Thành tích race'],
                      ['yearEnd', 'Cuối năm'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={sectionFilter === value ? 'chip active' : 'chip'}
                      onClick={() => setSectionFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="filter-row">
                  {(
                    [
                      ['all', 'Mọi trạng thái'],
                      ['pending', 'Chờ trao'],
                      ['given', 'Đã trao'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={statusFilter === value ? 'chip active' : 'chip'}
                      onClick={() => setStatusFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="reward-search gift-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tìm thành viên, race, quà"
                    aria-label="Tìm thành viên, race, quà"
                  />
                  {search && (
                    <button type="button" aria-label="Xóa tìm kiếm" onClick={() => setSearch('')}>
                      <X size={16} />
                    </button>
                  )}
                </div>

                {filtered.length === 0 ? (
                  <p className="empty">
                    {awards.length ? 'Không có quà tặng phù hợp.' : 'Chưa ghi nhận quà tặng nào.'}
                  </p>
                ) : (
                  <ul className="participant-list">
                    {filtered.map((a) => {
                      const c = categoryById.get(a.category)
                      return (
                        <li key={a.id} className="participant-row finance-row">
                          <div className="participant-meta">
                            <strong>{nameOf(a)}</strong>
                            <span className="tiny muted">
                              {c?.title ?? a.category} · {a.tierLabel || a.gift}
                              {c?.section === 'yearEnd' ? ` · Năm ${a.year}` : ''}
                            </span>
                            {(a.raceName || a.raceDate || a.chipTime) && (
                              <span className="tiny muted">
                                {[a.raceName, a.raceDate, a.chipTime && formatRankTime(a.chipTime)]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            )}
                            {a.gift && (
                              <span className="tiny">
                                🎁 Hiện vật: {a.gift}
                                {a.value ? ` (${formatVnd(a.value)})` : ''}
                              </span>
                            )}
                            {a.cash > 0 && (
                              <span className="tiny">💵 Tiền mặt: {formatVnd(a.cash)}</span>
                            )}
                            <span className="tiny">
                              <span className={`penalty-pay-badge${a.status === 'given' ? ' paid' : ''}`}>
                                {a.status === 'given' ? 'Đã trao' : 'Chờ trao'}
                              </span>
                              {a.status === 'given' && a.givenDate ? ` ngày ${a.givenDate}` : ''}
                              {canEdit && a.note ? ` · ${a.note}` : ''}
                            </span>
                            {canEdit && (
                              <span className="finance-row-actions">
                                <button
                                  type="button"
                                  className="btn ghost compact"
                                  onClick={() => void toggleGiven(a)}
                                >
                                  {a.status === 'given' ? 'Chưa trao' : 'Đã trao'}
                                </button>
                                <button
                                  type="button"
                                  className="btn ghost compact"
                                  onClick={() => {
                                    setMessage('')
                                    setEditing(a)
                                    window.scrollTo({ top: 0, behavior: 'smooth' })
                                  }}
                                >
                                  Sửa
                                </button>
                                <button
                                  type="button"
                                  className="btn ghost compact danger"
                                  onClick={() => void removeAward(a)}
                                >
                                  Xóa
                                </button>
                              </span>
                            )}
                          </div>
                          <span className="reward-amount">{formatVnd(awardTotal(a))}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}
