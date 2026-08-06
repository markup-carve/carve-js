import type {
  Attrs,
  BlockNode,
  DefinitionItem,
  Document,
  Figure,
  Image,
  InlineNode,
  Link,
  List,
  ListItem,
  Table,
  TableCell,
  Text,
} from './ast.js'
import { parse } from './parse.js'
import { MAX_RENDER_DEPTH, RenderDepthError } from './render-depth.js'

export { MAX_RENDER_DEPTH }
import { normalizeLegacyInline } from './legacy-nodes.js'
import { resolveHeadingIds } from './heading-ids.js'

export interface CarveRenderOptions {}

/**
 * The writer's recursion bound, and it must sit ABOVE the parser's.
 *
 * The guard exists for hand-built ASTs, which can nest arbitrarily deep. It is
 * not a language rule, and reusing the parser's own number made it one: a
 * document nested at exactly `MAX_NESTING_DEPTH` parses fine, and the writer
 * then returned '' for its innermost block, so `fmt` deleted the content
 * silently and PART 11's semantic invariant broke at the boundary (issue 517).
 *
 * A parsed tree is one level deeper than the containers that produced it - the
 * paragraph inside the innermost container - so the slack has to cover the
 * blocks a container subtree adds, not just one. Same reasoning as
 * `MAX_AST_JSON_DEPTH` in ast-json.ts, which is above the parser cap for the
 * same reason: the two counts measure different things, so one cannot be the
 * bound for the other.
 */
/**
 * Whitespace that is NOT a non-breaking space. Applied one character at a
 * time by the trim helpers below, deliberately: the equivalent anchored
 * pattern `/[^\S\u00a0]+$/` is quadratic on its input, because the engine
 * retries the run from every start position before it can fail. The writer
 * trims whole rendered subtrees, whose length grows with nesting depth, so
 * that cost compounded per level - `fmt` on an 80-level list took 88 seconds
 * here against 0.24 in carve-php and 0.009 in carve-rs, all of it inside
 * these two patterns (carve-js#638). A scan from the end is linear in the
 * run it removes.
 */
const WS_NON_NBSP_RE = /[^\S\u00a0]/

function isWsNonNbsp(ch: string): boolean {
  return WS_NON_NBSP_RE.test(ch)
}

function trimEndNonNbsp(text: string): string {
  let end = text.length
  while (end > 0 && isWsNonNbsp(text[end - 1]!)) end--
  return end === text.length ? text : text.slice(0, end)
}

function trimStartNonNbsp(text: string): string {
  let start = 0
  while (start < text.length && isWsNonNbsp(text[start]!)) start++
  return start === 0 ? text : text.slice(start)
}

interface CarveContext {
  blockDepth: number
  inlineDepth: number
  listDepth: number
  /** Depth of line-block nesting, so the inline writer drops the explicit
   *  backslash: inside a `::: |` fence every newline already IS a hard break. */
  lineBlockDepth: number
  /** Number of colon-fence containers enclosing the block currently rendering. */
  colonFenceDepth: number
}

export function renderCarve(ast: Document, _opts: CarveRenderOptions = {}): string {
  // PART 11 section 4: emit the minimal-escape form when dropping the candidate
  // escapes changes nothing, and fall back to the conservative form when it
  // does. The check is the parser's, not a table's, so the writer cannot drift
  // as the grammar grows.
  // Choose the verbatim sentinels before anything is rendered, so both escape
  // passes below agree on them.
  sentinels = pickSentinels(collectStrings(ast))
  redundantIds = findRedundantHeadingIds(ast)
  const minimal = renderWithEscapes(ast, 'minimal')
  const conservative = renderWithEscapes(ast, 'conservative')
  if (minimal === conservative) return minimal
  // A cheaper sufficient reason to prefer the minimal form: it RE-PARSES TO THE
  // TREE WE WERE GIVEN. That is strictly stronger than "the two renders agree" -
  // a form that reproduces the input tree cannot have changed the document, so
  // there is nothing left for the comparison below to decide.
  //
  // Worth a tier of its own because that comparison costs TWO full parses, and
  // it was paid by every document holding a single escapable character in text,
  // which is nearly all of them. It showed up as depth sensitivity rather than
  // as what it is: on a 40 KB `- x` ladder, adding one `-` to a paragraph took
  // `fmt` from 6 ms to 186 ms - about twice the parse - while the ladder alone
  // stayed at 6 ms.
  //
  // A MISS costs nothing but the parse it just did: it falls through to the same
  // comparison as before. The tree here is parse-only plus block-image
  // promotion, so a document whose sole image was promoted misses and is decided
  // the old way.
  // ONE parse of the minimal form, reused by both tiers below. Parsing it here
  // and again inside the comparison would make a MISS cost three parses where it
  // used to cost two - paying for the shortcut exactly on the documents it
  // cannot help.
  const minimalTree = treeOf(minimal)
  if (minimalTree !== null && minimalTree === stableJson(ast)) return minimal
  return escapingIsRedundant(minimalTree, conservative) ? minimal : conservative
}

/**
 * The canonical tree of `src`, or null when it does not parse.
 *
 * Null answers "cannot tell" for every caller: a writer bug that produces
 * unparseable source must not throw out of the renderer, and the conservative
 * form is what the writer emitted before minimal escaping existed.
 */
function treeOf(src: string): string | null {
  try {
    return stableJson(parse(src))
  } catch {
    return null
  }
}


/**
 * Which headings carry the id a fresh parse would give them.
 *
 * Runs `resolveHeadingIds` - the pass the parser itself uses - over a copy with
 * every heading id stripped, then compares position by position. Reusing that
 * pass is the point: slug and dedup rules live in one place, so this cannot
 * answer differently from the parse it is predicting.
 */
function findRedundantHeadingIds(ast: Document): WeakSet<object> {
  const out = new WeakSet<object>()
  // ITERATIVE, because this runs before the renderer's depth guard: a hand-built
  // tree 50k nodes deep overflowed the stack here and raised a RangeError where
  // the caller should see RenderDepthError. Document order is preserved by
  // pushing children in reverse.
  const headings = (root: unknown, into: Array<Record<string, unknown>>): void => {
    const stack: unknown[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i -= 1) stack.push(node[i])
        continue
      }
      if (!node || typeof node !== 'object') continue
      const record = node as Record<string, unknown>
      if (record['type'] === 'heading') into.push(record)
      const values = Object.values(record)
      for (let i = values.length - 1; i >= 0; i -= 1) stack.push(values[i])
    }
  }

  const original: Array<Record<string, unknown>> = []
  headings(ast, original)
  if (original.length === 0) return out

  // A tree too deep to copy is also too deep to render: the depth error the
  // renderer raises is the one the caller should see, so this pass declines
  // rather than throwing a stack overflow ahead of it.
  let copy: Document
  try {
    copy = JSON.parse(JSON.stringify(ast)) as Document
  } catch {
    return out
  }
  const copied: Array<Record<string, unknown>> = []
  headings(copy, copied)
  for (const heading of copied) {
    const attrs = heading['attrs'] as { id?: string; order?: string[] } | undefined
    if (attrs && attrs.id !== undefined && !(attrs.order ?? []).includes('#id')) {
      delete attrs.id
    }
  }
  resolveHeadingIds(copy)

  for (const [index, heading] of original.entries()) {
    const attrs = heading['attrs'] as { id?: string; order?: string[] } | undefined
    if (!attrs || attrs.id === undefined || (attrs.order ?? []).includes('#id')) continue
    const fresh = (copied[index]?.['attrs'] as { id?: string } | undefined)?.id
    if (fresh === attrs.id) out.add(heading)
  }

  return out
}

function renderWithEscapes(ast: Document, mode: 'minimal' | 'conservative'): string {
  const previous = escapeMode
  escapeMode = mode
  try {
    const ctx: CarveContext = {
      blockDepth: 0,
      inlineDepth: 0,
      listDepth: 0,
      lineBlockDepth: 0,
      colonFenceDepth: 0,
    }
    const parts: string[] = []
    if (ast.frontmatter) parts.push(renderFrontmatter(ast.frontmatter))
    const body = renderBlocks(ast.children, ctx)
    if (body) parts.push(body)
    const footnotes = renderFootnoteDefs(ast, ctx)
    if (footnotes) parts.push(footnotes)
    return normalize(parts.join('\n\n'))
  } finally {
    escapeMode = previous
  }
}

