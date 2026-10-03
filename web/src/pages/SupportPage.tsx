import { Phone } from 'lucide-react'

type Contact = { name: string; role?: string; phone: string }

const groups: { title: string; contacts: Contact[] }[] = [
  {
    title: 'Ban chủ nhiệm',
    contacts: [
      { name: 'Hoàng Minh An', role: 'Chủ nhiệm', phone: '0973.234.555' },
      { name: 'Nguyễn Ngọc Chiến', role: 'PCN TT', phone: '0914.185.285' },
      { name: 'Trần Mạnh Thường', role: 'PCN Đối ngoại', phone: '0914.145.575' },
      { name: 'Trương Công Tuyên', role: 'PCN Hậu cần', phone: '0907.779.995' },
      { name: 'Lê Thị Đoài', role: 'Thủ quỹ', phone: '0918.190.555' },
    ],
  },
  {
    title: 'CNTT - Quản lý Web app',
    contacts: [{ name: 'Tạ Bắc Sơn', phone: '0913.485.889' }],
  },
]

function initials(name: string): string {
  return name.split(' ').pop()?.charAt(0).toUpperCase() ?? '?'
}

export function SupportPage() {
  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">Câu lạc bộ</p>
        <h1>☎ Liên hệ hỗ trợ</h1>
      </header>

      {groups.map((g) => (
        <section key={g.title} className="section panel">
          <h2>{g.title}</h2>
          <ul className="participant-list support-list">
            {g.contacts.map((c) => (
              <li key={c.phone} className="participant-row">
                <div className="hof-avatar">
                  <span>{initials(c.name)}</span>
                </div>
                <div className="participant-meta">
                  <strong>{c.name}</strong>
                  {c.role && <span className="tiny muted">{c.role}</span>}
                </div>
                <a
                  className="btn ghost compact support-call"
                  href={`tel:${c.phone.replace(/\D/g, '')}`}
                  aria-label={`Gọi ${c.name}`}
                >
                  <Phone size={16} aria-hidden />
                  {c.phone}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
