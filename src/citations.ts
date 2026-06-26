import type { BlockNode, Citation, CitationGroup, Div, InlineNode, Text } from './ast.js'
import type {
  BlockExtensionRenderContext,
  CarveExtension,
  ExtensionRenderContext,
  InlineMatch,
  MatcherContext,
} from './extension.js'

/** Citation key characters (Pandoc-compatible). */
const KEY = String.raw`[\w][\w:.#$%&+?<>~/-]*`
// One `;`-item: optional prefix, optional single `+`/`-` marker, `@key`,
// optional `, locator`. The marker is exactly one sign directly before `@`.
const ITEM_RE = new RegExp(String.raw`^(.*?)([+-]?)@(${KEY})(?:,\s*(.*))?$`)

/** Fixed citeproc locator vocabulary: canonical -> matchers. Flattened and
 *  sorted longest-first so global longest-match wins. ASCII case-insensitive. */
const LOCATOR_VOCAB: Array<[string, string[]]> = [
  ['book', ['book', 'bk.']],
  ['chapter', ['chapter', 'chaps.', 'chap.']],
  ['column', ['column', 'cols.', 'col.']],
  ['figure', ['figure', 'figs.', 'fig.']],
  ['folio', ['folio', 'fols.', 'fol.']],
  ['issue', ['issue', 'no.']],
  ['line', ['line', 'll.', 'l.']],
  ['note', ['note', 'nn.', 'n.']],
  ['opus', ['opus', 'opp.', 'op.']],
  ['page', ['pages', 'page', 'pp.', 'p.']],
  ['paragraph', ['paragraph', 'paras.', 'para.', '¶¶', '¶']],
  ['part', ['part', 'pts.', 'pt.']],
  ['section', ['section', 'secs.', 'sec.', '§§', '§']],
  ['sub verbo', ['sub verbo', 's.vv.', 's.v.']],
  ['verse', ['verse', 'vv.', 'v.']],
  ['volume', ['volume', 'vols.', 'vol.']],
]
const FLAT_TERMS: Array<[string, string]> = LOCATOR_VOCAB.flatMap(([canon, ms]) =>
  ms.map((m) => [m, canon] as [string, string]),
).sort((a, b) => b[0].length - a[0].length)

const VALUE_CHAR = /[0-9IVXLCDMivxlcdm.,&\- ]/

/** True when `ch` ends a label term (boundary). Roman letters are NOT a
 *  boundary; a roman value is only reachable through whitespace/`.`. */
function isLabelBoundary(ch: string | undefined): boolean {
  if (ch === undefined || ch === ' ' || ch === '\t') return true
  if (ch >= '0' && ch <= '9') return true
  return ch === '§' || ch === '¶'
}

export interface ParsedLocator {
  label?: string
  value?: string
  suffixText?: string
}

/** Parse a raw locator substring into label / value / suffix. Pure; never
 *  throws. See the design spec "Locator parsing" section. */
export function parseLocator(loc: string): ParsedLocator {
  const s = loc.replace(/^\s+/, '')
  const lower = s.toLowerCase()
  let label: string | undefined
  let rest = s
  for (const [m, canon] of FLAT_TERMS) {
    if (lower.startsWith(m.toLowerCase()) && isLabelBoundary(s[m.length])) {
      label = canon
      rest = s.slice(m.length).replace(/^[ \t]+/, '')
      break
    }
  }
  if (label === undefined) {
    const c = rest[0]
    if (c !== undefined && c >= '0' && c <= '9') label = 'page'
  }
  if (label === undefined) return s === '' ? {} : { suffixText: s }
  let i = 0
  while (i < rest.length && VALUE_CHAR.test(rest[i]!)) i++
  const value = rest.slice(0, i).replace(/[ ,&\-.]+$/, '')
  const suffixText = rest.slice(i).replace(/^[ \t]+/, '')
  const out: ParsedLocator = { label }
  if (value !== '') out.value = value
  if (suffixText !== '') out.suffixText = suffixText
  return out
}

/** Private marker key on the carrier div that the block renderer turns into
 *  the references list. */
const REFS_MARK = 'data-cite-refs'

/** A CSL-JSON name object (the subset the minimal formatter reads). */
export interface CslName {
  family?: string
  given?: string
  literal?: string
}