/**
 * True when the two renders mean the same thing, so the escapes the
 * conservative form adds are redundant and the minimal form can be emitted.
 *
 * The comparison is minimal-against-conservative rather than
 * minimal-against-the-original-AST, deliberately. The writer does not satisfy
 * `parse(fmt(x)) == parse(x)` for every construct today - tables with a colspan,
 * doubled alignment markers, some list-item attributes and one line-block shape
 * all re-parse to a different AST while rendering identical HTML. Comparing
 * against the original document would inherit those defects and make the
 * escaping decision flip between passes, breaking idempotence for a reason that
 * has nothing to do with escaping. Comparing the two renders isolates the only
 * question this decision is about: does dropping the candidate escapes change
 * anything?
 *
 * It is also document-scoped rather than per-line. Verifying anything smaller
 * loses the document's link and footnote definitions, so a paragraph carrying a
 * reference link comes back with an empty href and reports a difference that
 * escaping never caused.
 */
function escapingIsRedundant(minimalTree: string | null, conservative: string): boolean {
  // `minimalTree` is the caller's single parse of the minimal form; null means it
  // did not parse, which answers the question conservatively.
  if (minimalTree === null) return false
  const conservativeTree = treeOf(conservative)
  return conservativeTree !== null && minimalTree === conservativeTree
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value))
}

/**
 * Key-order-insensitive view of a node tree.
 *
 * A parsed document and a re-parsed one carry the same fields in different
 * insertion order - `attrs` before `children` in one, after it in the other -
 * so a plain JSON.stringify comparison reports a difference that does not
 * exist and escalates the whole document to conservative escaping for nothing.
 *
 * `pos`, `footnoteDefPos` and `srcByteLength` describe where the text sat
 * rather than what it says, and the writer legitimately renormalizes
 * indentation, so they are dropped rather than compared.
 *
 * `footnoteDefPos` is the one that bites: it is a root-level MAP of positions
 * whose key is not `pos`, so the name-based skip missed it. Adding an escape
 * lengthens the source and shifts every offset in that map, so the comparison
 * reported a difference on EVERY document carrying a footnote and escalated it
 * to conservative escaping - 12 of the 14 cross-engine writer diffs in
 * carve#478 were this one line.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return mergeTextRuns(value).map(canonical)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key === 'pos' || key === 'footnoteDefPos' || key === 'srcByteLength') continue
      // `escapedLeadingCaret` records that a leading caret was escaped, which
      // is the escape itself rather than a consequence of it - comparing it
      // would escalate every document whose text starts with a caret. Where
      // the escape is load-bearing, dropping it promotes an image to a FIGURE,
      // and that is a structural difference this comparison sees anyway.
      if (key === 'escapedLeadingCaret') continue
      out[key] = canonical((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

/**
 * Collapse adjacent text and escaped-text nodes into one text node.
 *
 * An escape is exactly what this comparison is deciding, so the two renders
 * must not be told apart BY it. Escaping a character both retypes the node and
 * SPLITS the run it sat in - `blue.` is one text node, `blue\.` is a text node
 * plus an escaped-text node - so without this every candidate character would
 * report a difference and escalate the whole document to conservative escaping.
 *
 * What survives the merge is the question worth asking: same characters, same
 * order, same surrounding structure - does dropping the escapes change anything
 * ELSE?
 */
function mergeTextRuns(nodes: unknown[]): unknown[] {
  const out: unknown[] = []
  for (const node of nodes) {
    const current = node as Record<string, unknown> | null
    const isTextish =
      current !== null &&
      typeof current === 'object' &&
      (current['type'] === 'text' || current['type'] === 'escaped_text')
    const previous = out[out.length - 1] as Record<string, unknown> | undefined
    if (isTextish && previous !== undefined && previous['type'] === 'text') {
      previous['value'] = String(previous['value'] ?? '') + String(current!['value'] ?? '')
      continue
    }
    if (isTextish) {
      out.push({ type: 'text', value: String(current!['value'] ?? '') })
      continue
    }
    out.push(node)
  }
  return out
}

