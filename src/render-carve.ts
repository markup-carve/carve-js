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
import { opensFrontmatter, parse, rawBracketRunCloses } from './parse.js'
import { MAX_RENDER_DEPTH, RenderDepthError } from './render-depth.js'

export { MAX_RENDER_DEPTH }
import { normalizeLegacyInline } from './legacy-nodes.js'
import { resolveHeadingIds } from './heading-ids.js'
import { ownValue } from './own-property.js'
import { thematicBreakSpelling } from './thematic-break-marker.js'
import { SourceUnspellableError } from './source-unspellable-error.js'

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
// SPACE, TAB, and the two line terminators - and NOTHING ELSE.
//
// It was `\s` minus NBSP and minus U+FEFF, and each of those two exceptions was
// added the same way: a character that every engine renders as ordinary content
// was being trimmed out of the written form, so `to_html(fmt(x)) == to_html(x)`
// went false for a document containing it (carve#844 for U+FEFF). The list was
// one character long, then two, and the general rule was already written down -
// `whitespace` in this language is SPACE or TAB (PART 1, carve#890), and
// U+000B, U+000C, U+0085 and every Unicode space are CONTENT. Enumerating the
// exceptions to `\s` was chasing the complement of that rule one character at a
// time; three more were waiting in the corpus that carve#924 added.
//
// The two LINE TERMINATORS stay trimmable because this trim is also what strips
// the padding off a rendered SUBTREE, where a leading or trailing newline is
// the writer's own layout and not anything the author wrote.
//
// NO LONGER in step with `isTrimmable` in src/trim-non-nbsp.ts, which answers
// the same question for the markdown, plain-text and ANSI targets and still
// takes the whole Unicode class. That is deliberate and is the reason this is
// spelled out rather than shared: those three targets are LOSSY by design and
// carry no round-trip invariant, and their output is pinned byte-for-byte
// against carve-php and carve-rs, so narrowing them here would break parity
// for a rule no ruling has extended to them. The Carve writer is the only one
// of the four that has to reproduce its input.
function isWsNonNbsp(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
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
  /** Whether the previous sibling block can host a caption. */
  afterCaptionHost: boolean
  /** Caption state scoped to the paragraph currently being rendered. */
  paragraphStartsAfterCaptionHost: boolean
}

/**
 * Render canonical Carve source.
 *
 * @throws {SourceUnspellableError} when no source can reproduce an AST node.
 */
