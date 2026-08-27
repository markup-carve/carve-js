/*
 * Is this document portable to Djot - does it MEAN the same thing there?
 */

/**
 * The slice of djot.js this check needs. Structural, so a caller can pass the
 * real `@djot/djot`, a pinned older copy, or a stub - and so this module does
 * not import it.
 */
export interface DjotEngine {
  parse(input: string): unknown
  renderHTML(doc: unknown): string
}

/** How a Carve document and its Djot reading come apart. */
export interface Divergence {
  /**
   * 1-based source line the Carve side attributes the difference to, when it
   * can place it. Absent rather than guessed: the line comes from Carve's own
   * `data-source-line` output, so it is the parser's opinion, and a difference
   * inside a region Carve did not place carries no line at all.
   */
  line?: number
  /** The normalized Carve rendering from the first differing point onward. */
  carve: string
  /** The normalized Djot rendering from the same point. */
  djot: string
}

export interface PortabilityReport {
  /** True when both engines render the document to the same normalized HTML. */
  portable: boolean
  /**
   * The FIRST place the renderings differ, absent when they do not.
   *
   * Only the first: once the two engines disagree about a block boundary,
   * everything after it is displaced and every later difference is a
   * consequence of this one, not an independent finding. Reporting the tail
   * would restate one divergence as many.
   */
  divergence?: Divergence
}

/*
 * Elements whose edges do not carry meaning.
 *
 * A space after `<li>` or before `</p>` is a pretty-printing artifact - the two
 * engines indent differently, so Carve's `<li>one</li>` and Djot's
 * `<li> one </li>` are the same document. Inside a paragraph the same space is
 * content (`a<em>b</em>` and `a <em>b</em>` differ), so this trims only where a
 * BLOCK begins or ends, never between inline siblings.
 */
const BLOCK_ELEMENTS =
  'html|body|section|div|p|blockquote|ul|ol|li|dl|dt|dd|table|thead|tbody|tfoot|tr|td|th|figure|figcaption|h[1-6]|pre|hr|details|summary|nav|aside|article|header|footer|main'

const BLOCK_OPEN = new RegExp(`^</?(?:${BLOCK_ELEMENTS})(?:\\s|/?>)`, 'i')

/**
 * Attributes excluded from the comparison.
 *
 * `data-source-line` is injected by this check itself to locate the difference
 * (see `renderCarveWithLines`), so comparing it would report every document as
 * divergent. It is dropped from BOTH sides, so a document that authors the
 * attribute by hand is treated consistently rather than having its own markup
 * compared against our injection.
 */
const IGNORED_ATTRIBUTES = new Set(['data-source-line'])

/**
 * Elements with no closing tag, so nothing to pop when the walk passes them.
 * Tracked by name rather than by a trailing `/`, because neither engine writes
 * one consistently and the normalizer removes it anyway.
 */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

interface Token {
  /** Raw text of the token. */
  raw: string
  kind: 'tag' | 'text' | 'comment'
  /** For a tag: the lowercased element name. */
  name?: string
  /** For a tag: whether it closes an element. */
  closing?: boolean
  /** For a tag: the value of `data-source-line`, when it carries one. */
  line?: number
}

/** Split HTML into tags, comments and text. Both inputs are engine output. */
function tokenize(html: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) {
      tokens.push({ raw: html.slice(i), kind: 'text' })
      break
    }
    if (lt > i) tokens.push({ raw: html.slice(i, lt), kind: 'text' })
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      const stop = end === -1 ? html.length : end + 3
      tokens.push({ raw: html.slice(lt, stop), kind: 'comment' })
      i = stop
      continue
    }
    // Scan to the closing `>`, skipping any inside a quoted attribute value.
    let j = lt + 1
    let quote: string | undefined
    while (j < html.length) {
      const ch = html[j]!
      if (quote) {
        if (ch === quote) quote = undefined
      } else if (ch === '"' || ch === "'") quote = ch
      else if (ch === '>') break
      j++
    }
    const raw = html.slice(lt, Math.min(j + 1, html.length))
    const m = /^<\/?([a-zA-Z][-\w]*)/.exec(raw)
    const lineMatch = /\sdata-source-line="(\d+)"/.exec(raw)
    const name = m?.[1]?.toLowerCase()
    tokens.push({
      raw,
      kind: 'tag',
      ...(name !== undefined ? { name } : {}),
      closing: raw.startsWith('</'),
      ...(lineMatch ? { line: Number(lineMatch[1]) } : {}),
    })
    i = j + 1
  }
  return tokens
}

/**
 * Rewrite one start tag into a comparable form.
 *
 * Two normalizations, both about how a renderer writes a tag rather than what
 * the tag says: attributes are sorted, because `<img src alt>` and
 * `<img alt src>` are the same element and the two engines emit them in
 * different orders; and `disabled=""` collapses to `disabled`, because the two
 * spellings of a boolean attribute are the same attribute.
 */