function renderBlocks(blocks: BlockNode[], ctx: CarveContext): string {
  if (ctx.blockDepth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderCarve', MAX_RENDER_DEPTH)
  ctx.blockDepth++
  try {
    return blocks
      .map((b) => renderBlock(b, ctx))
      .filter((s) => s.length > 0)
      .join('\n\n')
  } finally {
    ctx.blockDepth--
  }
}

/** A copy of `attrs` without its `id`, for an id the author did not write. */
function withoutIdSlot(attrs: Attrs | undefined): Attrs | undefined {
  if (!attrs || attrs.id === undefined) return attrs
  const next: Attrs = { ...attrs }
  delete next.id
  if (next.order) next.order = next.order.filter((slot) => slot !== '#id')

  return next
}

/** A copy of `attrs` without one key-value, dropping the slot from `order`. */
function withoutKey(attrs: Attrs | undefined, key: string): Attrs | undefined {
  if (!attrs?.keyValues || !(key in attrs.keyValues)) return attrs
  const keyValues = { ...attrs.keyValues }
  delete keyValues[key]
  const next: Attrs = { ...attrs, keyValues }
  if (next.order) next.order = next.order.filter((slot) => slot !== key)
  if (
    next.id === undefined &&
    (next.classes === undefined || next.classes.length === 0) &&
    Object.keys(keyValues).length === 0
  ) {
    return undefined
  }
  return next
}

function renderBlock(node: BlockNode, ctx: CarveContext): string {
  const attrs = renderBlockAttrs(node.attrs)
  const withAttrs = (body: string) => (attrs ? `${attrs}\n${body}` : body)
  switch (node.type) {
    case 'heading': {
      // A heading is SINGLE-LINE (PART 2), so its text must not contain a
      // newline: emitting one would end the heading and silently re-parse the
      // remainder as a following block. No parse can build such a heading, but
      // an ingested AST can - PART 12 lets any inline sit in a heading, break
      // nodes included - so a break collapses to a single space here rather
      // than corrupting the document it is written back to.
      //
      // Only an ODD run of backslashes before the newline is a hard break's
      // marker; an even run is literal backslashes that happen to end the line,
      // and dropping one there would eat the escape and swallow the space.
      const text = trimNonNbsp(
        trimNonNbsp(renderInlines(node.children, ctx)).replace(
          /(\\*)\n[ \t]*/g,
          (_m, slashes: string) => (slashes.length % 2 === 1 ? slashes.slice(1) : slashes) + ' ',
        ),
      )
      // A generated id that a fresh parse would re-derive is not written back:
      // it is a resolution result, not the author's source (carve-js#741). One
      // the parse would NOT re-derive - an ingested tree whose text was edited -
      // is written, because the id lives nowhere else.
      const headingBody = `${'#'.repeat(node.level)} ${text}`
      if (redundantIds.has(node as unknown as object)) {
        const withoutId = renderBlockAttrs(withoutIdSlot(node.attrs))

        return withoutId ? `${withoutId}\n${headingBody}` : headingBody
      }

      return withAttrs(headingBody)
    }
    case 'paragraph':
      return withAttrs(guardThematicBreakLines(renderInlines(node.children, ctx)))
    case 'code_block': {
      const fence = safeFence(node.content, 3)
      const info = codeFenceInfo(node.lang, node.header, node.label)
      // The opener's quoted title is resolved onto `attrs.title` at parse time
      // so it reaches every consumer, but the fence carries it too - emitting
      // both says it twice (`{title=x}` AND `\`\`\` lang "x"`), which is longer
      // than the author wrote and re-parses with an attribute ORDER the source
      // never had (issue 369). The fence is the authored spelling, so it wins.
      const attrsWithoutTitle =
        node.header !== undefined && node.attrs?.keyValues?.['title'] === node.header
          ? renderBlockAttrs(withoutKey(node.attrs, 'title'))
          : attrs
      const body = `${fence}${info}\n${protectVerbatim(node.content)}\n${fence}`
      return attrsWithoutTitle ? `${attrsWithoutTitle}\n${body}` : body
    }
    case 'block_quote': {
      const inner = renderHostedBlocks(node.children, ctx)
      const body = inner
        .split('\n')
        .map((line) => (line === '' ? '>' : `> ${line}`))
        .join('\n')
      return withAttrs(body)
    }
    case 'list':
      return withAttrs(renderList(node, ctx))
    case 'thematic_break':
      return withAttrs('---')
    case 'table':
      return withAttrs(renderTable(node, ctx))
    case 'admonition': {
      // The quoted title is re-parsed as a quoted_title token (which admits
      // no escapes and cannot contain a quote), so the inline serialization
      // must be emitted verbatim: wrapping it in escapeQuoted doubles the
      // backslashes renderInlines already produced and compounds on every
      // fmt pass (issue 295).
      const title = node.title !== undefined ? ` "${renderInlines(node.title, ctx)}"` : ''
      const label = node.label !== undefined ? ` [${escapeBracketText(node.label)}]` : ''
      const fence = colonFenceFor(ctx)
      const body = renderColonFenceBody(node.children, ctx)
      return withAttrs(`${fence} ${node.kind}${title}${label}\n${body}\n${fence}`)
    }
    case 'line_block': {
      // `::: |` is the line-block opener (PART 3, line_block_open). Emitting a
      // bare `:::` and tagging the node with a `.line-block` class instead
      // re-parsed as an ordinary div, so the node type changed across a format
      // round trip and `parse(fmt(x)) == parse(x)` did not hold (issue 359).
      //
      // Inside the fence every newline IS a hard break (PART 3,
      // line_block_body), so the explicit backslash the inline writer emits for
      // a hard_break would double it on re-parse.
      const fence = colonFenceFor(ctx)
      ctx.lineBlockDepth++
      ctx.colonFenceDepth++
      let body: string
      try {
        body = renderBlocks(node.children, ctx)
      } finally {
        ctx.colonFenceDepth--
        ctx.lineBlockDepth--
      }
      return withAttrs(fence + ' |\n' + lineBlockLayoutWhitespace(body) + '\n' + fence)
    }
    case 'div': {
      // Divs render generically (`::: {.class}`), never the `::: \` hardbreaks
      // sugar: that sugar forces hard breaks, but a plain div carrying a
      // `.hardbreaks` class keeps soft breaks. The two are indistinguishable by
      // attrs - only the child break nodes differ - so we let those break nodes
      // serialize themselves, which round-trips both. (A line block is its own
      // node type and is handled above.)
      const label = node.label !== undefined ? ` [${escapeBracketText(node.label)}]` : ''
      const fence = colonFenceFor(ctx)
      const body = renderColonFenceBody(node.children, ctx)
      return withAttrs(`${fence}${label}\n${body}\n${fence}`)
    }
    case 'definition_list':
      return withAttrs(renderDefinitionList(node.items, ctx))
    case 'figure':
      return withAttrs(renderFigure(node, ctx))
    case 'image':
      return renderImage(node)
    case 'raw_block': {
      const fence = safeFence(node.content, 3)
      return withAttrs(`${fence}=${escapeFormat(node.format)}\n${protectVerbatim(node.content)}\n${fence}`)
    }
    case 'abbreviation_def':
      return `*[${escapeAbbr(node.abbr)}]: ${escapePlainLine(node.expansion)}`
    case 'link_reference_definition': {
      // PART 12 §10 gave this a node precisely so the writer can put the line
      // back. Before that there was nowhere to write it from, which is why every
      // resolved reference was INLINED instead (carve-js#690).
      const title = node.title === undefined ? '' : ` "${escapeQuoted(node.title)}"`
      const attrs = renderAttrs(node.attrs)
      return `[${node.label}]: ${node.href}${title}${attrs === '' ? '' : ` ${attrs}`}`
    }
    case 'comment':
      return node.block ? renderBlockComment(node.content) : `%% ${node.content}`
    default: {
      const t: never = node
      throw new Error(`renderCarve: unknown block ${(t as { type: string }).type}`)
    }
  }
}

function renderList(node: List, ctx: CarveContext): string {
  ctx.listDepth++
  try {
    let out = ''
    let counter = node.start ?? 1
    // The marker is semantic (§11: a different bullet char / ordered delim
    // starts a new list), so emit it as authored - normalizing would merge
    // adjacent sibling lists on re-parse (carve issue 286).
    const delim = node.delim ?? '.'
    const bullet = node.bulletChar ?? '-'
    // The bare dot is written back only where the author wrote one (carve#315).
    // PART 11 §6: `fmt` does not respell a construct to a synonym, because the
    // choice is the author's and the AST records it - the same rule, and the
    // same remedy, as the combined bold-italic form. `bareMarker` is that
    // record; picking a canonical spelling instead would rewrite every
    // `1.`/`2.`/`3.` list in existing documents on the next format.
    //
    // The other three conditions are belt and braces for a hand-built tree: a
    // bare dot cannot carry a start, a dialect or the `)` delimiter, so a mark
    // that contradicts one of them is ignored rather than written as source
    // that reads back differently.
    const bareDot =
      node.ordered &&
      node.bareMarker === true &&
      delim === '.' &&
      node.olType === undefined &&
      (node.start ?? 1) === 1
    node.items.forEach((item, idx) => {
      const indent = ''
      let prefix: string
      if (node.ordered) {
        prefix = bareDot ? `${delim} ` : `${orderedMarker(counter, node.olType)}${delim} `
        counter++
      } else if (item.checked !== undefined) {
        prefix = `${bullet} ${item.checked ? '[x]' : '[ ]'} `
      } else {
        prefix = `${bullet} `
      }
      const itemAttrs = renderAttrs(item.attrs)
      if (itemAttrs) {
        prefix = node.ordered
          ? `${prefix.trimEnd()}${itemAttrs} `
          : `${bullet}${itemAttrs}${item.checked !== undefined ? ` [${item.checked ? 'x' : ' '}] ` : ' '}`
      }
      let content = trimNonNbsp(renderListItem(item, ctx, node.tight))
      const lines = content ? content.split('\n') : ['']
      const first = lines.shift() ?? ''
      out += `${indent}${prefix}${first || '+'}\n`
      const continuation = ' '.repeat(prefix.length)
      // An EMPTY continuation line stays empty. Indenting it produces a line of
      // nothing but spaces, which the writer must never emit - the blank line
      // inside a fenced block in a list item was the one place it did (corpus
      // 75-list-nesting-and-looseness-5). The content is unchanged either way,
      // since the reader strips the item's columns back off.
      for (const line of lines) out += line ? `${indent}${continuation}${line}\n` : '\n'
      if (!node.tight && idx < node.items.length - 1) out += '\n'
    })
    return trimEndNonNbsp(out)
  } finally {
    ctx.listDepth--
  }
}

function renderListItem(item: ListItem, ctx: CarveContext, tight: boolean): string {
  // A list item is a prefix/indent host: its fences start over at `:::`.
  const outerFenceDepth = ctx.colonFenceDepth
  ctx.colonFenceDepth = 0
  try {
    return renderListItemBody(item, ctx, tight)
  } finally {
    ctx.colonFenceDepth = outerFenceDepth
  }
}

function renderListItemBody(item: ListItem, ctx: CarveContext, tight: boolean): string {
  // A loose item separates its blocks with a blank line; a tight item joins
  // them with a single newline so the re-parse stays tight. Using the generic
  // blank-line join here would loosen a tight item that has more than one child
  // (e.g. text after a fenced block), breaking toHtml(fmt(x)) == toHtml(x).
  if (!tight) return renderBlocks(item.children, ctx)
  if (ctx.blockDepth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderCarve', MAX_RENDER_DEPTH)
  ctx.blockDepth++
  try {
    return item.children
      .map((b) => renderBlock(b, ctx))
      .filter((s) => s.length > 0)
      .join('\n')
  } finally {
    ctx.blockDepth--
  }
}

function orderedMarker(n: number, type: List['olType']): string {
  switch (type) {
    case 'a':
      return alphaMarker(n, false)
    case 'A':
      return alphaMarker(n, true)
    case 'i':
      return romanMarker(n).toLowerCase()
    case 'I':
      return romanMarker(n)
    default:
      return String(n)
  }
}

function alphaMarker(n: number, upper: boolean): string {
  const base = String.fromCharCode((n - 1) % 26 + (upper ? 65 : 97))
  return base
}

function romanMarker(n: number): string {
  const values: Array<[number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ]
  let out = ''
  for (const [value, token] of values) {
    while (n >= value) {
      out += token
      n -= value
    }
  }
  return out || 'I'
}

function renderDefinitionList(items: DefinitionItem[], ctx: CarveContext): string {
  const out: string[] = []
  for (const item of items) {
    for (const term of item.terms) out.push(`:: ${renderInlines(term, ctx)}`)
    for (const def of item.definitions) {
      const lines = trimNonNbsp(renderHostedBlocks(def, ctx)).split('\n')
      out.push(`:  ${lines.shift() ?? ''}`)
      for (const line of lines) out.push(`   ${line}`)
    }
  }
  return out.join('\n')
}

/**
 * A colon fence closes on an EXACT length match (PART 9 §12), so a fence's
 * width is simply how deep it sits: the outermost container is `:::` and each
 * level inward adds a colon. No subtree scan, and no writer needing to know its
 * own maximum depth before it can emit its opening line - the bug class behind
 * issue 496.
 *
 * A container inside a blockquote, a list item or a definition body does NOT
 * count toward that depth (issue 499): its fence lines carry that host's prefix
 * or indent, and an indented or prefixed bare fence cannot close an ancestor,
 * so the count restarts inside the host. Widening for them would only make the
 * source noisier.
 */
function colonFenceFor(ctx: CarveContext): string {
  return ':'.repeat(3 + ctx.colonFenceDepth)
}

function renderColonFenceBody(children: BlockNode[], ctx: CarveContext): string {
  ctx.colonFenceDepth++
  try {
    return renderBlocks(children, ctx)
  } finally {
    ctx.colonFenceDepth--
  }
}

/**
 * Render blocks that a prefix/indent host owns (blockquote, list item,
 * definition body). Their fences start over at `:::` - see colonFenceFor.
 */
function renderHostedBlocks(children: BlockNode[], ctx: CarveContext): string {
  const outer = ctx.colonFenceDepth
  ctx.colonFenceDepth = 0
  try {
    return renderBlocks(children, ctx)
  } finally {
    ctx.colonFenceDepth = outer
  }
}

/**
 * Tables prefer the NATIVE header form: an `=` on each header cell, plus the
 * per-cell `<`/`>`/`~` alignment markers.
 *
 * The GFM delimiter row is an accepted alias on input, but it says something
 * the AST does not: its alignment applies to the WHOLE column, header and body
 * alike (PART 9 T7), while alignment on the AST belongs to each cell. Writing a
 * delimiter row for the ordinary shape - an aligned header over unaligned body
 * cells - brought every body cell back aligned, so `parse(fmt(x)) == parse(x)`
 * did not hold (issue 359).
 *
 * Two header shapes have no native spelling, because `header_cell` in the
 * grammar is `'=' [alignment_marker] content` and admits neither an attribute
 * block nor a span marker:
 *
 *   | < | b |     a span marker promoted to a header cell
 *   |{.x} a | b | a header cell carrying attributes
 *
 * Those still need a delimiter row to promote the first row. It is emitted BARE
 * (`|---|---|`), never with colons: the cells keep their own alignment markers,
 * so the delimiter contributes structure only and cannot spill alignment down
 * the column.
 */
function renderTable(node: Table, ctx: CarveContext): string {
  const rows: string[] = []
  const columns = node.rows.reduce((max, row) => Math.max(max, row.cells.length), 0)
  const first = node.rows[0]
  const headerRow = first !== undefined && first.cells.length > 0 && first.cells.every((c) => c.header)
  const needsDelimiter =
    headerRow && first.cells.some((c) => c.span !== undefined || c.attrs !== undefined)

  node.rows.forEach((row, rowIndex) => {
    const cells: RenderedCell[] = []
    for (let i = 0; i < columns; i++) {
      const cell = row.cells[i]
      // In the delimiter form the promoted row is written as ordinary data
      // cells - the row after it is what makes them headers.
      const asHeader = !(needsDelimiter && rowIndex === 0)
      cells.push(cell ? renderTableCell(cell, ctx, asHeader) : { text: '', tight: false })
    }
    rows.push(renderTableRow(cells, renderAttrs(row.attrs)))
  })
  if (needsDelimiter) {
    rows.splice(1, 0, `|${Array.from({ length: columns }, () => '---').join('|')}|`)
  }
  if (node.caption) rows.push(`^ ${renderInlines(node.caption, ctx)}`)
  return rows.join('\n')
}

interface RenderedCell {
  text: string
  tight: boolean
}

function renderTableRow(cells: RenderedCell[], attrs: string): string {
  return `|${cells.map((cell) => (cell.tight ? cell.text : ` ${cell.text} `)).join('|')}|${attrs}`
}

function renderTableCell(cell: TableCell, ctx: CarveContext, markHeader = true): RenderedCell {
  const attrs = renderAttrs(cell.attrs)
  // A lone span marker keeps a SPACE before it. Glued to the opening pipe, `<`
  // is also the left-alignment sigil, and the two readings differ: the
  // executable spec reads `|<|` as alignment where all three engines read a
  // colspan (markup-carve/carve#710). The padded form is unambiguous under either
  // reading - `alignment_marker` is defined as glued, `colspan_marker` allows
  // surrounding whitespace - so the writer should never emit the ambiguous one.
  // `^` is not an alignment sigil and needs no disambiguation, but it takes the
  // same shape so a row of span cells stays readable.
  //
  // With a cell attribute the block stays GLUED to the pipe, which is where the
  // grammar puts it, and the space goes between it and the marker.
  const spanMarker = cell.span === 'rowspan' ? '^' : '<'
  if (cell.span === 'rowspan' || cell.span === 'colspan') {
    return attrs === ''
      ? { text: spanMarker, tight: false }
      : { text: `${attrs} ${spanMarker}`, tight: true }
  }
  const prefix = `${attrs}${cell.header && markHeader ? '=' : ''}${alignMarker(cell.align)}`
  return { text: `${prefix}${renderInlines(cell.children, ctx)}`, tight: prefix !== '' }
}

function renderFigure(node: Figure, ctx: CarveContext): string {
  const target =
    node.target.type === 'image'
      ? renderImage(node.target)
      : node.target.type === 'table'
        ? renderTable(node.target, ctx)
        : renderBlock(node.target, ctx)
  return `${target}\n^ ${renderInlines(node.caption, ctx)}`
}

function renderFootnoteDefs(ast: Document, ctx: CarveContext): string {
  if (!ast.footnoteDefs) return ''
  const out: string[] = []
  for (const [label, blocks] of Object.entries(ast.footnoteDefs)) {
    const rawBody = renderBlocks(blocks, ctx)
    const body = trimNonNbsp(blocks.length === 1 ? rawBody.replace(/\n\n/g, '\n') : rawBody)
    const lines = body.split('\n')
    const defLines = [`[^${escapeFootnoteLabel(label)}]: ${lines.shift() ?? ''}`]
    // TWO spaces, the body's own column (PART 9 §16). Three is legal
    // continuation, but it leaves the body's blocks at a relative column above
    // zero - and a reader that takes the body's column as two then sees an
    // indented block opener, which does not open. This engine reads three back
    // fine; the executable spec, carve-rs and carve-php do not.
    for (const line of lines) defLines.push(`  ${line}`)
    out.push(defLines.join('\n'))
  }
  return out.join('\n\n')
}

function renderInlines(nodes: InlineNode[], ctx: CarveContext): string {
  if (ctx.inlineDepth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderCarve', MAX_RENDER_DEPTH)
  ctx.inlineDepth++
  try {
    return nodes
      .map((node, idx) => renderInline(node, ctx, lastBoundary(nodes[idx - 1]), firstBoundary(nodes[idx + 1])))
      .join('')
  } finally {
    ctx.inlineDepth--
  }
}

function renderInline(node: InlineNode, ctx: CarveContext, prevChar = '', nextChar = ''): string {
  // A stored tree may still carry a type this engine no longer emits; map it
  // before dispatch so the switch below only ever sees current types.
  node = normalizeLegacyInline(node)

  const withAttrs = (body: string) => `${body}${renderAttrs(node.attrs)}`
  switch (node.type) {
    case 'text':
      return escapeText(cleanEscapedText(node))
    case 'escaped_text':
      // The author escaped this character; the writer says so again. No
      // minimal/conservative decision applies - the node IS the decision.
      return '\\' + node.value
    case 'emphasis':
      return withAttrs(renderEmphasis('/', renderInlines(node.children, ctx), prevChar, nextChar))
    case 'strong': {
      // The combined bold-italic form is a single production, and the nested
      // spelling parses to the SAME strong-wrapping-emphasis tree - so the
      // nesting does not record which one the author wrote and cannot be
      // serialized back "literally". The comment here used to claim each
      // spelling re-parses to the shape it came from; it does not, which is why
      // the documented form was being rewritten into an undocumented one
      // (carve#375). `boldItalic` carries the answer (PART 11 section 6).
      const inner = node.children[0]
      if (node.boldItalic === true && node.children.length === 1 && inner?.type === 'emphasis') {
        const content = renderInlines(inner.children, ctx)
        return withAttrs(`/*${content}*/`)
      }
      return withAttrs(renderEmphasis('*', renderInlines(node.children, ctx), prevChar, nextChar))
    }
    case 'underline':
      return withAttrs(renderEmphasis('_', renderInlines(node.children, ctx), prevChar, nextChar))
    case 'strike':
      return withAttrs(renderEmphasis('~', renderInlines(node.children, ctx), prevChar, nextChar))
    case 'superscript':
      return withAttrs(renderForcedEmphasis('^', renderInlines(node.children, ctx)))
    case 'subscript':
      return withAttrs(renderForcedEmphasis(',', renderInlines(node.children, ctx)))
    case 'highlight':
      return withAttrs(renderEmphasis('=', renderInlines(node.children, ctx), prevChar, nextChar))
    case 'code':
      return withAttrs(renderCode(node.value))
    case 'link':
      return renderLink(node, ctx)
    case 'image':
      return renderImage(node)
    case 'span':
      return `[${renderInlines(node.children, ctx)}]${renderAttrs(node.attrs) || '{}'}`
    case 'math':
      return withAttrs(renderMath(node.display, node.content))
    case 'raw_inline':
      return `${renderCode(node.content)}{=${escapeFormat(node.format)}}`
    case 'literal_inline':
      // §27: `!` prefix on a verbatim span. A trailing attribute block is the
      // ordinary inline attribute block (same as a code span carries).
      // renderCode widens the backtick fence when the content holds backticks.
      return `!${renderCode(node.content)}${renderAttrs(node.attrs)}`
    case 'symbol':
      return withAttrs(`:${escapeSymbolName(node.name)}:`)
    case 'autolink':
      // Emit the raw autolink content verbatim (keeps a URI scheme like
      // `mailto:`); fall back to the href for nodes without `text`.
      return withAttrs(`<${escapeAutolinkHref(node.text ?? (node.href.startsWith('mailto:') ? node.href.slice(7) : node.href))}>`)
    case 'mention':
      return `@${escapeName(node.user)}`
    case 'tag':
      return `#${escapeName(node.name)}`
    case 'inline_extension':
      return withAttrs(`:${escapeIdentifier(node.name)}[${renderInlines(node.content, ctx)}]`)
    case 'abbreviation':
      return escapeText(node.abbr)
    case 'footnote_ref':
    case 'inline_footnote':
      return withAttrs(node.inline
        ? `^[${renderInlines(node.inline, ctx)}]`
        : `[^${escapeFootnoteLabel(node.id ?? '')}]`)
    case 'soft_break':
      return '\n'
    case 'hard_break':
      return ctx.lineBlockDepth > 0 ? '\n' : '\\\n'
    case 'insert':
      return `{+${renderInlines(node.children, ctx)}+}${renderAttrs(node.attrs)}`
    case 'delete':
      return `{-${renderInlines(node.children, ctx)}-}${renderAttrs(node.attrs)}`
    case 'substitution':
      return `{~${escapeCriticText(node.oldText)}~>${escapeCriticText(node.newText)}~}`
    case 'critic_comment':
      return `{#${escapeCriticText(node.text)}#}`
    case 'heading_ref':
      return `</#${escapeCrossrefTarget(node.target)}>`
    case 'caption_number':
      return '#'
    case 'citation_group':
      return node.raw
    case 'comment':
      // THE UNIT IS THE OPENER (PART 11 §2). A content run that begins with `%`
      // joins the opener rather than being separated from it by a space: a
      // comment whose content is `%` is written ` %%%`, not ` %% %`, which
      // splits a three-character opener run into an opener plus a stray
      // character - "a shape that happens to work rather than one that says
      // what it means". Both re-parse to the same content, so the invariant
      // never saw it; §1's `to_html(fmt(x)) == to_html(x)` is necessary, not
      // sufficient. (carve#581, carve#544)
      return node.content.startsWith('%')
        ? ` %%${node.content}`
        : ` %% ${node.content}`
    case 'smart_punctuation':
      // The whole point: reproduce the author's source run verbatim.
      return node.value
    default: {
      const t: never = node
      throw new Error(`renderCarve: unknown inline ${(t as { type: string }).type}`)
    }
  }
}

function renderLink(node: Link, ctx: CarveContext): string {
  // An unresolved reference link (parse() left `ref` set with an empty href -
  // no matching `[label]: url` def) round-trips via its verbatim source. resolve
  // either matches it to a heading later or renders it literally; emitting the
  // raw reference reproduces that exactly, where `[text]()` would not.
  // UNRESOLVED means no destination, not "carries a ref": PART 12 §3a keeps
  // `ref` and `rawRef` on a RESOLVED reference too, so the presence of a ref
  // no longer answers this question (carve#596).
  if (node.ref !== undefined && node.rawRef !== undefined && !node.href) {
    return node.rawRef
  }
  // A RESOLVED reference stays a reference. Inlining it satisfied
  // toHtml(fmt(x)) == toHtml(x) and broke PART 11 §1: `ref`/`rawRef` - which §3a
  // keeps so `[a][r]` and `[a](/u)` stay distinguishable - were absent from the
  // reparse, and one destination became N after a single pass, which is the
  // duplication the definition form exists to avoid (carve-js#690, carve#642).
  //
  // `rawRef` is the authored source VERBATIM and already carries any attribute
  // block written at the reference, so it is emitted as-is rather than having
  // renderAttrs appended - which would write the block twice.
  // No heading-reference guard is needed here, unlike carve-php's: this engine
  // DELETES `ref`/`rawRef` when a heading resolves a reference, and `carveToCarve`
  // does not run resolve() at all - so a heading-derived link never reaches this
  // branch carrying a ref.
  if (node.ref !== undefined && node.rawRef !== undefined) {
    return node.rawRef
  }
  const text = renderInlines(node.children, ctx)
  const title = node.title === undefined ? '' : ` "${escapeQuoted(node.title)}"`
  return `[${text}](${escapeDestination(node.href)}${title})${renderAttrs(node.attrs)}`
}

function renderImage(node: Image): string {
  // An unresolved reference image round-trips via its verbatim source, exactly
  // like an unresolved reference link (renderLink); `![alt]()` would change the
  // rendered text and break the carveToHtml(fmt(x)) == carveToHtml(x) invariant.
  if (node.ref !== undefined && node.rawRef !== undefined && !node.src) {
    return node.rawRef
  }
  // A RESOLVED reference image stays a reference, for the same reason as a link.
  if (node.ref !== undefined && node.rawRef !== undefined) {
    return node.rawRef
  }
  const title = node.title === undefined ? '' : ` "${escapeQuoted(node.title)}"`
  return `![${escapeImageAlt(node.alt)}](${escapeDestination(node.src)}${title})${renderAttrs(node.attrs)}`
}

function renderFrontmatter(frontmatter: { format: string; content: string }): string {
  const open = frontmatter.format === 'yaml' ? '---' : `---${escapeFormat(frontmatter.format)}`
  return `${open}\n${protectVerbatim(frontmatter.content)}\n---`
}

function renderBlockComment(content: string): string {
  let longest = 0
  for (const match of content.matchAll(/%+/g)) longest = Math.max(longest, match[0].length)
  const fence = '%'.repeat(Math.max(3, longest + 1))
  return `${fence}\n${protectVerbatim(content)}\n${fence}`
}

function renderMath(display: boolean, content: string): string {
  const code = renderCode(content)
  return `${display ? '$$' : '$'}${code}`
}

// Superscript and subscript have no bare delimiter form -- always emit the
// braced `{^x^}` / `{,x,}` form.
function renderForcedEmphasis(delim: string, content: string): string {
  return `{${delim}${content}${delim}}`
}

function renderEmphasis(
  delim: string,
  content: string,
  prevChar: string,
  nextChar: string,
  closeDelim: string = delim,
): string {
  const needsForced =
    /[A-Za-z0-9_]/.test(prevChar) ||
    /[A-Za-z0-9_]/.test(nextChar) ||
    content.startsWith(delim) ||
    content.endsWith(closeDelim) ||
    content.startsWith(' ') ||
    content.endsWith(' ') ||
    content === ''
  return needsForced
    ? `{${delim}${content}${closeDelim}}`
    : `${delim}${content}${closeDelim}`
}


function renderCode(content: string): string {
  // A code span is verbatim too, so an authored U+E000 is the CHARACTER here as
  // much as it is inside a fence - and `normalize()` would otherwise rewrite it
  // to `\ `, which inside backticks is a literal backslash and a space
  // (carve-js#688). Same sentinel as protectVerbatim uses; `restoreVerbatim`
  // puts the character back at the end of normalization. carve-rs already emits
  // it as itself here.
  content = content.replace(/\ue000/g, sentinels[3])
  const fence = safeFence(content, 1)
  // Pad exactly when the parser will strip, so the strip is reversible and fmt
  // stays idempotent; the padding sits INSIDE the fence, so a trailing attribute
  // block still attaches to the closing run. The parser strips one leading and
  // one trailing space when the content BOTH begins and ends with a space but is
  // NOT entirely spaces (see stripVerbatimPadding in parse.ts), and needs a space
  // around backtick-adjacent content. All-space content must therefore NOT be
  // padded: it is emitted verbatim and read back unchanged. Padding it instead
  // grew the span by two spaces on every fmt pass.
  const needsPad =
    content.startsWith('`') ||
    content.endsWith('`') ||
    (content.startsWith(' ') && content.endsWith(' ') && content.trim() !== '')
  return needsPad ? `${fence} ${content} ${fence}` : `${fence}${content}${fence}`
}

function codeFenceInfo(lang: string | undefined, header: string | undefined, label: string | undefined): string {
  const parts: string[] = []
  if (lang) parts.push(escapeFenceToken(lang))
  // The fence header is a LITERAL quoted_title token: no escape processing
  // on parse, and it cannot contain a quote. Emit it verbatim - escaping a
  // backslash here would round-trip to a doubled backslash (issue 295).
  if (header !== undefined) parts.push(`"${header}"`)
  if (label !== undefined) parts.push(`[${escapeBracketText(label)}]`)
  return parts.length ? ` ${parts.join(' ')}` : ''
}

function safeFence(content: string, min: number): string {
  let longest = 0
  for (const match of content.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  return '`'.repeat(Math.max(min, longest + 1))
}

function renderBlockAttrs(attrs: Attrs | undefined): string {
  const rendered = renderAttrs(attrs)
  return rendered
}

function renderAttrs(attrs: Attrs | undefined): string {
  if (!attrs) return ''
  const parts: string[] = []
  const kv = attrs.keyValues ?? {}
  const idAsKey = attrs.id !== undefined && !isAttrIdentifier(attrs.id)

  const emitId = () => {
    if (attrs.id === undefined) return
    if (idAsKey) parts.push(`id=${quoteAttrValue(attrs.id)}`)
    else parts.push(`#${escapeAttrNameValue(attrs.id)}`)
  }
  const emitClasses = () => {
    for (const cls of attrs.classes ?? []) parts.push(`.${escapeAttrNameValue(cls)}`)
  }
  const emitKey = (key: string) => {
    if (kv[key] === undefined) return
    parts.push(`${escapeAttrKey(key)}=${quoteAttrValue(kv[key]!)}`)
  }

  // Honor the author's source slot order so the reparsed Attrs - and therefore
  // the rendered HTML attribute order - is byte-identical. Fall back to a fixed
  // id / class / key order only for programmatically-built Attrs (no `order`).
  if (attrs.order) {
    const seen = new Set<string>()
    for (const slot of attrs.order) {
      if (slot === '#id') emitId()
      else if (slot === '.class') emitClasses()
      else if (!seen.has(slot)) {
        emitKey(slot)
        seen.add(slot)
      }
    }
    // Any key-values not represented in `order` (defensive) keep source order.
    for (const key of Object.keys(kv)) {
      if (!seen.has(key)) emitKey(key)
    }
  } else {
    emitId()
    emitClasses()
    for (const key of Object.keys(kv)) emitKey(key)
  }

  return parts.length ? `{${parts.join(' ')}}` : ''
}

function quoteAttrValue(value: string): string {
  if (/^[^\s"'{}]+$/.test(value)) return value
  return `"${value.replace(/[\\"]/g, '\\$&')}"`
}

function alignMarker(align: TableCell['align']): string {
  switch (align) {
    case 'left':
      return '<'
    case 'right':
      return '>'
    case 'center':
      return '~'
    default:
      return ''
  }
}

/**
 * Write a line block's preserved whitespace back as ordinary spaces.
 *
 * The parser records it as the U+E000 placeholder (the same sentinel an escaped
 * space uses, so the two never collide with a literal nbsp). normalize()
 * resolves every remaining U+E000 to a real nbsp, which is right for an escaped
 * space and wrong here: the source form of a line block's layout is plain
 * spaces, and a real nbsp re-parses as literal text rather than as layout, so
 * the text node came back different (issue 359).
 *
 * Hand those runs to the verbatim scheme instead, which restores plain spaces
 * after normalize() has run.
 *
 * The runs handed over are exactly the ones the parser reproduces from plain
 * spaces: a LEADING run of any width, and a medial or trailing run of two or
 * more. A lone medial sentinel can then only have come from an escaped space,
 * so `a\ b` still round-trips as written. Two adjacent escaped spaces are the
 * one case that changes form - `a\ \ b` is written back as `a  b` - because the
 * two are the same document here: both parse to the same pair of sentinels.
 */
function lineBlockLayoutWhitespace(body: string): string {
  return body.replace(/(?:^\ue000+)|\ue000{2,}/gm, (run) => sentinels[0].repeat(run.length))
}

function normalize(text: string): string {
  // The placeholder means the author wrote an ESCAPED SPACE, so the writer says
  // that again. Resolving it to a literal non-breaking space instead lost the
  // distinction the parser draws - `10\ kg` came back carrying U+00A0, which
  // re-parses as a literal nbsp rather than as an escape, so the text node
  // differed even though the HTML did not (carve#369).
  //
  // A line block's indent is the other user of this sentinel and is already
  // routed through the verbatim scheme before this runs, so what is left here
  // is an escaped space and nothing else.
  const lines = trimNonNbspKeepingGuard(text.replace(/\ue000/g, '\\ ')).split('\n')
  const swept = lines.map((line, i) => {
    // A line whose only content is ASCII space or tab is emitted EMPTY, wherever
    // it sits (PART 11 \u00a77). Verbatim content is still sentinel-encoded here, so
    // three spaces inside a code block are out of reach and stay intact.
    if (line.length > 0 && line.replace(/[ \t]+/g, '') === '') return ''
    // Otherwise strip a line's trailing whitespace only where it CANNOT be
    // content. At the end of a block the parser drops it too, so the writer
    // must; before a SOFT BREAK the parser keeps it, and stripping it there
    // changes the rendered output - `a \nb` renders `<p>a \nb</p>`, so the
    // stripped form broke carveToHtml(fmt(x)) == carveToHtml(x). carve-rs and
    // carve-php already restricted this (carve#359, carve#375); this engine did
    // not, and no corpus case covered an ASCII trailing space before a soft
    // break, so nothing caught it.
    const next = lines[i + 1]
    const endsBlock = next === undefined || next.trim() === ''
    return endsBlock ? trimEndNonNbsp(line) : line
  })
  const cleaned = trimNonNbspKeepingGuard(swept.join('\n').replace(/\n{3,}/g, '\n\n'))
  return `${restoreVerbatim(cleaned)}\n`
}

/**
 * The three writer-only sentinels, chosen per render from code points the
 * DOCUMENT does not contain.
 *
 * They used to be the fixed U+E001..U+E003. An author who wrote one of those in
 * a code block - where arbitrary bytes are the whole point - had it silently
 * rewritten on the way out: U+E001 became a space, U+E002 a tab, U+E003 nothing
 * at all. Three of those are worse than a deletion, because a space or a tab in
 * a code block is plausible content and the diff reads as whitespace
 * (carve#678).
 *
 * Escaping the authored occurrences cannot fix it: any escape needs a reserved
 * character, and that character has the same collision. Picking characters the
 * document does not use does fix it, and cannot fail in practice - the BMP
 * private-use area alone has 6400 code points.
 *
 * U+E000 is NOT here. It is the parser's in-band marker for a non-breaking
 * space, shared with the HTML, plain, ANSI and Markdown renderers, so an
 * authored U+E000 is already indistinguishable from a parsed nbsp before the
 * writer runs. That is the other half of carve#678 and needs a decision about
 * what the parsed text of an nbsp is, not a change here.
 */
const DEFAULT_SENTINELS = ['\ue001', '\ue002', '\ue003', '\ue004'] as const
let sentinels: readonly [string, string, string, string] = [
  '\ue001',
  '\ue002',
  '\ue003',
  '\ue004',
]

/**
 * Every string in the tree, joined. ITERATIVE on purpose: `JSON.stringify` would
 * be one line, and it recurses - so on an AST deeper than the JS stack it throws
 * a RangeError before the writer can reach its own §25 depth REFUSAL, which is
 * a documented behaviour with tests on it. An explicit stack has no such limit.
 */
function collectStrings(root: unknown): string {
  const parts: string[] = []
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (typeof node === 'string') {
      parts.push(node)
      continue
    }
    if (node === null || typeof node !== 'object') continue
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item)
      continue
    }
    for (const value of Object.values(node)) stack.push(value)
  }

  return parts.join('\u0000')
}

function pickSentinels(text: string): readonly [string, string, string, string] {
  // The common case: none of the defaults occur, so keep them and skip the scan
  // of the private-use area entirely.
  if (!DEFAULT_SENTINELS.some((c) => text.includes(c))) {
    return ['\ue001', '\ue002', '\ue003', '\ue004']
  }
  for (let base = 0xe005; base <= 0xf8fc; base += 4) {
    const quad = [
      String.fromCharCode(base),
      String.fromCharCode(base + 1),
      String.fromCharCode(base + 2),
      String.fromCharCode(base + 3),
    ] as const
    if (!quad.some((c) => text.includes(c))) return quad
  }

  // Unreachable for any real document; keep the old behaviour rather than throw.
  return ['\ue001', '\ue002', '\ue003', '\ue004']
}

/**
 * Whole-document normalization (trailing-whitespace strip, blank-line
 * collapsing) must not reach inside verbatim content - code blocks, raw
 * blocks, frontmatter, and block comments reproduce their content
 * byte-exact (issue 340). Sentinel-encode the vulnerable bytes before the
 * content joins the document string; normalize() restores them at the end.
 * U+E000 is already the NBSP sentinel; U+E001..U+E003 extend the scheme.
 */
function protectVerbatim(content: string): string {
  const [sp, tab, blank, nbsp] = sentinels

  return content
    // An authored U+E000 inside verbatim content is the CHARACTER, not an
    // escape. `normalize()` rewrites every U+E000 to `\ `, which is right
    // outside verbatim and wrong inside it - escapes do not resolve in a code
    // block, so `\ ` there is a literal backslash and a space and
    // toHtml(fmt(x)) != toHtml(x) (carve-js#688). Carrying it through
    // normalization under its own sentinel keeps it out of that rewrite;
    // `restoreVerbatim` puts the character back. carve-rs already emits it as
    // itself.
    .replace(/\ue000/g, nbsp)
    .replace(/[ \t]+(?=\n|$)/g, (run) => run.replace(/ /g, sp).replace(/\t/g, tab))
    .split('\n')
    .map((line) => (line === '' ? blank : line))
    .join('\n')
}

function restoreVerbatim(text: string): string {
  return (
    text
      // A blank line inside verbatim content is carried as U+E003 so trimming
      // cannot eat it - which also makes it NON-EMPTY while a host indents its
      // lines, so a list item turned it into a line of nothing but spaces. The
      // host's indent goes with the sentinel: the line was blank in the source
      // and stays blank, and the reader strips those columns back off anyway.
      .replace(new RegExp(`^[ \\t]+${sentinels[2]}$`, 'gm'), '')
      .replace(new RegExp(sentinels[0], 'g'), ' ')
      .replace(new RegExp(sentinels[1], 'g'), '\t')
      .replace(new RegExp(sentinels[2], 'g'), '')
      // Back to the character itself - see protectVerbatim.
      .replace(new RegExp(sentinels[3], 'g'), '\ue000')
  )
}

function trimNonNbsp(text: string): string {
  return trimEndNonNbsp(trimStartNonNbsp(text))
}

/**
 * `trimNonNbsp`, except it keeps leading whitespace that is load-bearing.
 *
 * `guardThematicBreakLines` re-indents a paragraph line that would otherwise
 * re-parse as a thematic break. That space is the whole protection, and
 * `normalize` trims BOTH its input and its joined output - so on the document's
 * FIRST line, the only line either trim can reach, the guard was undone and the
 * marker landed back at column 0. The next parse then read `<hr>` where the
 * source had a paragraph, breaking `to_html(fmt(x)) == to_html(x)` and
 * `fmt(fmt(x)) == fmt(x)` together (carve-js#566).
 *
 * A REAL thematic break is unaffected: the writer emits it at column 0 with no
 * guard space, so there is nothing here to preserve.
 */
function trimNonNbspKeepingGuard(text: string): string {
  if (/^[^\S\u00a0]+-{3,}[ \t]*(\n|$)/.test(text)) {
    return trimEndNonNbsp(text)
  }
  return trimNonNbsp(text)
}

function cleanEscapedText(node: Text): string {
  return node.value
}

  // `,` needs no escape: there is no bare subscript delimiter, and the braced
  // `{,` opener is neutralized by the `{` escape. `^` stays escaped for the
  // inline-footnote (`^[`) and caption (line-leading `^`) channels.
// PART 11 section 5. The UNCONDITIONAL set is escaped in every mode: a
// backslash and a backtick are never re-derivable, and a bare quote
// re-derives as smart punctuation (PART 9 section 8), so a quote that reached
// the writer as TEXT is one the author escaped and stays escaped. The
// CANDIDATE set is every other character the grammar can read as an opener,
// escaped only when the minimal form fails to round-trip.
// The caret is a CANDIDATE, not unconditional. It opens nothing on its own,
// and section 2's test is whether omitting the escape changes the RE-PARSED
// AST: `}^p` re-parses identically bare, so nothing there needs escaping, and
// writing it with two backslashes was over-escaping by two characters
// (carve#581).
//
// It used to be unconditional because a text node whose LEADING caret came
// from an escape is flagged (`escapedLeadingCaret`), so an image followed by a
// caret line is not promoted to a figure - and comparing that flag escalated
// any document whose text starts with a caret. The flag is now dropped from
// the comparison instead (see `canonical`): where the escape actually matters,
// the two renders differ by a FIGURE node rather than by a boolean, and that
// difference the comparison already sees.
const UNCONDITIONAL_ESCAPES = /[\\`"']/g
const CANDIDATE_ESCAPES = /[\\`*_{}\[\]()#+\-.!~^/<>@%|=;"']/g
// A colon is a candidate only where it can OPEN something: at the start of a
// line, which is where `:: term`, `:  def` and a `:::` fence live. Mid-line it
// is ordinary punctuation and escaping it is exactly the over-escaping PART 11
// section 4 forbids - `\\^ Figure 1: moon` came out `\\^ Figure 1\\: moon`, where the
// caret on that line is ALREADY escaped, so the line is a paragraph and nothing
// downstream reads the colon (carve-js#614).
//
// Kept in the CONSERVATIVE form only, like every other candidate: the
// round-trip check decides whether it is needed. Dropping it outright breaks
// seven corpus round-trips whose text runs hold a line-initial `::`/`:::`.
const LINE_INITIAL_COLON = /(^|\\n)(:+)/g

// Which set the writer is escaping right now. renderCarve renders the document
// minimally, checks that it re-parses to the same AST, and re-renders
// conservatively only when it does not (PART 11 section 4).
let escapeMode: 'minimal' | 'conservative' = 'conservative'

/**
 * Headings whose published id is the one a fresh parse would assign anyway.
 *
 * PART 12 §5 publishes a heading's slugged id, and PART 11 §1 writes the
 * document back - so the writer must not turn the first into source. An
 * AUTHORED id carries an `#id` slot and is written; a GENERATED one carries
 * none and is dropped, EXCEPT where dropping it would change the document: an
 * ingested tree whose heading text was edited carries an id the text no longer
 * slugs to, and there the id is the only place that information lives.
 *
 * "What a fresh parse would assign" is computed with the parser's own pass over
 * a copy with the ids removed, rather than a second dedup implementation here
 * that could drift from it (carve-js#741).
 */
let redundantIds = new WeakSet<object>()

/**
 * Protect a paragraph line that would re-parse as a thematic break.
 *
 * Source indentation is not in the AST, so an indented `---` - a paragraph
 * holding an em dash - is emitted at column 0, where it stops being a paragraph
 * and becomes a thematic break.
 *
 * Text nodes are already covered: the conservative form escapes the hyphens, so
 * the round-trip check sees the difference and picks that form. A
 * `smart_punctuation` run is not, because its source run is emitted verbatim in
 * BOTH forms - that is the point of the node - so the check never sees a
 * difference to act on. Escaping the run in the conservative form does not work
 * either: it would make that form change the document, and the check would then
 * never be able to prefer the minimal one.
 *
 * So the guard sits on the rendered line instead, where it does not care which
 * node produced the hyphens.
 */
function guardThematicBreakLines(body: string): string {
  if (!body.includes('-')) return body
  return body
    .split('\n')
    .map((line) => (/^-{3,}[ \t]*$/.test(line) ? ` ${line}` : line))
    .join('\n')
}

function escapeText(text: string): string {
  const escapes = escapeMode === 'minimal' ? UNCONDITIONAL_ESCAPES : CANDIDATE_ESCAPES
  const out = text
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .replace(escapes, '\\$&')
  if (escapeMode === 'minimal') return out
  // Escape a colon RUN that begins a line (see LINE_INITIAL_COLON). Run, not
  // single character: `:::` needs only its first colon neutralized to stop
  // being a fence, and escaping each one would be the same over-escaping in a
  // different place.
  return out.replace(LINE_INITIAL_COLON, (_m, lead: string, colons: string) => `${lead}\\${colons}`)
}

function escapePlainLine(text: string): string {
  return text.replace(/\n/g, ' ')
}

function escapeImageAlt(text: string): string {
  return text.replace(/[\\[\]]/g, '\\$&')
}

/**
 * Backslash-escape exactly the characters the destination scan would otherwise
 * read differently: a parenthesis with no partner, and a backslash sitting in
 * front of one of the three escapable characters. Balanced parentheses are
 * left alone -- they re-parse as themselves, and escaping them would be churn
 * against the minimal-escaping rule in PART 11 section 4.
 */
function escapeDestinationEscapes(text: string): string {
  const openers: number[] = []
  const unbalanced = new Set<number>()
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') openers.push(i)
    else if (text[i] === ')') {
      if (openers.length > 0) openers.pop()
      else unbalanced.add(i)
    }
  }
  for (const i of openers) unbalanced.add(i)
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    const escapable = ch === '\\' && (text[i + 1] === '(' || text[i + 1] === ')' || text[i + 1] === '\\')
    out += unbalanced.has(i) || escapable ? `\\${ch}` : ch
  }
  return out
}

function escapeDestination(text: string): string {
  const scheme = /^[\u0000-\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(text)?.[1]?.toLowerCase()
  const sanitizeBlank = scheme !== undefined && ['javascript', 'vbscript', 'data', 'file'].includes(scheme)
  // Whitespace is percent-encoded (it would otherwise end the destination).
  // A parenthesis only needs escaping when it is unbalanced, because a
  // balanced pair survives the scan as-is -- and leaving it bare is what keeps
  // the common case (`.../Foo_(bar)`) readable. A backslash is escaped only
  // in front of the three characters the destination scan treats as escapes,
  // so backslashes elsewhere in a URL are emitted verbatim.
  const escaped = escapeDestinationEscapes(text)
  return escaped
    .replace(/\s/g, (ch) => (ch === ' ' ? '%20' : `%${ch.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`))
    .replace(/\\?[()]/g, (m) => (sanitizeBlank ? (m.endsWith('(') ? '%28' : '%29') : m))
}

function escapeQuoted(text: string): string {
  return text.replace(/[\\"]/g, '\\$&')
}

function escapeBracketText(text: string): string {
  return text.replace(/[\\\]]/g, '\\$&')
}

function escapeFootnoteLabel(text: string): string {
  return text.replace(/[\\\]]/g, '\\$&')
}

function escapeAbbr(text: string): string {
  return text.replace(/[\\\]]/g, '\\$&')
}

function escapeIdentifier(text: string): string {
  return text.replace(/[^\w-]/g, '')
}

// A symbol name may contain `+` and `-` (so `:+1:` / `:-1:` round-trip),
// unlike an extension identifier.
function escapeSymbolName(text: string): string {
  return text.replace(/[^\w+-]/g, '')
}

function escapeName(text: string): string {
  return text.replace(/[^\w.-]/g, '').replace(/^\.+|\.+$/g, '')
}

function escapeFormat(text: string): string {
  const safe = text.replace(/[^\w-]/g, '')
  return safe || 'text'
}

function escapeFenceToken(text: string): string {
  return text.split(/\s/)[0]!.replace(/`/g, '')
}

function escapeAttrKey(text: string): string {
  const safe = text.replace(/^[^a-zA-Z_]+|[^\w-]/g, '')
  return safe || 'x'
}

function escapeAttrNameValue(text: string): string {
  return text.replace(/[^\w-]/g, '-')
}

function isAttrIdentifier(text: string): boolean {
  return /^[A-Za-z_][\w-]*$/.test(text)
}

function escapeAutolinkHref(text: string): string {
  return text.replace(/[\\<>]/g, '\\$&')
}

function escapeCrossrefTarget(text: string): string {
  return text.replace(/[\\>]/g, '\\$&')
}

function escapeCriticText(text: string): string {
  return text.replace(/[\\{}]/g, '\\$&')
}

function firstBoundary(node: InlineNode | undefined): string {
  if (!node) return ''
  switch (node.type) {
    case 'text':
      return node.value[0] ?? ''
    // The CHARACTER, not the backslash that precedes it in the output. A text
    // node holding `_b_` and an escaped-text node holding `_` describe the same
    // neighbour, and the writer has to brace an adjacent delimiter the same way
    // for both - otherwise the first pass (text) and the second (escaped text)
    // disagree and `fmt(fmt(x)) != fmt(x)`.
    case 'escaped_text':
      return node.value
    case 'soft_break':
    case 'hard_break':
      return '\n'
    case 'code':
      return node.value[0] ?? ''
    case 'mention':
      return '@'
    case 'tag':
      return '#'
    default:
      return ''
  }
}

function lastBoundary(node: InlineNode | undefined): string {
  if (!node) return ''
  switch (node.type) {
    case 'text':
      return node.value[node.value.length - 1] ?? ''
    case 'escaped_text':
      return node.value
    case 'soft_break':
    case 'hard_break':
      return '\n'
    case 'code':
      return node.value[node.value.length - 1] ?? ''
    case 'mention':
      return node.user[node.user.length - 1] ?? ''
    case 'tag':
      return node.name[node.name.length - 1] ?? ''
    default:
      return ''
  }
}
