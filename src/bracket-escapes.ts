import type { InlineNode } from './ast.js'
import { buildBracketMap } from './parse.js'

/**
 * PART 11 §5's LONE BRACKETS: a `[` or `]` left unpaired in the content a span,
 * link or inline note writes between its own brackets. They are in the
 * unconditional set, so they are decided from the tree before anything is
 * written, keyed by the node that writes the character and its offset in that
 * node's text.
 */
export type LoneBrackets = WeakMap<object, Set<number>>

/**
 * A PAIRED `]` in bracketed content, keyed like `LoneBrackets`, to the `[` it
 * pairs with. Escaping either one alone re-pairs the construct's own brackets,
 * so the closer is written with the escape decision its opener took.
 */
export type PairedClosers = WeakMap<object, Map<number, Site>>

/**
 * The `[` of a pair whose two brackets sit under DIFFERENT formatting nodes,
 * keyed like `LoneBrackets`.
 *
 * PART 8 resolves the bracket run before the emphasis delimiters, so a run
 * reaching across a formatting boundary isolates the delimiters inside it: the
 * OPENER carries the escape, and its closer then closes no run, so a `(` behind
 * it opens no destination.
 *
 * A pair is read as crossing from BOTH sides: the opener may sit at the run's own
 * level and the closer under a span, or the other way round, and it is the SPAN's
 * delimiter run that the bracket run would split either way. Spans holding both
 * brackets are crossed by nothing and stay out.
 *
 * The span's own spelling does not enter it. A braced span loses its delimiters
 * to a bracket run as surely as a bare one - `[{^a]^}` reads back as literal text
 * in the spec's reader, in carve-rs and in carve-php - so declining there dropped
 * the span instead of protecting it (markup-carve/carve-js#2399).
 */
export type CrossingOpeners = WeakMap<object, Set<number>>

/**
 * The `]` of such a pair, where an OUTER opener survives to answer it.
 *
 * Escaping an opener takes it out of the run, so the `]` that answered it falls
 * through to the next opener out; where that pair crosses the same boundary a
 * second escape is owed and only the closer can pay it, because the outer opener
 * keeps its bare form. One forward pass cannot see this, and leaving it undecided
 * is what made the writer disagree with itself: `carve fmt` computed the second
 * pass and spent one more backslash per bracket level (markup-carve/carve-rs#2209).
 */
export type CrossingClosers = WeakMap<object, Set<number>>

/**
 * Text nodes of a run holding an empty code span. Neither §5 half selects a
 * bracket or `(` in them; the escape search decides them instead.
 */
export type LeftToSearch = WeakSet<object>

const UNWRITABLE_CONTROLS = /[\u0000\u000d]/g

const TRANSPARENT = new Set(['emphasis', 'strong', 'underline', 'strike', 'highlight', 'superscript', 'subscript', 'insert', 'delete'])

export interface Site {
  owner: object
  offset: number
  char: string
}

interface Scope {
  content: readonly InlineNode[]
  bracketed: boolean
}

/**
 * Record the lone brackets of one inline scope and of every bracketed scope
 * nested in it. Iterative, because it runs before the render depth guard.
 *
 * Crossing openers are recorded in EVERY scope, bracketed or not: the boundary
 * the pair reaches across is the formatting node's, not the construct's.
 */
export function collectLoneBrackets(
  nodes: readonly InlineNode[],
  bracketed: boolean,
  into: LoneBrackets,
  leftToSearch: LeftToSearch,
  pairs?: PairedClosers,
  crossing?: CrossingOpeners,
  crossingClosers?: CrossingClosers,
  escaped?: WeakMap<object, Set<number>>,
): void {
  const scopes: Scope[] = [{ content: nodes, bracketed }]
  for (let scope = scopes.pop(); scope !== undefined; scope = scopes.pop()) collectScope(scope, scopes, into, leftToSearch, pairs, crossing, crossingClosers, escaped)
}

/** How deep two bracket sites share the same spans. */
function sharedDepth(left: readonly object[], right: readonly object[]): number {
  let depth = 0
  while (depth < left.length && depth < right.length && left[depth] === right[depth]) depth++
  return depth
}

