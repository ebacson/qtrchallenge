import { useMemo, useState } from 'react'
import { useUserProfiles } from '../lib/userWrites'

/** Chọn thành viên chính thức để mời; `exclude` là những người không hiện trong danh sách */
export function DuelInvitePicker({
  selected,
  onChange,
  exclude,
}: {
  selected: string[]
  onChange: (next: string[]) => void
  exclude: string[]
}) {
  const profiles = useUserProfiles()
  const [query, setQuery] = useState('')
  const excludeKey = exclude.join(',')
  const members = useMemo(() => {
    const skip = new Set(excludeKey.split(','))
    return Object.entries(profiles ?? {})
      .filter(([uid, p]) => !skip.has(uid) && p.member === true)
      .map(([uid, p]) => ({ uid, name: String(p.fullName || p.email || 'Thành viên') }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  }, [profiles, excludeKey])
  const q = query.trim().toLowerCase()
  const shown = q ? members.filter((m) => m.name.toLowerCase().includes(q)) : members
  const chosen = new Set(selected)
  const allChosen = members.length > 0 && members.every((m) => chosen.has(m.uid))

  function toggle(uid: string) {
    onChange(chosen.has(uid) ? selected.filter((u) => u !== uid) : [...selected, uid])
  }

  return (
    <div className="duel-invite-picker">
      <div className="duel-invite-head">
        <input
          type="search"
          value={query}
          placeholder="Tìm thành viên…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="btn ghost compact"
          onClick={() => onChange(allChosen ? [] : members.map((m) => m.uid))}
        >
          {allChosen ? 'Bỏ chọn hết' : 'Chọn tất cả'}
        </button>
      </div>
      <p className="tiny muted">Đã chọn {chosen.size} người (chỉ thành viên chính thức).</p>
      {profiles == null ? (
        <p className="tiny muted">Đang tải danh sách…</p>
      ) : (
        <ul className="duel-invite-list">
          {shown.map((m) => (
            <li key={m.uid}>
              <label>
                <input type="checkbox" checked={chosen.has(m.uid)} onChange={() => toggle(m.uid)} />
                <span>{m.name}</span>
              </label>
            </li>
          ))}
          {shown.length === 0 && <li className="tiny muted">Không có thành viên phù hợp.</li>}
        </ul>
      )}
    </div>
  )
}
