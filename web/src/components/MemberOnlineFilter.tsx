export type OnlineFilter = 'all' | 'online' | 'offline'

export function matchesOnlineFilter(isOnline: boolean, filter: OnlineFilter): boolean {
  if (filter === 'online') return isOnline
  if (filter === 'offline') return !isOnline
  return true
}

export function MemberOnlineFilter({
  value,
  onChange,
  onlineCount,
  offlineCount,
  total,
}: {
  value: OnlineFilter
  onChange: (next: OnlineFilter) => void
  onlineCount: number
  offlineCount: number
  total: number
}) {
  const options: [OnlineFilter, string, number][] = [
    ['all', 'Tất cả', total],
    ['online', 'Online', onlineCount],
    ['offline', 'Offline', offlineCount],
  ]
  return (
    <div className="filter-row" role="group" aria-label="Lọc trạng thái online">
      {options.map(([type, label, count]) => (
        <button
          key={type}
          type="button"
          className={value === type ? 'chip active' : 'chip'}
          aria-pressed={value === type}
          onClick={() => onChange(type)}
        >
          {label} ({count})
        </button>
      ))}
    </div>
  )
}