export function renderCarve(ast: Document, _opts: CarveRenderOptions = {}): string {
  // PART 11 section 4: emit the minimal-escape form when dropping the candidate
  // escapes changes nothing, and fall back to the conservative form when it
  // does. The check is the parser's, not a table's, so the writer cannot drift
  // as the grammar grows.
  // Choose the verbatim sentinels before anything is rendered, so both escape
  // passes below agree on them.
  sentinels = pickSentinels(collectStrings(ast))
  redundantIds = findRedundantHeadingIds(ast)
  // The two "written in place" sets are NOT reset here: they are per-PASS, and
  // renderWithEscapes owns them. Resetting them here as well would be the same
  // rule in two places, and the pass-scoped one is the one that has to hold.
  definitionsByLine = new Map()
  for (const child of ast.children) {
    if (child.type !== 'link_reference_definition') continue
    const line = child.pos?.startLine
    // First writer wins for a line, which cannot normally collide: two
    // definitions on one line is not a shape the parser produces.
    if (line !== undefined && !definitionsByLine.has(line)) definitionsByLine.set(line, child)
  }
  footnoteDefsByLine = new Map()
  documentFootnoteDefs = ast.footnoteDefs
  for (const [label, pos] of Object.entries(ast.footnoteDefPos ?? {})) {
    const line = pos?.startLine
    if (line !== undefined && !footnoteDefsByLine.has(line)) footnoteDefsByLine.set(line, label)
  }
  // The two escape passes each render the WHOLE tree, and the write-back sets
  // below record what a pass has already emitted - so they have to start empty
  // for each one. Shared across both, the first pass consumed every in-place
  // definition and the second omitted them, and which output was returned then
  // decided whether the document kept its definitions (carve-js#754).
  const minimal = withFreshWriteBackState(() => renderWithEscapes(ast, 'minimal'))
  const conservative = withFreshWriteBackState(() => renderWithEscapes(ast, 'conservative'))
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

/**
 * The spelling a `thematic_break` is written with.
 *
 * The document-wide fallback spelling for a break that would otherwise open
 * manufactured frontmatter. PART 11 section 1 requires
 * `to_html(fmt(x)) == to_html(x)`.
 */
let thematicBreakMarker: string | null = null

/**
 * Render, and fall back to a break spelling that cannot be read as frontmatter
 * when the finished bytes would be.
 *
 * THE WRITER MANUFACTURED FRONTMATTER. A frontmatter block is an opening fence
 * at byte 0 plus a bare `---` CLOSER anywhere below it, so the collision is a
 * property of the whole emitted document rather than of its first line. Two
 * unrelated writer decisions reach it:
 *
 * - an authored `---` break can open the document and gain a closer from any
 *   later break (markup-carve/carve-js#899).
 * - a hoisted link or footnote definition is written after the body, promoting
 *   whatever stood second to byte 0 (markup-carve/carve-js#901). Nothing is
 *   respelled there - the `---` was already in the source - so fixing the first
 *   cause does not fix this one.
 *
 * And a THIRD shape neither ticket names falls out of the same check: a hoisted
 * definition can promote a PARAGRAPH whose first line is `---yaml`-shaped, which
 * no head-of-document respelling can repair, because the paragraph's text is not
 * the writer's to change. That document is saved by respelling the CLOSER
 * instead - which is why the fallback moves every break in the document rather
 * than the one at the head.
 *
 * So the FINISHED bytes are handed to the PARSER'S own opener test, twice: once
 * to ask whether the default spelling is misread, and once to confirm the
 * fallback is not. A document that is still misread with `***` - a `---` closer
 * that came from somewhere other than a break, such as the inside of a fenced
 * block - keeps the canonical spelling rather than paying a respelling that buys
 * nothing.
 *
 * A leading break with nothing below it to close a block keeps `---`, which is
 * what corpus `132-thematic-break-requires-contiguous-markers-4` asks for and
 * what carve-php and carve-rs write. It is a CONTROL here: no mutation of this
 * fallback changes it.
 */
function renderWithEscapes(ast: Document, mode: 'minimal' | 'conservative'): string {
  const canonicalForm = renderOnePass(ast, mode)
  // The `ast.frontmatter` arm is a COST GATE, not a correctness one, and saying
  // so is the honest reading: a document that really carries frontmatter has it
  // written by `renderFrontmatter`, whose closer is not a break, so the fallback
  // pass would open frontmatter too and the canonical form would be returned
  // anyway. Removing the arm changes no output, only the number of renders paid
  // by every document with frontmatter. Verified by mutation.
  if (ast.frontmatter || !opensFrontmatter(canonicalForm)) return canonicalForm
  const previousMarker = thematicBreakMarker
  thematicBreakMarker = '***'
  try {
    const fallback = renderOnePass(ast, mode)
    return opensFrontmatter(fallback) ? canonicalForm : fallback
  } finally {
    thematicBreakMarker = previousMarker
  }
}

function renderOnePass(ast: Document, mode: 'minimal' | 'conservative'): string {
  const previous = escapeMode
  escapeMode = mode
  // "Already written on a description line" is true of THIS PASS, not of the
  // document. renderCarve runs this function twice and picks between the two
  // forms (PART 11 §4), so a set that survives the first pass tells the second
  // one that every definition is already placed: the description emits a bare
  // `:` and the document-level arm - which returns '' for a marked node - emits
  // nothing either, deleting the definition outright. Whenever the conservative
  // form then wins, `to_html(fmt(x)) == to_html(x)` fails by turning a resolved
  // reference back into literal text (markup-carve/carve#805).
  definitionsWrittenInPlace = new WeakSet()
  footnotesWrittenInPlace = new Set()
  try {
    const ctx: CarveContext = {
      blockDepth: 0,
      inlineDepth: 0,
      listDepth: 0,
      lineBlockDepth: 0,
      colonFenceDepth: 0,
      afterCaptionHost: false,
      paragraphStartsAfterCaptionHost: false,
    }
    const parts: string[] = []
    if (ast.frontmatter) parts.push(renderFrontmatter(ast.frontmatter))
    const body = renderDocumentBody(ast, ctx)
    if (body) parts.push(body)
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
 *
 * `definitionSpans` is the SECOND one, and it arrived the same way: a positions
 * array on a definition-list entry, added for markup-carve/carve-js#813 so an
 * emptied description could still be placed. Escaping a character in ANY
 * description shifts every offset after it, so with the key compared, every
 * document carrying a definition list escalated to conservative escaping and two
 * corpus round-trips came back with escapes the formatter would not have written.
 *
 * `termSpans` is the THIRD, sitting on the same entry as `definitionSpans` and
 * missed when that one was added. It hid behind the fast path above this
 * comparison: a document that was PARSED re-parses to the tree it came from, so
 * the minimal form wins before the comparison runs, and only a tree BUILT
 * without positions - what the HTML importer and `--from-json` hand the writer -
 * reaches it. Such a document escalated whenever an escape candidate stood
 * anywhere before its last term, which is why `<dl><dt>A<dd>x language.<dt>B`
 * came out of the importer as `x language\.`.
 *
 * The rule, since this is now three times: a NAME-based skip is the whole hazard
 * here. Any field holding offsets belongs on this list whatever it is called,
 * and the test that catches a missing one is the corpus round-trip, not this
 * comment.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return mergeTextRuns(value).map(canonical)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (
        key === 'pos' ||
        key === 'footnoteDefPos' ||
        key === 'definitionSpans' ||
        key === 'termSpans' ||
        key === 'srcByteLength'
      )
        continue
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

/** Every non-blank line of `text`, prefixed with `columns` spaces. */
function indentLines(text: string, columns: number): string {
  const pad = ' '.repeat(columns)
  return text
    .split('\n')
    .map((line) => (line === '' ? line : pad + line))
    .join('\n')
}

/**
 * Whether two adjacent sibling lists would read back as ONE list.
 *
 * The axes are §11 N1's: a list kind, and for each kind the marker character
 * the author chose plus the plain-vs-task classification. When any of them
 * differs the lists already separate on their own and the writer owes them
 * nothing - which is what carve#286 established.
 */
function listsWouldMerge(a: List, b: List): boolean {
  if (a.ordered !== b.ordered) return false
  if (isTaskList(a) !== isTaskList(b)) return false
  if (a.ordered) return (a.delim ?? '.') === (b.delim ?? '.') && a.olType === b.olType
  return (a.bulletChar ?? '-') === (b.bulletChar ?? '-')
}

function isTaskList(list: List): boolean {
  return list.items.some((item) => item.checked !== undefined)
}

function renderBlocks(blocks: BlockNode[], ctx: CarveContext): string {
  if (ctx.blockDepth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderCarve', MAX_RENDER_DEPTH)
  ctx.blockDepth++
  const previousHost = ctx.afterCaptionHost
  const previousParagraphStart = ctx.paragraphStartsAfterCaptionHost
  ctx.afterCaptionHost = false
  try {
    const parts: string[] = []
    // TWO ADJACENT SIBLING LISTS NEED SOMETHING BETWEEN THEM. Written at the
    // same column with matching markers they merge on re-parse, so
    // `parse(fmt(x)) == parse(x)` is false for a document the parser reads as
    // two lists (carve#1088). carve#286 spent the marker axis - "emit the
    // marker as authored" - which separates them only while the markers differ;
    // when both are `1.` at column 0 there is nothing left to preserve.
    //
    // ONE SPACE, CUMULATIVE, RELATIVE TO THE LIST BEFORE IT. One space is the
    // only offset safe for both kinds: a bullet's content column is 2, so two
    // spaces already NEST the second list inside the first. And the step is per
    // list rather than per run - writing every later list at +1 leaves the
    // second and third at the same column, where they merge with each other.
    let previousList: List | null = null
    let listOffset = 0
    let previousBlock: BlockNode | null = null
    for (const block of blocks) {
      ctx.paragraphStartsAfterCaptionHost = ctx.afterCaptionHost
      const rendered = renderBlock(block, ctx)
      ctx.afterCaptionHost = hostsCaption(block)
      if (block.type === 'list') {
        listOffset = previousList !== null && listsWouldMerge(previousList, block) ? listOffset + 1 : 0
        previousList = block
      } else if (rendered.length > 0) {
        previousList = null
        listOffset = 0
      }
      if (rendered.length > 0) {
        const text = listOffset > 0 ? indentLines(rendered, listOffset) : rendered
        // A RUN OF BIBLIOGRAPHY LINES STAYS A RUN. Consecutive `[@key]: entry`
        // lines are one paragraph in the source and N nodes in the tree since
        // PART 12 §18, so the default block separator would open a blank line
        // between lines the author wrote adjacent - and PART 11 §6 binds the
        // writer to the author's layout. Adjacency is read from `pos`, so a
        // blank line the author DID write survives, and a tree with no
        // positions falls back to the separator every other block gets.
        if (previousBlock !== null && parts.length > 0 && writtenAsOneRun(previousBlock, block)) {
          parts[parts.length - 1] += `\n${text}`
        } else {
          parts.push(text)
        }
        previousBlock = block
      }
    }
    return parts.join('\n\n')
  } finally {
    ctx.afterCaptionHost = previousHost
    ctx.paragraphStartsAfterCaptionHost = previousParagraphStart
    ctx.blockDepth--
  }
}

/** Whether two adjacent blocks were written on consecutive source lines, with
 *  no blank line between them - true only for the bibliography definition,
 *  whose line-per-node shape is the one the parser splits out of a paragraph. */
function writtenAsOneRun(previous: BlockNode, block: BlockNode): boolean {
  if (previous.type !== 'citation_definition' || block.type !== 'citation_definition') return false
  const before = previous.pos
  const after = block.pos
  if (!before || !after) return false
  return after.startLine === before.endLine + 1
}

function hostsCaption(block: BlockNode): boolean {
  // A figure group's CLOSING fence hosts a caption (PART 9 §4c), so a literal
  // `^ …` paragraph written after one must have its caret escaped or it would
  // re-attach as the group caption on the way back (the F6 detached shape).
  if (
    block.type === 'table' ||
    block.type === 'code_block' ||
    block.type === 'block_quote' ||
    block.type === 'image' ||
    block.type === 'figure_group'
  )
    return true
  if (block.type !== 'paragraph' || block.children.length !== 1) return false
  const child = block.children[0]
  return child?.type === 'image' || (child?.type === 'math' && child.display)
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
    case 'paragraph': {
      const text = guardThematicBreakLines(
        renderInlines(
          node.children,
          ctx,
          attrs === '' && ctx.paragraphStartsAfterCaptionHost,
          ctx.lineBlockDepth > 0,
        ),
      )
      // AN EMPTY LINE INSIDE A STANZA IS SPELLED `%%`, and nothing else spells
      // it (PART 9 §23). A blank line ENDS a stanza, so writing one here would
      // return one stanza as two; a comment-only line is the one construct that
      // leaves an empty verse line instead of rewriting it, and the block layer
      // removes it before the inline run exists - so `%%` re-reads to exactly
      // the empty line it was written for.
      //
      // It reaches here from a verbatim run that swallowed such a line: the run
      // keeps the emptied line as a NEWLINE in its value, and that newline has
      // to come back out as an empty line. §7c already spells the OTHER source
      // of one, the empty-content `hard_break`, with a backslash, so no line
      // arriving here is a break.
      //
      // A line block's children are its stanzas, so the guard is the whole
      // scope: every empty line in this string is interior to one stanza.
      //
      // The lookahead is what keeps the LAST newline out of it. §7c writes the
      // trailing `hard_break` of a last body line as `\` plus the newline it
      // consumes, so the stanza ends in one - and the position after it is the
      // closing fence, not an empty verse line.
      if (ctx.lineBlockDepth > 0) {
        return withAttrs(text.replace(/^$(?=\n)/gm, '%%'))
      }

      return withAttrs(text)
    }
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
      return withAttrs(thematicBreakSpelling(node.marker, thematicBreakMarker))
    case 'table':
      return renderTableWithColumns(node, ctx)
    case 'admonition': {
      // The quoted title is re-parsed as a quoted_title token (which admits
      // no escapes and cannot contain a quote), so the inline serialization
      // must be emitted verbatim: wrapping it in escapeQuoted doubles the
      // backslashes renderInlines already produced and compounds on every
      // fmt pass (issue 295).
      const title = node.title !== undefined ? ` "${renderInlines(node.title, ctx)}"` : ''
      const label = node.label !== undefined ? ` [${writeFlatBracketRun(node.label)}]` : ''
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
      // A BODY THAT ALREADY ENDS ITS LINE DOES NOT GET A SECOND NEWLINE. The
      // last body line can end in a `hard_break`, which under §7c is written
      // `\` plus the newline it consumes (PART 3); adding the closer's newline
      // on top of that leaves a BLANK line before the fence, which ends the
      // stanza and takes the trailing `<br>` - and the space it was holding -
      // with it (markup-carve/carve#1334).
      const layout = lineBlockLayoutWhitespace(body)
      return withAttrs(fence + ' |\n' + layout + (layout.endsWith('\n') ? '' : '\n') + fence)
    }
    case 'div': {
      // Divs render generically (`::: {.class}`), never the `::: \` hardbreaks
      // sugar: that sugar forces hard breaks, but a plain div carrying a
      // `.hardbreaks` class keeps soft breaks. The two are indistinguishable by
      // attrs - only the child break nodes differ - so we let those break nodes
      // serialize themselves, which round-trips both. (A line block is its own
      // node type and is handled above.)
      const label = node.label !== undefined ? ` [${writeFlatBracketRun(node.label)}]` : ''
      const fence = colonFenceFor(ctx)
      const body = renderColonFenceBody(node.children, ctx)
      return withAttrs(`${fence}${label}\n${body}\n${fence}`)
    }
    case 'definition_list':
      return withAttrs(renderDefinitionList(node.items, ctx))
    case 'figure':
      return withAttrs(renderFigure(node, ctx))
    case 'figure_group': {
      // The canonical spelling is the authored form (PART 9 §4c): a bare
      // `::: figure` fence, the children as an ordinary fence body, and the
      // group caption as a `^ ` line after the CLOSING fence - unescaped,
      // because the writer knows the closer hosts it. The `#` placeholder is
      // written back by the caption_number arm like every numbered caption.
      const fence = colonFenceFor(ctx)
      const body = renderColonFenceBody(node.children, ctx)
      const caption = node.caption !== undefined ? `\n^ ${renderInlines(node.caption, ctx)}` : ''
      return withAttrs(`${fence} figure\n${body}\n${fence}${caption}`)
    }
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
      //
      // Unless a definition list already wrote it on its own description line,
      // where the author put it - writing it twice would define it twice.
      if (definitionsWrittenInPlace.has(node as unknown as object)) return ''
      const title = node.title === undefined ? '' : ` "${escapeQuoted(node.title)}"`
      const attrs = renderAttrs(node.attrs)
      return `[${node.label}]: ${node.href}${title}${attrs === '' ? '' : ` ${attrs}`}`
    }
    case 'citation_definition': {
      // PART 12 §18 gave the bibliography line a node for the same reason §10
      // gave one to the reference definition: so the writer can put the line
      // back. The metadata block leads the entry, where the author wrote it.
      const metadata = renderCitationMetadata(node.attrs)
      const entry = renderInlines(node.children, ctx)
      const tail = [metadata, entry].filter((part) => part !== '').join(' ')
      return `[@${node.key}]:${tail === '' ? '' : ` ${tail}`}`
    }
    case 'comment':
      return node.block
        ? renderBlockComment(node.content)
        : node.delimited
          ? `{% ${node.content} %}`
          : `%% ${node.content}`
    default: {
      const t: never = node
      throw new Error(`renderCarve: unknown block ${(t as { type: string }).type}`)
    }
  }
}

function renderTableWithColumns(node: Table, ctx: CarveContext): string {
  if (!node.columns?.length) {
    const attrs = renderBlockAttrs(node.attrs)
    const body = renderTable(node, ctx)
    return attrs ? `${attrs}\n${body}` : body
  }
  const keyValues = { ...(node.attrs?.keyValues ?? {}) }
  const join = (field: 'align' | 'valign', key: string) => {
    if (keyValues[key] === undefined && node.columns!.some((column) => column[field] !== undefined)) {
      keyValues[key] = node.columns!.map((column) => column[field] ?? '').join(',')
    }
  }
  join('align', 'aligns')
  join('valign', 'valigns')
  if (keyValues.widths === undefined && node.columns.some((column) => column.width !== undefined)) {
    keyValues.widths = node.columns.map((column) => column.width === undefined ? '' : String(column.width * 100)).join(',')
  }
  const attrs = renderBlockAttrs({ ...(node.attrs ?? {}), keyValues })
  return `${attrs}\n${renderTable(node, ctx)}`
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
      for (const line of lines) {
        if (line.startsWith(MARKER_COLUMN)) {
          // The continuation marker and the block it attaches sit at the ITEM's
          // marker column, not at its content column: §17 L3 puts the marker at
          // "the current container's MARKER COLUMN" and attaches the following
          // block "with no marker prefix or indentation". Indenting either into
          // the item is what made the attached paragraph fold (carve#861).
          out += `${indent}${line.slice(MARKER_COLUMN.length)}\n`
          continue
        }
        out += line ? `${indent}${continuation}${line}\n` : '\n'
      }
      if (!node.tight && idx < node.items.length - 1) out += '\n'
    })
    return trimEndNonNbsp(out)
  } finally {
    ctx.listDepth--
  }
}

