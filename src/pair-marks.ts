// The pair rules of lint read a pair of bare marks in text; the writer escapes what they report (C2-W-146).

export function isWord(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch)
}

// 0.1 read U+FEFF as content, which String.prototype.trim would strip.
const EDGE_SPACE = /^[\p{Zs}\t\n\r\f\v]|[\p{Zs}\t\n\r\f\v]$/u

/** Whether the character at `at` stands behind an odd run of backslashes, so 0.1 read it as text. */
export function escaped(text: string, at: number): boolean {
  let slashes = 0
  while (text[at - 1 - slashes] === '\\') slashes++
  return slashes % 2 === 1
}

// C2-I-050: a bare mark followed by a combining mark, a variation selector or a zero-width joiner opens no pair.
const JOINED = /^[\p{M}\u200D\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u

function joined(text: string, mark: string, id: string, at: number): boolean {
  return id.startsWith('deprecated-bare-') && JOINED.test(text.slice(at + mark.length, at + mark.length + 2))
}

function canOpen(text: string, mark: string, id: string, at: number): boolean {
  if (!id.startsWith('deprecated-bare-')) return true
  const after = text[at + mark.length]
  return !joined(text, mark, id, at) && !escaped(text, at)
    && !(id.startsWith('deprecated-bare-') && text[at - 1] === mark[0])
    && after !== undefined && !EDGE_SPACE.test(after) && after !== mark[0]
    && (mark.length === 2 || !isWord(text[at - 1]))
}

function nextCloser(text: string, mark: string, id: string, from: number): number {
  let end = text.indexOf(mark, from)
  while (end >= 0 && (/[\p{Zs}\t\n\r]/u.test(text[end - 1] ?? '') || escaped(text, end) || joined(text, mark, id, end))) {
    end = text.indexOf(mark, end + mark.length)
  }
  return end
}

function validDjotPair(text: string, mark: string, start: number, end: number): boolean {
  return text[start - 1] !== '{' && text[end + mark.length] !== '}'
    && text[start - 1] !== mark && text[start + 1] !== mark
}

function validPair(text: string, mark: string, id: string, start: number, end: number): boolean {
  const inside = text.slice(start + mark.length, end)
  if (escaped(text, start) || inside === '' || EDGE_SPACE.test(inside)) return false
  if (inside[0] === mark[0] || inside.at(-1) === mark[0]) return false
  if (mark === '**' && inside.includes('*')) return false
  if (id === 'djot-subscript-tilde' || id === 'djot-superscript-caret') return validDjotPair(text, mark, start, end)
  if (id === 'markdown-strong-double-star' || id === 'markdown-strikethrough-double-tilde') return true
  return !isWord(text[start - 1]) && !isWord(text[end + mark.length])
}

/** The pairs of `mark` in `text` that the lint rule `id` reports, as start and end offsets. */
export function pairedMarks(text: string, mark: string, id: string, visit: (start: number, end: number) => void): void {
  let at = 0
  while (at < text.length) {
    const start = text.indexOf(mark, at)
    if (start < 0) return
    if (!canOpen(text, mark, id, start)) {
      at = start + mark.length
      continue
    }
    const end = nextCloser(text, mark, id, start + mark.length + 1)
    if (end < 0) return
    if (validPair(text, mark, id, start, end)) visit(start, end + mark.length)
    at = end + mark.length
  }
}