/** A CSL-JSON bibliography entry (the subset the minimal formatter reads;
 *  unknown fields are ignored). */
export interface CslEntry {
  id: string
  author?: CslName[]
  issued?: { 'date-parts'?: number[][]; literal?: string }
  title?: string
  [k: string]: unknown
}

export interface CitationsOptions {
  /** `numbered` (default) emits `[1]`; `author-date` emits `(Author Year)`. */
  mode?: 'numbered' | 'author-date'
  /**
   * Tier-3 Bibliography (#199): an external CSL-JSON pool. Keys resolve against
   * in-document `[@key]:` defs first, then this pool. When supplied (even
   * empty), in-text citations and the references list gain footnote-style
   * back-links. The host resolves the front-matter `bibliography:` path and
   * passes the parsed array here; the extension itself does no file I/O.
   */
  bibliography?: CslEntry[]
}

interface Def {
  entry: InlineNode[]
  author?: string
  year?: string
  /** Pre-formatted entry text for a CSL-JSON-sourced def (HTML-escaped at
   *  render time); when set, used instead of the parsed inline `entry`. */
  cslText?: string
}

// Single-entry cache: the matcher is invoked repeatedly for the SAME inline
// text (once per `[` in it), so caching only the most-recent text gives the
// O(1)-per-opener win without a global Map retaining large source strings of
// past parses in a long-lived process.
let lastBracketMapText: string | null = null
let lastBracketMap: Record<number, number> = {}

/**
 * Citations (#90, Tier-2). Bracketed `[@key]` references with an in-document
 * `[@key]: entry` bibliography and a generated references list. Bare `@key`
 * stays a core mention; only tail-less brackets containing a `@key` are
 * claimed. See docs/superpowers/specs/2026-06-11-citations-design.md.
 */
export function citations(opts: CitationsOptions = {}): CarveExtension {
  const mode = opts.mode ?? 'numbered'
  // A supplied pool (even empty) activates the Tier-3 Bibliography behavior:
  // external resolution + back-links (#199).
  const hasBib = opts.bibliography !== undefined
  const pool = opts.bibliography ?? []
  const defs = new Map<string, Def>()
  const numbers = new Map<string, number>()
  const order: string[] = [] // cited+defined keys in first-citation order
  const uses = new Map<string, number>() // per-key use-site count (back-links)

  return {
    name: 'citations',
    matchInline: matchCitation,

    afterParse(doc) {
      // Reset per-document state so a reused extension instance does not leak
      // definitions/numbers across carveToHtml calls.
      defs.clear()
      numbers.clear()
      order.length = 0
      uses.clear()
      doc.children = collectDefs(doc.children, defs)
      // Seed the CSL-JSON pool: in-document defs win on collision (§6.2).
      for (const e of pool) {
        if (e && typeof e.id === 'string' && !defs.has(e.id)) defs.set(e.id, cslToDef(e))
      }
      return doc
    },

    beforeRender(doc) {
      // Number cited+defined keys in document order; collect them. When a
      // bibliography pool is active, also assign per-key use-site indexes for
      // back-links - but only for groups that fully resolve (a group with any
      // undefined key renders verbatim and is not a use site, §6.4).
      for (const block of doc.children)
        walkCitationGroups(block, (g) => {
          // A group with any unresolved key renders verbatim (§6.4): its keys are
          // literal text, not citations, so they are neither numbered, listed,
          // nor a back-link use site. Skip the whole group.
          if (!g.items.every((it) => defs.has(it.key))) return
          for (const item of g.items) {
            if (!numbers.has(item.key)) {
              numbers.set(item.key, numbers.size + 1)
              order.push(item.key)
            }
            item.number = numbers.get(item.key)!
            if (hasBib) {
              const n = (uses.get(item.key) ?? 0) + 1
              uses.set(item.key, n)
              item.useIndex = n
            }
          }
        })
      if (order.length === 0) return doc
      // Place the references list via a marked carrier div the block renderer
      // turns into the list: inside an explicit `::: references` container
      // (div or admonition) if present, else appended at document end.
      const carrier: Div = {
        type: 'div',
        attrs: { keyValues: { [REFS_MARK]: '' } },
        children: [],
      } as Div
      const explicit = doc.children.find(
        (b) =>
          (b.type === 'div' && hasClass(b, 'references')) ||
          (b.type === 'admonition' && (b as { kind?: string }).kind === 'references'),
      ) as { children: BlockNode[] } | undefined
      if (explicit) explicit.children.push(carrier)
      else doc.children.push(carrier)
      return doc
    },

    inlineRenderers: {
      'citation-group': (node, ctx) =>
        renderGroup(node as CitationGroup, ctx, mode, numbers, defs, hasBib),
    },

    blockRenderers: {
      div: (node, ctx) => {
        const kv = (node as Div).attrs?.keyValues
        if (kv && REFS_MARK in kv) return renderRefsList(ctx, mode, order, defs, uses, hasBib)
        return undefined
      },
    },
  }
}