function collectScope(
  { content, bracketed }: Scope,
  scopes: Scope[],
  into: LoneBrackets,
  leftToSearch: LeftToSearch,
  pairs: PairedClosers | undefined,
  crossing: CrossingOpeners | undefined,
  crossingClosers: CrossingClosers | undefined,
  escaped: WeakMap<object, Set<number>> | undefined,
): void {
  const sites: Array<Site & { chain: readonly object[]; fixed: boolean }> = []
  const owners: object[] = []
  // A run holding an empty code span is left to the escape search whole: the
  // span is written as a bare backtick run, so a pairing read from the tree no
  // longer matches the written bytes, before the span or after it.
  let hasEmptyCode = false

  const addText = (owner: object, value: string, chain: readonly object[], verbatim = false): void => {
    owners.push(owner)
    if (!/[[\]]/.test(value)) return
    const text = verbatim ? value : value.replace(UNWRITABLE_CONTROLS, '')
    const structural = verbatim ? new Set<number>() : undefined
    if (structural !== undefined) {
      buildBracketMap(text, true, structural)
      if (structural.has(-1) || /^[ \t]*%%/m.test(text)) hasEmptyCode = true
    }
    for (let offset = 0; offset < text.length; offset++) {
      const char = text[offset]!
      if (char !== '[' && char !== ']') continue
      if (structural !== undefined && !structural.has(offset)) continue
      if (!escaped?.get(owner)?.has(offset)) sites.push({ owner, offset, char, chain, fixed: verbatim })
    }
  }

  // Lists still to read, innermost last, so text is met in document order, each
  // with the chain of delimiter-writing spans above it. Small caps has no wrapper
  // of its own and ruby is written flattened, so neither joins a chain.
  const pending: Array<readonly InlineNode[]> = [content]
  const chains: Array<readonly object[]> = [[]]
  const cursors: number[] = [0]
  while (pending.length > 0) {
    const list = pending[pending.length - 1]!
    const index = cursors[cursors.length - 1]!
    const chain = chains[chains.length - 1]!
    if (index >= list.length) {
      pending.pop()
      chains.pop()
      cursors.pop()
      continue
    }
    cursors[cursors.length - 1] = index + 1
    const node = list[index]!
    const descend = (children: readonly InlineNode[]): void => {
      pending.push(children)
      chains.push(TRANSPARENT.has(node.type) ? [...chain, node] : chain)
      cursors.push(0)
    }
    switch (node.type) {
      case 'text':
        addText(node, node.value, chain)
        break
      case 'abbreviation':
        addText(node, node.abbr, chain)
        break
      case 'code':
        if (node.value === '') hasEmptyCode = true
        break
      case 'small_caps':
        if (node.attrs === undefined) descend(node.children)
        else scopes.push({ content: node.children, bracketed: true })
        break
      case 'ruby': {
        // Written flattened: base, then the annotation in parentheses.
        const flattened = node.pairs.flatMap((pair) => [...pair.base, ...pair.annotation])
        if (node.attrs === undefined) descend(flattened)
        else scopes.push({ content: flattened, bracketed: true })
        break
      }
      case 'substitution':
        descend(node.new)
        descend(node.old)
        break
      case 'span':
        scopes.push({ content: node.children, bracketed: true })
        break
      case 'link':
        if (node.ref === undefined || node.rawRef === undefined) scopes.push({ content: node.children, bracketed: true })
        else addText(node, node.rawRef, chain, true)
        break
      case 'image':
        if (node.ref !== undefined && node.rawRef !== undefined) addText(node, node.rawRef, chain, true)
        break
      case 'inline_extension':
        // Its content ends at the first `]`, so a `[` there pairs with nothing.
        scopes.push({ content: node.content, bracketed: false })
        break
      case 'inline_footnote':
      case 'footnote_ref':
        if (node.inline !== undefined) scopes.push({ content: node.inline, bracketed: true })
        break
      default:
        if (TRANSPARENT.has(node.type)) descend((node as { children: InlineNode[] }).children)
    }
  }

  for (const owner of owners) {
    into.delete(owner)
    pairs?.delete(owner)
    crossing?.delete(owner)
    crossingClosers?.delete(owner)
    if (hasEmptyCode) leftToSearch.add(owner)
    else leftToSearch.delete(owner)
  }
  if (hasEmptyCode) return

  type Bracket = Site & { chain: readonly object[]; fixed: boolean }
  /** The spans a pair reaches across, from whichever side holds them. */
  const crossed = (opener: Bracket, closer: Bracket): number => {
    const shared = sharedDepth(opener.chain, closer.chain)
    return opener.chain.length - shared + (closer.chain.length - shared)
  }

  // PASS ONE names the crossing openers: a pair read straight off the run whose
  // two brackets sit under different spans.
  const crossingOpeners = new Set<Bracket>()
  {
    const open: Bracket[] = []
    for (const site of sites) {
      if (site.char === '[') open.push(site)
      else {
        const opener = open.pop()
        if (opener !== undefined && !opener.fixed && crossed(opener, site) > 0) crossingOpeners.add(opener)
      }
    }
  }

  // PASS TWO reads the run as the reader will, with those openers GONE. A `]`
  // whose own `[` is escaped falls through to the next opener out, and where
  // that pair crosses the same boundary the CLOSER takes the escape - the opener
  // cannot, because escaping it would only move the question one bracket further
  // out. One pass cannot decide this, since which brackets survive is not known
  // until the run is complete (markup-carve/carve-rs#2209).
  //
  // An escaped closer answers nothing, so its opener STAYS OPEN for the next `]`
  // rather than being spent on it. Popping it left a second crossing `]` bare,
  // and `carve fmt` then wrote that escape itself: `<p>[[[<ins>]]</ins></p>`
  // imported as `[\[\[{+\]]+}` and re-formatted to `\[\[\[{+\]]+}`.
  const lone: Site[] = []
  const crossingClosed: Bracket[] = []
  {
    const open: Bracket[] = []
    const decided = new Set<Bracket>()
    for (const site of sites) {
      if (site.char === '[') {
        if (!crossingOpeners.has(site)) open.push(site)
        continue
      }
      const opener = open.pop()
      if (opener === undefined) continue
      decided.add(site)
      if (!site.fixed && crossed(opener, site) > 0) {
        crossingClosed.push(site)
        open.push(opener)
        continue
      }
      if (pairs === undefined || !bracketed) continue
      let closers = pairs.get(site.owner)
      if (closers === undefined) pairs.set(site.owner, (closers = new Map()))
      closers.set(site.offset, opener)
    }
    for (const site of sites) if (site.char === ']' && !decided.has(site)) lone.push(site)
    for (const site of open) lone.push(site)
  }

  if (bracketed) {
    for (const site of lone) {
      let offsets = into.get(site.owner)
      if (offsets === undefined) into.set(site.owner, (offsets = new Set()))
      offsets.add(site.offset)
    }
  }
  record(crossing, crossingOpeners)
  record(crossingClosers, crossingClosed)
}

function record(at: WeakMap<object, Set<number>> | undefined, sites: Iterable<Site>): void {
  if (at === undefined) return
  for (const site of sites) {
    let offsets = at.get(site.owner)
    if (offsets === undefined) at.set(site.owner, (offsets = new Set()))
    offsets.add(site.offset)
  }
}
