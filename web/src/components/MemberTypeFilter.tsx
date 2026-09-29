export type MemberType = 'all' | 'official' | 'free'

/** "Tự do" = thành viên Khách (chưa được duyệt chính thức, `member` false) */
export function matchesMemberType(isMember: boolean, type: MemberType): boolean {
  if (type === 'official') return isMember
  if (type === 'free') return !isMember
  return true
}

export function MemberTypeFilter({
  value,
  onChange,
  items,
}: {
  value: MemberType
  onChange: (next: MemberType) => void
  items: { member: boolean }[]
}) {
  const official = items.filter((m) => m.member).length
  const options: [MemberType, string, number][] = [
    ['all', 'Tất cả', items.length],
    ['official', 'Chính thức', official],
    ['free', 'Tự do', items.length - official],
  ]
  return (
    <div className="filter-row" role="group" aria-label="Lọc loại thành viên">
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
