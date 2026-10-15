import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ref, set, update } from 'firebase/database'
import { Pencil, Share2, Trash2, UserPlus } from 'lucide-react'
import { DuelInvitePicker } from '../components/DuelInvitePicker'
import { PayDialog } from '../components/PenaltyPayDialog'
import { useAuth } from '../context/AuthContext'
import {
  activeDuelCount,
  DUEL_JOIN_KEYS_PATH,
  DUEL_SECRETS_PATH,
  DUELS_PATH,
  duelDateText,
  duelGoalText,
  duelPercent,
  duelPhase,
  duelRules,
  formatDateTime,
  formatJoinDeadline,
  formatDuelValue,
  isJoinOpen,
  MAX_ACTIVE_DUELS,
  MAX_DUEL_PARTICIPANTS,
  parseDuel,
  parseDuels,
  rankDuel,
  stakeSummary,
  useDuelValues,
  type Duel,
} from '../lib/duels'
import { db } from '../lib/firebase'
import { duelCode } from '../lib/payment'
import { formatVnd } from '../lib/rewardPenalty'
import { useSharedValue } from '../lib/sharedValue'
import { useUserProfiles } from '../lib/userWrites'
import { DuelPhasePill } from './DuelsPage'

type Row = { uid: string; name: string; value: number | null | undefined; rank: number; won: boolean }

function fillTone(pct: number): string {
  if (pct >= 100) return 'fill-done'
  if (pct >= 75) return 'fill-high'
  if (pct >= 40) return 'fill-mid'
  if (pct >= 20) return 'fill-low'
  return 'fill-start'
}

function errorText(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : ''
  return /permission/i.test(msg) ? `${fallback} (không có quyền hoặc đã hết hạn).` : msg || fallback
}

