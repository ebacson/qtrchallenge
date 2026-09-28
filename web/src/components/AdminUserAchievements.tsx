import { useMemo, useState, type FormEvent } from 'react'
import { ref, remove, set, update } from 'firebase/database'
import { db } from '../lib/firebase'
import { formatRankTime, timeToSeconds } from '../lib/prRanking'
import {
  RECORD_FIELDS,
  formatHistoryTime,
  parseHistory,
  recordStatus,
  type RecordDistance,
} from '../lib/userRecords'

type PrDraft = Record<RecordDistance, { time: string; verified: boolean }>

const DISTANCES: RecordDistance[] = ['FM', 'HM']

type Props = {
  uid: string
  displayName: string
  row: Record<string, unknown>
}

export function AdminUserAchievements({ uid, displayName, row }: Props) {
  const status = useMemo(
    () => ({ FM: recordStatus(row, 'FM'), HM: recordStatus(row, 'HM') }),
    [row],
  )
  const history = useMemo(() => parseHistory(row.history), [row])

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<PrDraft | null>(null)
  const [prBusy, setPrBusy] = useState(false)
  const [historyDraft, setHistoryDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  function initialDraft(): PrDraft {
    const pick = (d: RecordDistance) => {
      const s = status[d]
      return {
        time: s.validFormat ? formatRankTime(s.submitted) : s.submitted,
        verified: s.verified,
      }
    }
    return { FM: pick('FM'), HM: pick('HM') }
  }

  function toggleOpen() {
    if (!open) {
      setDraft(initialDraft())
      setHistoryDraft('')
      setEditingId(null)
      setError('')
      setMessage('')
    }
    setOpen((v) => !v)
  }

  function patchDraft(d: RecordDistance, patch: Partial<PrDraft[RecordDistance]>) {
    setDraft((prev) => (prev ? { ...prev, [d]: { ...prev[d], ...patch } } : prev))
  }

  async function onSavePr(e: FormEvent) {
    e.preventDefault()
    if (!draft) return
    const base = initialDraft()
    const updates: Record<string, string | boolean> = {}
    for (const d of DISTANCES) {
      const { time, flag, label } = RECORD_FIELDS[d]
      const raw = draft[d].time.trim()
      if (raw && !Number.isFinite(timeToSeconds(raw))) {
        setError(`PR ${label} sai định dạng hh:mm:ss.`)
        return
      }
      const value = raw ? formatRankTime(raw) : ''
      const verify = Boolean(value) && draft[d].verified
      if (value === base[d].time.trim() && verify === base[d].verified) continue
      updates[time] = value
      updates[flag] = verify
      if (verify || !value) {
        updates[`personalRecord/${time}`] = value
        updates[`personalRecord/${flag}`] = verify
      } else if (base[d].verified) {
        updates[`personalRecord/${flag}`] = false
      }
    }
    if (Object.keys(updates).length === 0) {
      setMessage('Không có thay đổi PR.')
      return
    }
    setPrBusy(true)
    setError('')
    setMessage('')
    try {
      await update(ref(db, `users/${uid}`), updates)
      setMessage(`Đã lưu PR của ${displayName}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được PR')
    } finally {
      setPrBusy(false)
    }
  }

  async function onSaveHistory(e: FormEvent) {
    e.preventDefault()
    const content = historyDraft.trim()
    if (!content) {
      setError('Nhập nội dung lịch sử.')
      return
    }
    setHistoryBusy(true)
    setError('')
    setMessage('')
    try {
      if (editingId) {
        const existing = history.find((h) => h.id === editingId)
        await update(ref(db, `users/${uid}/history/${editingId}`), {
          content,
          timestamp: existing?.timestamp || editingId,
          createdAt: existing?.createdAt || Date.now() / 1000,
          updatedAt: Date.now() / 1000,
        })
      } else {
        const nowMs = Date.now()
        const key = String(nowMs)
        await set(ref(db, `users/${uid}/history/${key}`), {
          content,
          timestamp: key,
          createdAt: nowMs / 1000,
        })
      }
      setHistoryDraft('')
      setEditingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được lịch sử')
    } finally {
      setHistoryBusy(false)
    }
  }

  async function deleteHistory(id: string) {
    if (!window.confirm(`Xóa mục lịch sử này của ${displayName}?`)) return
    setHistoryBusy(true)
    setError('')
    setMessage('')
    try {
      await remove(ref(db, `users/${uid}/history/${id}`))
      if (editingId === id) {
        setEditingId(null)
        setHistoryDraft('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xóa được')
    } finally {
      setHistoryBusy(false)
    }
  }

  return (
    <div className="admin-achievements">
      <div className="admin-achievements-head">
        <strong>Thành tích</strong>
        <button type="button" className="btn ghost compact" onClick={toggleOpen}>
          {open ? 'Đóng' : 'Sửa thành tích'}
        </button>
      </div>

      <div className="admin-pr-summary">
        {DISTANCES.map((d) => {
          const s = status[d]
          return (
            <div key={d} className="admin-pr-item">
              <span className="tiny muted">PR {d}</span>
              <strong className="record-time">
                {s.submitted ? (s.validFormat ? formatRankTime(s.submitted) : s.submitted) : '—'}
              </strong>
              {s.submitted && (
                <span className={`verify-pill ${s.verified ? 'yes' : 'no'}`}>
                  {s.verified ? 'Đã xác thực' : 'Chờ xác thực'}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {!open && (
        <p className="tiny muted admin-history-preview">
          {history.length === 0
            ? 'Chưa có lịch sử thành tích.'
            : `Lịch sử: ${history[0].content.split('\n')[0]}${
                history.length > 1 ? ` (+${history.length - 1} mục)` : ''
              }`}
        </p>
      )}

      {open && draft && (
        <>
          <form className="auth-form admin-pr-form" onSubmit={onSavePr}>
            <div className="pr-edit-grid">
              {DISTANCES.map((d) => (
                <div key={d} className="admin-pr-field">
                  <label>
                    PR {RECORD_FIELDS[d].label} (hh:mm:ss)
                    <input
                      value={draft[d].time}
                      onChange={(e) => patchDraft(d, { time: e.target.value })}
                      placeholder={d === 'FM' ? '3:45:00' : '1:45:00'}
                    />
                  </label>
                  <label className="admin-pr-verify">
                    <input
                      type="checkbox"
                      checked={draft[d].verified}
                      disabled={!draft[d].time.trim()}
                      onChange={(e) => patchDraft(d, { verified: e.target.checked })}
                    />
                    <span>Đã xác thực (lên Bảng vàng)</span>
                  </label>
                </div>
              ))}
            </div>
            <p className="tiny muted">Để trống thời gian để xóa PR.</p>
            <div className="history-form-actions">
              <button type="submit" className="btn primary compact" disabled={prBusy}>
                {prBusy ? 'Đang lưu…' : 'Lưu PR'}
              </button>
            </div>
          </form>

          <div className="admin-history">
            <strong className="tiny">Lịch sử thành tích</strong>
            <form className="history-form" onSubmit={onSaveHistory}>
              <textarea
                value={historyDraft}
                onChange={(e) => setHistoryDraft(e.target.value)}
                rows={3}
                placeholder="VD: VnExpress Marathon 2025 — FM 3:42:15"
              />
              <div className="history-form-actions">
                {editingId && (
                  <button
                    type="button"
                    className="btn ghost compact"
                    disabled={historyBusy}
                    onClick={() => {
                      setEditingId(null)
                      setHistoryDraft('')
                    }}
                  >
                    Hủy
                  </button>
                )}
                <button type="submit" className="btn primary compact" disabled={historyBusy}>
                  {historyBusy ? 'Đang lưu…' : editingId ? 'Cập nhật' : 'Thêm lịch sử'}
                </button>
              </div>
            </form>

            {history.length === 0 ? (
              <p className="tiny muted">Chưa có lịch sử thành tích.</p>
            ) : (
              <ul className="history-list editable">
                {history.map((h) => (
                  <li key={h.id} className="history-item">
                    <div className="history-item-body">
                      <p>{h.content}</p>
                      <span className="tiny muted">{formatHistoryTime(h)}</span>
                    </div>
                    <div className="history-item-actions">
                      <button
                        type="button"
                        className="btn ghost compact"
                        disabled={historyBusy}
                        onClick={() => {
                          setEditingId(h.id)
                          setHistoryDraft(h.content)
                        }}
                      >
                        Sửa
                      </button>
                      <button
                        type="button"
                        className="btn ghost compact danger"
                        disabled={historyBusy}
                        onClick={() => void deleteHistory(h.id)}
                      >
                        Xóa
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {error && <p className="form-error">{error}</p>}
      {message && <p className="form-info">{message}</p>}
    </div>
  )
}
