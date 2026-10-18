/** `true` = chỉ hiện online; `false` = không lọc theo presence */
export function MemberOnlineFilter({
  active,
  onChange,
  onlineCount,
}: {
  active: boolean
  onChange: (next: boolean) => void
  onlineCount: number
}) {
  return (
    <div className="filter-row" role="group" aria-label="Lọc thành viên online">
      <button
        type="button"
        className={active ? 'chip active' : 'chip'}
        aria-pressed={active}
        onClick={() => onChange(!active)}
      >
        Online ({onlineCount})
      </button>
    </div>
  )
}
