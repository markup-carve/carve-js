import type { InlineNode } from './ast.js'

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
 * keyed like `LoneBrackets` but carrying the HOSTS the pair reaches across.
 *
 * PART 8 resolves the bracket run before the emphasis delimiters, so a run
 * reaching across a formatting boundary isolates the bare delimiters inside it:
 * the OPENER carries the escape, and its closer then closes no run, so a `(`
 * behind it opens no destination.
 *
 * The hosts are what say whether the escape is load bearing, because only a BARE
 * delimiter run can be isolated. A braced pair survives a bracket run, and the
 * writer braces a span whenever its neighbors or its content leave it no bare
 * spelling - which is a rendering decision, so the writer resolves it rather
 * than this pass.
 *
 * Every span the pair crosses is recorded, from BOTH sides: the opener may sit at
 * the run's own level and the closer under a span, or the other way round, and it
 * is the SPAN's delimiter run that the bracket run would split either way. Spans
 * holding both brackets are crossed by nothing and stay out.
 *
 * The writer escapes only where EVERY crossed span came out bare, which is the
 * conservative side of the question on purpose. Where a braced span is in the way
 * the bracket run stops behaving like one, in ways that vary with the nesting, and
 * declining there costs nothing: PART 11 section 4's own check still sees any
 * spelling that would re-read wrong and escalates that unit, which is what the
 * writer did for all of these before this rule existed.
 */
export type CrossingOpeners = WeakMap<object, Map<number, readonly object[]>>

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
): void {
  const scopes: Scope[] = [{ content: nodes, bracketed }]
  for (let scope = scopes.pop(); scope !== undefined; scope = scopes.pop()) collectScope(scope, scopes, into, leftToSearch, pairs, crossing)
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
): void {
  const sites: Array<Site & { chain: readonly object[] }> = []
  const owners: object[] = []
  // A run holding an empty code span is left to the escape search whole: the
  // span is written as a bare backtick run, so a pairing read from the tree no
  // longer matches the written bytes, before the span or after it.
  let hasEmptyCode = false

  const addText = (owner: object, value: string, chain: readonly object[]): void => {
    owners.push(owner)
    if (!/[[\]]/.test(value)) return
    const text = value.replace(UNWRITABLE_CONTROLS, '')
    for (let offset = 0; offset < text.length; offset++) {
      const char = text[offset]!
      if (char === '[' || char === ']') sites.push({ owner, offset, char, chain })
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
        if (node.rawRef === undefined) scopes.push({ content: node.children, bracketed: true })
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
    if (hasEmptyCode) leftToSearch.add(owner)
    else leftToSearch.delete(owner)
  }
  if (hasEmptyCode) return

  const lone: Site[] = []
  const crossed: Array<{ site: Site; hosts: readonly object[] }> = []
  const open: Array<Site & { chain: readonly object[] }> = []
  for (const site of sites) {
    if (site.char === '[') {
      open.push(site)
      continue
    }
    const opener = open.pop()
    if (opener === undefined) {
      lone.push(site)
      continue
    }
    const shared = sharedDepth(opener.chain, site.chain)
    const hosts = [...opener.chain.slice(shared), ...site.chain.slice(shared)]
    if (hosts.length > 0) {
      crossed.push({ site: opener, hosts })
      continue
    }
    if (pairs === undefined || !bracketed) continue
    let closers = pairs.get(site.owner)
    if (closers === undefined) pairs.set(site.owner, (closers = new Map()))
    closers.set(site.offset, opener)
  }
  for (const site of open) lone.push(site)

  if (bracketed) {
    for (const site of lone) {
      let offsets = into.get(site.owner)
      if (offsets === undefined) into.set(site.owner, (offsets = new Set()))
      offsets.add(site.offset)
    }
  }
  if (crossing === undefined) return
  for (const { site, hosts } of crossed) {
    let offsets = crossing.get(site.owner)
    if (offsets === undefined) crossing.set(site.owner, (offsets = new Map()))
    offsets.set(site.offset, hosts)
  }
}