// ----- parse: matcher -------------------------------------------------------

function buildBracketMap(text: string): Record<number, number> {
  const stack: number[] = []
  const map: Record<number, number> = {}
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '[') stack.push(i)
    else if (c === ']') {
      const open = stack.pop()
      if (open !== undefined) map[open] = i
    }
  }
  return map
}

function bracketMapFor(text: string): Record<number, number> {
  if (text !== lastBracketMapText) {
    lastBracketMap = buildBracketMap(text)
    lastBracketMapText = text
  }
  return lastBracketMap
}

function parseItem(raw: string, ctx: MatcherContext): Citation | null {
  const m = ITEM_RE.exec(raw.trim())
  if (!m) return null
  const prefixText = m[1]!.replace(/\s+$/, '')
  const marker = m[2]
  const item: Citation = { key: m[3]!, suppressAuthor: marker === '-' }
  if (marker === '+') item.mode = 'narrative'
  if (prefixText !== '') item.prefix = ctx.parseInlines(prefixText)
  const locRaw = m[4]
  if (locRaw !== undefined && locRaw.trim() !== '') {
    item.locator = ctx.parseInlines(locRaw.trim())     // raw, printed as-is
    const p = parseLocator(locRaw)                      // parse the RAW substring
    if (p.label !== undefined) item.locatorLabel = p.label
    if (p.value !== undefined) item.locatorValue = p.value
    if (p.suffixText !== undefined) item.suffix = ctx.parseInlines(p.suffixText)
  }
  return item
}

const matchCitation = (text: string, pos: number, ctx: MatcherContext): InlineMatch | null => {
  if (text[pos] !== '[') return null
  const close = bracketMapFor(text)[pos]
  if (close === undefined) return null
  const after = text[close + 1]
  if (after === '(' || after === '[' || after === '{') return null
  const inner = text.slice(pos + 1, close)
  if (!inner.includes('@')) return null
  const items: Citation[] = []
  for (const part of inner.split(';')) {
    const item = parseItem(part, ctx)
    if (!item) return null
    items.push(item)
  }
  if (items.length === 0) return null
  const node: CitationGroup = { type: 'citation-group', items, raw: text.slice(pos, close + 1) }
  return { node: node as InlineNode, end: close + 1 }
}

// ----- afterParse: collect [@key]: definitions ------------------------------

const ATTR_RE = /^\{([^}]*)\}\s*/
// The `{author= year=}` block sits in the entry prose, so the core typographic
// pass may have turned its straight quotes into curly ones (#196). Accept both.
const KV_RE = (k: string) => new RegExp(`${k}\\s*=\\s*["“”]([^"“”]*)["“”]`)

/** Return a new block list with definition lines removed, populating `defs`.
 *  Consecutive `[@key]: entry` lines parse as one paragraph (soft-break
 *  separated), so split each paragraph into lines and collect per line. */
function collectDefs(blocks: BlockNode[], defs: Map<string, Def>): BlockNode[] {
  const out: BlockNode[] = []
  for (const b of blocks) {
    if (b.type !== 'paragraph') {
      out.push(b)
      continue
    }
    const lines = splitOnSoftBreaks(b.children)
    const kept: InlineNode[][] = []
    for (const line of lines) {
      const def = asDefinition(line)
      if (def) defs.set(def.key, def.value)
      else kept.push(line)
    }
    if (kept.length === 0) continue // whole paragraph was definitions
    if (kept.length === lines.length) {
      out.push(b) // nothing removed
      continue
    }
    b.children = joinWithSoftBreaks(kept)
    out.push(b)
  }
  return out
}