function normalizeTag(raw: string): string {
  if (raw.startsWith('</') || raw.startsWith('<!')) return raw.replace(/\s*\/?>$/, '>')
  const m = /^<([a-zA-Z][-\w]*)([\s\S]*?)\s*\/?>$/.exec(raw)
  if (!m) return raw
  const name = m[1]!.toLowerCase()
  const attrText = m[2] ?? ''
  const attrs = attrText.match(/[^\s=]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/g) ?? []
  const kept = attrs
    .map((a) => a.replace(/=(?:""|'')$/, ''))
    .filter((a) => !IGNORED_ATTRIBUTES.has((a.split('=')[0] ?? '').toLowerCase()))
    .sort()
  return kept.length ? `<${name} ${kept.join(' ')}>` : `<${name}>`
}

/**
 * The comparable form of a rendering, plus where each output offset came from.
 *
 * `lines[k]` is the source line in effect at `html[k]`, taken from the
 * innermost enclosing element that carried a `data-source-line`. The Djot side
 * carries none, so its map is empty and only the Carve side can place a
 * difference - which is the right way round: the report is advice about a Carve
 * document, and a Carve line is what the author can act on.
 */
export interface NormalizedHtml {
  html: string
  lines: Array<number | undefined>
}

export function normalizeHtml(input: string): NormalizedHtml {
  const tokens = tokenize(input)
  let out = ''
  const lines: Array<number | undefined> = []
  /** Enclosing `data-source-line` values, innermost last. */
  const lineStack: number[] = []
  /** One entry per open element: did it push onto `lineStack`? */
  const openElements: boolean[] = []
  /** Depth inside `<pre>`, where whitespace is content and is left alone. */
  let preDepth = 0
  const push = (s: string) => {
    const line = lineStack.length ? lineStack[lineStack.length - 1] : undefined
    for (let k = 0; k < s.length; k++) lines.push(line)
    out += s
  }

  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t]!
    if (tok.kind === 'text') {
      if (preDepth > 0) {
        push(tok.raw)
        continue
      }
      let text = tok.raw.replace(/\s+/g, ' ')
      // Trim a space that only separates this text from a block boundary.
      const prev = tokens[t - 1]
      const next = tokens[t + 1]
      if (!prev || (prev.kind === 'tag' && BLOCK_OPEN.test(prev.raw))) text = text.replace(/^ /, '')
      if (!next || (next.kind === 'tag' && BLOCK_OPEN.test(next.raw))) text = text.replace(/ $/, '')
      if (text) push(text)
      continue
    }
    if (tok.kind === 'comment') {
      push(tok.raw)
      continue
    }
    const name = tok.name ?? ''
    if (name === 'pre') preDepth += tok.closing ? -1 : 1
    if (preDepth < 0) preDepth = 0
    if (tok.closing) {
      // The closing tag still belongs to the element, so emit it before the
      // line goes out of scope - and only unwind a line if THIS element is the
      // one that introduced it. Popping on every closer instead would lose the
      // enclosing block's line at the first inline `</em>` inside it.
      push(normalizeTag(tok.raw))
      if (openElements.pop()) lineStack.pop()
      continue
    }
    const introducesLine = tok.line !== undefined
    if (introducesLine) lineStack.push(tok.line!)
    push(normalizeTag(tok.raw))
    // A void element has no closer to unwind it, so its line ends with it.
    if (VOID_ELEMENTS.has(name)) {
      if (introducesLine) lineStack.pop()
    } else {
      openElements.push(introducesLine)
    }
  }
  return { html: out, lines }
}

/** How much of each side to show around the first difference. */
const EXCERPT_LENGTH = 120

/**
 * The line to blame for a difference at `at`.
 *
 * The enclosing element is the honest answer and is tried first. Some output
 * carries no position at all - the `<section>` wrapper around a heading is
 * synthesized, not parsed - and a difference landing there would otherwise be
 * reported with no line even though the very next element has one. So fall
 * forward to the first placed element AFTER the difference, which is the
 * content the difference is about. Still no invention: if nothing downstream
 * was placed either, the report carries no line.
 */
function lineFor(side: NormalizedHtml, at: number, start: number): number | undefined {
  const enclosing = side.lines[at] ?? side.lines[start]
  if (enclosing !== undefined) return enclosing
  for (let k = at; k < side.lines.length; k++) {
    if (side.lines[k] !== undefined) return side.lines[k]
  }
  return undefined
}

/**
 * Compare a Carve document against its Djot reading.
 *
 * `renderCarve` is passed in rather than imported so this module does not pull
 * the renderer into a caller that only wanted the comparison, and so a test can
 * drive both sides with stubs.
 */
export function checkPortability(
  source: string,
  djot: DjotEngine,
  renderCarve: (src: string) => string,
): PortabilityReport {
  const carve = normalizeHtml(renderCarve(source))
  const theirs = normalizeHtml(djot.renderHTML(djot.parse(source)))
  if (carve.html === theirs.html) return { portable: true }

  let i = 0
  while (i < carve.html.length && i < theirs.html.length && carve.html[i] === theirs.html[i]) i++
  // Back up to the start of the element the difference falls inside, so the
  // excerpt begins at a tag rather than mid-word.
  const start = Math.max(0, carve.html.lastIndexOf('<', i))
  const line = lineFor(carve, i, start)
  return {
    portable: false,
    divergence: {
      ...(line !== undefined ? { line } : {}),
      carve: carve.html.slice(start, start + EXCERPT_LENGTH),
      djot: theirs.html.slice(start, start + EXCERPT_LENGTH),
    },
  }
}
