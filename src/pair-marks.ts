// The pair rules of lint read a pair of bare marks in text; the writer escapes what they report (C2-W-146).

const WORD = /[\p{L}\p{N}]/u
const BLANK = /[\p{Zs}\t\n\r]/u
const EDGE = /[\p{Zs}\t\n\r\f\v]/u

export function isWord(ch: string | undefined): boolean {
  if (ch === undefined) return false
  const code = ch.charCodeAt(0)
  if (code < 128) return (code >= 48 && code <= 57) || ((code | 32) >= 97 && (code | 32) <= 122)
  return WORD.test(ch)
}

/** The classes of the regular expressions above, read by code unit so the ASCII range takes no regex test. */
function isBlankAt(text: string, at: number): boolean {
  const code = text.charCodeAt(at)
  if (code < 128) return code === 32 || code === 9 || code === 10 || code === 13
  return BLANK.test(text[at]!)
}

export function isEdgeSpaceAt(text: string, at: number): boolean {
  const code = text.charCodeAt(at)
  if (code < 128) return code === 32 || (code >= 9 && code <= 13)
  return EDGE.test(text[at]!)
}

// 0.1 read U+FEFF as content, which String.prototype.trim would strip: an edge space is one of EDGE.

/** Whether the character at `at` stands behind an odd run of backslashes, so 0.1 read it as text. */
export function escaped(text: string, at: number): boolean {
  let slashes = 0
  while (text[at - 1 - slashes] === '\\') slashes++
  return slashes % 2 === 1
}

// C2-I-050: a bare mark followed by a combining mark, a variation selector or a zero-width joiner opens no pair.
const JOINED = /^[\p{M}\u200D\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u

/** `bare`: the rule is one of the deprecated-bare rules, which these tests concern. */
function joined(text: string, mark: string, bare: boolean, at: number): boolean {
  // Every character of JOINED lies at U+0300 or above.
  if (!bare || !(text.charCodeAt(at + mark.length) >= 0x300)) return false
  return JOINED.test(text.slice(at + mark.length, at + mark.length + 2))
}

function canOpen(text: string, mark: string, bare: boolean, at: number): boolean {
  if (!bare) return true
  const after = at + mark.length
  return !joined(text, mark, bare, at) && !escaped(text, at)
    && text[at - 1] !== mark[0]
    && after < text.length && !isEdgeSpaceAt(text, after) && text[after] !== mark[0]
    && (mark.length === 2 || !isWord(text[at - 1]))
}

function nextCloser(text: string, mark: string, bare: boolean, from: number): number {
  let end = text.indexOf(mark, from)
  while (end >= 0 && ((end > 0 && isBlankAt(text, end - 1)) || escaped(text, end) || joined(text, mark, bare, end))) {
    end = text.indexOf(mark, end + mark.length)
  }
  return end
}

function validDjotPair(text: string, mark: string, start: number, end: number): boolean {
  return text[start - 1] !== '{' && text[end + mark.length] !== '}'
    && text[start - 1] !== mark && text[start + 1] !== mark
}

function hasStar(text: string, from: number, to: number): boolean {
  const at = text.indexOf('*', from)
  return at >= 0 && at < to
}

function validPair(text: string, mark: string, id: string, start: number, end: number): boolean {
  const first = start + mark.length
  if (escaped(text, start) || first >= end || isEdgeSpaceAt(text, first) || isEdgeSpaceAt(text, end - 1)) return false
  if (text[first] === mark[0] || text[end - 1] === mark[0]) return false
  if (mark === '**' && hasStar(text, first, end)) return false
  if (id === 'djot-subscript-tilde' || id === 'djot-superscript-caret') return validDjotPair(text, mark, start, end)
  if (id === 'markdown-strong-double-star' || id === 'markdown-strikethrough-double-tilde') return true
  return !isWord(text[start - 1]) && !isWord(text[end + mark.length])
}

/** The pairs of `mark` in `text` that the lint rule `id` reports, as start and end offsets. */
export function pairedMarks(text: string, mark: string, id: string, visit: (start: number, end: number) => void): void {
  for (let at = nextPair(text, mark, id, 0); at >= 0; at = nextPair(text, mark, id, pairEnd)) visit(at, pairEnd)
}

/** The end of the pair `nextPair` found last, behind its closer. */
export let pairEnd = 0

/** The start of the first pair of `mark` at or after `from` that the lint rule `id` reports, or -1; its end is `pairEnd`. */
export function nextPair(text: string, mark: string, id: string, from: number): number {
  const bare = id.startsWith('deprecated-bare-')
  let at = from
  while (at < text.length) {
    const start = text.indexOf(mark, at)
    if (start < 0) return -1
    if (!canOpen(text, mark, bare, start)) {
      at = start + mark.length
      continue
    }
    const end = nextCloser(text, mark, bare, start + mark.length + 1)
    if (end < 0) return -1
    at = end + mark.length
    if (validPair(text, mark, id, start, end)) {
      pairEnd = at
      return start
    }
  }
  return -1
}