/**
 * A hoisted definition that sat BETWEEN two of a container's blocks, written
 * back into the gap it came from.
 *
 * A definition collected out of a list item renders nothing, but it still
 * SEPARATES the blocks around it: `- a` / `  [^f]: x` / `  more` is an item
 * holding two paragraphs, and writing the definition at document level instead
 * leaves `- a` / `  more`, which re-reads as one paragraph with a soft break.
 * The document changes, not just its spelling (carve-js#754, corpus 228).
 *
 * The gap is derivable from the blocks' own positions: a definition whose line
 * falls after one block ends and before the next begins was written there. This
 * is the same repair markup-carve/carve#805 needed for a definition-list
 * description, stated for any pair of siblings rather than for one container.
 */
/** Run one render pass with the in-place write-back bookkeeping reset. */
function withFreshWriteBackState<T>(render: () => T): T {
  definitionsWrittenInPlace = new WeakSet()
  footnotesWrittenInPlace = new Set()
  return render()
}

function definitionInGap(
  before: BlockNode,
  after: BlockNode,
  ctx: CarveContext,
): string | undefined {
  const from = before.pos?.endLine
  const to = after.pos?.startLine
  if (from === undefined || to === undefined) return undefined
  for (const [line, node] of definitionsByLine) {
    if (line > from && line < to && !definitionsWrittenInPlace.has(node as unknown as object)) {
      const written = renderBlock(node, ctx)
      definitionsWrittenInPlace.add(node as unknown as object)
      return written
    }
  }
  // A footnote definition lives in a root map rather than in `children`, so it
  // is tracked by label - the same split the description write-back has.
  for (const [line, label] of footnoteDefsByLine) {
    if (line > from && line < to && !footnotesWrittenInPlace.has(label)) {
      const blocks = ownValue(documentFootnoteDefs, label)
      if (blocks === undefined) continue
      const written = renderOneFootnoteDef(label, blocks, ctx)
      footnotesWrittenInPlace.add(label)
      return written
    }
  }
  return undefined
}

/**
 * Mark every line of `text` to be written at the ITEM's marker column.
 *
 * The list writer prefixes an item's continuation lines with its content
 * column. A `+` continuation marker and the block it attaches are the two
 * things that must NOT get that prefix (§17 L3), and they are produced deep
 * inside the item body where the prefix is not yet known - so they are tagged
 * here and the prefix loop honours the tag.
 */
/**
 * Block kinds whose canonical source is a bare inline run on its own line, so
 * at a container's content column they continue an open paragraph instead of
 * opening a block of their own.
 *
 * Derived by sweeping twenty block constructs rather than by reasoning about
 * them: a `figure` is an image line plus a caption line and an `image` is the
 * image line alone, which is why both read as paragraph text one column in.
 */
const FOLDS_INTO_AN_OPEN_PARAGRAPH = new Set(['paragraph', 'image', 'figure'])

/** A written block-attributes line: `{` … `}` alone on its line (PART 2). */
const A_BLOCK_ATTRIBUTES_LINE = /^\{.*\}$/

/**
 * Does the written form of a block OPEN with a block-attributes line?
 *
 * The three kinds above fold into an open paragraph one column in because their
 * canonical source is a bare inline run. That stops being true the moment the
 * writer has to put the block's attributes on a line of their own ahead of it:
 * `block_attributes` is one of PART 9 §10's INVISIBLE CONSTRUCTS, so it
 * INTERRUPTS the open paragraph, and the block below it opens its own.
 *
 * So this is not a preference between two spellings. Where the attribute line is
 * written, the fold this rule exists to prevent cannot happen, and the `+` costs
 * a construct the document did not have. `- a` / `{.x}` / `para` and
 * `- a` / `  {.x}` / `  para` render the same document in carve-js, carve-php
 * and carve-rs alike - and the indented one is what the corpus source and
 * carve-rs write, so writing the marker was this engine disagreeing with the
 * other two (markup-carve/carve#1275).
 *
 * A paragraph whose own text is `{…}` does not reach this: the writer escapes
 * that leading brace (`\{.c\}`), precisely so it cannot come back as attributes.
 */
function opensWithAnAttributeLine(rendered: string): boolean {
  return A_BLOCK_ATTRIBUTES_LINE.test(rendered.split('\n', 1)[0])
}

function adjacentBlocksMerge(left: BlockNode, right: BlockNode): boolean {
  if (left.type !== right.type) return false
  if (left.type === 'list' && right.type === 'list') {
    if (left.ordered !== right.ordered) return false
    return left.ordered
      ? (left.delim ?? '.') === (right.delim ?? '.') && left.olType === right.olType
      : (left.bulletChar ?? '-') === (right.bulletChar ?? '-')
  }
  return new Set<BlockNode['type']>([
    'block_quote',
    'table',
    'line_block',
    'definition_list',
  ]).has(left.type)
}

const MARKER_COLUMN = '\ue005'

