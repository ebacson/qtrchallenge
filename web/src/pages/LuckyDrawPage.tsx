import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { push, ref, remove, runTransaction, set, update } from 'firebase/database'
import { ArrowDown, ArrowUp, BadgeCheck, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { DrawStage, FullscreenButton } from '../components/DrawStage'
import { useAuth } from '../context/AuthContext'
import {
  drawPhase,
  prizeSlots,
  useDrawSpinner,
  useFullscreen,
  type StagePerson,
} from '../lib/drawSpinner'
import { db } from '../lib/firebase'
import {
  asList,
  LUCKY_DRAWS_PATH,
  LUCKY_MENU_PATH,
  LUCKY_STATUS_LABELS,
  parseLuckyDraw,
  type LuckyDraw,
  type LuckyParticipant,
} from '../lib/luckyDraw'
import { pickRandom, rewardItemsSummary } from '../lib/rewardPenalty'
import { useSharedValue } from '../lib/sharedValue'
import type { RewardItem } from '../types'

type Row = Record<string, unknown>

function nowMs(): number {
  return Date.now()
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase('vi') === b.trim().toLocaleLowerCase('vi')
}

function stagePerson(draw: LuckyDraw, key: string, index = -1): StagePerson {
  const p = draw.participants.find((x) => x.key === key)
  return { id: key, name: p?.name || draw.winnerNames[index] || 'Người tham gia', avatar: p?.avatar }
}

/** Lượt Admin đang quay (đã lưu người trúng, chưa công bố): người xem quay theo trên máy mình */
function watchedRound(draw: LuckyDraw): { key: string; people: StagePerson[]; winner: StagePerson } | null {
  if (draw.status !== 'locked' || draw.winners.length <= draw.revealed) return null
  const i = draw.revealed
  const before = new Set(draw.winners.slice(0, i))
  return {
    key: `${i}:${draw.winners[i]}`,
    people: draw.candidates.filter((k) => !before.has(k)).map((k) => stagePerson(draw, k)),
    winner: stagePerson(draw, draw.winners[i], i),
  }
}

function PrizeEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: RewardItem[]
  busy: boolean
  onSave: (items: RewardItem[]) => void
  onCancel: () => void
}) {
  const [items, setItems] = useState<RewardItem[]>(
    initial.length ? initial : [{ name: '', quantity: 1 }],
  )
  const [error, setError] = useState('')

  function patch(i: number, next: Partial<RewardItem>) {
    setItems((list) => list.map((it, j) => (j === i ? { ...it, ...next } : it)))
  }

  function move(i: number, delta: number) {
    setItems((list) => {
      const j = i + delta
      if (j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const clean = items
      .map((it) => ({ name: it.name.trim(), quantity: Math.floor(it.quantity) }))
      .filter((it) => it.name || it.quantity > 0)
    if (!clean.length) {
      setError('Nhập ít nhất một phần quà.')
      return
    }
    if (clean.some((it) => !it.name || !(it.quantity >= 1))) {
      setError('Mỗi phần quà cần có tên và số lượng từ 1 trở lên.')
      return
    }
    setError('')
    onSave(clean)
  }

  return (
    <form className="lucky-prize-editor" onSubmit={submit}>
      <p className="tiny muted">
        Quay theo thứ tự từ trên xuống: thường để quà nhỏ trước, giải lớn cuối cùng.
      </p>
      {items.map((it, i) => (
        <div key={i} className="lucky-prize-row">
          <span className="lucky-prize-index">{i + 1}</span>
          <input
            value={it.name}
            maxLength={100}
            placeholder="Tên quà"
            aria-label="Tên quà"
            onChange={(e) => patch(i, { name: e.target.value })}
          />
          <input
            className="lucky-prize-qty"
            inputMode="numeric"
            value={it.quantity ? String(it.quantity) : ''}
            placeholder="SL"
            aria-label="Số lượng"
            onChange={(e) => patch(i, { quantity: Number(e.target.value.replace(/\D/g, '')) || 0 })}
          />
          <button type="button" className="btn ghost compact" aria-label="Lên" disabled={i === 0} onClick={() => move(i, -1)}>
            <ArrowUp size={16} />
          </button>
          <button
            type="button"
            className="btn ghost compact"
            aria-label="Xuống"
            disabled={i === items.length - 1}
            onClick={() => move(i, 1)}
          >
            <ArrowDown size={16} />
          </button>
          <button
            type="button"
            className="btn ghost compact danger"
            aria-label="Xóa quà"
            onClick={() => setItems((list) => list.filter((_, j) => j !== i))}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn ghost compact support-link-add"
        onClick={() => setItems((list) => [...list, { name: '', quantity: 1 }])}
      >
        <Plus size={16} aria-hidden /> Thêm quà
      </button>
      {error && <p className="form-error">{error}</p>}
      <div className="btn-row">
        <button type="submit" className="btn primary" disabled={busy}>
          Lưu danh sách quà
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>
          Hủy
        </button>
      </div>
    </form>
  )
}

export function LuckyDrawPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const isAdmin = profile?.admin === true
  const raw = useSharedValue<Row>(id ? `${LUCKY_DRAWS_PATH}/${id}` : null)
  const menuRaw = useSharedValue<Row>(id ? `${LUCKY_MENU_PATH}/${id}` : null)
  const spinner = useDrawSpinner()
  const { ref: screenRef, ...fullscreen } = useFullscreen<HTMLDivElement>()
  const [busy, setBusy] = useState(false)
  /** Người vừa trúng đã lưu nhưng còn đang quay: chưa hiện ra */
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [editingPrizes, setEditingPrizes] = useState(false)
  const [manualName, setManualName] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  /** Lượt người xem đã quay xong trên máy mình (có thể trước khi Admin công bố vài trăm ms) */
  const [watchedKey, setWatchedKey] = useState('')
  const draw = raw == null ? null : parseLuckyDraw(id, raw)
  const watched = !isAdmin && draw ? watchedRound(draw) : null
  const watchKey = watched?.key ?? ''

  useEffect(() => {
    if (!watched) return
    let finished = false
    void spinner.spin(watched.people, watched.winner, { music: false }).then((ok) => {
      finished = true
      if (ok) setWatchedKey(watched.key)
    })
    return () => {
      if (!finished) spinner.stop()
    }
    // Chỉ chạy lại khi sang lượt khác; watched/spinner đổi object mỗi lần render
  }, [watchKey])

  if (raw === undefined) {
    return (
      <div className="page">
        <p className="empty">Đang tải…</p>
      </div>
    )
  }
  if (!draw) {
    return (
      <div className="page">
        <p className="form-error">Không tìm thấy chương trình.</p>
        <Link to="/lucky-draw">← Quay số may mắn</Link>
      </div>
    )
  }

  const path = `${LUCKY_DRAWS_PATH}/${id}`
  const menuPath = `${LUCKY_MENU_PATH}/${id}`
  const published = menuRaw != null
  const byKey = new Map(draw.participants.map((p) => [p.key, p]))
  const isOpen = draw.status === 'open'
  const confirmed = draw.status === 'done'
  const candidates = isOpen ? draw.participants.map((p) => p.key) : draw.candidates
  const slots = prizeSlots(draw.prizes)
  const savedWinners = draw.winners
  const shownCount = isAdmin
    ? savedWinners.length
    : draw.revealed + (watched && watchedKey === watched.key ? 1 : 0)
  const shownWinners = savedWinners.slice(0, shownCount)
  const winners = pendingId ? shownWinners.filter((k) => k !== pendingId) : shownWinners
  const winnerSet = new Set(winners)
  const pool = candidates.filter((k) => !savedWinners.includes(k))
  const totalRounds = Math.min(slots.length, candidates.length)
  const round = winners.length
  const phase = drawPhase(spinner.spinning, round, totalRounds)
  const working = busy || spinner.spinning
  const canEditPrizes = isAdmin && !confirmed && savedWinners.length === 0
  const lockBlocker = !slots.length
    ? 'Cần nhập danh sách quà (mục Phần quà) trước khi chốt.'
    : !draw.participants.length
      ? 'Cần có ít nhất một người tham gia trước khi chốt.'
      : editingPrizes
        ? 'Lưu danh sách quà đang sửa trước khi chốt.'
        : ''
  const me = user ? byKey.get(user.uid) : undefined

  const toPerson = (key: string, index = -1): StagePerson => stagePerson(draw, key, index)
  const stageWinners = winners.map((k, i) => ({
    person: toPerson(k, i),
    prize: draw.winnerPrizes[i] || slots[i] || '',
  }))

  async function run(action: () => Promise<void>, done = '') {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      if (done) setMessage(done)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thực hiện được')
    } finally {
      setBusy(false)
    }
  }

  function join() {
    if (!user) return
    void run(
      () =>
        set(ref(db, `${path}/participants/${user.uid}`), {
          uid: user.uid,
          name: (profile?.fullName || user.displayName || 'Thành viên').slice(0, 100),
          avatar: profile?.avatar || null,
          source: 'self',
          addedAt: nowMs(),
        }),
      'Bạn đã tham gia chương trình.',
    )
  }

  function leave() {
    if (!user || !window.confirm('Rời khỏi chương trình quay số này?')) return
    void run(() => remove(ref(db, `${path}/participants/${user.uid}`)), 'Bạn đã rời chương trình.')
  }

  function addManual(e: FormEvent) {
    e.preventDefault()
    const name = manualName.trim()
    if (!user || !name) return
    if (
      draw?.participants.some((p) => sameName(p.name, name)) &&
      !window.confirm(`Đã có người tên "${name}" trong danh sách. Vẫn thêm?`)
    )
      return
    void run(async () => {
      await set(push(ref(db, `${path}/participants`)), {
        name: name.slice(0, 100),
        source: 'manual',
        addedAt: nowMs(),
        addedBy: user.uid,
      })
      setManualName('')
    }, `Đã thêm ${name}.`)
  }

  function removeParticipant(p: LuckyParticipant) {
    if (!window.confirm(`Xóa ${p.name} khỏi danh sách tham gia?`)) return
    void run(() => remove(ref(db, `${path}/participants/${p.key}`)))
  }

  function savePrizes(items: RewardItem[]) {
    void run(async () => {
      await set(ref(db, `${path}/prizes`), items)
      setEditingPrizes(false)
    }, 'Đã lưu danh sách quà.')
  }

  /** Chụp danh sách tham gia ngay trên RTDB để không sót người vừa bấm tham gia */
  function lock() {
    if (!user || !draw || lockBlocker) return
    if (
      !window.confirm(
        `Chốt danh sách ${draw.participants.length} người tham gia, ${slots.length} phần quà?\n\nSau khi chốt, mọi người không thể tham gia hoặc rời chương trình nữa.`,
      )
    )
      return
    const uid = user.uid
    void run(async () => {
      const result = await runTransaction(
        ref(db, path),
        (cur: Row | null) => {
          if (!cur || cur.status !== 'open') return undefined
          const keys = Object.entries((cur.participants ?? {}) as Record<string, Row>)
            .sort(([, a], [, b]) => (Number(a?.addedAt) || 0) - (Number(b?.addedAt) || 0))
            .map(([key]) => key)
          if (!keys.length) return undefined
          return { ...cur, status: 'locked', candidates: keys, lockedAt: nowMs(), lockedBy: uid }
        },
        { applyLocally: false },
      )
      if (!result.committed) throw new Error('Không chốt được: chương trình đã thay đổi.')
    }, 'Đã chốt danh sách.')
  }

  function unlock() {
    if (!window.confirm('Mở lại danh sách để thêm/bớt người tham gia?')) return
    void run(async () => {
      const result = await runTransaction(
        ref(db, path),
        (cur: Row | null) => {
          if (!cur || cur.status !== 'locked' || asList(cur.winners).length) return undefined
          return { ...cur, status: 'open', candidates: null, lockedAt: null, lockedBy: null }
        },
        { applyLocally: false },
      )
      if (!result.committed) throw new Error('Không mở lại được: đã có kết quả quay.')
    }, 'Đã mở lại danh sách.')
  }

  /** Quay một phần quà: lưu người trúng trước rồi mới chạy hiệu ứng */
  async function runRound() {
    if (!user || !draw || working || draw.status !== 'locked' || round >= totalRounds) return
    const picked = pickRandom(pool)
    if (!picked) return
    const expected = savedWinners.length
    const prize = slots[expected] ?? ''
    const name = toPerson(picked).name
    const uid = user.uid
    setBusy(true)
    setError('')
    setMessage('')
    setPendingId(picked)
    try {
      const result = await runTransaction(
        ref(db, path),
        (cur: Row | null) => {
          if (!cur || cur.status !== 'locked') return undefined
          const curWinners = asList(cur.winners).map(String)
          if (curWinners.length !== expected) return undefined
          return {
            ...cur,
            winners: [...curWinners, picked],
            winnerNames: [...asList(cur.winnerNames).slice(0, expected), name],
            winnerPrizes: [...asList(cur.winnerPrizes).slice(0, expected), prize],
            revealed: expected,
            drawnAt: nowMs(),
            drawnBy: uid,
          }
        },
        { applyLocally: false },
      )
      if (!result.committed) {
        setPendingId(null)
        setError('Kết quả vừa thay đổi ở máy khác. Hãy xem lại trước khi quay tiếp.')
        return
      }
    } catch (err) {
      setPendingId(null)
      setError(err instanceof Error ? err.message : 'Không lưu được kết quả')
      return
    } finally {
      setBusy(false)
    }
    await spinner.spin(pool.map((k) => toPerson(k)), toPerson(picked))
    setPendingId(null)
    void runTransaction(
      ref(db, path),
      (cur: Row | null) => {
        if (!cur || cur.status !== 'locked' || asList(cur.winners).length !== expected + 1) return undefined
        return { ...cur, revealed: expected + 1 }
      },
      { applyLocally: false },
    ).catch(() => {})
  }

  function confirmResult() {
    if (!user) return
    if (
      !window.confirm(
        `Xác nhận kết quả ${winners.length} người trúng thưởng?\n\nSau khi xác nhận sẽ không thể quay lại nữa.`,
      )
    )
      return
    const uid = user.uid
    void run(async () => {
      const result = await runTransaction(
        ref(db, path),
        (cur: Row | null) => {
          if (!cur || cur.status !== 'locked') return undefined
          return {
            ...cur,
            status: 'done',
            revealed: asList(cur.winners).length,
            confirmedAt: nowMs(),
            confirmedBy: uid,
          }
        },
        { applyLocally: false },
      )
      if (!result.committed) throw new Error('Không xác nhận được: chương trình đã thay đổi.')
    }, 'Đã xác nhận kết quả.')
  }

  function resetDraw() {
    if (!window.confirm(`Xóa kết quả ${winners.length} người đã trúng và quay lại từ đầu?`)) return
    spinner.stop()
    void run(async () => {
      const result = await runTransaction(
        ref(db, path),
        (cur: Row | null) => {
          if (!cur || cur.status !== 'locked') return undefined
          return {
            ...cur,
            winners: null,
            winnerNames: null,
            winnerPrizes: null,
            revealed: null,
            drawnAt: null,
            drawnBy: null,
          }
        },
        { applyLocally: false },
      )
      if (!result.committed) throw new Error('Không xóa được: kết quả đã được xác nhận.')
    }, 'Đã xóa kết quả quay.')
  }

  function deleteDraw() {
    if (!draw || !window.confirm(`Xóa chương trình "${draw.name}" cùng toàn bộ danh sách và kết quả?`))
      return
    void run(async () => {
      await update(ref(db), { [path]: null, [menuPath]: null })
      navigate('/lucky-draw')
    })
  }

  function togglePublish() {
    if (!draw) return
    if (published) {
      if (!window.confirm(`Ẩn "${draw.name}" khỏi menu Câu lạc bộ? Thành viên sẽ không tự tham gia được nữa.`))
        return
      void run(() => remove(ref(db, menuPath)), 'Đã ẩn khỏi menu Câu lạc bộ.')
      return
    }
    void run(
      () => set(ref(db, menuPath), { name: draw.name, publishedAt: nowMs() }),
      'Đã hiện ở menu Câu lạc bộ, thành viên có thể vào tham gia.',
    )
  }

  const participantList = (keys: string[]) => (
    <ol className="reward-candidates">
      {keys.map((key, i) => {
        const p = byKey.get(key)
        const name = p?.name || 'Người tham gia'
        return (
          <li
            key={key}
            className={['reward-candidate', winnerSet.has(key) ? 'winner' : '']
              .filter(Boolean)
              .join(' ')}
            title={name}
          >
            <span className="reward-candidate-avatar" aria-hidden>
              {p?.avatar ? <img src={p.avatar} alt="" /> : name.charAt(0).toUpperCase()}
            </span>
            <span className="reward-candidate-text">
              <span className="reward-candidate-name">
                {i + 1}. {name}
              </span>
              {winnerSet.has(key) ? (
                <small className="tag-winner">🎁 Trúng thưởng</small>
              ) : (
                <small className="tag-done">{p?.source === 'manual' ? 'Admin thêm' : 'Tự tham gia'}</small>
              )}
            </span>
            {isAdmin && isOpen && p && (
              <button
                type="button"
                className="lucky-remove"
                aria-label={`Xóa ${name}`}
                disabled={busy}
                onClick={() => removeParticipant(p)}
              >
                <X size={14} />
              </button>
            )}
          </li>
        )
      })}
    </ol>
  )

  return (
    <div className="page draw-test">
      <header className="page-header">
        <p className="eyebrow">
          <Link to="/lucky-draw">← Quay số may mắn</Link>
        </p>
        <h1>{draw.name}</h1>
        <p className="lede">
          <span className={`lucky-status lucky-status-${draw.status}`}>
            {LUCKY_STATUS_LABELS[draw.status]}
          </span>{' '}
          {draw.note}
        </p>
      </header>

      {message && <p className="form-info">{message}</p>}
      {error && !isAdmin && <p className="form-error">{error}</p>}

      {isOpen && (
        <section className="section panel lucky-join">
          {me ? (
            <>
              <p>
                ✓ Bạn đã tham gia với tên <strong>{me.name}</strong>.
              </p>
              <button type="button" className="btn ghost compact" disabled={busy} onClick={leave}>
                Rời chương trình
              </button>
            </>
          ) : published || isAdmin ? (
            <>
              <p>Bấm tham gia để có tên trong danh sách quay số.</p>
              <button type="button" className="btn primary" disabled={busy} onClick={join}>
                Tham gia
              </button>
            </>
          ) : (
            <p>Chương trình chưa mở cho thành viên tham gia.</p>
          )}
        </section>
      )}

      <section className="section panel">
        <h2>Phần quà ({slots.length})</h2>
        {editingPrizes && canEditPrizes ? (
          <PrizeEditor
            initial={draw.prizes}
            busy={busy}
            onSave={savePrizes}
            onCancel={() => setEditingPrizes(false)}
          />
        ) : (
          <>
            {draw.prizes.length ? (
              <ol className="lucky-prizes">
                {draw.prizes.map((it, i) => (
                  <li key={i}>
                    {it.name} <span className="muted">× {it.quantity}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="empty">Chưa có phần quà.</p>
            )}
            {canEditPrizes && (
              <button
                type="button"
                className="btn ghost compact"
                onClick={() => {
                  setMessage('')
                  setEditingPrizes(true)
                }}
              >
                Sửa danh sách quà
              </button>
            )}
          </>
        )}
      </section>

      {isAdmin && (
        <section className="section panel lucky-admin">
          <h2>Quản lý</h2>
          <div className="lucky-publish">
            <p>
              {published
                ? '✓ Đang hiện ở menu Câu lạc bộ, thành viên có thể vào tham gia.'
                : 'Chưa hiện ở menu Câu lạc bộ: thành viên chưa thấy và chưa tự tham gia được.'}
            </p>
            <button
              type="button"
              className={published ? 'btn ghost compact' : 'btn primary compact'}
              disabled={busy || menuRaw === undefined}
              onClick={togglePublish}
            >
              {published ? 'Ẩn khỏi menu Câu lạc bộ' : 'Hiện ở menu Câu lạc bộ'}
            </button>
          </div>
          {isOpen && (
            <form className="lucky-manual" onSubmit={addManual}>
              <input
                value={manualName}
                maxLength={100}
                placeholder="Nhập tên người tham gia"
                aria-label="Tên người tham gia"
                onChange={(e) => setManualName(e.target.value)}
              />
              <button type="submit" className="btn ghost compact" disabled={busy || !manualName.trim()}>
                <Plus size={16} aria-hidden /> Thêm
              </button>
            </form>
          )}
          {!confirmed && (
            <div className="btn-row">
              {isOpen ? (
                <button type="button" className="btn primary" disabled={busy || !!lockBlocker} onClick={lock}>
                  Chốt danh sách
                </button>
              ) : (
                savedWinners.length === 0 && (
                  <button type="button" className="btn ghost" disabled={working} onClick={unlock}>
                    Mở lại danh sách
                  </button>
                )
              )}
              <button type="button" className="btn ghost danger" disabled={working} onClick={deleteDraw}>
                Xóa chương trình
              </button>
            </div>
          )}
          {isOpen && lockBlocker && <p className="muted">{lockBlocker}</p>}
          {error && <p className="form-error">{error}</p>}
        </section>
      )}

      {isOpen ? (
        <section className="section panel">
          <h2>Người tham gia ({draw.participants.length})</h2>
          {draw.participants.length ? (
            participantList(draw.participants.map((p) => p.key))
          ) : (
            <p className="empty">Chưa có ai tham gia.</p>
          )}
        </section>
      ) : (
        <div
          ref={screenRef}
          className={fullscreen.isFull ? 'draw-screen full' : 'draw-screen'}
        >
          <DrawStage
            spinner={spinner}
            phase={phase}
            target={draw.name}
            itemsSummary={rewardItemsSummary(draw.prizes)}
            roundText={
              totalRounds === 0
                ? 'Chưa có phần quà'
                : phase === 'done'
                  ? `${confirmed ? 'Đã xác nhận' : 'Đã quay xong'} · ${winners.length}/${slots.length} phần quà`
                  : `Lượt ${round + 1}/${totalRounds} · ${slots[round] ?? ''} · còn ${candidates.length - round} người`
            }
            idleText={`${candidates.length} người · ${slots.length} phần quà`}
            lastWin={stageWinners[stageWinners.length - 1]}
            winners={stageWinners}
            tools={<FullscreenButton {...fullscreen} />}
            actions={
              confirmed ? (
                <span className="draw-confirmed">
                  <BadgeCheck size={18} aria-hidden /> Kết quả đã được xác nhận
                </span>
              ) : !isAdmin ? (
                <span className="draw-confirmed">
                  {phase === 'spinning'
                    ? 'Admin đang quay…'
                    : phase === 'done'
                      ? 'Chờ Admin xác nhận kết quả'
                      : 'Chờ Admin quay số'}
                </span>
              ) : (
                <>
                  {phase === 'done' ? (
                    <button type="button" className="draw-go" disabled={working} onClick={confirmResult}>
                      Xác nhận kết quả
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="draw-go"
                      disabled={working || totalRounds === 0}
                      onClick={() => void runRound()}
                    >
                      {working ? 'Đang quay…' : round === 0 ? 'Quay số' : 'Quay tiếp'}
                    </button>
                  )}
                  {savedWinners.length > 0 && !working && (
                    <button type="button" className="draw-reset" onClick={resetDraw}>
                      <RotateCcw size={16} aria-hidden /> Quay lại từ đầu
                    </button>
                  )}
                </>
              )
            }
          />
          <section className="section panel">
            <h2>Danh sách được quay ({candidates.length})</h2>
            {participantList(candidates)}
          </section>
        </div>
      )}
    </div>
  )
}