function Avatar({ name, avatar }: { name: string; avatar?: string }) {
  return (
    <div className="hof-avatar">
      {avatar ? <img src={avatar} alt="" /> : <span>{(name || '?').charAt(0).toUpperCase()}</span>}
    </div>
  )
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export function DuelDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const uid = user?.uid ?? ''
  const isAdmin = Boolean(profile?.admin)
  const raw = useSharedValue(`${DUELS_PATH}/${id}`)
  const allRaw = useSharedValue(DUELS_PATH)
  const profiles = useUserProfiles()
  const now = useNow()
  const duel = raw ? parseDuel(id, raw) : null
  const isCreator = Boolean(duel && duel.createdBy === uid)
  const canManage = isCreator || isAdmin
  const secret = useSharedValue<{ password?: string }>(
    duel && canManage ? `${DUEL_SECRETS_PATH}/${id}` : null,
  )
  const phase = duel ? duelPhase(duel, now) : 'pending'
  const live = useDuelValues(duel, Boolean(duel && !duel.result && (phase === 'ongoing' || phase === 'finished')))

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [password, setPassword] = useState('')
  const [inviting, setInviting] = useState(false)
  const [newInvites, setNewInvites] = useState<string[]>([])
  const [editingPassword, setEditingPassword] = useState(false)
  const [passwordDraft, setPasswordDraft] = useState('')
  const [payFor, setPayFor] = useState<string | null>(null)
  const closePay = useCallback(() => setPayFor(null), [])
  const locking = useRef(false)

  // Hết hạn: người tạo / Admin mở trang thì chốt kết quả một lần, sau đó không đổi nữa
  useEffect(() => {
    if (!duel || duel.result || phase !== 'finished' || !canManage || locking.current) return
    const uids = Object.keys(duel.participants)
    if (uids.some((u) => live[u] === undefined)) return
    locking.current = true
    const ranked = rankDuel(duel, Object.fromEntries(uids.map((u) => [u, live[u] ?? null])))
    const rows = Object.fromEntries(
      ranked.map((r) => [
        r.uid,
        { name: duel.participants[r.uid].name, value: r.value, rank: r.rank, won: r.won },
      ]),
    )
    set(ref(db, `${DUELS_PATH}/${id}/result`), {
      lockedAt: Date.now(),
      lockedBy: uid,
      size: ranked.length,
      rows,
    }).catch(() => {
      locking.current = false
    })
  }, [duel, phase, canManage, live, id, uid])

  if (raw === undefined) {
    return (
      <div className="page">
        <p className="empty">Đang tải…</p>
      </div>
    )
  }
  if (!duel || (duel.approval.status !== 'approved' && !canManage)) {
    return (
      <div className="page">
        <Link className="back-link" to="/duels">
          ← Thách đấu
        </Link>
        <p className="empty">Không tìm thấy thách đấu.</p>
      </div>
    )
  }

  const d: Duel = duel
  const base = `${DUELS_PATH}/${id}`
  const joined = Boolean(d.participants[uid])
  const invited = d.invited.includes(uid)
  const joinOpen = isJoinOpen(d, now)
  const participantCount = Object.keys(d.participants).length
  const myName = profile?.fullName || user?.email || 'Thành viên'
  const nameOf = (u: string) =>
    d.participants[u]?.name ||
    d.result?.rows[u]?.name ||
    String(profiles?.[u]?.fullName || '') ||
    'Thành viên'

  const rows: Row[] = d.result
    ? Object.entries(d.result.rows)
        .map(([u, r]) => ({ uid: u, name: r.name, value: r.value, rank: r.rank, won: r.won }))
        .sort((a, b) => a.rank - b.rank)
    : rankDuel(
        d,
        Object.fromEntries(Object.keys(d.participants).map((u) => [u, live[u] ?? null])),
      ).map((r) => ({
        ...r,
        name: nameOf(r.uid),
        value: phase === 'upcoming' ? (d.metric === 'best_effort' ? null : 0) : live[r.uid],
      }))

  async function run(action: () => Promise<unknown>, done: string, fallback: string) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      setMessage(done)
      return true
    } catch (err) {
      setError(errorText(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  function approve() {
    void run(
      () => set(ref(db, `${base}/approval`), { status: 'approved', by: uid, at: Date.now() }),
      'Đã duyệt thách đấu.',
      'Không duyệt được',
    )
  }

  function reject() {
    const reason = window.prompt('Lý do từ chối (người tạo sẽ thấy):', '')
    if (reason == null) return
    void run(
      () =>
        set(ref(db, `${base}/approval`), {
          status: 'rejected',
          by: uid,
          at: Date.now(),
          ...(reason.trim() ? { reason: reason.trim().slice(0, 300) } : {}),
        }),
      'Đã từ chối thách đấu.',
      'Không từ chối được',
    )
  }

  async function remove() {
    const started = now >= d.startAt && d.approval.status === 'approved'
    if (
      !window.confirm(
        started
          ? 'Xóa thách đấu đang diễn ra / đã kết thúc? Toàn bộ dữ liệu sẽ mất.'
          : 'Hủy thách đấu này? Mọi người tham gia sẽ không thấy nữa.',
      )
    ) {
      return
    }
    const ok = await run(
      () => update(ref(db), { [base]: null, [`${DUEL_SECRETS_PATH}/${id}`]: null }),
      'Đã hủy thách đấu.',
      'Không hủy được',
    )
    if (ok) navigate('/duels')
  }

  function join(e?: FormEvent) {
    e?.preventDefault()
    if (participantCount >= MAX_DUEL_PARTICIPANTS) {
      setError(`Thách đấu đã đủ ${MAX_DUEL_PARTICIPANTS} người.`)
      return
    }
    if (!isAdmin && activeDuelCount(parseDuels(allRaw), uid, now) >= MAX_ACTIVE_DUELS) {
      setError(`Mỗi người tối đa ${MAX_ACTIVE_DUELS} thách đấu chờ duyệt hoặc đang chạy.`)
      return
    }
    const needKey = !invited && d.hasPassword && !isAdmin
    if (needKey && !password.trim()) {
      setError('Nhập mật khẩu tham gia.')
      return
    }
    const updates: Record<string, unknown> = {
      [`${base}/participants/${uid}`]: { name: myName, joinedAt: Date.now() },
    }
    if (d.declined[uid]) updates[`${base}/declined/${uid}`] = null
    if (needKey) updates[`${DUEL_JOIN_KEYS_PATH}/${id}/${uid}`] = password.trim()
    setBusy(true)
    setError('')
    setMessage('')
    update(ref(db), updates)
      .then(() => setMessage('Bạn đã tham gia thách đấu.'))
      .catch((err) =>
        setError(
          needKey && /permission/i.test(String(err))
            ? 'Mật khẩu không đúng.'
            : errorText(err, 'Không tham gia được'),
        ),
      )
      .finally(() => setBusy(false))
  }

  function decline() {
    if (!window.confirm('Từ chối lời mời tham gia thách đấu này?')) return
    void run(() => set(ref(db, `${base}/declined/${uid}`), Date.now()), 'Đã từ chối lời mời.', 'Không từ chối được')
  }

  function requestWithdraw() {
    const reason = window.prompt('Lý do xin rút lui (người tạo sẽ thấy):', '')
    if (reason == null) return
    void run(
      () =>
        set(ref(db, `${base}/withdrawRequests/${uid}`), {
          at: Date.now(),
          ...(reason.trim() ? { reason: reason.trim().slice(0, 300) } : {}),
        }),
      'Đã gửi yêu cầu rút lui, chờ người tạo đồng ý.',
      'Không gửi được yêu cầu',
    )
  }

  function cancelWithdraw() {
    void run(() => set(ref(db, `${base}/withdrawRequests/${uid}`), null), 'Đã hủy yêu cầu rút lui.', 'Không hủy được')
  }

  function decideWithdraw(target: string, accept: boolean) {
    if (accept && !window.confirm(`Đồng ý cho ${nameOf(target)} rút khỏi thách đấu?`)) return
    void run(
      () =>
        accept
          ? update(ref(db, base), { [`participants/${target}`]: null, [`withdrawRequests/${target}`]: null })
          : set(ref(db, `${base}/withdrawRequests/${target}`), null),
      accept ? `${nameOf(target)} đã rút khỏi thách đấu.` : 'Đã từ chối yêu cầu rút lui.',
      'Không cập nhật được',
    )
  }

  function reinvite(target: string) {
    void run(() => set(ref(db, `${base}/declined/${target}`), null), `Đã mời lại ${nameOf(target)}.`, 'Không mời lại được')
  }

  async function sendInvites() {
    if (!newInvites.length) return
    const ok = await run(
      () =>
        update(ref(db, `${base}/invited`), Object.fromEntries(newInvites.map((u) => [u, true]))),
      `Đã mời thêm ${newInvites.length} người.`,
      'Không mời được',
    )
    if (ok) {
      setInviting(false)
      setNewInvites([])
    }
  }

  async function savePassword() {
    const next = passwordDraft.trim()
    if (next.length > 50) {
      setError('Mật khẩu tối đa 50 ký tự.')
      return
    }
    const ok = await run(
      () =>
        update(ref(db), {
          [`${DUEL_SECRETS_PATH}/${id}`]: next ? { password: next } : null,
          [`${base}/hasPassword`]: next ? true : null,
        }),
      next ? 'Đã đổi mật khẩu.' : 'Đã bỏ mật khẩu, thành viên nào cũng tham gia được.',
      'Không đổi được mật khẩu',
    )
    if (ok) setEditingPassword(false)
  }

  async function share() {
    const url = `${window.location.origin}/duels/${id}`
    const pw = secret?.password
    const content = `${d.title}\n${duelGoalText(d)} · ${duelDateText(d)}${pw ? `\nMật khẩu: ${pw}` : ''}\n${url}`
    try {
      if (navigator.share) {
        await navigator.share({ title: d.title, text: content })
      } else {
        await navigator.clipboard.writeText(content)
        setMessage('Đã chép link (kèm mật khẩu) để gửi qua Zalo.')
      }
    } catch {
      // Người dùng đóng bảng chia sẻ
    }
  }

  function toggleStake(target: string, done: boolean) {
    void run(
      () => set(ref(db, `${base}/stakeDone/${target}`), done ? { at: Date.now(), by: uid } : null),
      done ? `Đã ghi nhận ${nameOf(target)} thực hiện cam kết.` : 'Đã bỏ đánh dấu.',
      'Không cập nhật được',
    )
  }

  function toggleFund(target: string, paid: boolean) {
    if (paid && !window.confirm(`Xác nhận ${nameOf(target)} đã góp ${formatVnd(d.fundAmount)} vào quỹ?`)) return
    void run(
      () =>
        set(
          ref(db, `${base}/fundPayments/${target}`),
          paid
            ? {
                amount: d.fundAmount,
                code: duelCode(d, target),
                confirmedAt: Date.now(),
                confirmedBy: uid,
              }
            : null,
        ),
      paid ? 'Đã xác nhận góp quỹ.' : 'Đã hủy xác nhận.',
      'Không cập nhật được',
    )
  }

  const pendingWithdraws = Object.entries(d.withdrawRequests).filter(([u]) => d.participants[u])
  const myWithdraw = d.withdrawRequests[uid]
  const canWithdraw = joined && !isCreator && !d.result && now < d.endAt && d.approval.status === 'approved'
  const editable = canManage && ['pending', 'rejected', 'expired'].includes(phase)
  const canCancel = isAdmin || (isCreator && (d.approval.status !== 'approved' || now < d.startAt))
  const stake = stakeSummary(d)
  const losers = d.result ? rows.filter((r) => !r.won) : []
  const winners = d.result ? rows.filter((r) => r.won) : []
  const canMarkStake = (target: string) =>
    isAdmin ||
    (isCreator && target !== uid) ||
    (target === d.createdBy && d.result?.size === 2 && d.result.rows[uid]?.won === true)

  return (
    <div className="page detail-page">
      <Link className="back-link" to="/duels">
        ← Thách đấu
      </Link>

      <div className="duel-hero">
        <DuelPhasePill phase={phase} />
        <h1>{d.title}</h1>
        <p className="duel-goal">{duelGoalText(d)}</p>
        <p className="muted">
          {duelDateText(d)} · Tạo bởi {d.createdByName || '—'}
        </p>
        <div className="btn-row">
          {editable && (
            <Link className="btn ghost compact" to={`/duels/${id}/edit`}>
              <Pencil size={15} aria-hidden /> Sửa
            </Link>
          )}
          {d.approval.status === 'approved' && phase !== 'finished' && (
            <button type="button" className="btn ghost compact" onClick={() => void share()}>
              <Share2 size={15} aria-hidden /> Chia sẻ
            </button>
          )}
          {canCancel && (
            <button type="button" className="btn ghost compact" disabled={busy} onClick={() => void remove()}>
              <Trash2 size={15} aria-hidden /> {isAdmin && phase !== 'pending' ? 'Xóa' : 'Hủy thách đấu'}
            </button>
          )}
        </div>
      </div>

      {phase === 'pending' && (
        <section className="section panel duel-review">
          <h2>Chờ Admin duyệt</h2>
          <p className="tiny muted">
            Thách đấu chỉ hiện cho mọi người sau khi được duyệt. Phải duyệt trước ngày {d.startDate}.
          </p>
          {isAdmin && (
            <div className="btn-row">
              <button type="button" className="btn primary" disabled={busy} onClick={approve}>
                Duyệt
              </button>
              <button type="button" className="btn danger" disabled={busy} onClick={reject}>
                Từ chối
              </button>
            </div>
          )}
        </section>
      )}
      {phase === 'expired' && (
        <section className="section panel duel-review">
          <h2>Hết hạn duyệt</h2>
          <p className="tiny muted">Đã qua ngày bắt đầu mà chưa được duyệt. Sửa lại ngày để gửi duyệt lại.</p>
        </section>
      )}
      {phase === 'rejected' && (
        <section className="section panel duel-review">
          <h2>Bị từ chối</h2>
          <p className="tiny">{d.approval.reason || 'Admin không ghi lý do.'}</p>
          <p className="tiny muted">Người tạo có thể sửa lại và gửi duyệt lại.</p>
        </section>
      )}

      <section className="section panel">
        <h2>Luật chơi</h2>
        <ul className="goal-details">
          {duelRules(d).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {stake && (
          <>
            <h3 className="goal-rules-title">Cam kết khi thua / không đạt</h3>
            <ul className="goal-details">
              {d.stakeText && <li>{d.stakeText}</li>}
              {d.fundAmount > 0 && <li>Góp quỹ CLB {formatVnd(d.fundAmount)} mỗi người.</li>}
            </ul>
          </>
        )}
        {d.description && <p className="body-text duel-description">{d.description}</p>}
      </section>

      {!joined && d.approval.status === 'approved' && phase !== 'finished' && (
        <section className="section panel">
          <h2>Tham gia</h2>
          {!joinOpen ? (
            <p className="form-error">Đã hết hạn tham gia ({formatJoinDeadline(d.joinUntil)}).</p>
          ) : invited ? (
            <>
              <p className="tiny">
                {d.declined[uid]
                  ? 'Bạn đã từ chối lời mời. Vẫn có thể tham gia nếu đổi ý.'
                  : `${d.createdByName || 'Người tạo'} mời bạn tham gia thách đấu này.`}
              </p>
              <div className="btn-row">
                <button type="button" className="btn primary" disabled={busy} onClick={() => join()}>
                  Tham gia
                </button>
                {!d.declined[uid] && (
                  <button type="button" className="btn ghost" disabled={busy} onClick={decline}>
                    Từ chối
                  </button>
                )}
              </div>
            </>
          ) : (
            <form className="auth-form" onSubmit={join}>
              {d.hasPassword && !isAdmin && (
                <label>
                  Mật khẩu tham gia
                  <input
                    type="password"
                    value={password}
                    autoComplete="off"
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              )}
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Đang xử lý…' : 'Tham gia'}
              </button>
            </form>
          )}
          <p className="tiny muted">
            Hạn tham gia: {formatJoinDeadline(d.joinUntil)}. Muốn rút lui sau khi tham gia phải được người
            tạo đồng ý.
          </p>
        </section>
      )}

      {canWithdraw && (
        <section className="section panel">
          <h2>Rút lui</h2>
          {myWithdraw ? (
            <>
              <p className="tiny">
                Bạn đã xin rút lui lúc {formatDateTime(myWithdraw.at)}
                {myWithdraw.reason ? ` (${myWithdraw.reason})` : ''}. Đang chờ người tạo đồng ý; trong lúc
                chờ bạn vẫn được tính kết quả.
              </p>
              <button type="button" className="btn ghost" disabled={busy} onClick={cancelWithdraw}>
                Hủy yêu cầu
              </button>
            </>
          ) : (
            <button type="button" className="btn ghost" disabled={busy} onClick={requestWithdraw}>
              Xin rút lui
            </button>
          )}
        </section>
      )}

      {canManage && pendingWithdraws.length > 0 && !d.result && (
        <section className="section panel">
          <h2>Yêu cầu rút lui ({pendingWithdraws.length})</h2>
          <ul className="duel-request-list">
            {pendingWithdraws.map(([u, w]) => (
              <li key={u}>
                <div>
                  <strong>{nameOf(u)}</strong>
                  <span className="tiny muted">
                    {formatDateTime(w.at)}
                    {w.reason ? ` · ${w.reason}` : ''}
                  </span>
                </div>
                <div className="btn-row">
                  <button type="button" className="btn primary compact" disabled={busy} onClick={() => decideWithdraw(u, true)}>
                    Đồng ý
                  </button>
                  <button type="button" className="btn ghost compact" disabled={busy} onClick={() => decideWithdraw(u, false)}>
                    Từ chối
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section panel">
        <h2>{d.result ? 'Kết quả' : 'Bảng xếp hạng'}</h2>
        <p className="lede tiny">
          {participantCount || rows.length} người ·{' '}
          {d.result
            ? `chốt lúc ${formatDateTime(d.result.lockedAt)}`
            : phase === 'ongoing'
              ? 'cập nhật trực tiếp từ Strava'
              : phase === 'finished'
                ? 'đang chốt kết quả…'
                : 'bắt đầu tính khi thách đấu diễn ra'}
        </p>
        <ol className="participant-list">
          {rows.map((r) => {
            const pct = duelPercent(d, r.value)
            return (
              <li key={r.uid} className={`participant-row${r.uid === uid ? ' me' : ''}`}>
                <span className="participant-rank">{r.rank}</span>
                <Avatar name={r.name} avatar={String(profiles?.[r.uid]?.avatar || '')} />
                <div className="participant-meta">
                  <strong>
                    {r.name}
                    {r.uid === uid ? ' (bạn)' : ''}
                  </strong>
                  <span className="tiny muted">
                    {r.uid === d.createdBy && 'Người tạo · '}
                    {d.withdrawRequests[r.uid] && !d.result && 'Xin rút lui · '}
                    {d.result ? (r.won ? '🏆 Thắng' : 'Không đạt') : d.kind === 'target' ? `${pct}% mục tiêu` : `Hạng ${r.rank}`}
                  </span>
                  {d.kind === 'target' && (
                    <div className="progress-track">
                      <div className={`progress-fill ${fillTone(pct)}`} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
                <span className="participant-km">{formatDuelValue(d, r.value)}</span>
              </li>
            )
          })}
        </ol>
      </section>

      {d.result && (stake || winners.length > 0) && (
        <section className="section panel">
          <h2>Thực hiện cam kết</h2>
          <p className="tiny">
            {winners.length
              ? `Thắng: ${winners.map((w) => w.name).join(', ')}.`
              : 'Không ai thắng.'}
          </p>
          {!stake ? (
            <p className="tiny muted">Thách đấu không có cam kết thưởng – phạt.</p>
          ) : losers.length === 0 ? (
            <p className="tiny muted">Tất cả đều đạt, không ai phải thực hiện cam kết.</p>
          ) : (
            <ul className="duel-request-list">
              {losers.map((r) => {
                const done = d.stakeDone[r.uid]
                const paid = d.fundPayments[r.uid]
                return (
                  <li key={r.uid}>
                    <div>
                      <strong>
                        {r.name}
                        {r.uid === uid ? ' (bạn)' : ''}
                      </strong>
                      {d.stakeText && (
                        <span className="tiny muted">
                          {done ? `✓ Đã thực hiện cam kết (${formatDateTime(done.at)})` : 'Chưa thực hiện cam kết'}
                        </span>
                      )}
                      {d.fundAmount > 0 && (
                        <span className="tiny muted">
                          {paid
                            ? `✓ Đã góp quỹ ${formatVnd(paid.amount)} · ${paid.code}`
                            : `Chưa góp quỹ ${formatVnd(d.fundAmount)}`}
                          {!paid && isAdmin && ` · Mã ${duelCode(d, r.uid)}`}
                        </span>
                      )}
                    </div>
                    <div className="btn-row">
                      {d.stakeText && canMarkStake(r.uid) && (
                        <button
                          type="button"
                          className="btn ghost compact"
                          disabled={busy}
                          onClick={() => toggleStake(r.uid, !done)}
                        >
                          {done ? 'Bỏ đánh dấu' : 'Đã thực hiện'}
                        </button>
                      )}
                      {d.fundAmount > 0 && !paid && (r.uid === uid || isAdmin) && (
                        <button
                          type="button"
                          className={r.uid === uid ? 'btn primary compact' : 'btn ghost compact'}
                          onClick={() => setPayFor(r.uid)}
                        >
                          {r.uid === uid ? 'Góp quỹ' : 'Mã QR'}
                        </button>
                      )}
                      {d.fundAmount > 0 && isAdmin && (
                        <button
                          type="button"
                          className="btn ghost compact"
                          disabled={busy}
                          onClick={() => toggleFund(r.uid, !paid)}
                        >
                          {paid ? 'Hủy xác nhận' : 'Xác nhận đã nộp'}
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {canManage && d.approval.status === 'approved' && (d.invited.length > 0 || joinOpen) && (
        <section className="section panel">
          <h2>Lời mời ({d.invited.length})</h2>
          {d.invited.length > 0 && (
            <ul className="duel-request-list">
              {d.invited.map((u) => {
                const status = d.participants[u]
                  ? 'Đã tham gia'
                  : d.declined[u]
                    ? 'Đã từ chối'
                    : d.withdrawRequests[u]
                      ? 'Xin rút lui'
                      : joinOpen
                        ? 'Chờ phản hồi'
                        : 'Không phản hồi'
                return (
                  <li key={u}>
                    <div>
                      <strong>{nameOf(u)}</strong>
                      <span className="tiny muted">{status}</span>
                    </div>
                    {d.declined[u] && joinOpen && !d.participants[u] && (
                      <button type="button" className="btn ghost compact" disabled={busy} onClick={() => reinvite(u)}>
                        Mời lại
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {joinOpen &&
            (inviting ? (
              <div className="duel-invite-more">
                <DuelInvitePicker
                  selected={newInvites}
                  exclude={[...d.invited, ...Object.keys(d.participants)]}
                  onChange={setNewInvites}
                />
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy || newInvites.length === 0}
                    onClick={() => void sendInvites()}
                  >
                    Gửi lời mời ({newInvites.length})
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setInviting(false)}>
                    Hủy
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn ghost" onClick={() => setInviting(true)}>
                <UserPlus size={16} aria-hidden /> Mời thêm
              </button>
            ))}
        </section>
      )}

      {canManage && d.approval.status === 'approved' && phase !== 'finished' && (
        <section className="section panel">
          <h2>Mật khẩu tham gia</h2>
          {editingPassword ? (
            <div className="auth-form">
              <label>
                Mật khẩu mới (để trống để bỏ mật khẩu)
                <input
                  value={passwordDraft}
                  maxLength={50}
                  onChange={(e) => setPasswordDraft(e.target.value)}
                />
              </label>
              <div className="btn-row">
                <button type="button" className="btn primary" disabled={busy} onClick={() => void savePassword()}>
                  Lưu
                </button>
                <button type="button" className="btn ghost" onClick={() => setEditingPassword(false)}>
                  Hủy
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="tiny">
                {secret?.password ? (
                  <>
                    Mật khẩu: <code>{secret.password}</code>
                  </>
                ) : (
                  'Không có mật khẩu: thành viên chính thức nào cũng tham gia được.'
                )}
              </p>
              <button
                type="button"
                className="btn ghost compact"
                onClick={() => {
                  setPasswordDraft(secret?.password ?? '')
                  setEditingPassword(true)
                }}
              >
                Đổi mật khẩu
              </button>
            </>
          )}
        </section>
      )}

      {error && <p className="form-error">{error}</p>}
      {message && <p className="form-info">{message}</p>}

      {payFor && (
        <PayDialog
          heading={`Góp quỹ ${formatVnd(d.fundAmount)}`}
          subtitle={`${d.title} · ${nameOf(payFor)}`}
          code={duelCode(d, payFor)}
          amount={d.fundAmount}
          fileName="gop-quy"
          onClose={closePay}
        />
      )}
    </div>
  )
}