/** Split an inline run into segments at each soft-break (the breaks dropped). */
function splitOnSoftBreaks(nodes: InlineNode[]): InlineNode[][] {
  const lines: InlineNode[][] = [[]]
  for (const n of nodes) {
    if (n.type === 'soft-break') lines.push([])
    else lines[lines.length - 1]!.push(n)
  }
  return lines
}

/** Inverse of splitOnSoftBreaks. */
function joinWithSoftBreaks(lines: InlineNode[][]): InlineNode[] {
  const out: InlineNode[] = []
  lines.forEach((line, i) => {
    if (i > 0) out.push({ type: 'soft-break' } as InlineNode)
    // Non-spread push: a single soft-break-delimited segment can be unbounded.
    for (const n of line) out.push(n)
  })
  return out
}

function asDefinition(kids: InlineNode[]): { key: string; value: Def } | null {
  const g = kids[0]
  if (!g || g.type !== 'citation-group') return null
  const cg = g as CitationGroup
  if (cg.items.length !== 1) return null
  const it = cg.items[0]!
  if (it.prefix || it.locator || it.suppressAuthor) return null
  const second = kids[1]
  if (!second || second.type !== 'text' || !(second as Text).value.startsWith(':')) return null

  // Entry = inline content after the leading `: `, with the second text node's
  // leading colon stripped.
  const rest: InlineNode[] = [...kids.slice(1)]
  rest[0] = { type: 'text', value: (second as Text).value.replace(/^:\s*/, '') } as Text

  const value: Def = { entry: rest }
  // `{author= year=}` after the `:` attaches to the citation-group node (the
  // preceding non-text node), so read it from there first.
  const cgAttrs = (cg as { attrs?: { keyValues?: Record<string, string> } }).attrs?.keyValues
  if (cgAttrs?.author !== undefined) value.author = cgAttrs.author
  if (cgAttrs?.year !== undefined) value.year = cgAttrs.year
  // Fallback: a leading `{…}` left in the entry text (when it did not attach).
  const head = rest[0] as Text
  if (value.author === undefined && head?.type === 'text') {
    const am = ATTR_RE.exec(head.value)
    if (am) {
      const inside = am[1]!
      const author = KV_RE('author').exec(inside)?.[1]
      const year = KV_RE('year').exec(inside)?.[1]
      if (author !== undefined) value.author = author
      if (year !== undefined) value.year = year
      head.value = head.value.slice(am[0].length)
      if (head.value === '') rest.shift()
    }
  }
  // Strip a leading space left behind by a consumed attr block.
  if (head?.type === 'text') head.value = head.value.replace(/^\s+/, '')
  return { key: it.key, value }
}

// ----- render ---------------------------------------------------------------

/** Build a `Def` from a CSL-JSON entry using the minimal fixed template
 *  (§6.3): `Family, Given (Year). Title.`, missing fields + separators omitted,
 *  trailing period when non-empty. The text is plain (HTML-escaped at render). */
function cslToDef(e: CslEntry): Def {
  // Real-world CSL-JSON often has a non-array `author` (string/number/object);
  // a non-array here must not abort the whole document render (§6.3 robustness).
  const list = Array.isArray(e.author) ? e.author : []
  const names = list.map(formatName).filter((n) => n !== '')
  const authors = names.join('; ')
  const year = cslYear(e.issued)
  let head = authors
  if (year) head = head ? `${head} (${year})` : `(${year})`
  const segs: string[] = []
  if (head) segs.push(head)
  if (typeof e.title === 'string' && e.title !== '') segs.push(e.title)
  let cslText = segs.join('. ')
  if (cslText) cslText += '.'
  const def: Def = { entry: [], cslText }
  // author/year also feed author-date mode; use the first author's family.
  const first = list[0]
  const author =
    first && typeof first === 'object' ? (first.literal ?? first.family) : undefined
  if (author !== undefined) def.author = author
  if (year) def.year = year
  return def
}

function formatName(n: CslName): string {
  // Array elements may be null / non-objects in untrusted CSL-JSON; skip them
  // rather than dereferencing `.literal`/`.family` (would throw).
  if (!n || typeof n !== 'object') return ''
  if (n.literal) return n.literal
  if (n.family && n.given) return `${n.family}, ${n.given}`
  return n.family ?? ''
}

function cslYear(issued: CslEntry['issued']): string {
  const y = issued?.['date-parts']?.[0]?.[0]
  if (typeof y === 'number') return String(y)
  return issued?.literal ?? ''
}