function atMarkerColumn(text: string): string {
  return text
    .split('\n')
    .map((line) => MARKER_COLUMN + line)
    .join('\n')
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
    const parts: string[] = []
    // Whether any child so far was written at the item's MARKER column, which
    // is column 0. Everything after it has to sit there too - see below - so
    // this only ever latches on. Clearing it again was a store that could not
    // change an outcome: no mutation of it failed a test, which is the shape
    // this repository keeps finding under a check that cannot fail.
    let previousAtMarkerColumn = false
    item.children.forEach((b, i) => {
      const previous = item.children[i - 1]
      const next = item.children[i + 1]
      // A definition written back BETWEEN the two blocks already ends the
      // paragraph above it, so the marker below is not needed - and emitting it
      // anyway changes the canonical form of corpus 228, whose whole point is
      // that a line at the definition's own column forms its own tight block.
      let separated = false
      if (previous !== undefined) {
        const written = definitionInGap(previous, b, ctx)
        if (written !== undefined && written.length > 0) {
          parts.push(written)
          separated = true
        }
      }
      const rendered = renderBlock(b, ctx)
      if (rendered.length === 0) return
      // §17 L3: a PARAGRAPH after a paragraph needs the continuation marker
      // written back. Indented under the item it is a LAZY CONTINUATION of the
      // paragraph above (§10 I2), so the item comes back holding ONE block
      // where the author wrote two, and `to_html(fmt(x)) != to_html(x)`
      // (carve#861).
      //
      // Only a paragraph reaches this. A fence, quote, heading, table, div or
      // thematic break cannot fold into an open paragraph, so indenting them
      // into the item is a different SPELLING of the same document and the
      // invariant already held - which is why the corpus, which pinned exactly
      // those kinds, never saw this.
      //
      // WHICH BLOCKS FOLD. The claim that "only a paragraph reaches this" was
      // measured across twenty block constructs and is wrong for two of them: a
      // standalone `image` and a `figure` are both written as a bare inline run
      // on its own line (`![a](i.png)`, plus a `^ cap` line), so at the item's
      // content column they are lazy continuation exactly as a paragraph is.
      // `- x` / `+` / `![a](i.png)` / `^ cap` came back as one paragraph holding
      // an inline image and the literal text `^ cap`: the `<figure>` and its
      // `<figcaption>` were gone (markup-carve/carve-js#902). Every other
      // construct measured - fence, quote, heading, table, break, div, list,
      // definition list, admonition, line block, math, raw block, comment -
      // opens its own block at that column and is unaffected.
      //
      // AND ONCE ONE CHILD IS AT THE MARKER COLUMN, EVERY LATER ONE MUST BE.
      // The marker column is column 0, so a following child written at the
      // item's content column is INDENTED relative to the block above it and
      // becomes that block's lazy continuation. `- x` / `+` / `---yaml` /
      // `k: v` / `---` wrote the paragraph flush and the thematic break at two
      // columns, and the break was absorbed into the paragraph and folded to an
      // em dash. Mixed indentation inside one attached run is not a form any
      // reader can round-trip, so it is not written.
      if (
        previousAtMarkerColumn ||
        (next !== undefined && adjacentBlocksMerge(b, next)) ||
        (!separated &&
          previous?.type === 'paragraph' &&
          FOLDS_INTO_AN_OPEN_PARAGRAPH.has(b.type) &&
          !opensWithAnAttributeLine(rendered))
      ) {
        parts.push(atMarkerColumn('+'), atMarkerColumn(rendered))
        previousAtMarkerColumn = true
        return
      }
      parts.push(rendered)
    })
    return parts.join('\n')
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
    item.definitions.forEach((def, index) => {
      // An EMPTY description whose line carries a hoisted definition is one the
      // author wrote the definition on: write it back there. Without this the
      // line came out as a bare `:`, which re-parses into the term above it -
      // the failure markup-carve/carve#805 describes.
      if (def.length === 0) {
        const line = item.definitionLines?.[index]
        const definition = line === undefined ? undefined : definitionsByLine.get(line)
        if (definition !== undefined) {
          // Render BEFORE marking it: the document-level arm returns '' for a
          // node in this set, so marking first renders the line away.
          const written = renderBlock(definition, ctx)
          definitionsWrittenInPlace.add(definition as unknown as object)
          out.push(`:  ${written}`)
          return
        }
        const label = line === undefined ? undefined : footnoteDefsByLine.get(line)
        const blocks = label === undefined ? undefined : ownValue(documentFootnoteDefs, label)
        if (label !== undefined && blocks !== undefined) {
          const written = renderOneFootnoteDef(label, blocks, ctx)
          footnotesWrittenInPlace.add(label)
          // A footnote body can be multi-line; its continuation lines carry the
          // body's own two-column indent and sit under the description.
          const [first, ...rest] = written.split('\n')
          out.push(`:  ${first}`)
          for (const l of rest) out.push(`   ${l}`)
          return
        }
      }
      const lines = trimNonNbsp(renderHostedBlocks(def, ctx)).split('\n')
      out.push(`:  ${lines.shift() ?? ''}`)
      for (const line of lines) out.push(`   ${line}`)
    })
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
 * ONE header shape has no native spelling: a SPAN marker promoted to a header
 * cell (`| < | b |`), which `header_cell` does not admit.
 *
 *   | < | b |     a span marker promoted to a header cell
 *
 * That still needs a delimiter row to promote the first row. It is emitted BARE
 * (`|---|---|`), never with colons: the cells keep their own alignment markers,
 * so the delimiter contributes structure only and cannot spill alignment down
 * the column.
 *
 * An ATTRIBUTED header cell used to be in that list, for the reason the whole
 * order changed: `header_cell` had no attributes slot, so the only shape
 * available was `|{.x}=a |`, which the grammar reads as a data cell whose
 * content starts with `=`. Falling back to a delimiter row avoided writing it,
 * at the cost of promoting the row with syntax the AST did not ask for. §5 T10
 * gives `header_cell` the slot, after the markers, so `|={.x} a |` is a real
 * spelling now and the fallback is not needed for it.
 */
function renderTable(node: Table, ctx: CarveContext): string {
  const rows: string[] = []
  const first = node.rows[0]
  const headerRow = first !== undefined && first.cells.length > 0 && first.cells.every((c) => c.header)
  const needsDelimiter = headerRow && first.cells.some((c) => c.span !== undefined)

  node.rows.forEach((row, rowIndex) => {
    const cells: string[] = []
    for (const cell of row.cells) {
      // In the delimiter form the promoted row is written as ordinary data
      // cells - the row after it is what makes them headers.
      const asHeader = !(needsDelimiter && rowIndex === 0)
      cells.push(renderTableCell(cell, ctx, asHeader))
    }
    rows.push(renderTableRow(cells, renderAttrs(row.attrs)))
  })
  if (needsDelimiter) {
    rows.splice(1, 0, `|${Array.from({ length: first!.cells.length }, () => '---').join('|')}|`)
  }
  if (node.caption) rows.push(`^ ${renderInlines(node.caption, ctx)}`)
  return rows.join('\n')
}

/**
 * A cell's written form: its PREFIX glued to the opening pipe, then one space,
 * then the content, then one space before the closing pipe.
 *
 * The prefix has to touch the pipe - a space in front of `=` or of an
 * attribute block makes it literal content - but the CONTENT does not, and the
 * padded form is the readable one. It is also the safe one: the parser's
 * alignment scan runs at the position right after `|` or `|=` and consumes one
 * `<`, `>` or `~`, so a glued content sigil was read as a marker the author
 * never wrote (markup-carve/carve-js#903, corpus 319-4). A space stops that
 * scan for every cell rather than for the shapes someone enumerated.
 *
 * An EMPTY cell takes a single space, not two, so a column does not grow a
 * space each time the document is formatted.
 */
function padCell(prefix: string, content: string): string {
  return content === '' ? `${prefix} ` : `${prefix} ${content} `
}

function renderTableRow(cells: string[], attrs: string): string {
  return `|${cells.join('|')}|${attrs}`
}

function renderTableCell(cell: TableCell, ctx: CarveContext, markHeader = true): string {
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
    return padCell(attrs, spanMarker)
  }
  const align = alignMarker(cell.align)
  const valign = cell.valign === 'top' ? '^' : cell.valign === 'middle' ? '~' : cell.valign === 'bottom' ? 'v' : ''
  // MARKER RUN FIRST, THEN THE BLOCK. The grammar binds a cell's attributes
  // after the kind marker and after the alignment marker, so `|={.x} h |` is
  // an attributed header cell. Writing the block ahead of the markers instead
  // produced `|{.x}=h |`, which is the one shape the grammar cannot tell from
  // a data cell whose content starts with `=` - and reads it as that, so an
  // attributed header cell round-tripped into `<td class="x">=h</td>` and
  // `toHtml(fmt(x)) != toHtml(x)` (spec §5 T10, corpus 319).
  const prefix = `${cell.header && markHeader ? '=' : ''}${align}${valign}${attrs}`
  // The space `padCell` writes after the prefix is what keeps a content sigil
  // content: the alignment scan runs right after `|` or `|=` and consumes one
  // `<`, `>` or `~`, so `| ~x~ |` written glued came back as CENTER alignment
  // holding `x~` - the strikethrough gone and the column centered by a marker
  // nobody wrote (markup-carve/carve-js#903). This used to be a guard that
  // fired only on those three characters and only where the prefix was a bare
  // `=`; padding every cell covers it without enumerating anything.
  return padCell(prefix, renderInlines(cell.children, ctx))
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

/**
 * One footnote definition, marker and body.
 *
 * Extracted because a definition list writes one back on its own description
 * line (markup-carve/carve#805) and a second spelling of the body's indent rule
 * would be a rule with two implementations - the shape that has produced most of
 * this engine's cross-engine divergences.
 */
/**
 * The body written for a footnote whose body is empty.
 *
 * A block-attribute line, because that is the only body measured to render to
 * nothing on HTML, Markdown, plain text and ANSI alike. The name inside is
 * discarded by the parse - the block it would attach to does not exist - so it
 * is chosen to be readable rather than to mean anything.
 */
const EMPTY_FOOTNOTE_BODY = '{empty}'

function renderOneFootnoteDef(label: string, blocks: BlockNode[], ctx: CarveContext): string {
  const rawBody = renderBlocks(blocks, ctx)
  const body = trimNonNbsp(blocks.length === 1 ? rawBody.replace(/\n\n/g, '\n') : rawBody)
  // AN EMPTY BODY IS NOT SPELLABLE, so it is written as something the reader
  // consumes back to nothing.
  //
  // `footnote_definition = "[^", footnote_label, "]:", space+, inline_content`
  // and `inline_content` is one-or-more, so a definition ALWAYS has content:
  // `[^f]:` and `[^f]: ` are both paragraphs, not definitions. An empty-bodied
  // footnote is therefore a state the source language cannot express directly.
  // It is still reachable, because a body holding only a block-attribute line
  // (`[^f]: {x}`) has that line consumed as attributes, leaving nothing behind -
  // and the writer then emitted `[^f]:`, which un-defined the note and turned
  // both the definition and its reference into literal text
  // (markup-carve/carve-js#904).
  //
  // So the body is written as the construct that PRODUCED the empty body. A
  // block-attribute line with nothing under it is dropped, which is what the
  // document already does with `{x}` at top level, and it is the only spelling
  // measured to render identically on all four targets: a `%%` comment and a
  // `%%%` block both leave an extra newline inside the `<li>`, so HTML moves.
  // The attribute name is arbitrary because the parse discards it - the payload
  // is not recorded anywhere in the tree - so it is spelled to say what it is
  // rather than to carry anything.
  if (body === '') {
    return `[^${writeFlatBracketRun(label)}]: ${EMPTY_FOOTNOTE_BODY}`
  }
  const lines = body.split('\n')
  const defLines = [`[^${writeFlatBracketRun(label)}]: ${lines.shift() ?? ''}`]
  // TWO spaces, the body's own column (PART 9 §16). Three is legal
  // continuation, but it leaves the body's blocks at a relative column above
  // zero - and a reader that takes the body's column as two then sees an
  // indented block opener, which does not open. This engine reads three back
  // fine; the executable spec, carve-rs and carve-php do not.
  for (const line of lines) defLines.push(`  ${line}`)
  return defLines.join('\n')
}

/**
 * Child kinds that are HOISTED definitions rather than body blocks.
 *
 * ONLY the collected kinds. §7 moves `link_reference_definition` and `footnote`
 * to the document and orders them by source position, and refuses that for
 * `abbreviation_def` specifically - "hoisting it would empty the line rather
 * than relocate visible output" - so an abbreviation definition already sits
 * where the author wrote it and must be written there.
 *
 * Listing it here moved every abbreviation definition to the end of the
 * document (carve-js#756): `compare:impls` reported five corpus documents at
 * once, all abbreviation cases, with carve-rs and carve-php agreeing against
 * this engine.
 */
const HOISTED_DEFINITION_TYPES = new Set(['link_reference_definition'])

/**
 * The document's body, then its hoisted definitions in source-position order.
 *
 * §7 puts hoisted definitions after the body and orders them among themselves
 * by source position; this engine publishes them that way since carve#746, and
 * PART 11 §6 then binds the writer - "fmt does not reorder ... those are the
 * author's choices and the AST records them".
 *
 * The writer used to render `children` and append every footnote afterwards,
 * because the runtime keeps footnote bodies in a label-keyed map where their
 * position is not part of what it walks. A link definition hoisted from INSIDE
 * a footnote body therefore came out BEFORE the footnote containing it, though
 * the tree has the footnote first (carve-js#750).
 *
 * Positions order the definitions, and only when every one of them has a
 * position: a hand-built or `pos`-less tree has no order to honor, and there the
 * old behavior - children as they come, then the footnotes - is the only
 * defensible one.
 */
function renderDocumentBody(ast: Document, ctx: CarveContext): string {
  type Piece = { at: number | undefined; text: string }
  const body: BlockNode[] = []
  const hoisted: BlockNode[] = []

  for (const child of ast.children) {
    if (HOISTED_DEFINITION_TYPES.has(child.type)) {
      hoisted.push(child)
      continue
    }
    body.push(child)
  }

  // THE BODY IS RENDERED FIRST, whatever the output order. A definition written
  // inside a definition-list description is emitted on that line and marked, and
  // `renderBlock` then returns '' for it here (carve-js#748) - so rendering the
  // definitions before the body wrote them twice.
  const bodyText = renderBlocks(body, ctx)

  const definitions: Piece[] = hoisted.map((child) => ({
    at: (child as { pos?: { startOffset?: number } }).pos?.startOffset,
    text: renderBlockAtTop(child, ctx),
  }))

  for (const [label, blocks] of Object.entries(ast.footnoteDefs ?? {})) {
    // Unless a definition list already wrote it where the author put it.
    if (footnotesWrittenInPlace.has(label)) continue
    definitions.push({
      at: ownValue(ast.footnoteDefPos, label)?.startOffset,
      text: renderOneFootnoteDef(label, blocks, ctx),
    })
  }

  const ordered = definitions.every((piece) => piece.at !== undefined)
    ? definitions
        .map((piece, index) => ({ piece, index }))
        // STABLE: two definitions at the same offset keep the order they were
        // collected in, which is the tree's.
        .sort((a, b) => a.piece.at! - b.piece.at! || a.index - b.index)
        .map(({ piece }) => piece)
    : definitions

  return [bodyText, ...ordered.map((piece) => piece.text)]
    .filter((text) => text.length > 0)
    .join('\n\n')
}

/** One top-level block, with the depth accounting `renderBlocks` does. */
function renderBlockAtTop(block: BlockNode, ctx: CarveContext): string {
  if (ctx.blockDepth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderCarve', MAX_RENDER_DEPTH)
  ctx.blockDepth++
  try {
    return renderBlock(block, ctx)
  } finally {
    ctx.blockDepth--
  }
}

function renderInlines(
  nodes: InlineNode[],
  ctx: CarveContext,
  captionCanOpen = false,
  /**
   * These nodes are a line block's STANZA, so the newline after the last of
   * them ends the stanza rather than a line inside it (PART 11 §7c). Set only
   * by the paragraph arm: a nested inline container inside a line block is not
   * a stanza, and its last node is not at a stanza boundary.
   */
  isStanza = false,
): string {
  if (ctx.inlineDepth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderCarve', MAX_RENDER_DEPTH)
  ctx.inlineDepth++
  try {
    let out = ''
    let firstLine = true
    let lineNodeCount = 0
    let lineHostsCaption = false
    // THE CURRENT OUTPUT LINE, CARRIED FORWARD instead of read back off `out`.
    // The two decisions below are properties of the line written so far, and
    // `out` is the wrong place to ask: it grows with every node, and probing a
    // growing accumulator per node is the quadratic shape this engine's scaling
    // guards exist to keep out. Two counters answer both questions in O(piece).
    let lineLength = 0
    /** The last up-to-two characters of the current output line. */
    let lineTail = ''
    nodes.forEach((node, idx) => {
      let piece = renderInline(
        node,
        ctx,
        lastBoundary(nodes[idx - 1]),
        firstBoundary(nodes[idx + 1]),
        captionCanOpen,
        opensBacktickRun(nodes[idx + 1]),
      )
      // THE TWO DECISIONS BELOW NEED THE LINE WRITTEN SO FAR, which is why they
      // live here and not in `renderInline`: the answer is a property of the
      // output line, not of the neighbouring nodes. `lastBoundary` cannot stand
      // in for it - after a code span it reports the span's last CONTENT
      // character, not the backtick that actually ends the line.
      const atLineStart = lineLength === 0

      // THE SEPARATOR SPACE IS ONLY A SEPARATOR (PART 11 §1; §21). `%%` is
      // recognized after whitespace OR at the start of its line, so a comment
      // that already STARTS its line has nothing to separate from and must not
      // be given a space it did not have.
      //
      // Everywhere else the space was cosmetic - leading whitespace is stripped
      // on the way back in - which is why it went unnoticed. A LINE BLOCK is
      // the one place it is not: there leading whitespace is preserved CONTENT
      // (PART 9 §23), so the space pushed the marker off column 0, the reparse
      // read `%%` as ordinary verse, and `carve fmt` PUBLISHED the text the
      // author hid (carve-js#1170; carve-php fixed the same defect in
      // markup-carve/carve-php#1394, carve-rs never had it).
      if (node.type === 'comment' && atLineStart && piece.startsWith(' %%')) piece = piece.slice(1)

      // A LINE BLOCK'S HARD BREAK KEEPS ITS BACKSLASH WHERE THE BARE NEWLINE
      // WOULD BE RE-READ (PART 11 §7c, NORMATIVE). The container hardens every
      // line boundary of its own accord, so the bare newline is right for most
      // lines and wrong for exactly two - the two where §7's precondition
      // fails, because the parser does NOT discard the trailing run when a
      // backslash follows it (PART 7 makes that run INTERIOR).
      //
      //   - the line's content is EMPTY. A bare newline is a BLANK line, which
      //     ends the stanza, so one stanza comes back as two.
      //   - the line's content ends in a LONE space. A bare newline makes that
      //     space line-trailing, where PART 2 drops it. A run of TWO OR MORE
      //     columns is already NBSP content (§23 MEDIAL GAPS) and needs none -
      //     it reaches here sentinel-encoded, so it is not a space to this
      //     test either.
      //   - the break ENDS THE STANZA. §7c's third sentence excuses a line with
      //     no trailing whitespace because its "tree is identical either way",
      //     and on a line INSIDE a stanza it is: the boundary hardens whether or
      //     not a backslash spells it. At the stanza's end there is no boundary
      //     to harden - the next newline belongs to the blank line or the
      //     closing fence - so the bare spelling drops the break outright. The
      //     ruling measured this as "a last body line loses a trailing `<br>`
      //     WITH ITS SPACE"; the space is incidental, the loss is the break, and
      //     `a\` and `a  \` lose it with no space involved.
      //
      // This is PART 11 §1a, not an exemption from it: the per-construct
      // spelling emits bytes that do not re-parse to the tree they came from,
      // so §1 wins and the spelling yields to another spelling of the SAME
      // construct - which for a `hard_break` is its own PART 3 form
      // (markup-carve/carve#1334).
      //
      // A LINE THAT ENDS IN A COMMENT IS EXEMPT. `%%` runs to end of line, so a
      // trailing space there is INSIDE the comment, not content the parser is
      // about to lose - stripping it leaves the same node. Protecting it with a
      // backslash does not: the `\` lands inside the comment's own content, and
      // the block layer, which takes the whole line before the inline parser
      // sees it, reads the note back as `\`. A comment is always the last thing
      // on its line, so the node before the break is the whole test.
      if (
        ctx.lineBlockDepth > 0 &&
        node.type === 'hard_break' &&
        piece === '\n' &&
        nodes[idx - 1]?.type !== 'comment' &&
        (atLineStart ||
          /(?:^|[^ \t]) $/.test(lineTail) ||
          (isStanza && idx === nodes.length - 1))
      ) {
        piece = '\\\n'
      }

      out += piece
      const lastNewline = piece.lastIndexOf('\n')
      if (lastNewline === -1) {
        lineLength += piece.length
        lineTail = (lineTail + piece).slice(-2)
      } else {
        lineLength = piece.length - lastNewline - 1
        lineTail = piece.slice(lastNewline + 1).slice(-2)
      }
      if (node.type === 'soft_break') {
        captionCanOpen = firstLine && lineNodeCount === 1 && lineHostsCaption
        firstLine = false
        lineNodeCount = 0
        lineHostsCaption = false
        return
      }
      lineNodeCount++
      lineHostsCaption = lineNodeCount === 1 && inlineHostsCaption(node)
      captionCanOpen = false
    })
    return out
  } finally {
    ctx.inlineDepth--
  }
}

function inlineHostsCaption(node: InlineNode): boolean {
  return (node.type === 'image' && node.src !== '') || (node.type === 'math' && node.display)
}

function renderInline(
  node: InlineNode,
  ctx: CarveContext,
  prevChar = '',
  nextChar = '',
  captionCanOpen = false,
  /**
   * Whether the node AFTER this one is written starting with a backtick run.
   *
   * `firstBoundary` cannot answer it: for a code span it reports the span's
   * first CONTENT character, not the backtick that actually starts the piece.
   * §27 binds `!` to a FOLLOWING BACKTICK RUN, so a text node ending in `!`
   * needs to know (carve-js#1175).
   */
  nextOpensBacktickRun = false,
): string {
  // A stored tree may still carry a type this engine no longer emits; map it
  // before dispatch so the switch below only ever sees current types.
  node = normalizeLegacyInline(node)

  const withAttrs = (body: string) => `${body}${renderAttrs(node.attrs)}`
  switch (node.type) {
    case 'text':
      return escapeText(cleanEscapedText(node), captionCanOpen, nextOpensBacktickRun)
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
      if (node.content === '') {
        throw new SourceUnspellableError(
          'raw_inline',
          'an empty raw inline has no Carve source spelling',
        )
      }
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
        : `[^${writeFlatBracketRun(node.id ?? '')}]`)
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
      if (node.delimited) return `{% ${node.content} %}`
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

/**
 * THE CANONICAL OPENER SPELLS THE FORMAT OUT: `---yaml`, never a bare `---`
 * (markup-carve/carve#977, PART 11 §6b; markup-carve/carve#961).
 *
 * The writer used to drop the token for `yaml` alone. That was a special case
 * for ONE format in a writer that already spelled every other one out - `toml`,
 * `json` and any custom word all came back as `---toml` / `---json` - so the
 * ruling REMOVES a branch rather than adding one, and it is the spelling
 * carve-rs already produced.
 *
 * The two forms parse identically: a bare opener takes
 * `defaultFrontmatterFormat`, whose default is `yaml`. Writing the token is
 * what makes the round trip say what the AST holds - a document parsed with
 * `defaultFrontmatterFormat: 'toml'` and written back bare would have read as
 * `yaml` on the next pass, under the option's default.
 */
function renderFrontmatter(frontmatter: { format: string; content: string }): string {
  return `---${escapeFormat(frontmatter.format)}\n${protectVerbatim(frontmatter.content)}\n---`
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
  //
  // "ENTIRELY SPACES" IS MEASURED IN CARVE'S WHITESPACE, the four characters
  // PART 7 names (markup-carve/carve#977), not the host language's `\s`. This
  // read a native `.trim()`, so ` <VT> ` counted as all-space here while the
  // parser - once it read the same four characters - strips its padding. The
  // two halves of one reversible operation have to spell the test once.
  const needsPad =
    content.startsWith('`') ||
    content.endsWith('`') ||
    (content.startsWith(' ') && content.endsWith(' ') && !isCarveBlank(content))
  return needsPad ? `${fence} ${content} ${fence}` : `${fence}${content}${fence}`
}

function codeFenceInfo(lang: string | undefined, header: string | undefined, label: string | undefined): string {
  const parts: string[] = []
  if (lang) parts.push(escapeFenceToken(lang))
  // The fence header is a LITERAL quoted_title token: no escape processing
  // on parse, and it cannot contain a quote. Emit it verbatim - escaping a
  // backslash here would round-trip to a doubled backslash (issue 295).
  if (header !== undefined) parts.push(`"${header}"`)
  if (label !== undefined) parts.push(`[${writeFlatBracketRun(label)}]`)
  // NO SPACE between the fence run and the info string. `fenced_code_block`
  // names the slot OPTIONAL and the no-space form CANONICAL: "The no-space form
  // (```php) is canonical and is what the X->Carve converters emit." The reader
  // stays lenient and accepts both, which is why a single-pass output check
  // never caught this - `` ``` js `` re-parses to the same tree.
  //
  // The separators BETWEEN the parts are a different slot and stay: inside
  // `code_fence_info` they are `space+`, mandatory, so ```js"t" is not a fence
  // opener at all and joining without one would lose the header.
  return parts.join(' ')
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
    const value = kv[key]!
    // EXACT key match, not case-insensitive. `LANG` and `lang` are different
    // attribute names - the parser keeps the authored case and the HTML shows
    // it - so folding here rewrote `[x]{LANG=fr}` into `[x]{:fr}` and changed
    // the name, which breaks PART 11 §1 (carve#1137).
    if (key === 'lang' && isLanguageTag(value)) parts.push(`:${value}`)
    // PART 11 §6c: a value-less attribute comes back as the bare name, which is
    // the production the language has for it. Guarded on the key being a valid
    // attribute identifier, because that is what `boolean_attribute` is - a key
    // that needs escaping has no bare spelling to fall back to.
    else if (value === '' && isAttrIdentifier(key)) parts.push(escapeAttrKey(key))
    else parts.push(`${escapeAttrKey(key)}=${quoteAttrValue(value)}`)
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

function isLanguageTag(value: string): boolean {
  return value === '' || /^[A-Za-z0-9]{1,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value)
}

function quoteAttrValue(value: string): string {
  // A value may stay UNQUOTED when it holds no `whitespace` and no delimiter --
  // PART 7's four characters, not `\s`. With `\s` a value carrying a vertical
  // tab was quoted defensively, so the writer's own output no longer round-
  // tripped to the shorter spelling the parser accepts.
  if (/^[^ \t\n\r"'{}]+$/.test(value)) return value
  return `"${value.replace(/[\\"]/g, '\\$&')}"`
}

/**
 * The `{author="Smith" year="2020"}` block leading a bibliography entry.
 *
 * ALWAYS QUOTED, which is why this is not `renderAttrs`: that writer drops the
 * quotes a value does not strictly need, and the citations extension reads the
 * block back with a QUOTED-value pattern. `{author=Smith}` therefore reparses
 * as an attribute the entry no longer feeds to author-date mode, and the
 * formatter would have silently emptied the reference list's labels.
 */
function renderCitationMetadata(attrs: Attrs | undefined): string {
  const keyValues = attrs?.keyValues
  if (!keyValues) return ''
  const parts = Object.entries(keyValues).map(
    ([key, value]) => `${escapeAttrKey(key)}="${value.replace(/[\\"]/g, '\\$&')}"`,
  )
  return parts.length === 0 ? '' : `{${parts.join(' ')}}`
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
/**
 * A BLANK LINE HOLDS SPACES AND TABS AND NOTHING ELSE (PART 1, carve#890,
 * corpus `a-blank-line-holds-spaces-and-tabs-and-nothing-else` from carve#924).
 *
 * `normalize` asked this question twice and spelled it two different ways: the
 * "emit the line empty" test was already this character class, while the "does
 * the next line end the block" test was a native `.trim() === ''`, i.e. the
 * full Unicode `\s`. So a line holding one U+1680 or one U+2000 counted as
 * blank for the second question and not for the first, and the line ABOVE it
 * was trimmed as block-final. On a run of such lines each one trimmed the one
 * before it away, and `a` + nine invisible lines + `b` came back as two
 * paragraphs - `to_html(fmt(x)) == to_html(x)` false, with no character in the
 * document that the parser calls whitespace.
 *
 * The parser answers the same question with `RE_BLANK_LINE` in src/parse.ts,
 * which is this pattern. Keep them in step.
 */
const RE_WRITER_BLANK = /^[ \t]*$/

/**
 * Whether `text` holds nothing but Carve whitespace - U+0020, U+0009, U+000A,
 * U+000D and nothing else (markup-carve/carve#977, PART 7).
 *
 * Spelled once, because a native `.trim() === ''` answers a different question
 * (the host language's `\s`, which holds U+000B, U+000C, U+00A0, U+FEFF and
 * every Unicode space) and the difference is invisible until a document
 * carries one of them.
 */
function isCarveBlank(text: string): boolean {
  return /^[ \t\n\r]*$/.test(text)
}

function lineBlockLayoutWhitespace(body: string): string {
  return body.replace(/(?:^\ue000+)|\ue000{2,}/gm, (run) => sentinels[0].repeat(run.length))
}

/**
 * A written document never BEGINS with U+FEFF.
 *
 * A single leading byte-order mark is stripped before the first line is read -
 * by this parser, by carve-php, by carve-rs and by the executable spec, all of
 * them deliberately (carve#872), so that a BOM'd file's first heading is a
 * heading. That strip is right, and it is also the one place where a character
 * that is otherwise ORDINARY CONTENT cannot be written back as itself: a
 * paragraph whose text is a bare U+FEFF was emitted as a bare U+FEFF, and the
 * next parse ate it, leaving an empty document. `to_html(fmt(x)) == to_html(x)`
 * went false (PART 11 section 1) for a document the HTML renderer renders
 * perfectly well.
 *
 * A single leading SPACE is the guard, because it is exactly what the source
 * that produced this tree had: the shape is `<SP>U+FEFF<SP>` in carve#926's
 * corpus, and leading whitespace on a paragraph line is discarded, so the space
 * costs nothing and the mark survives to be read as content.
 */
function guardLeadingBom(text: string): string {
  return text.startsWith('\ufeff') ? ` ${text}` : text
}

/**
 * `line` without its trailing space-and-tab run.
 *
 * `dropTrailingWhitespace` in src/parse.ts answers the same question for the
 * parser, and answers it unconditionally, so this does too
 * (markup-carve/carve#1027).
 *
 * IT USED TO KEEP AN ESCAPED SPACE. `normalize` rewrites the escaped-space
 * sentinel back to `\ `, and a line ending in that pair was left alone so the
 * writer would not turn the author's no-break space into a line break. The
 * parser has since stopped drawing that distinction: the strip runs first and a
 * backslash left in the last column is a hard break, so keeping the space no
 * longer preserves anything - it just spells the same hard break in two
 * characters instead of one. The one tree that still needs the old behavior is
 * handled where the sentinel is resolved, in `normalize`, because that is where
 * the alternative spelling is still available.
 */
function dropTrailingWs(line: string): string {
  const run = /[ \t]+$/.exec(line)

  return run === null ? line : line.slice(0, run.index)
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
  //
  // EXCEPT IN THE LAST COLUMN OF A LINE, where the escape has no spelling any
  // more (markup-carve/carve#1027): the trailing run goes before the escape is
  // read, so `\ ` there re-parses as a hard break and so does the `\` it
  // reduces to. No parse can build such a node now, but `fromAstJson` can, and
  // PART 11 section 1a holds for a tree however it arrived - so the character
  // is written as itself. That is not the escape and the re-parsed text node
  // carries U+00A0 rather than the sentinel, but it is the same rendered
  // document and it survives another pass, which is what section 1 asks. A
  // trailing whitespace run after the sentinel is part of the same last column,
  // so it is looked past here rather than left for `dropTrailingWs` to remove
  // once the substitution can no longer see it.
  const lines = trimNonNbspKeepingGuard(
    text.replace(/\ue000(?=[ \t]*(?:\n|$))/g, '\u00a0').replace(/\ue000/g, '\\ '),
  ).split('\n')
  const swept = lines.map((line) => {
    // A line whose only content is ASCII space or tab is emitted EMPTY, wherever
    // it sits (PART 11 \u00a77). Verbatim content is still sentinel-encoded here, so
    // three spaces inside a code block are out of reach and stay intact.
    if (line.length > 0 && RE_WRITER_BLANK.test(line)) return ''
    // Strip a line's trailing whitespace, on EVERY line (PART 2 NO TRAILING
    // WHITESPACE; carve#926).
    //
    // This used to fire only where the line ENDED A BLOCK, because before a
    // SOFT BREAK the parser kept the run, so stripping it there changed the
    // rendered output and broke carveToHtml(fmt(x)) == carveToHtml(x). The
    // parser is the half that moved: it drops the run at both positions now, so
    // the restriction inverts - keeping the run is what breaks the invariant,
    // for a hand-built tree that carries one. carve-rs#359 and carve#375 added
    // the restriction for the old parser and it goes with it.
    return dropTrailingWs(line)
  })
  const cleaned = trimNonNbspKeepingGuard(swept.join('\n').replace(/\n{3,}/g, '\n\n'))

  return `${guardLeadingBom(restoreVerbatim(cleaned))}\n`
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
  // The guard is INDENTATION, so PART 7's four characters. `[^\S\u00a0]` was
  // `\s` with one carve-out, and it read a leading vertical tab as indentation.
  if (/^[ \t]+-{3,}[ \t]*(\n|$)/.test(text)) {
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
// The caret is examined as a candidate, but escaped only when it can open an
// inline construct or a caption in the exact block slot being rendered. That
// keeps an unrelated orphan caret bare when another caret in the document is
// load-bearing (carve#1028).
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
 * Hoisted definitions keyed by the SOURCE LINE they were written on, and the
 * ones a definition list has already written back.
 *
 * A definition collected from a definition list's description empties the `dd`
 * (spec markup-carve/carve#801), and an empty description has no source
 * spelling: the writer emitted a bare `:` line, which re-parses as a
 * continuation of the term, so `to_html(fmt(x)) == to_html(x)` failed on the
 * documents that rule added (markup-carve/carve#805).
 *
 * Nothing new is needed to fix it. The entry records `definitionLines`, the
 * definition node keeps the `pos` it was written at (PART 12 §4), and the two
 * name the SAME LINE - so the description can be written back with the
 * definition on it, exactly as the author had it, and the document-level pass
 * skips what a description already claimed.
 *
 * This is the same shape as the heading id: the tree already distinguishes
 * authored from derived, and the writer only had to ask (carve-php#901).
 */
let definitionsByLine = new Map<number, BlockNode>()
let definitionsWrittenInPlace = new WeakSet<object>()
/** Footnote definitions live in a root map, not in `children`, so these are
 *  tracked by LABEL rather than by node identity. */
let footnoteDefsByLine = new Map<number, string>()
let footnotesWrittenInPlace = new Set<string>()
/** The document's footnote bodies, so a description can write one back. */
let documentFootnoteDefs: Record<string, BlockNode[]> | undefined

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

/*
 * The two control characters a PARSE can never put in a text node.
 *
 * U+0000 is replaced with U+FFFD on the way in and U+000D is a line ending, so
 * neither can reach the writer from a parse - only from an ingested tree - and
 * writing either one back would not round-trip anyway, because the next parse
 * would transform it again.
 *
 * Every OTHER C0 and C1 control is ordinary content that the HTML renderer
 * emits unchanged, and this used to strip the whole of
 * `[\u0000-\u0008\u000b-\u001f\u007f-\u009f]`. That silently deleted 61 of the
 * 63 characters in that range from the written form, so `to_html(fmt(x)) ==
 * to_html(x)` was false for every document that contained one (PART 11 section
 * 1). The corpus carve#924 added names three of them - U+000B, U+000C and
 * U+0085 - and those were the ones with a fixture, not the extent of it.
 */
const UNWRITABLE_CONTROLS = /[\u0000\u000d]/g

function escapeText(text: string, captionCanOpen = false, bangOpensLiteral = false): string {
  const escapes = escapeMode === 'minimal' ? UNCONDITIONAL_ESCAPES : CANDIDATE_ESCAPES
  let out = text
    .replace(UNWRITABLE_CONTROLS, '')
    .replace(escapes, (char, offset: number) => {
      if (char !== '^') return `\\${char}`
      const next = text[offset + 1] ?? ''
      // A TAB after the marker is not a caption opener: PART 10 §231 leaves
      // that line as prose, which is why the corpus renders `^<TAB>Figure 1`
      // as a paragraph. Escaping it wrote `\^` where carve-php and carve-rs
      // write the caret bare, and an escape that guards a channel the
      // character cannot open is exactly what corpus 304 refuses.
      const opensCaption = captionCanOpen && offset === 0 && next === ' '
      const opensInline = next === '[' || (text[offset - 1] ?? '') === '{' || next === '}'
      return opensCaption || opensInline ? '\\^' : '^'
    })
  // The caption-opening caret is escaped in EVERY mode, not only when `^` is
  // in the candidate class: after a caption host (a figure group, an image, a
  // table...) an unescaped `^ ` line re-attaches as the caption on re-parse,
  // so the minimal form always failed the redundancy check and the WHOLE
  // document escalated to conservative escaping - `\(a\)` and `\#` where
  // carve-php and carve-rs write the characters bare. One structural escape
  // keeps the minimal pass winnable (cross-engine fmt parity, PART 11 §4).
  if (
    escapeMode === 'minimal' &&
    captionCanOpen &&
    out.startsWith('^') &&
    out[1] === ' '
  ) {
    out = '\\' + out
  }
  // A TRAILING `!` BEFORE A BACKTICK RUN is escaped in EVERY mode too, for the
  // same reason and with the same shape. §27 makes `!` immediately before a
  // verbatim run an INLINE LITERAL, and names this as the single case the
  // construct reinterprets: "A literal `!` immediately before a backtick run is
  // therefore written `\!`". So the escape is not optional - it is the only
  // spelling of this tree - and leaving the minimal pass to discover that by
  // failing its redundancy check escalated the WHOLE DOCUMENT to conservative
  // escaping. `foo (bar) 50% a-b` in a document that also holds a `!` before a
  // code span came out `foo \(bar\) 50\% a\-b`, which is the over-escaping PART
  // 11 §4 forbids, while carve-rs wrote the whole line bare (carve-js#1175).
  if (escapeMode === 'minimal' && bangOpensLiteral && out.endsWith('!')) {
    out = out.slice(0, -1) + '\\!'
  }
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

/**
 * An image's ALT TEXT, written between `![` and `]`.
 *
 * ALT IS RAW. It is an HTML attribute, so nothing inside is inline-parsed and
 * no escape inside it is resolved: `![t\]z](/i.png)` gives `alt="t\]z"`, with
 * the backslash in the value. That is what makes escaping the wrong tool here -
 * a `\]` the writer emits is not a neutralized bracket, it is two more
 * characters of alt text, and the document says something else on the next
 * read. It compounded, too: each pass escaped the backslash the last pass
 * wrote (markup-carve/carve#1197).
 *
 * The run closes at the MATCHING `]`, by the balanced, escape- and
 * literal-span-aware scan a link's text closes by - so the alt an author can
 * write is exactly the alt that re-reads as itself, and the writer's job is to
 * put it back verbatim rather than to neutralize anything
 * (markup-carve/carve#1206).
 *
 * The fallback covers an alt that has NO Carve spelling - a bare unbalanced
 * `]`, or a run ending inside an unclosed code span. `parse` cannot produce
 * one; an ingested AST can. Escaping is not a representation of that value
 * either, but it keeps the image a well-formed image instead of letting a
 * stray `]` split the line, and it settles: the escaped alt IS representable,
 * so the pass after it writes the same bytes.
 */
function escapeImageAlt(text: string): string {
  return rawBracketRunCloses(text) ? text : text.replace(/[\\[\]]/g, '\\$&')
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
  // Whitespace is percent-encoded (it would otherwise end the destination),
  // and the test is the Unicode White_Space property -- the same one the reader
  // uses (`RE_DESTINATION_WHITESPACE` in parse.ts). NOT `/\s/`: that also holds
  // U+FEFF, which is an ordinary destination character, so a BOM came back out
  // as the literal text `%FEFF` -- not even a well-formed percent escape. The
  // reader was corrected for that in carve-js#751 and the writer was not, so
  // `toHtml(fmt(x)) === toHtml(x)` stopped holding for any destination carrying
  // one, and a `javascript:` scheme PART 9 §25 had blanked came back visible
  // behind a prefix the probe no longer recognized (markup-carve/carve#806).
  //
  // A parenthesis only needs escaping when it is unbalanced, because a
  // balanced pair survives the scan as-is -- and leaving it bare is what keeps
  // the common case (`.../Foo_(bar)`) readable. A backslash is escaped only
  // in front of the three characters the destination scan treats as escapes,
  // so backslashes elsewhere in a URL are emitted verbatim.
  const escaped = escapeDestinationEscapes(text)
  return escaped
    .replace(/\p{White_Space}/gu, (ch) => (ch === ' ' ? '%20' : `%${ch.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`))
    .replace(/\\?[()]/g, (m) => (sanitizeBlank ? (m.endsWith('(') ? '%28' : '%29') : m))
}

function escapeQuoted(text: string): string {
  return text.replace(/[\\"]/g, '\\$&')
}

/**
 * A FLAT raw bracketed run: a colon-fence or code-fence `[label]`, and a
 * footnote's `[^id]` in both its definition and its references.
 *
 * Same rule as an alt text and the same reason - the value is raw, so an
 * escape the writer emits reaches the reader as two characters of content
 * rather than as a neutralized bracket - but a narrower close. These readers
 * scan `[^\]]*` and stop at the first `]`, with no balance and no escape, so a
 * run is representable exactly when it holds neither a `]` nor a line break.
 *
 * One function for one rule. It was written twice, and both spellings escaped,
 * so `::: [a\b]` and `[^n\m]` grew a backslash on every format pass.
 *
 * WRITTEN AS AUTHORED WITH NO FALLBACK, unlike an alt text. A value holding a
 * `]` has no spelling here either, but the escape is not a spelling of it: the
 * label regexes require the run to be the whole of what follows, so `[a\]b]`
 * fails to match exactly as `[a]b]` does, and `::: [a\]b]` and `::: [a]b]`
 * render the same paragraph, container and all. Where the construct instead
 * survives as text - a code fence, a footnote definition - the escape only
 * adds a backslash a reader can see. So the branch would change no output
 * anywhere, which is a branch that cannot fail, and it is not written.
 */
function writeFlatBracketRun(text: string): string {
  return text
}

/**
 * NOT the same rule, deliberately. `RE_ABBR_DEF` reads the abbreviation as
 * `[A-Za-z0-9]+`, so neither character this would escape can reach it from a
 * parse, and an ingested abbreviation carrying one has no `*[…]:` spelling
 * with or without the backslash. Left as it stands rather than folded into the
 * function above, which would claim a shared rule where there is only a shared
 * shape.
 */
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
  // The info token ends at `whitespace` (PART 7), not at `\s`: a language name
  // carrying a vertical tab was truncated on the way out while the same name
  // carrying any other control character survived.
  return text.split(/[ \t\n\r]/)[0]!.replace(/`/g, '')
}

function escapeAttrKey(text: string): string {
  const safe = text.replace(/^[^a-zA-Z_]+|[^\w-]/g, '')
  return safe || 'x'
}

function escapeAttrNameValue(text: string): string {
  return text.replace(/[^\w-]/g, '-')
}

/**
 * Whether a name is a grammar `identifier` - `(letter | '_'), {letter | digit |
 * '_' | '-'}` - and so survives `escapeAttrKey` unchanged.
 *
 * Exported because `html-import.ts` has to know which attribute names this
 * writer can spell BACK: `escapeAttrKey` silently deletes the characters an
 * identifier may not hold, so a kept `~onclick` would be written as `onclick`
 * and a kept `xlink:href` as `xlinkhref` - a different attribute than the one
 * the source carried. The importer refuses those names rather than owning a
 * second copy of the rule (markup-carve/carve-js#1156).
 */
export function isAttrIdentifier(text: string): boolean {
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

/**
 * Whether this node's written form STARTS with a backtick run.
 *
 * The two that do are the code span and the raw inline, both of which go
 * through `renderCode`. Inline math opens with `$` and an inline literal with
 * `!`, so neither is one - the `!` that §27 binds has to reach the backtick
 * itself, with nothing between.
 *
 * EMPTY CONTENT IS NOT ONE OF THEM. `renderCode('')` writes the fence twice
 * with nothing between, so the two backticks read back as a single UNCLOSED
 * run of two rather than a closed span - and §27 binds `!` to a run that
 * closes. `` !`` `` is a `text` beside an empty `code` on the way in and on the
 * way out, so the channel never opens and escaping the `!` would be exactly the
 * guard corpus 304 refuses.
 */
function opensBacktickRun(node: InlineNode | undefined): boolean {
  if (node?.type === 'code') return node.value !== ''
  if (node?.type === 'raw_inline') return node.content !== ''
  return false
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
