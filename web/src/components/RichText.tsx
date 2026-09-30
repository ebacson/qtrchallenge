import type { ReactNode } from 'react'

type Run = { text: string; bold: boolean; italic: boolean }

/**
 * Chữ "in đậm/nghiêng" dán từ Facebook là ký tự Unicode toán học (𝐀, 𝑨…), dấu tiếng Việt
 * ghép rời nên font web hiển thị lệch. Khối U+1D400–U+1D7FF.
 */
const MATH_START = 0x1d400
const MATH_END = 0x1d7ff

const BOLD_RANGES: [number, number][] = [
  [0x1d400, 0x1d433], // bold
  [0x1d468, 0x1d49b], // bold italic
  [0x1d4d0, 0x1d503], // bold script
  [0x1d56c, 0x1d59f], // bold fraktur
  [0x1d5d4, 0x1d607], // sans bold
  [0x1d63c, 0x1d66f], // sans bold italic
  [0x1d7ce, 0x1d7d7], // bold digits
  [0x1d7ec, 0x1d7f5], // sans bold digits
]

const ITALIC_RANGES: [number, number][] = [
  [0x1d434, 0x1d467], // italic
  [0x1d468, 0x1d49b], // bold italic
  [0x1d608, 0x1d63b], // sans italic
  [0x1d63c, 0x1d66f], // sans bold italic
]

const URL_RE = /https?:\/\/[^\s<>"']+/g
const TRAILING_PUNCT_RE = /[.,;:!?)\]}'"]+$/
const DIVIDER_RE = /^[-–—_=~*•·]{3,}$/
const BULLET_RE = /^[-*•+·]\s+(.*)$/

function inRanges(cp: number, ranges: [number, number][]): boolean {
  return ranges.some(([a, b]) => cp >= a && cp <= b)
}

/** Chuẩn hóa văn bản dán vào: xuống dòng, khoảng trắng lạ, ký tự vô hình, dòng trống thừa. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function toStyledRuns(text: string): Run[] {
  const runs: Run[] = []
  let current: Run | null = null
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    // Dấu ghép và khoảng trắng đi theo đoạn đang mở để không cắt vụn thẻ đậm/nghiêng
    if (current && (/\p{M}/u.test(ch) || /\s/.test(ch))) {
      current.text += ch
      continue
    }
    let bold = false
    let italic = false
    let out = ch
    if (cp >= MATH_START && cp <= MATH_END) {
      bold = inRanges(cp, BOLD_RANGES)
      italic = inRanges(cp, ITALIC_RANGES)
      out = ch.normalize('NFKC')
    }
    if (current && current.bold === bold && current.italic === italic) {
      current.text += out
    } else {
      current = { text: out, bold, italic }
      runs.push(current)
    }
  }
  return runs.map((r) => ({ ...r, text: r.text.normalize('NFC') }))
}

/** Văn bản thuần (bỏ kiểu chữ Unicode) — dùng cho tiêu đề, xem trước. */
export function plainText(text: string): string {
  return toStyledRuns(normalizeText(text))
    .map((r) => r.text)
    .join('')
}

function linkify(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0
    let url = match[0]
    const trailing = TRAILING_PUNCT_RE.exec(url)?.[0] ?? ''
    if (trailing) url = url.slice(0, -trailing.length)
    if (start > last) nodes.push(text.slice(last, start))
    nodes.push(
      <a key={`${keyPrefix}-${start}`} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>,
    )
    last = start + url.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function renderInline(line: string, key: string): ReactNode[] {
  return toStyledRuns(line).map((run, i) => {
    const content = linkify(run.text, `${key}-${i}`)
    if (run.bold && run.italic) {
      return (
        <strong key={i}>
          <em>{content}</em>
        </strong>
      )
    }
    if (run.bold) return <strong key={i}>{content}</strong>
    if (run.italic) return <em key={i}>{content}</em>
    return <span key={i}>{content}</span>
  })
}

/** Hiển thị văn bản người dùng dán vào: giữ xuống dòng, gạch đầu dòng, đường kẻ, link bấm được. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const lines = normalizeText(text).split('\n')
  return (
    <div className={className ? `rich-text ${className}` : 'rich-text'}>
      {lines.map((raw, i) => {
        const line = raw.trim()
        if (!line) return <div key={i} className="rt-gap" />
        if (DIVIDER_RE.test(line)) return <hr key={i} />
        const bullet = BULLET_RE.exec(line)
        if (bullet) {
          return (
            <div key={i} className="rt-bullet">
              {renderInline(bullet[1], String(i))}
            </div>
          )
        }
        return <div key={i}>{renderInline(line, String(i))}</div>
      })}
    </div>
  )
}
