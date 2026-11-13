// The comparison of the contract, section 1: two HTML documents are equal when they are equal
// after the attributes of each element are sorted and the whitespace between tags is dropped.
// Text is compared as it is, and so is everything inside `<pre>`.

const TEXT = 0
const OPEN = 1
const CLOSE = 2

interface Token {
  kind: number
  /** The element name of a tag, empty for text. */
  name: string
  /** The normalized tag, or the text. */
  text: string
  /** The source line the 0.2 engine wrote on this element or on the nearest one before it. */
  line: number
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const SOURCE_LINE = 'data-source-line'
const LT = 0x3c
const GT = 0x3e
const QUOTE = 0x22
const SLASH = 0x2f
const LF = 0x0a

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === LF || code === 0x0d
}

function isWhitespace(text: string): boolean {
  for (let at = 0; at < text.length; at++) {
    if (!isSpace(text.charCodeAt(at))) return false
  }
  return true
}

/** End of the tag that starts at `at`: the first `>` outside a quoted value. */
function tagEnd(html: string, at: number): number {
  let quoted = false
  for (let pos = at + 1; pos < html.length; pos++) {
    const code = html.charCodeAt(pos)
    if (code === QUOTE) quoted = !quoted
    else if (code === GT && !quoted) return pos
  }
  return html.length - 1
}

/** The attributes of the tag body `body`, each as written. */
function splitAttributes(body: string, from: number): string[] {
  const parts: string[] = []
  let start = -1
  let quoted = false
  for (let at = from; at <= body.length; at++) {
    const code = at < body.length ? body.charCodeAt(at) : 0x20
    if (code === QUOTE) quoted = !quoted
    if (quoted || !isSpace(code)) {
      if (start < 0) start = at
    } else if (start >= 0) {
      parts.push(body.slice(start, at))
      start = -1
    }
  }
  return parts
}

function nameEnd(body: string): number {
  let at = 0
  while (at < body.length && !isSpace(body.charCodeAt(at))) at++
  return at
}

/** Reads the source line off `parts`, removes it, and returns it, or 0. */
function takeSourceLine(parts: string[]): number {
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!
    if (!part.startsWith(SOURCE_LINE + '="')) continue
    parts.splice(index, 1)
    return Number.parseInt(part.slice(SOURCE_LINE.length + 2), 10)
  }
  return 0
}

function readTag(html: string, start: number, end: number, line: number): Token {
  if (html.charCodeAt(start + 1) === SLASH) {
    const name = html.slice(start + 2, end).trim()
    return { kind: CLOSE, name, text: `</${name}>`, line }
  }
  const body = html.slice(start + 1, end)
  const split = nameEnd(body)
  const name = body.slice(0, split)
  const parts = splitAttributes(body, split)
  const own = takeSourceLine(parts)
  parts.sort()
  const text = parts.length === 0 ? `<${name}>` : `<${name} ${parts.join(' ')}>`
  return { kind: OPEN, name, text, line: own > 0 ? own : line }
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = []
  let line = 0
  let at = 0
  while (at < html.length) {
    if (html.charCodeAt(at) === LT) {
      const end = tagEnd(html, at)
      const tag = readTag(html, at, end, line)
      line = tag.line
      tokens.push(tag)
      at = end + 1
      continue
    }
    let end = html.indexOf('<', at)
    if (end < 0) end = html.length
    tokens.push({ kind: TEXT, name: '', text: html.slice(at, end), line })
    at = end
  }
  return tokens
}

interface Frame {
  name: string
  children: number
  /** Index of the open tag, and for a list the number of its items. */
  open: number
  items: number
}

/** The open tags of the items that are the only item of their list. */
function onlyItems(tokens: Token[]): Set<number> {
  const only = new Set<number>()
  const stack: Frame[] = []
  const firstItem = new Map<number, number>()
  tokens.forEach((token, index) => {
    if (token.kind === TEXT || VOID.has(token.name)) return
    if (token.kind === CLOSE) {
      const frame = stack.pop()
      if (frame !== undefined && frame.items === 1) only.add(firstItem.get(frame.open)!)
      return
    }
    const top = stack[stack.length - 1]
    if (token.name === 'li' && top !== undefined) {
      top.items++
      if (top.items === 1) firstItem.set(top.open, index)
    }
    stack.push({ name: token.name, children: 0, open: index, items: 0 })
  })
  return only
}

interface Reduced {
  tokens: Token[]
  /** Later paragraphs of list items that were written with a paragraph element. */
  laterParagraphs: number
}