function renderGroup(
  node: CitationGroup,
  ctx: ExtensionRenderContext,
  mode: 'numbered' | 'author-date',
  numbers: Map<string, number>,
  defs: Map<string, Def>,
  hasBib: boolean,
): string {
  // Any item whose key has no definition ⇒ render the source verbatim.
  if (node.items.some((it) => !defs.has(it.key))) return ctx.escapeHtml(node.raw)

  const pre = (it: Citation) => (it.prefix ? `${ctx.renderInlines(it.prefix)} ` : '')
  const loc = (it: Citation) => (it.locator ? `, ${ctx.renderInlines(it.locator)}` : '')
  // Back-link anchor on the per-key item (only with a bibliography pool, §6.3).
  const idAttr = (it: Citation) =>
    hasBib && it.useIndex ? `id="cite-${ctx.escapeAttr(it.key)}-${it.useIndex}" ` : ''

  if (mode === 'author-date') {
    const parts = node.items.map((it) => {
      const d = defs.get(it.key)!
      const label = it.suppressAuthor
        ? d.year ?? String(it.number ?? '')
        : `${d.author ?? ''} ${d.year ?? ''}`.trim() || String(it.number ?? '')
      return `${pre(it)}<a ${idAttr(it)}href="#ref-${ctx.escapeAttr(it.key)}">${ctx.escapeHtml(label)}</a>${loc(it)}`
    })
    return `(${parts.join('; ')})`
  }
  const parts = node.items.map((it) => {
    const n = numbers.get(it.key)
    return `${pre(it)}<a ${idAttr(it)}href="#ref-${ctx.escapeAttr(it.key)}">${n}</a>${loc(it)}`
  })
  return `[${parts.join(', ')}]`
}

function renderRefsList(
  ctx: BlockExtensionRenderContext,
  mode: 'numbered' | 'author-date',
  order: string[],
  defs: Map<string, Def>,
  uses: Map<string, number>,
  hasBib: boolean,
): string {
  const pad = ctx.indent(ctx.level)
  const keys = [...order]
  if (mode === 'author-date') {
    keys.sort((a, b) => (defs.get(a)?.author ?? a).localeCompare(defs.get(b)?.author ?? b))
  }
  // Both modes use a list element so the markup is valid; numbered is ordered.
  const tag = mode === 'author-date' ? 'ul' : 'ol'
  const items = keys
    .map((k) => {
      const d = defs.get(k)!
      // A CSL-sourced entry is plain text (escaped); an in-doc def is inline AST.
      const body = d.cslText !== undefined ? ctx.escapeHtml(d.cslText) : ctx.renderInlines(d.entry)
      let backlinks = ''
      if (hasBib) {
        const n = uses.get(k) ?? 0
        const links: string[] = []
        for (let m = 1; m <= n; m++)
          links.push(`<a href="#cite-${ctx.escapeAttr(k)}-${m}" class="ref-backref">↩</a>`)
        if (links.length) backlinks = (body ? ' ' : '') + links.join(' ')
      }
      return `${pad}  <li id="ref-${ctx.escapeAttr(k)}">${body}${backlinks}</li>`
    })
    .join('\n')
  return `${pad}<${tag} class="references">\n${items}\n${pad}</${tag}>`
}

// ----- helpers --------------------------------------------------------------

function hasClass(b: BlockNode, cls: string): boolean {
  const attrs = (b as { attrs?: { classes?: string[] } }).attrs
  return !!attrs?.classes?.includes(cls)
}

/** Depth-first visit of every citation-group under a node, in document order.
 *  Generic walk: arrays preserve order, and a citation-group has no nested
 *  citation-groups, so this yields correct first-citation order. */
function walkCitationGroups(node: unknown, fn: (g: CitationGroup) => void): void {
  if (!node || typeof node !== 'object') return
  if ((node as { type?: string }).type === 'citation-group') {
    fn(node as CitationGroup)
    return
  }
  for (const key of Object.keys(node as Record<string, unknown>)) {
    if (key === 'pos') continue
    const v = (node as Record<string, unknown>)[key]
    if (Array.isArray(v)) for (const el of v) walkCitationGroups(el, fn)
    else if (v && typeof v === 'object') walkCitationGroups(v, fn)
  }
}