/**
 * Drops the paragraph element around a later paragraph of a list item, which 0.1 writes bare in
 * a tight list and 0.2 always writes (ruling on U-019), and counts the elements dropped. With
 * `only`, every paragraph element directly in the only item of a list is dropped too: 0.1 could
 * make such a list loose and 0.2 cannot (U-021).
 */
function dropParagraphs(tokens: Token[], only: Set<number>): Reduced {
  const out: Token[] = []
  const stack: Frame[] = []
  const dropped: boolean[] = []
  let count = 0
  tokens.forEach((token, index) => {
    const top = stack[stack.length - 1]
    if (token.kind === TEXT) {
      if (top !== undefined && !isWhitespace(token.text)) top.children++
      out.push(token)
      return
    }
    if (token.kind === CLOSE) {
      stack.pop()
      if (dropped.pop() !== true) out.push(token)
      return
    }
    const inItem = token.text === '<p>' && top !== undefined && top.name === 'li'
    const later = inItem && top.children > 0
    const drop = later || (inItem && only.has(top.open))
    if (top !== undefined) top.children++
    if (later) count++
    if (!drop) out.push(token)
    if (VOID.has(token.name)) return
    stack.push({ name: token.name, children: 0, open: index, items: 0 })
    dropped.push(drop)
  })
  return { tokens: out, laterParagraphs: count }
}

/** Trims the whitespace a pretty printer put at the edges of `text` and after its line breaks. */
function layoutText(text: string): string {
  let start = 0
  let end = text.length
  while (start < end && isSpace(text.charCodeAt(start))) start++
  while (end > start && isSpace(text.charCodeAt(end - 1))) end--
  // Edge whitespace on one line is content: `a <em>b</em>` keeps its space.
  if (!text.slice(0, start).includes('\n')) start = 0
  if (!text.slice(end).includes('\n')) end = text.length
  let out = ''
  let at = start
  while (at < end) {
    const code = text.charCodeAt(at)
    out += text[at]!
    at++
    if (code !== LF) continue
    while (at < end && (text.charCodeAt(at) === 0x20 || text.charCodeAt(at) === 0x09)) at++
  }
  return out
}

/** Merges neighboring text, drops whitespace between tags and lays text out, outside `<pre>`. */
function settle(tokens: Token[]): Token[] {
  const out: Token[] = []
  let pre = 0
  let text = ''
  let line = 0
  const flush = (): void => {
    const laid = pre > 0 ? text : layoutText(text)
    if (laid !== '') out.push({ kind: TEXT, name: '', text: laid, line })
    text = ''
  }
  for (const token of tokens) {
    if (token.kind === TEXT) {
      text += token.text
      line = token.line
      continue
    }
    flush()
    if (token.name === 'pre') pre += token.kind === OPEN ? 1 : -1
    out.push(token)
  }
  flush()
  return out
}

export interface Difference {
  /** Line of the 0.2 source near the first difference, 0 when none is known. */
  line: number
  expected: string
  actual: string
}

export interface Comparison {
  equal: boolean
  difference: Difference | null
  /** Paragraph elements 0.2 writes around later paragraphs of list items that 0.1 wrote bare. */
  gainedParagraphs: number
}

const CONTEXT = 3

function excerpt(tokens: Token[], at: number): string {
  let out = ''
  for (let index = Math.max(0, at - 1); index < Math.min(tokens.length, at + CONTEXT); index++) out += tokens[index]!.text
  return out
}

/**
 * Compares the HTML of 0.1 for the input with the HTML of 0.2 for the output. With
 * `singleItems` a list of one item compares equal whether its paragraphs are bare or not.
 */
export function compareHtml(html01: string, html02: string, singleItems = false): Comparison {
  const oldTokens = tokenize(html01)
  const nextTokens = tokenize(html02)
  const none = new Set<number>()
  const old = dropParagraphs(oldTokens, singleItems ? onlyItems(oldTokens) : none)
  const next = dropParagraphs(nextTokens, singleItems ? onlyItems(nextTokens) : none)
  const a = settle(old.tokens)
  const b = settle(next.tokens)
  const gainedParagraphs = Math.max(0, next.laterParagraphs - old.laterParagraphs)
  const length = Math.min(a.length, b.length)
  let at = 0
  while (at < length && a[at]!.text === b[at]!.text) at++
  if (at === a.length && at === b.length) return { equal: true, difference: null, gainedParagraphs }
  const line = at < b.length ? b[at]!.line : b.length > 0 ? b[b.length - 1]!.line : 0
  return { equal: false, difference: { line, expected: excerpt(a, at), actual: excerpt(b, at) }, gainedParagraphs }
}
