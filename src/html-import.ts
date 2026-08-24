import { parseFragment, serializeOuter } from 'parse5'
import type {
  Attrs,
  BlockNode,
  DefinitionItem,
  Document,
  FigureGroup,
  InlineNode,
  List,
  Math,
  Paragraph,
  TableBodyGroup,
  TableCell,
  TableRow,
  TableRowGroups,
} from './ast.js'
import { CANONICAL_ADMONITION_KINDS } from './ast.js'
import { DocumentIdRegistry } from './document-ids.js'
import { isAttrIdentifier, isContainerKind, renderCarve } from './render-carve.js'
import {
  DANGEROUS_URL_SCHEMES,
  LABEL_DEFAULTS,
  SCHEME_PROBE_STRIP_RE,
  isDangerousAttrName,
} from './render-html.js'
import type { LabelKey } from './render-html.js'
import { inlineText, slugify } from './heading-ids.js'
import { hasOwnKey, ownValue, setOwn } from './own-property.js'
import { trimNonNbsp } from './trim-non-nbsp.js'

export type HtmlImportMode = 'safe' | 'semantic' | 'roundtrip'
export type HtmlImportAdapter =
  | 'generic'
  | 'tiptap'
  | 'prosemirror'
  | 'ckeditor'
  | 'tinymce'
  | 'word'
  | 'google-docs'

/**
 * The diagnostic codes, as the `code` enum of the published report schema
 * (`spec/resources/html-import-schema.json`) lists them.
 *
 * A runtime list rather than a hand-written union, because the union alone is
 * a constraint nothing can check: types are gone by the time a test runs, so
 * a code added here and not to the schema - or to the schema and not here -
 * diverged in silence. Deriving `HtmlImportDiagnosticCode` from this array
 * makes the two one thing, and a test then holds this array against the
 * schema's own enum.
 *
 * Not re-exported from `index.ts`: the package publishes the TYPE, and this
 * is the machinery the type is built from.
 */
export const HTML_IMPORT_DIAGNOSTIC_CODES = [
  'element-dropped',
  'element-unwrapped',
  'attribute-dropped',
  'style-unmapped',
  'table-degraded',
  'structure-unspellable',
  'structure-split',
  'raw-preserved',
  'encoding-assumed',
  'diagnostics-truncated',
] as const

export type HtmlImportDiagnosticCode = (typeof HTML_IMPORT_DIAGNOSTIC_CODES)[number]

export interface HtmlImportDiagnostic {
  code: HtmlImportDiagnosticCode
  message: string
  severity: 'info' | 'warning' | 'error'
  path?: string
  line?: number
  column?: number
}

export interface HtmlImportOptions {
  mode?: HtmlImportMode
  adapter?: HtmlImportAdapter
  maxDepth?: number
  maxNodes?: number
  maxDiagnostics?: number
  /**
   * The `labels` map the HTML was RENDERED with (PART 9 §16a).
   *
   * The derived-name drop matches the English defaults, which catches a
   * document rendered in English and nothing else: one rendered with
   * `{tabsGroup: 'Registerkarten'}` carries a value no default equals, so its
   * generated name is kept and baked into the imported source - and a
   * translated document is exactly the one the map exists to serve
   * (markup-carve/carve#1500 step 2).
   *
   * The host that rendered the HTML knows the map it used; passing the same one
   * here closes that. Layered OVER the defaults, so naming one key leaves every
   * other construct matched as before. Omitting it changes nothing.
   */
  labels?: Partial<Record<LabelKey, string>>
}

export interface HtmlImportResult<T> {
  value: T
  report: {
    mode: HtmlImportMode
    adapter: HtmlImportAdapter
    diagnostics: HtmlImportDiagnostic[]
  }
}

export class HtmlImportLimitError extends Error {
  constructor(public readonly limit: 'depth' | 'nodes' | 'diagnostics') {
    super(`HTML import ${limit} limit exceeded`)
    this.name = 'HtmlImportLimitError'
  }
}

interface P5Node {
  nodeName: string
  tagName?: string
  value?: string
  attrs?: Array<{ name: string; value: string }>
  childNodes?: P5Node[]
  parentNode?: P5Node
}

const ACTIVE = new Set(['script', 'style', 'template', 'noscript'])
const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset',
  'figure', 'footer', 'form', 'header', 'hgroup', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'ul', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
  // Synthetic, never present in real HTML input: the marker
  // `markFootnotePlacement` leaves where a non-final endnotes section sat. It
  // belongs here because it stands where a `<section>` stood, and a name
  // `blocks()` does not recognize is buffered as INLINE - which put the
  // placement inside the paragraph after it rather than between the two.
  'carve-footnote-placement',
])
/**
 * Is this node a BLOCK being flattened into an inline slot?
 *
 * The list-item spellings are here beside `BLOCK` because a `<ul>` reaching a
 * caption flattens its items too, and the boundary between two `<li>` is the
 * same boundary between two `<p>` - the clause is over every inline-only slot
 * an importer can reach, not over the caption it was first measured in.
 */
function isFlattenedBlock(node: P5Node): boolean {
  const tag = node.tagName
  if (!tag) return false

  return BLOCK.has(tag) || FLATTENED_BLOCK_EXTRA.has(tag)
}

/** The block-level containers `BLOCK` leaves out because they are never top level. */
const FLATTENED_BLOCK_EXTRA = new Set(['li', 'dt', 'dd', 'td', 'th', 'tr', 'caption', 'figcaption'])

/**
 * Is a separator needed between what is already in the slot and what follows?
 *
 * The clause makes one required at a block boundary and SUFFICIENT iff
 * re-reading the slot draws no token from both sides of the join - so a side
 * that carries nothing is not a side, and a boundary that already separates
 * needs nothing added. Every arm below is one of those two readings, and the
 * two whitespace arms are not one arm twice: whitespace already at the join can
 * sit on either side of it, and `<p>a </p><p>b</p>` and `<p>a</p><p> b</p>`
 * reach this from opposite directions.
 *
 * A whitespace-only block needs no arm of its own. It ARRIVES as leading
 * whitespace and then LEAVES as trailing whitespace, so the two arms already
 * hold `<p>a</p><p> </p><p>b</p>` to one space.
 *
 * A BREAK IS ASKED FROM BOTH SIDES for the same reason the whitespace is.
 * `<p>a</p><p><br>b</p>` reaches the join with the break on the RIGHT, and a
 * separator inserted before it writes a trailing space the source never had
 * (raised by `codex review`).
 */
function needsSeparator(before: InlineNode[], after: InlineNode[]): boolean {
  const last = before.at(-1)
  const first = after[0]
  if (last === undefined || first === undefined) return false
  if (last.type === 'hard_break' || first.type === 'hard_break') return false
  if (last.type === 'text' && /\s$/.test(last.value)) return false
  if (first.type === 'text' && /^\s/.test(first.value)) return false

  return true
}

/**
 * WHAT A CARVE LINE DROPS, THE IMPORTER MUST NOT WRITE (`docs/html-import.md`:
 * "an importer emits the source `carve fmt` emits").
 *
 * HTML collapses a run of whitespace and then ignores it entirely at the edges
 * of a block and around a hard break; Carve's parser does the same, dropping
 * the indentation of a continuation line and the padding of a table cell. So
 * the two agree about the DOCUMENT and disagree only about the bytes - which is
 * exactly the disagreement the fixed-point rule exists to catch, because the
 * writer, handed the tree that whitespace produced, writes the space back out
 * and then removes it on the next pass.
 *
 * Measured over the 1370-document render corpus, the surviving space was ONE
 * root cause wearing four faces: a hard break whose next line began with it, a
 * padded table cell, a caption whose separator became a run, and a lazy
 * continuation carried one column too far. Every one of them is a text run
 * holding a space at a boundary where the re-parse does not keep it.
 */
function textEdge(node: InlineNode | undefined, side: 'start' | 'end'): boolean {
  if (node === undefined || node.type !== 'text') return false
  // NOT the whitespace class: JavaScript counts U+00A0 as whitespace and a
  // non-breaking space is CONTENT - it is the one character here whose whole
  // point is that the renderer does not collapse it.
  return (side === 'start' ? /^[ 	]/ : /[ 	]$/).test(node.value)
}

/**
 * A line's leading whitespace, dropped after every hard break.
 *
 * Applies at EVERY level rather than only at a block's edges: a break inside a
 * `<strong>` still ends a line, and the text that follows it may sit in the
 * same element or in the parent, so the test asks what the previous node ENDS
 * with rather than what it is.
 */
function dropSpaceAfterHardBreak(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = []
  for (const node of nodes) {
    if (node.type === 'text' && endsWithHardBreak(out.at(-1))) {
      const value = node.value.replace(/^[ 	]+/, '')
      if (value === '') continue
      out.push({ ...node, value })
      continue
    }
    out.push(node)
  }

  return out
}

function endsWithHardBreak(node: InlineNode | undefined): boolean {
  if (node === undefined) return false
  if (node.type === 'hard_break') return true
  const children = (node as { children?: InlineNode[] }).children
  if (children === undefined || children.length === 0) return false

  return endsWithHardBreak(children.at(-1))
}

/**
 * The whitespace at the edges of a BLOCK's inline content, dropped.
 *
 * Only at a block boundary, never around an inline element: `a <em> b </em>c`
 * renders with the space between the words, so trimming inside the `<em>`
 * would join them. The caller says which it is - `inlines()` itself cannot
 * know, since it serves both.
 */
function trimBlockEdges(nodes: InlineNode[]): InlineNode[] {
  const out = [...nodes]
  while (textEdge(out[0], 'start')) {
    const first = out[0] as { type: 'text'; value: string }
    const value = first.value.replace(/^[ 	]+/, '')
    if (value === '') out.shift()
    else out[0] = { ...first, value }
  }
  while (textEdge(out.at(-1), 'end')) {
    const last = out.at(-1) as { type: 'text'; value: string }
    const value = last.value.replace(/[ 	]+$/, '')
    if (value === '') out.pop()
    else out[out.length - 1] = { ...last, value }
  }

  return out
}

const ADAPTERS = new Set<HtmlImportAdapter>([
  'generic', 'tiptap', 'prosemirror', 'ckeditor', 'tinymce', 'word', 'google-docs',
])

/**
 * The import adapters whose input can carry footnote-shaped HTML.
 *
 * Word and Google Docs are the two the portable adapter list names for
 * word-processor exports, and the recognition below is shape-driven, so the
 * same pass reads LibreOffice's and pre-3.x Pandoc's spellings too. `generic`
 * deliberately stays out: it takes arbitrary HTML, where a mutually linked
 * anchor pair is not proof of a footnote, and the caller naming an adapter is
 * the declaration of provenance that makes the recognition safe.
 */
const FOOTNOTE_SHAPED_ADAPTERS = new Set<HtmlImportAdapter>(['word', 'google-docs'])

/** The elements a footnote definition body can be spelled as. */
const FOOTNOTE_DEFINITION_BLOCKS = new Set(['li', 'div', 'section', 'aside', 'p', 'td', 'blockquote'])

/**
 * The elements a per-footnote wrapper can be spelled as.
 *
 * Word wraps each definition in `<div style='mso-element:footnote' id=ftn1>`
 * and LibreOffice in `<div id="sdfootnote1">`, so the block holding the body
 * is one level above the paragraph the back-anchor sits in.
 */
const FOOTNOTE_WRAPPER_BLOCKS = new Set(['div', 'li', 'section', 'aside'])

/**
 * Word's downlevel-revealed conditionals, `<![if !supportFootnotes]>` and the
 * matching `<![endif]>`. They are NOT comments in the HTML grammar - a parser
 * following the spec reads `<!` without `--` as a bogus comment, and one
 * following libxml's lead hands them back as TEXT - so both spellings are
 * recognized as the separator's packaging (see isFootnoteChromeNode).
 */
const RE_DOWNLEVEL_CONDITIONAL = /^(<!\[if[^\]]*\]>|<!\[endif\]>)+$/i

/**
 * A footnote-reference candidate: the anchor, the definition block its
 * fragment resolves to, the fragment itself, and whether the pair is mutual.
 */
interface FootnoteCandidate {
  ref: P5Node
  block: P5Node
  fragment: string
  mutual: boolean
}

/** One recognized note: its block and every reference bound to it. */
interface FootnoteDefinitionGroup {
  block: P5Node
  refs: P5Node[]
  fragments: string[]
}

/**
 * The elements PART 9 §9 and §10 spell as an attribute on a span, so the
 * importer writes `[Tab]{kbd}` rather than unwrapping to `Tab` (carve#1140).
 *
 * Mirrors EXTENDED_SEMANTIC_SPAN_ORDER in render-html.ts.
 *
 * `mark` and `code` are not here, and their ABSENCE is not what keeps them out:
 * `inline()` maps each of them a few lines before it consults this set, so
 * adding either name changes no output at all. The rule they follow - the tier
 * split retired them from the registry and each already has its own syntax
 * (`=m=`, a code span), so importing them here as well would give one input two
 * spellings - is enforced by those earlier branches, and that is what a test
 * has to move to fail. Stated here because the comment that used to sit in this
 * spot claimed the membership was the guarantee, and a mutation that added both
 * names passed every test.
 *
 * A Set rather than an object literal, because `constructor` and `toString` are
 * tag names a fragment may carry.
 */
const SEMANTIC_SPAN_TAGS = new Set(['abbr', 'time', 'samp', 'var', 'kbd', 'cite', 'dfn'])

/**
 * Where each name's VALUE comes from in the HTML. The rest are value-less and
 * import as the bare boolean attribute (PART 11 §6c), as does one of these
 * whose source attribute is absent.
 */
const SEMANTIC_SPAN_VALUE_SOURCE = new Map([['abbr', 'title'], ['dfn', 'title'], ['time', 'datetime']])

/**
 * The `<annotation>` encodings that DECLARE their payload to be TeX.
 *
 * Matched case-insensitively against the whole attribute value, never as a
 * substring: `MathType-MTEF` and `application/mathml-content` both contain
 * neither of these as a prefix, but a substring test for `tex` accepts the
 * first of them and hands a binary blob to the math node as if it were an
 * equation.
 */
const TEX_ANNOTATION_ENCODINGS = new Set(['application/x-tex', 'text/x-tex', 'latex'])

/**
 * The `data-` names that are A SERIALIZER'S PROTOCOL, not an author's content.
 *
 * Everything else the source carries is kept, so these need naming: a
 * round-trip marker carries the stored Carve source for the element it sits on,
 * and re-emitting it as `{data-carve-src=…}` would make the importer's output
 * claim a provenance it does not have.
 */
const ROUND_TRIP_MARKER_ATTRIBUTES = new Set(['data-djot-src', 'data-carve-src'])

/**
 * Does this URL attribute name no destination at all?
 *
 * EMPTY IS A PROPERTY OF THE STRING, read the way an HTML URL attribute is
 * read: a value of zero length, or of zero length once leading and trailing
 * ASCII whitespace is stripped, because that is what a URL parser strips before
 * resolving one. A value that is merely unusual is not empty and is kept - the
 * rule is over the DESTINATION, not over the reason it is missing.
 *
 * An ABSENT attribute is the same shape and reaches this the same way: an `<a>`
 * with no `href` names no destination just as an `<a href="">` does.
 *
 * The character list is the URL spec's ASCII whitespace rather than the regex
 * `\s` class, which adds a vertical tab and the Unicode spaces that are not
 * whitespace here.
 */
function destinationIsEmpty(value: string | undefined): boolean {
  return value === undefined || value.replace(/^[ \t\n\f\r]+|[ \t\n\f\r]+$/g, '') === ''
}

/**
 * The dangerous URL scheme an attribute value hides where the RENDERER's value
 * sanitizer cannot see it, or `undefined` when there is none.
 *
 * §25 blanks a value whose scheme leads the value, which covers every attribute
 * holding ONE URL. A list-valued attribute holds several - `srcset="a.png 1x,
 * javascript:alert(1) 2x"`, `ping="/log javascript:alert(1)"` - and a safe first
 * entry hides the rest, so the renderer writes the whole list back out.
 *
 * The importer will not be the thing that puts one there. This is deliberately
 * an IMPORT-side refusal and not a change to §25: the renderer's behavior on
 * hand-written Carve is a separate question with its own false-positive cost
 * (a prose `title` may legitimately contain the word `javascript:`), and
 * widening the import is what makes the shape reachable from untrusted HTML.
 *
 * The denylist and the normalization are the renderer's own, so this cannot
 * drift into blocking a different set than §25 blocks.
 */
const DENIED_SCHEMES = new Set(DANGEROUS_URL_SCHEMES.map((scheme) => scheme.toLowerCase()))

function launderableScheme(value: string): string | undefined {
  // The FIRST token is the renderer's business: it blanks the whole value.
  for (const token of value.split(/[\s,]+/).slice(1)) {
    const colon = token.indexOf(':')
    if (colon === -1) continue
    const scheme = token.slice(0, colon).replace(SCHEME_PROBE_STRIP_RE, '').toLowerCase()
    if (DENIED_SCHEMES.has(scheme)) return scheme
  }
  return undefined
}

/**
 * The writer's slot order for `held`, READ OFF THE ELEMENT'S OWN ATTRIBUTE
 * ORDER.
 *
 * A fixed id-then-class-then-keys order renders `<h1 class="k" id="x">` back as
 * `{#x .k}` and then as `<h1 id="x" class="k">` - attributes the input did not
 * have in that order. carve-rs ruled this in carve-rs#1354 and reads the
 * element; markup-carve/carve-js#1416 added the slot here without that half, so
 * the two engines wrote different source for the same HTML
 * (markup-carve/carve-js#1456).
 *
 * A NON-EMPTY ORDER IS EXHAUSTIVE, so anything the element did not spell under
 * its own name - an attribute renamed or folded on the way in, a `style`
 * expanded into key-values - still has to appear, or the writer drops it
 * silently. Those go after the slots the element did name, keeping their own
 * order among themselves.
 */
function slotOrderFromElement(node: P5Node, held: Attrs): string[] {
  const order: string[] = []
  const push = (slot: string) => {
    if (!order.includes(slot)) order.push(slot)
  }
  const keyValues = held.keyValues ?? {}
  for (const attr of node.attrs ?? []) {
    const name = attr.name.toLowerCase()
    if (name === 'id') {
      if (held.id !== undefined) push('#id')
    } else if (name === 'class') {
      if (held.classes?.length) push('.class')
    } else if (name in keyValues) {
      push(name)
    }
  }
  if (held.id !== undefined) push('#id')
  if (held.classes?.length) push('.class')
  for (const key of Object.keys(keyValues)) push(key)
  return order
}

/**
 * Whether `id` sits where `renderHtml` writes a GENERATED one: after every
 * authored attribute.
 *
 * `data-source-line` is the one thing allowed to follow it, because that is a
 * render annotation rather than an authored attribute and the renderer appends
 * it last on purpose (`injectSourceLine`).
 */
function idInGeneratedPosition(node: P5Node): boolean {
  const names = (node.attrs ?? []).map((attr) => attr.name.toLowerCase())
  while (names[names.length - 1] === 'data-source-line') names.pop()
  return names[names.length - 1] === 'id'
}

/**
 * Whether `id` is a value the renderer would derive for a heading whose
 * plain-text projection is `text`.
 *
 * THE DEFAULT SLUG ONLY, which is the same accepted limit `dropDerived` states
 * for every other derived attribute: an importer cannot know which
 * `HeadingIdOptions` the render used, and a value no default equals is
 * indistinguishable from an authored one, so failing SAFE - keep - is the side
 * to err on.
 *
 * The `-N` tail is `resolveHeadingIds`' own dedup shape, which starts at 2
 * because the first occurrence takes the bare base. `-1` is therefore never a
 * counter this engine wrote, and neither is a leading-zero run nor anything
 * holding a non-digit.
 */
function isGeneratedHeadingId(id: string, text: string): boolean {
  const base = slugify(text)
  if (id === base) return true
  if (!id.startsWith(`${base}-`)) return false
  const count = id.slice(base.length + 1)
  return count !== '' && !count.startsWith('0') && count !== '1' && /^[0-9]+$/.test(count)
}

class Importer {
  readonly mode: HtmlImportMode
  readonly adapter: HtmlImportAdapter
  /**
   * Every diagnostic, with what it takes to put it in the order the page
   * promises: `at` is the document position of the LOSING ELEMENT and `seq`
   * the order this one was constructed in, which only ever breaks a tie.
   */
  private readonly entries: Array<{ diagnostic: HtmlImportDiagnostic; at: number; seq: number }> = []
  /**
   * Every node of the parsed tree, numbered in DOCUMENT ORDER
   * (markup-carve/carve#1586).
   *
   * A REPORT IS ORDERED BY WHERE THE LOSS IS, NOT BY WHEN IT WAS NOTICED.
   * docs/html-import.md always said the diagnostic list is ordered and, until
   * that ticket, never said ordered by what - so each engine's list came out in
   * whatever order its own walk happened to construct the rows in. This
   * importer reads a table's cells before its `<caption>`, because the caption
   * fills a slot on the finished table, so a `<table>` losing something on both
   * reported the cell first and the caption second for a document that spells
   * them the other way round.
   *
   * Numbering the tree once and sorting at the end fixes the whole class rather
   * than that one shape: no handler has to be rewritten to visit its parent's
   * children in source order, and none can reintroduce the defect by choosing a
   * convenient traversal. The number is the node's own position, which is why a
   * footnote definition lifted out of the end of the document by the adapter
   * pass - imported FIRST, long before the body it is referenced from - still
   * reports at the end, where the author wrote it.
   */
  private readonly documentOrder = new Map<P5Node, number>()

  /** The report, in the order docs/html-import.md states. */
  get diagnostics(): HtmlImportDiagnostic[] {
    return [...this.entries]
      .sort((a, b) => a.at - b.at || a.seq - b.seq)
      .map((entry) => entry.diagnostic)
  }
  /** Where the import built a structure only a serializer loses (§16). */
  private readonly unspellable: Array<{ node: P5Node; path: string; message: string }> = []
  /**
   * Where a WRITER has to spell one source structure as more than one (§16,
   * markup-carve/carve#1636).
   *
   * Kept apart from `unspellable` because the two say different things and the
   * page keeps them apart: `structure-unspellable` is for a shape the syntax
   * cannot spell at all, and here every part is spellable, present and exact -
   * what the source cannot say is that they were ONE list. Reported by the
   * source-writing exit only, like every other serialization loss.
   */
  private readonly split: Array<{ node: P5Node; path: string; message: string }> = []
  /**
   * Where the author wrote a `<p>` holding nothing but an image (§16,
   * markup-carve/carve-js#1419).
   *
   * A CANDIDATE, not yet a loss: `block()` is the only place the shape can be
   * seen with a source path to report it against, and it runs BEFORE the
   * unwrappers do. `captionHost` takes the paragraph back off a `<figure>`
   * body, and a table cell keeps inlines rather than blocks, so in both the
   * paragraph never reaches the tree and there is nothing to lose. The row is
   * emitted only for a candidate whose node the finished document still holds,
   * which is why the `block` itself is recorded and not just its coordinates.
   */
  private readonly loneImageParagraphs: Array<{
    node: P5Node
    path: string
    block: BlockNode
    attributed: boolean
    /** Names the image's own attribute block wins outright, so they are lost. */
    overwritten: string[]
  }> = []
  private nodes = 0
  /** How many `<q>` elements enclose the one being read, for the mark pair. */
  private quoteDepth = 0
  /**
   * The id PART 9 §16a's counter derives for each `<p class="admonition-title">`,
   * keyed by the node, so the drop is an equality match on the value the
   * renderer would write at that position. Built on first use, off `root`.
   */
  private admonitionTitleIds: Map<P5Node, string> | undefined
  private root: P5Node | undefined
  private readonly maxDepth: number
  private readonly maxNodes: number
  private readonly maxDiagnostics: number

  private readonly labels: Record<LabelKey, string>

  /**
   * Whether this import is the one that WRITES SOURCE (`htmlToCarve`), which is
   * the only exit allowed to record a source-layout field.
   *
   * PART 12 fixes `attrs.order` as a record of how a SOURCE spelled a block,
   * and an import read HTML: there was no source to read a spelling off, so the
   * PUBLISHED tree records none (markup-carve/carve#1647). The writer still
   * needs to be told that an imported heading id is AUTHORED - without that
   * signal `renderCarve` reads an id equal to its own generated slug as
   * generated and omits it, which is the loss markup-carve/carve-js#1416 fixed
   * by spelling the slot on both exits.
   *
   * So the slot becomes a WRITER-ONLY channel: the tree `htmlToCarve` renders
   * is an intermediate nobody publishes, and the tree `htmlToAst` returns
   * carries no source-layout field at all.
   */
  private readonly writing: boolean

  constructor(options: HtmlImportOptions, writing = false) {
    this.writing = writing
    this.mode = options.mode ?? 'safe'
    this.adapter = options.adapter ?? 'generic'
    if (!ADAPTERS.has(this.adapter)) throw new TypeError(`Unknown HTML import adapter: ${this.adapter}`)
    this.maxDepth = options.maxDepth ?? 128
    this.maxNodes = options.maxNodes ?? 1_000_000
    this.maxDiagnostics = options.maxDiagnostics ?? 1_000
    this.labels = { ...LABEL_DEFAULTS, ...options.labels }
  }

  import(html: string): Document {
    const fragment = parseFragment(html, { sourceCodeLocationInfo: true }) as unknown as P5Node
    this.root = fragment
    // BEFORE the adapter pass, which rewrites footnote-shaped HTML and imports
    // the definitions it finds: the numbers have to be on the tree as the
    // AUTHOR wrote it, or a definition's diagnostics would sort by where the
    // rewrite left it rather than by where it stands in the document.
    this.numberDocumentOrder(fragment)
    // Rewrite footnote-shaped HTML before the core policy reads the tree.
    // Under the word-processor adapters the full anchor-pair heuristic runs
    // ("Adapters may normalize editor-specific markup before the core
    // policy"); under EVERY adapter, `generic` included, the pass reads the
    // DPUB-ARIA roles a producer authored - `role="doc-noteref"` on the
    // reference, `role="doc-endnotes"` on the section - which is what
    // carve-php's core policy reads, and what makes Pandoc 2.11+ HTML import
    // footnotes without naming an adapter. Roles are authored semantics, an
    // EXPLICIT signal; the anchor-pair heuristic stays the adapter-gated
    // fallback for the role-less exports.
    const footnoteDefs = this.adapterFootnotes(
      fragment,
      FOOTNOTE_SHAPED_ADAPTERS.has(this.adapter),
    )
    const children = this.blocks(fragment.childNodes ?? [], '', 0)
    const doc: Document = { type: 'document', children }
    if (footnoteDefs && Object.keys(footnoteDefs).length > 0) doc.footnoteDefs = footnoteDefs
    return doc
  }

  private enter(depth: number): void {
    if (depth > this.maxDepth) throw new HtmlImportLimitError('depth')
    if (++this.nodes > this.maxNodes) throw new HtmlImportLimitError('nodes')
  }

  private add(
    code: HtmlImportDiagnosticCode,
    message: string,
    severity: HtmlImportDiagnostic['severity'],
    path: string,
    node: P5Node,
  ): void {
    if (this.entries.length >= this.maxDiagnostics) throw new HtmlImportLimitError('diagnostics')
    this.entries.push({ diagnostic: { code, message, severity, path }, at: this.positionOf(node), seq: this.entries.length })
  }

  /**
   * Where a losing element sits in the document, as the number the pre-order
   * walk gave it.
   *
   * An element the HTML parser IMPLIED - a `<tbody>` around rows nobody wrote
   * one for - is not in the source at all and has no position of its own, so it
   * answers with its nearest ancestor's and ties with it. That is the honest
   * reading: the loss is at the place in the source where the implied element's
   * content begins.
   */
  private positionOf(node: P5Node | undefined): number {
    for (let current = node; current !== undefined; current = current.parentNode) {
      const at = this.documentOrder.get(current)
      if (at !== undefined) return at
    }
    return Number.MAX_SAFE_INTEGER
  }

  /**
   * Number every node of the parsed tree in document order.
   *
   * Iterative, not recursive: the walk runs before `enter()` has capped
   * anything, so it meets whatever depth the input actually parsed to, and a
   * recursive version would answer a deeply nested document with a stack
   * overflow instead of the depth-limit error the page promises.
   */
  private numberDocumentOrder(root: P5Node): void {
    const stack: P5Node[] = [root]
    let next = 0
    while (stack.length > 0) {
      const node = stack.pop()!
      this.documentOrder.set(node, next++)
      const children = node.childNodes ?? []
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!)
    }
  }

  /**
   * An element's attributes, as the Carve attributes that carry them.
   *
   * THE POLICY IS A REFUSAL LIST, NOT A KEEP LIST. An attribute is dropped only
   * where there is a reason to drop it - it is an injection sink (§25), it is
   * CSS the language has no slot for, or its name is not spellable as a Carve
   * attribute identifier. Everything else is kept, because Carve's attribute
   * syntax can hold it and dropping what fits is a silent loss applied in bulk
   * to exactly the documents an importer runs on: `aria-label` on an imported
   * quote is an accessibility regression the format never required
   * (markup-carve/carve-js#1156, matching carve-php).
   *
   * The refusal is DERIVED, not enumerated: `isDangerousAttrName` is the
   * renderer's own §25 name filter, so the importer cannot admit a sink the
   * renderer knows to strip, and `isAttrIdentifier` is the Carve writer's own
   * name rule, so the importer cannot keep a name the writer would rewrite into
   * a different one.
   */
  private attrs(node: P5Node, path: string): Attrs | undefined {
    const attrs: Attrs = {}
    const classes: string[] = []
    const keyValues: Record<string, string> = {}
    for (const attr of node.attrs ?? []) {
      const name = attr.name.toLowerCase()
      if (isDangerousAttrName(name)) {
        // `srcdoc` and `formaction` are not event handlers, so they get their
        // own wording - but not their own membership test. The set is the
        // renderer's.
        const kind = name.startsWith('on') ? 'event-handler' : 'injection-sink'
        this.add('attribute-dropped', `Dropped ${kind} attribute ${name} on <${node.tagName}>`, 'warning', path, node)
      } else if (name === 'style') {
        this.styles(node, attr.value, keyValues, path)
      } else if (name === 'id') {
        attrs.id = attr.value
      } else if (name === 'class') {
        classes.push(...attr.value.split(/\s+/).filter(Boolean))
      } else if (ROUND_TRIP_MARKER_ATTRIBUTES.has(name)) {
        // A serializer's own marker rather than the author's content, so it is
        // not re-emitted as an attribute of the imported document.
        this.add('attribute-dropped', `Dropped round-trip marker ${name} on <${node.tagName}>`, 'info', path, node)
      } else if (this.isConsumedHtmlAttribute(node, node.tagName ?? '', name)) {
        // Read as content or as an instruction somewhere else in this importer,
        // so keeping it here as well would give the same source two spellings.
      } else if (!isAttrIdentifier(name)) {
        this.add('attribute-dropped', `Dropped unsupported attribute ${name} on <${node.tagName}>: not spellable as a Carve attribute name`, 'info', path, node)
      } else if (/[\r\n]/.test(attr.value)) {
        // A quoted attribute value ENDS at the line break, so writing this back
        // produces an attribute block that does not reparse as one: it lands in
        // the document as literal `{name="first` text and the attribute is gone
        // anyway. Refused loudly rather than emitted as corruption.
        this.add('attribute-dropped', `Dropped ${name} on <${node.tagName}>: its value spans a line break, which a Carve attribute value cannot`, 'warning', path, node)
      } else {
        // Everything the language can hold, held. `cite` on a block quote,
        // `open` on a `<details>` (PART 11 §6c's bare boolean, which the
        // details extension renders back onto the tag), `scope` on a `<th>`
        // (dropped again in `table()` when it matches the value the renderer
        // derives from position, markup-carve/carve-js#1032), `aria-*`, `role`,
        // microdata and any name a producer invented all arrive here. The
        // renderer sanitizes a LEADING dangerous scheme - `{foo=javascript:…}`
        // is blanked there, not refused here (markup-carve/carve#1286) - and
        // the one shape it does not reach is refused on the way in.
        if (hasOwnKey(keyValues, name)) {
          // A `style` declaration already mapped to this key. CSS beats the
          // presentational attribute in HTML, and it has to beat it in BOTH
          // source orders - a plain assignment let `<p style="text-align:left"
          // align="right">` come out right-aligned purely because `align` was
          // written second.
          this.add('attribute-dropped', `Dropped ${name} on <${node.tagName}>: a mapped CSS declaration already sets it`, 'info', path, node)
        } else {
          const laundered = launderableScheme(attr.value)
          if (laundered !== undefined) {
            this.add('attribute-dropped', `Dropped ${name} on <${node.tagName}>: its value carries a ${laundered} URL the renderer does not reach`, 'warning', path, node)
          } else {
            // `setOwn`, not `keyValues[name] = …`: a `<p __proto__="x">` would
            // run the prototype setter, store nothing, and lose the attribute
            // in silence (markup-carve/carve-js#886's class, reached here by
            // keeping attribute names the document chose).
            setOwn(keyValues, name, attr.value)
          }
        }
      }
    }
    if (classes.length) attrs.classes = classes
    if (Object.keys(keyValues).length) attrs.keyValues = keyValues
    this.dropDerived(node, classes, attrs)
    if (attrs.keyValues && Object.keys(attrs.keyValues).length === 0) delete attrs.keyValues
    // PRESENT, not TRUTHY. An explicit `id=""` suppresses the auto slug rather
    // than standing for an absent one - `resolveHeadingIds` says so, and
    // `renderHtml` writes `<h1 id="">` back for it - so a truthiness test threw
    // the whole `Attrs` away whenever the empty id was the ONLY thing kept, and
    // the re-render then gave the heading the anchor its source suppressed
    // (markup-carve/carve-js#1463). It survived one attribute later, which is
    // what showed the drop was accidental rather than a policy.
    //
    // `id` is the only field this can be wrong about: `classes` and `keyValues`
    // are assigned above only when non-empty, so for them truthy and present are
    // the same question.
    return attrs.id !== undefined || attrs.classes || attrs.keyValues ? attrs : undefined
  }

  /**
   * The attributes whose value EQUALS what the renderer derives for this
   * element, removed (PART 9 §16a, markup-carve/carve#1500, reconciled with
   * Extensions §1.5 in markup-carve/carve#1511).
   *
   * THE RULE IS VALUE-MATCHED, NOT NAME-MATCHED. Nothing in the HTML says who
   * wrote an attribute, so provenance cannot be the test and is not one. Where
   * the value equals the generated one the output is identical whichever side
   * wrote it, so the drop is a no-op for what a reader hears; where it differs
   * the attribute is kept, always. That second half is what a blanket
   * `aria-label` drop cost before (carve-php#1337, carve-rs#1060), and this
   * rule does not spend it again.
   *
   * WHAT IT BUYS is the only thing keeping a `labels` map alive across an
   * import. A kept `aria-label="Tabs"` is indistinguishable from an authored
   * one, and the author-wins precedence then makes the imported copy WIN on
   * every later render: the same source re-rendered with `tabsGroup` set to
   * `Registerkarten` still says `Tabs`. The document has been permanently
   * unlocalized while no byte of today's output moved - which is also why a
   * round trip cannot detect this and the test asserts ABSENCE instead.
   *
   * NOTHING IS DIAGNOSED. The renderer writes the value back, so this is not a
   * lossy decision and emits no `attribute-dropped` - the same reason the
   * `<figure>` and `<blockquote cite>` imports report nothing. A drop of the
   * OTHER kind, where the value could not be represented, is diagnosed in
   * `attrs()` as it always was.
   *
   * IT CATCHES THE DEFAULT ONLY, which §16a states as an accepted limit: HTML
   * rendered with a German map carries a value no default equals, so it is kept
   * and laundered. An importer cannot know the render's configuration and a
   * non-default value is indistinguishable from an authored one, so failing
   * SAFE - keep - is the side to err on.
   */
  private dropDerived(node: P5Node, classes: string[], attrs: Attrs): void {
    const derived = this.derivedAttributes(node, classes)
    if (!derived) return
    for (const [name, values] of Object.entries(derived)) {
      if (name === 'id') {
        if (attrs.id !== undefined && values.includes(attrs.id)) delete attrs.id
        continue
      }
      const held = attrs.keyValues?.[name]
      if (held !== undefined && values.includes(held)) delete attrs.keyValues![name]
    }
  }

  /**
   * What the renderer derives for this element, as attribute name to the values
   * it can produce. A name absent here is one the renderer never writes for
   * this element, so it is the author's and is kept untouched.
   *
   * The classes are the ones the renderers write at their DEFAULT options: an
   * importer cannot see the host's `wrapperClass` or `tabClass`, the same blind
   * spot the default-only label match already accepts.
   */
  private derivedAttributes(node: P5Node, classes: string[]): Record<string, string[]> | undefined {
    const tag = node.tagName ?? ''
    const has = (name: string): boolean => classes.includes(name)

    // A DIAGRAM FENCE names itself after its own class word, which is why
    // Extensions §1.5 gives it no `labels` key - there is no fixed English
    // string to translate, so the derived value is readable off the element.
    // The role travels with the name and is derived whichever side wrote the
    // name, so it goes even where an authored name stays.
    //
    // `<pre>` ONLY, though the json-mode fences wrap in a `<div>`. That mode
    // puts the payload in a `<script>` the importer drops, so such a div never
    // comes back as a fence for a renderer to name again - the drop would be a
    // pure loss there, and a classed `<div role="img">` is far likelier to be
    // some other producer's than a `<pre>` is. The narrower shape is the one
    // the spec's `derived-accessible-name` fixture pins.
    if (tag === 'pre' && classes.length > 0 && this.attr(node, 'role') === 'img') {
      return { role: ['img'], 'aria-label': [classes[0]!] }
    }

    // AN ENDNOTES SECTION is named by the `endnotes` key, beside the fixed
    // `doc-endnotes` role the renderer writes with it. Both are reconstructable
    // from the element: the role IS the shape test, and the name is the key's
    // documented default. Which is the whole property - a value the importer
    // can rebuild from the element it is standing on was written by the
    // renderer from the same document, so it is not the author's, whatever this
    // import goes on to do with the element (markup-carve/carve#1500,
    // markup-carve/carve-php#1588).
    if (tag === 'section' && this.attr(node, 'role') === 'doc-endnotes') {
      return { role: ['doc-endnotes'], 'aria-label': [this.labels.endnotes] }
    }

    // A TAB SET / CODE GROUP takes its name from a `labels` key, so unlike the
    // fence an author may genuinely have written the same words. Only the
    // documented English default is dropped; anything else is kept.
    if (tag === 'div' && has('tabs')) {
      return { role: ['group', 'tablist'], 'aria-label': [this.labels.tabsGroup] }
    }
    if (tag === 'div' && has('code-group')) {
      return { role: ['group'], 'aria-label': [this.labels.codeGroup] }
    }

    // A `css`-MODE PANEL is named by its own tab's `[label]` - a string the
    // author already wrote once, in the document, which is why §16a keeps it
    // out of the map. The importer reads that same string off the control
    // beside the panel rather than inventing it.
    if (tag === 'div' && (has('tabs-panel') || has('code-group-panel'))) {
      const control = this.precedingLabelText(node, has('tabs-panel') ? 'tabs-label' : 'code-group-label')
      return { role: ['group'], ...(control === undefined ? {} : { 'aria-label': [control] }) }
    }

    // A TITLED ADMONITION's title paragraph carries the renderer's own
    // document-order counter, and the `<aside>`'s `aria-labelledby` points at
    // it. Baked into source the id is authored, so the next render's counter
    // collides with it. The Nth such paragraph derives what the renderer's id
    // registry hands out for `adm-N`, so this stays an equality match rather
    // than a guess at the shape.
    if (tag === 'p' && has('admonition-title')) {
      const derivedId = this.admonitionTitleId(node)
      return derivedId === undefined ? undefined : { id: [derivedId] }
    }

    // A TITLED ADMONITION points `aria-labelledby` at the id on its own title
    // paragraph, and both halves are the renderer's: the id is the counter's
    // (dropped by the `<p>` arm above) and the reference is written from it.
    // Left standing it is a DANGLING reference - the paragraph it names becomes
    // the container's title and stops being an element with an id - which is
    // the defect carve-php#1542 records, and one this engine could not reach
    // until the aside survived the import at all (carve-js#1316).
    // The value matched is the title's OWN id rather than the counter's,
    // because what makes the reference derived here is not where the id came
    // from but that the ELEMENT it names is consumed: the paragraph becomes the
    // container's title, so any `aria-labelledby` still pointing at it names
    // nothing. The counter id is dropped by the `<p>` arm above when it is the
    // counter's; an authored one is reported as dropped where the title is
    // lifted. Either way the renderer writes a fresh reference on the next
    // render, so keeping this one could only ever preserve a dangling name.
    if (tag === 'aside' && has('admonition')) {
      const derived: Record<string, string[]> = {}
      // AN UNTITLED CALLOUT IS NAMED BY ITS TYPE WORD, through the `labels` key
      // for that kind - the shape §16a's own example uses. Unreachable until
      // carve-js#1316, because the `<aside>` was unwrapped and there was no
      // element left to read a name off; a `::: note` therefore came back
      // carrying `{aria-label=Note}` and was permanently unlocalizable, which
      // is the exact cost the clause exists to prevent.
      const kind = classes.find((name) => name !== 'admonition' && CANONICAL_ADMONITION_KINDS.has(name))
      if (kind !== undefined) {
        const key = `admonition${kind[0]!.toUpperCase()}${kind.slice(1)}` as LabelKey
        if (key in LABEL_DEFAULTS) derived['aria-label'] = [this.labels[key]]
      }
      // A TITLED one points at its title paragraph instead, and the renderer
      // writes one form or the other rather than both.
      const title = (node.childNodes ?? []).find((child) => this.isCountedAdmonitionTitle(child))
      const titleId = title === undefined ? undefined : this.attr(title, 'id')
      if (titleId !== undefined) derived['aria-labelledby'] = [titleId]
      if (Object.keys(derived).length > 0) return derived
    }

    // AN INDEX BACK-LINK is named `{indexBackref} {term}`, or with the
    // occurrence ordinal appended for the kth of several. Both halves are on
    // the page - the term is the entry's own text, the ordinal is the link's
    // position among its siblings - so the whole value is reconstructable.
    if (tag === 'a' && has('index-backref')) {
      const name = this.indexBackrefNames(node)
      return name === undefined ? undefined : { 'aria-label': name }
    }

    return undefined
  }

  /**
   * The text of the tab control that names the panel `node`: the nearest
   * preceding ELEMENT sibling, when it is the one carrying `labelClass`.
   * Nearest-and-only, because a panel with no control before it - a fragment
   * cut mid-set - derives no name, and guessing one there would drop a label
   * nothing writes back.
   */
  private precedingLabelText(node: P5Node, labelClass: string): string | undefined {
    const siblings = node.parentNode?.childNodes ?? []
    const at = siblings.indexOf(node)
    for (let i = at - 1; i >= 0; i--) {
      const previous = siblings[i]!
      if (previous.nodeName === '#text' && (previous.value ?? '').trim() === '') continue
      if (previous.tagName === undefined) continue
      const classes = (this.attr(previous, 'class') ?? '').split(/\s+/)
      return classes.includes(labelClass) ? this.text(previous) : undefined
    }
    return undefined
  }

  /**
   * The names the index extension can derive for one back-link: the label plus
   * the entry's term, and the same with this link's occurrence ordinal. Both
   * spellings are accepted for a lone link because the extension's byte budget
   * can truncate a numbered run down to one, leaving `… 1` on the survivor.
   */
  private indexBackrefNames(node: P5Node): string[] | undefined {
    const parent = node.parentNode
    if (!parent) return undefined
    const isBackref = (child: P5Node): boolean =>
      child.tagName === 'a' && (this.attr(child, 'class') ?? '').split(/\s+/).includes('index-backref')
    const backrefs = (parent.childNodes ?? []).filter(isBackref)
    const ordinal = backrefs.indexOf(node) + 1
    if (ordinal === 0) return undefined
    const term = (parent.childNodes ?? [])
      .filter((child) => !isBackref(child))
      .map((child) => this.text(child))
      .join('')
      .trim()
    if (term === '') return undefined
    const label = this.labels.indexBackref
    return [`${label} ${term}`, `${label} ${term} ${ordinal}`]
  }

  /**
   * The id the renderer derives for this `<p class="admonition-title">` -
   * `adm-1`, `adm-2`, … in document order, which is the order the renderer's
   * own counter runs in.
   *
   * WHICH PARAGRAPHS THE COUNTER COUNTS is the renderer's condition, not the
   * class alone. It increments for a CANONICAL admonition with a title and no
   * authored name, and that is exactly when it emits the id and points the
   * `<aside>`'s `aria-labelledby` at it - so a paragraph qualifies here when
   * its parent aside names it back. Counting every `admonition-title` instead
   * would desync on the two shapes that carry the class and no counter: a
   * NON-canonical `::: custom "T"` (a `<div>`, title with no id) and a
   * canonical one the author named (`aria-label` wins, title with no id).
   * Either one ahead of a real title shifted every later ordinal by one, and
   * the mismatch then KEPT a genuinely derived id - the safe direction, but a
   * missed drop rather than a correct one.
   *
   * Built in ONE walk on first use rather than counted per element: counting
   * upward from each title would be quadratic on a document that is mostly
   * titled admonitions, which is an input an importer runs on rather than a
   * hypothetical. Deferred to first use so a document with no such paragraph -
   * every document that never came from a Carve renderer - walks nothing.
   *
   * ITERATIVE, NOT RECURSIVE. The importer's depth limit is a COUNTER, and a
   * caller may raise it past what the JS stack holds; a recursive prewalk would
   * hit `Maximum call stack size exceeded` before the counter ever spoke, which
   * is the contract `maxDepth` exists to keep.
   */
  private admonitionTitleId(node: P5Node): string | undefined {
    if (!this.admonitionTitleIds) {
      // ONE WALK, TWO COLLECTIONS. The counted titles in document order - the
      // order the renderer's counter runs in - and every OTHER id the document
      // carries, which is the namespace the renderer's registry was seeded with
      // before that counter allocated anything.
      const titles: P5Node[] = []
      const reserved: string[] = []
      const stack: P5Node[] = this.root ? [this.root] : []
      while (stack.length > 0) {
        const current = stack.pop()!
        if (this.isCountedAdmonitionTitle(current)) {
          titles.push(current)
        } else {
          const id = this.attr(current, 'id')
          if (id !== undefined) reserved.push(id)
        }
        const children = current.childNodes ?? []
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!)
      }
      // THE PREDICTION IS THE RENDERER'S ALLOCATION, NOT ITS COUNTER. The
      // renderer takes `adm-N` from the document's id registry, which appends a
      // collision suffix when the name is already taken - so on a document
      // where the author holds `adm-1`, the id written is `adm-1-2` and a bare
      // `adm-${N}` matches nothing. Reserving the ids the document already
      // carries first, then allocating through the same registry, keeps this an
      // EQUALITY match on the value the renderer would write (carve-js#1336).
      // Matching the SHAPE `adm-N-M` instead is the guess the rule deliberately
      // does not make.
      const registry = new DocumentIdRegistry()
      for (const id of reserved) registry.reserve(id)
      const ids = new Map<P5Node, string>()
      for (const [index, title] of titles.entries()) ids.set(title, registry.uniqueId(`adm-${index + 1}`))
      this.admonitionTitleIds = ids
    }
    return this.admonitionTitleIds.get(node)
  }

  /**
   * Whether this node is a title paragraph the renderer's admonition counter
   * counted: an id, inside an `<aside class="admonition …">`, with the aside's
   * `aria-labelledby` naming it back. A `docIds` collision suffix (`adm-1-2`)
   * IS reconstructed, by seeding the same registry with the ids the document
   * already carries before allocating (carve-js#1336); before that the title
   * matched no derived value and its id was reported as a drop that had not
   * happened.
   */
  /**
   * Whether this is the paragraph a container's TITLE renders as.
   *
   * The class alone, because the class alone is what the renderer always
   * writes. The generated `id` beside it is conditional - `renderAdmonition`
   * emits one only for a CANONICAL kind with no authored name - so a
   * `::: sidebar "A"` (a `<div>`, no id) and a `::: note "A"` carrying an
   * authored `aria-label` (no id either) both render a bare
   * `<p class="admonition-title">`. Reading the id as the marker left the title
   * of both in the body, where it was written back as an ordinary paragraph
   * carrying the renderer's class.
   *
   * `isCountedAdmonitionTitle` is the NARROWER question and stays narrow: it
   * asks whether the renderer's counter produced this id, which is a question
   * about dropping a derived value, not about what the paragraph IS.
   */
  private isAdmonitionTitle(node: P5Node): boolean {
    return (
      node.tagName === 'p' &&
      (this.attr(node, 'class') ?? '').split(/\s+/).includes('admonition-title')
    )
  }

  private isDivLabel(node: P5Node): boolean {
    return (
      node.tagName === 'p' && (this.attr(node, 'class') ?? '').split(/\s+/).includes('div-label')
    )
  }

  /**
   * Every DOM node under one this importer consumes without walking it.
   *
   * The lift below removes the label paragraph before `blocks()` can reach it,
   * so its text child is a node nothing else will ever charge - and a labelled
   * container would then cost one node and one level LESS than the same DOM
   * without a label, which is a way to process more than `maxNodes` allows by
   * ADDING markup rather than removing it.
   */
  private chargeSubtree(node: P5Node, depth: number): void {
    for (const child of node.childNodes ?? []) {
      this.enter(depth + 1)
      this.chargeSubtree(child, depth + 1)
    }
  }

  /**
   * PART 9 §10's grouping `[label]`, taken back off the `<p class="div-label">`
   * the renderer degraded it to (markup-carve/carve-js#1413).
   *
   * A label has no spelling anywhere but on a container's OPENER, so leaving the
   * paragraph in the body writes it back as ordinary content carrying the
   * renderer's own class - `::: [g]` came back as a `{.div-label}` paragraph
   * holding `g`. That is not a LOSS the import could declare; it is an ADDITION,
   * the document saying something it never said, and a raw label holding markup
   * said something NEW on every pass as the escaping compounded.
   *
   * The same shape carve-rs uses (markup-carve/carve-rs#1310, #1322), and it
   * refuses in three places. Each refusal leaves the paragraph exactly where it
   * was, which is also what makes the refusals the near-miss controls for the
   * unwrap boundary: a div that lifted nothing kept nothing, so it must still
   * unwrap.
   */
  private containerLabel(
    body: P5Node[],
    bodyPaths: string[],
    depth: number,
  ): { label: string; body: P5Node[]; bodyPaths: string[] } | undefined {
    const at = body.findIndex((child) => child.tagName !== undefined)
    if (at < 0 || !this.isDivLabel(body[at]!)) return undefined
    /*
     * TEXT BEFORE IT IS ALSO "FURTHER DOWN". The search finds the first ELEMENT,
     * which is not the first thing in the container:
     * `<div>prefix<p class="div-label">g</p></div>` has visible text ahead of
     * the paragraph, and lifting the label onto the opener MOVES it in front of
     * `prefix` - the reorder the first-element rule exists to prevent, arriving
     * by the one route an element search cannot see. The renderer never writes
     * bare text before the label, so a container shaped like this is foreign
     * HTML rather than this engine's own output. Whitespace between the tags is
     * not text an author wrote, so a pretty-printed container still lifts.
     */
    for (const before of body.slice(0, at)) {
      if (before.nodeName === '#text' && (before.value ?? '').trim() !== '') return undefined
    }
    /*
     * TEXT ONLY. `Div.label` is a raw string and the writer emits it raw, so
     * lifting a paragraph holding markup would flatten the markup and lose it
     * without a word.
     */
    const kids = body[at]!.childNodes ?? []
    if (kids.some((kid) => kid.nodeName !== '#text')) return undefined
    const label = kids.map((kid) => kid.value ?? '').join('')
    /*
     * AND NOTHING THE OPENER CANNOT SPELL. `]` closes the label and a newline
     * ends the opener line, so neither can ride back out - a label carrying one
     * would be written into source that re-reads as something else.
     */
    if (label.includes(']') || label.includes('\n')) return undefined
    /*
     * The element itself, and then everything under it - see `chargeSubtree`.
     *
     * AT THE DEPTH THE BLOCK WALK WOULD HAVE USED, which is `depth + 2` and not
     * `depth + 1`: both callers hand their body to `blocks(..., depth + 1)`, and
     * that enters each child through `block(..., depth + 2)`. Charging a level
     * shallower let a labelled container pass a `maxDepth` the same DOM without
     * a label is refused at - `<div id="x"><p class="div-label">g</p></div>`
     * imported at 3 where its unlabelled twin needed 4. Same defect as the node
     * charge below it, in the other budget.
     */
    this.enter(depth + 2)
    this.chargeSubtree(body[at]!, depth + 2)
    /*
     * A LABEL IS A BARE STRING WITH NO ATTRIBUTE SLOT, so whatever the degraded
     * paragraph carried cannot come with it - the same shape as an admonition
     * title, and reported rather than dropped in silence. The structural
     * `div-label` class is the exception and is consumed, because the renderer
     * writes it back from the label itself.
     */
    const labelPath = bodyPaths[at] ?? ''
    const own = this.attrs(body[at]!, labelPath)
    const leftover = own && {
      ...own,
      classes: (own.classes ?? []).filter((name) => name !== 'div-label'),
    }
    if (leftover && !leftover.classes.length) delete (leftover as Attrs).classes
    if (leftover && (leftover.id || leftover.classes || leftover.keyValues)) {
      this.add(
        'attribute-dropped',
        `Dropped ${this.attrNames(leftover).join(', ')} on <p>: a container label has no attribute slot`,
        'warning',
        labelPath,
        body[at]!,
      )
    }
    return {
      label,
      body: body.filter((_, index) => index !== at),
      bodyPaths: bodyPaths.filter((_, index) => index !== at),
    }
  }

  private isCountedAdmonitionTitle(node: P5Node): boolean {
    if (!this.isAdmonitionTitle(node)) return false
    const id = this.attr(node, 'id')
    if (id === undefined) return false
    const parent = node.parentNode
    if (!parent || parent.tagName !== 'aside') return false
    if (!(this.attr(parent, 'class') ?? '').split(/\s+/).includes('admonition')) return false
    return this.attr(parent, 'aria-labelledby') === id
  }

  /**
   * The nodes an element with no destination leaves behind: its content, in a
   * span where an attribute survives and bare where none does.
   *
   * That is the attribute-less unwrap boundary the rest of this importer uses,
   * and it is the same boundary because it is the same question - what is the
   * element still needed to hold? Nothing here reads the destination slot.
   *
   * A LINK THAT COMES BACK AS PROSE IS A LOSSY DECISION, and this importer
   * requires those to be observable. It is not the bare `<span>`'s case, where
   * nothing was lost because nothing was carried: an anchor has a slot for a
   * destination, and this one is standing empty.
   */
  private unwrapDestinationLess(
    node: P5Node,
    message: string,
    children: InlineNode[],
    attrs: Attrs | undefined,
    path: string,
  ): InlineNode[] {
    this.add('element-unwrapped', message, 'info', path, node)
    if (!attrs) return children
    return [{ type: 'span', children, attrs }]
  }

  /**
   * Whether the importer already READ this attribute somewhere else - as the
   * node's own content, or as an instruction about what node to build.
   *
   * These are neither kept by `attrs()` nor reported: a `<a href>` reaches the
   * link's destination and a `<td colspan>` reaches the cell's span, so keeping
   * the name as well would give one source two spellings, and reporting it
   * would name a loss that does not happen.
   */
  private isConsumedHtmlAttribute(node: P5Node, tag: string, name: string): boolean {
    // `title` on a link or an image is the node's own `title` field, written
    // back as the `"…"` after the destination - so it must not ALSO ride along
    // as `{title=…}`, which would put the same text on the tag twice.
    //
    // UNLESS THERE IS NO DESTINATION, in which case no link or image node is
    // built (see the gate in `inlines()`) and there is no `title` field for the
    // value to be read into. It is an ordinary attribute again, kept on the
    // span that carries the content - the alternative is a title that vanishes
    // with no diagnostic, because this predicate promised it was read
    // somewhere. Keeping it does not reopen the security question the gate
    // settles: a `{title=…}` on a span is not a destination, and nothing
    // downstream reads one out of it.
    if (tag === 'a') {
      if (name === 'href') return true
      return name === 'title' && !destinationIsEmpty(this.attr(node, 'href'))
    }
    if (tag === 'img') {
      // `alt` stays consumed either way: with a source it is the image node's
      // `alt` field, and without one it is the CONTENT that stands in the
      // element's place, so it is in the emitted document as prose rather than
      // in an attribute position.
      if (name === 'src' || name === 'alt') return true
      return name === 'title' && !destinationIsEmpty(this.attr(node, 'src'))
    }
    if (tag === 'ol') return name === 'start' || name === 'type'
    if (tag === 'input') return name === 'type' || name === 'checked'
    if (tag === 'td' || tag === 'th') return name === 'colspan' || name === 'rowspan'
    // `datetime` is the VALUE of the `time` span attribute, not an extra:
    // `semanticSpan()` reads it off the node and it survives the import. A
    // `title` on `<time>` needs no entry - it is an ordinary kept attribute
    // there, unlike on a link or an image, where the node has a field for it.
    if (tag === 'time') return name === 'datetime'
    // `alttext` and `display` are READ by `mathml()` and reach the math node.
    // `xmlns` is the MathML namespace declaration, which is what makes the
    // element MathML in the first place - it is consumed by having been
    // recognized, not discarded.
    if (tag === 'math') return name === 'alttext' || name === 'display' || name === 'xmlns'
    return false
  }

  private styles(node: P5Node, value: string, keyValues: Record<string, string>, path: string): void {
    for (const declaration of value.split(';')) {
      const split = declaration.indexOf(':')
      if (split < 0) continue
      const property = declaration.slice(0, split).trim().toLowerCase()
      const val = declaration.slice(split + 1).trim().toLowerCase()
      if (!property) continue
      if (this.mode !== 'safe' && property === 'text-align' && ['left', 'right', 'center'].includes(val)) {
        keyValues.align = val
      } else {
        this.add('style-unmapped', `CSS declaration ${property} was not mapped`, 'info', path, node)
      }
    }
  }

  private attr(node: P5Node, name: string): string | undefined {
    return node.attrs?.find((a) => a.name.toLowerCase() === name)?.value
  }

  /**
   * `type` on an `<input>` is an ENUMERATED attribute, and HTML matches an
   * enumerated keyword ASCII case-insensitively: `<input type="CHECKBOX">` is
   * a checkbox to every browser, and so is `Checkbox`.
   *
   * ASCII, not `toLowerCase()`, and the difference is not academic here.
   * `toLowerCase()` is Unicode-aware, so `CHEC\u212ABOX` - the KELVIN SIGN in
   * place of the K - folds to the exact string `checkbox` and would be read as
   * a task marker no browser reads that way. Restricting the fold to `A-Z`
   * matches only what HTML says matches.
   */
  private isEnumeratedKeyword(value: string | undefined, keyword: string): boolean {
    return value !== undefined && value.replace(/[A-Z]/g, (c) => c.toLowerCase()) === keyword
  }

  private childPath(parent: string, node: P5Node, index: number): string {
    const name = node.tagName ?? (node.nodeName === '#text' ? 'text()' : node.nodeName)
    return `${parent}/${name}[${index + 1}]`
  }

  /**
   * `paths` overrides the path a node is reported under, index-parallel to
   * `nodes`. One caller needs it: a `<dl>` collects the children that are
   * neither a term nor a definition and converts them AFTER the list, and
   * rebuilding their paths from the filtered array would renumber them - a
   * `<p>` reported as `/dl[1]/p[3]` on its way out would report its own
   * attribute losses under `/dl[1]/p[1]`, so one element spoke under two names.
   */
  private blocks(nodes: P5Node[], parentPath: string, depth: number, paths?: string[]): BlockNode[] {
    const out: BlockNode[] = []
    let inlineBuffer: P5Node[] = []
    /*
     * THE PARAGRAPH THIS SYNTHESIZES IS NOT A STEP, so it is not an index basis
     * either (PART 12 §16, markup-carve/carve#1554). A bare inline run gets
     * wrapped here, the wrapper contributes no path step - and numbering the
     * run inside the wrapper anyway printed an index against a parent no step
     * names: `<p>z</p><kbd onclick="x()">K</kbd>` reported `/kbd[1]` where the
     * `<kbd>` is the second body child. The buffer therefore carries the path
     * each node ALREADY has among `nodes`, which is the level the step is
     * printed at. It is not a contiguous offset: a leading whitespace-only text
     * node is dropped rather than buffered, so the run does not start where the
     * buffer does.
     *
     * The tell that this was a defect rather than a spelling latitude: the same
     * document reported `/p[3]/math[2]` correctly one diagnostic later, and
     * `/p[3]` counts the siblings `/math[1]` did not.
     */
    let inlinePaths: string[] = []
    const flush = (): void => {
      const children = this.blockInlines(inlineBuffer, parentPath, depth + 1, inlinePaths)
      inlineBuffer = []
      inlinePaths = []
      if (!this.visible(children)) return
      out.push(this.bareBlockImage(children) ?? { type: 'paragraph', children })
    }
    nodes.forEach((node, index) => {
      const path = paths?.[index] ?? this.childPath(parentPath, node, index)
      if (node.nodeName === '#text' && !(node.value ?? '').trim()) {
        if (inlineBuffer.length) {
          inlineBuffer.push(node)
          inlinePaths.push(path)
        }
        return
      }
      if (!node.tagName || !BLOCK.has(node.tagName)) {
        inlineBuffer.push(node)
        inlinePaths.push(path)
        return
      }
      flush()
      out.push(...this.block(node, path, depth + 1))
    })
    flush()
    return out
  }

  private block(node: P5Node, path: string, depth: number): BlockNode[] {
    this.enter(depth)
    const tag = node.tagName!
    if (ACTIVE.has(tag)) {
      this.add('element-dropped', `Dropped active <${tag}> element`, 'warning', path, node)
      return []
    }
    const attrs = this.attrs(node, path)
    if (/^h[1-6]$/.test(tag)) {
      const children = this.blockInlines(node.childNodes ?? [], path, depth + 1)
      let held = attrs
      if (held?.id !== undefined) {
        /*
         * A heading id from HTML is authored input, even when it equals the
         * slug a fresh Carve parse would generate - EXCEPT where the element
         * itself says the renderer wrote it. `roundtrip` mode's input is
         * Carve-produced HTML BY DEFINITION, so there the id can be read back
         * as the generated one rather than assumed authored, and re-emitting it
         * CHANGES THE RENDER: `renderHtml` puts a generated id after every
         * authored attribute and an authored one in the slot it was written in,
         * so `{.k}` and `{.k #H}` are two different documents. carve-rs ruled
         * this in carve-rs#1354 / carve-rs#1355; this is the port
         * (markup-carve/carve-js#1459).
         *
         * WHICH ELEMENT CARRIES THE ID, measured on this engine rather than
         * assumed. A TOP-LEVEL heading is wrapped - `# H` renders
         * `<section id="H"><h1>H</h1></section>` and the `<h1>` carries no id
         * at all - so that id belongs to the SECTION, which is an unsupported
         * element the importer unwraps before any heading arm sees it. A
         * heading INSIDE a container is not sectioned, so the id sits on the
         * `<h1>` itself, and so it does at top level under `sections: false`.
         * This arm is that second placement, and it is the only one where the
         * id is a heading attribute; reading a wrapper's id as a heading's
         * would be a different claim about a different element.
         *
         * BOTH HALVES, AND NEITHER ALONE IS ENOUGH. Position alone eats the id
         * an author wrote LAST (`{.k #Other}`); slug equality alone cannot tell
         * `{.k}` from an id an author wrote FIRST whose value happens to be the
         * slug (`{#H .k}`), which is the shape that makes this a combination
         * bug rather than a defect in either half.
         */
        if (
          this.mode === 'roundtrip' &&
          idInGeneratedPosition(node) &&
          isGeneratedHeadingId(held.id, inlineText(children))
        ) {
          // The renderer derives it again from the same text, so dropping it is
          // the no-op `dropDerived` documents for every other derived
          // attribute. Carrying it would spell an authored slot the source
          // never had - and an id that was the whole of `attrs` leaves the
          // heading with none rather than an empty attribute block.
          const { id: _dropped, ...rest } = held
          held = Object.keys(rest).length > 0 ? (rest as Attrs) : undefined
        } else if (this.writing) {
          // Authored. Attribute order is exhaustive when present, so retain
          // every populated slot.
          //
          // ON THE WRITING EXIT ONLY. `order` is a source-layout field and an
          // import read no source, so the published tree records none of them
          // (markup-carve/carve#1647); see `writing` above for why the writer
          // still needs the slot.
          held.order = slotOrderFromElement(node, held)
        }
      }
      return [{ type: 'heading', level: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6, children, ...(held ? { attrs: held } : {}) }]
    }
    if (tag === 'p') {
      /*
       * PART 11 §7 DECIDES WHAT AN IMPORT KEEPS, and it draws the line at
       * the two-character `whitespace` terminal. A block whose every
       * character is layout builds NO node - a lone space or tab line is a
       * blank line, so a paragraph there is a node no Carve source spells -
       * while a block holding a character §7 calls content keeps both the
       * character and its paragraph. A NO-BREAK space is content, and so are
       * U+202F and U+3000: a lone one of those reads back as a paragraph.
       *
       * The drop is REPORTED, because an element left the document.
       *
       * READ OFF THE BUILT CHILDREN, not off the element's text. A second
       * walk of the subtree to weigh its characters is a recursion the
       * depth counter does not cover, and it overflowed the stack on the
       * nesting the counter exists to survive. `inlines()` is already
       * guarded, and the trim already removes exactly the characters §7
       * calls layout - so what it leaves answers the question by itself.
       *
       * A block that held NOTHING is untouched, and the distinction is the
       * point: §7 weighs the characters a block holds, and an empty one
       * holds none for the clause to call layout.
       */
      const raw = this.inlines(node.childNodes ?? [], path, depth + 1)
      const children = trimBlockEdges(raw)
      if (children.length === 0 && raw.length > 0) {
        this.add(
          'element-dropped',
          `Dropped whitespace-only <${tag}> holding no content character`,
          'warning',
          path,
          node,
        )
        return []
      }
      const paragraph: BlockNode = { type: 'paragraph', children, ...(attrs ? { attrs } : {}) }
      /*
       * CARVE SOURCE CANNOT SPELL THIS PARAGRAPH, so a writer loses it and
       * §16 says the writing exit reports that (carve-js#1419).
       *
       * `spec/resources/examples/edge-cases.md` is what rules the shape: "a
       * paragraph whose whole content is one image is still the standalone
       * image shape, not a wrapped one". So `![G](g.jpg)` re-reads as a BLOCK
       * image and the `<p>` is gone - the mirror of carve-js#1411, where the
       * paragraph was OURS and the tree was the wrong exit. This one is the
       * author's, the tree is right, and the loss belongs to the writer.
       *
       * NOT A CHANGE OF OUTPUT, because there is no other output to write.
       * ` ![G](g.jpg)` does parse as a paragraph holding one image, but the
       * canonical writer normalizes the indent away, and inside a list item or
       * a definition description the marker absorbs it at every width - so the
       * device does not exist for `list_item > paragraph > image` at all.
       */
      if (children.length === 1 && children[0]!.type === 'image') {
        this.loneImageParagraphs.push({
          node,
          path,
          block: paragraph,
          attributed: attrs !== undefined,
          overwritten: overwrittenAttrNames(attrs, (children[0] as { attrs?: Attrs }).attrs),
        })
      }
      return [paragraph]
    }
    if (tag === 'blockquote') return [{ type: 'block_quote', children: this.blocks(node.childNodes ?? [], path, depth + 1), ...(attrs ? { attrs } : {}) }]
    if (tag === 'ul' || tag === 'ol') return this.list(node, path, depth, tag === 'ol', attrs)
    if (tag === 'dl') return this.definitionList(node, path, depth, attrs)
    if (tag === 'pre') {
      const code = node.childNodes?.find((n) => n.tagName === 'code')
      const source = code ?? node
      const className = this.attr(source, 'class') ?? ''
      const lang = className.split(/\s+/).find((c) => c.startsWith('language-'))?.slice(9)
      // Rendered code blocks conventionally carry one newline before </code>.
      // It separates payload from markup; it is not an additional blank source
      // line. Remove exactly one so a real trailing blank line (two newlines)
      // remains data and Carve's own HTML round-trips semantically.
      const content = this.text(source).replace(/\n$/, '')
      return [{ type: 'code_block', content, ...(lang ? { lang } : {}), ...(attrs ? { attrs } : {}) }]
    }
    // The synthetic element `markFootnotePlacement` leaves where an endnotes
    // section sat that was NOT last; never present in real HTML input. It reads
    // back as the `::: footnotes` placement directive, which is what puts the
    // rebuilt section back in that slot instead of at document end.
    if (tag === 'carve-footnote-placement') return [{ type: 'admonition', kind: 'footnotes', children: [] }]
    if (tag === 'hr') return [{ type: 'thematic_break', ...(attrs ? { attrs } : {}) }]
    if (tag === 'table') return [this.table(node, path, depth, attrs)]
    if (tag === 'figure') return this.figure(node, path, depth, attrs)
    if (tag === 'details') return [this.disclosure(node, path, depth, attrs)]
    if (tag === 'div') {
      /*
       * The block spelling of the same shape, which pandoc and the `math`
       * fence both write as `<div class="math display">\[…\]</div>`. It reads
       * back as the CORE display form, a paragraph holding one display math
       * node (`$$`…``, §18) - not as a ` ```math ` fence, which is an
       * extension: without that extension loaded a fence renders as an
       * ordinary `language-math` code block, so importing to it would hand
       * back an equation that only stays an equation for some readers.
       */
      const math = this.carveMath(node, attrs)
      if (math) {
        // Charged because this arm returns without walking the children, which
        // `blocks()` would have counted one by one. Which arm an element takes
        // must not change what `maxNodes` / `maxDepth` see. Only a div whose
        // classes already carry the pair reaches here - `carveMath` tests them
        // before it reads any text - so a plain div pays for nothing.
        //
        // At `depth + 1`, which is where the skipped traversal would have
        // started: the ordinary div arm below hands its children to `blocks()`
        // at `depth + 1`. Charged from `depth` the subtree was one level short,
        // and `maxNodes` agreed while `maxDepth` did not - a math div imported
        // at a ceiling its own non-math twin was rejected at.
        this.budget(node, depth + 1)
        return [{ type: 'paragraph', children: [math] }]
      }
    }
    if (tag === 'div' || ['article', 'aside', 'footer', 'header', 'main', 'nav', 'section'].includes(tag)) {
      const container = this.containerFrom(tag, attrs)
      if (container) {
        /*
         * THE TITLE PARAGRAPH IS THE CONTAINER'S TITLE, not its first body
         * block. `::: note "A"` renders the title as a
         * `<p class="admonition-title">` inside the aside, so leaving it in the
         * body wrote it back as an ordinary paragraph carrying the renderer's
         * own class - source that renders a SECOND title element on the next
         * pass, and a document whose opening line is no longer the callout's
         * name. Lifted here, and the `aria-labelledby` that pointed at it is
         * dropped as derived, so nothing is left naming an element that no
         * longer exists.
         */
        const children0 = node.childNodes ?? []
        const titleAt = children0.findIndex((child) => this.isAdmonitionTitle(child))
        const titleNode = titleAt < 0 ? undefined : children0[titleAt]
        // The paths stay the ones the elements arrived under: filtering the
        // title out renumbers everything after it, the same reason `details`
        // keeps its summary's siblings numbered where the author put them.
        const body: P5Node[] = []
        const bodyPaths: string[] = []
        children0.forEach((child, index) => {
          if (child === titleNode) return
          body.push(child)
          bodyPaths.push(this.childPath(path, child, index))
        })
        let title: InlineNode[] | undefined
        if (titleNode) {
          // The element itself, not only its children - an empty title is a DOM
          // node the caller's `maxNodes` is counting, exactly as `<summary>` is.
          //
          // AT THE DEPTH THE BLOCK WALK WOULD HAVE USED. The body goes to
          // `blocks(..., depth + 1)`, which enters each child through
          // `block(..., depth + 2)`, so charging the lifted title a level
          // shallower let a titled container pass a `maxDepth` the same DOM
          // without a title is refused at. Found while giving the grouping
          // label the same accounting (markup-carve/carve-js#1413); the node
          // charge here was already right, only the depth was short.
          this.enter(depth + 2)
          const titlePath = this.childPath(path, titleNode, titleAt)
          /*
           * A TITLE HOLDS INLINE CONTENT AND HAS NO ATTRIBUTE SLOT, so whatever
           * the paragraph carried cannot come with it - the same shape as a
           * `<summary>`, and reported the same way rather than in silence
           * (carve-js#1332). The structural `admonition-title` class is the
           * exception and is consumed rather than reported, because the renderer
           * writes it back from the title itself, exactly as the container's own
           * `admonition` class is.
           */
          const own = this.attrs(titleNode, titlePath)
          const leftover = own && { ...own, classes: (own.classes ?? []).filter((c) => c !== 'admonition-title') }
          if (leftover && !leftover.classes.length) delete (leftover as Attrs).classes
          if (leftover && (leftover.id || leftover.classes || leftover.keyValues)) {
            this.add(
              'attribute-dropped',
              `Dropped ${this.attrNames(leftover).join(', ')} on <p>: an admonition title has no attribute slot`,
              'warning',
              titlePath,
              titleNode,
            )
          }
          title = this.blockInlines(titleNode.childNodes ?? [], titlePath, depth + 3)
        }
        // THE GROUPING LABEL IS THE CONTAINER'S TOO, and it sits after the
        // title the renderer wrote, so it is lifted off what the title lift
        // left behind (markup-carve/carve-js#1413).
        const lifted = this.containerLabel(body, bodyPaths, depth)
        return [
          {
            type: 'admonition',
            kind: container.kind,
            ...(title ? { title } : {}),
            ...(lifted ? { label: lifted.label } : {}),
            children: this.blocks(
              lifted?.body ?? body,
              path,
              depth + 1,
              lifted?.bodyPaths ?? bodyPaths,
            ),
            ...(container.attrs ? { attrs: container.attrs } : {}),
          },
        ]
      }
      if (tag !== 'div') {
        // The ELEMENT row is the one a derived wrapper does not earn. What it
        // still CARRIED is reported as it always was: `attrs` here is what
        // survived `dropDerived`, so an author's `class` on the section, or an
        // `aria-label` the default does not match, still goes out with a row.
        // Suppressing both together silenced two real losses.
        if (!this.isDerivedWrapper(node, tag)) {
          this.add('element-unwrapped', `Unwrapped unsupported <${tag}> element`, 'info', path, node)
        }
        this.reportUnwrappedAttributes(node, attrs, tag, path)
      }
      // THE LABEL IS LIFTED FIRST, because it is half of the test below. This
      // arm never had a lift at all - it lived only on the container-CLASS arm
      // above, so `::: figure [g]` reached it and a plain `<div>` never did.
      const own = node.childNodes ?? []
      const lifted =
        tag === 'div'
          ? this.containerLabel(
              own,
              own.map((child, index) => this.childPath(path, child, index)),
              depth,
            )
          : undefined
      const children = lifted
        ? this.blocks(lifted.body, path, depth + 1, lifted.bodyPaths)
        : this.blocks(own, path, depth + 1)
      /*
       * A DIV CARRYING NOTHING ONLY A CONTAINER CAN HOLD IS NOT A CONTAINER
       * WORTH SPELLING, so it unwraps to its content and the `:::` fence is not
       * written (markup-carve/carve#1578). A bare `<div>` carries no meaning of
       * its own: the fence buys the reader nothing and costs two lines of markup
       * nobody asked for.
       *
       * THE BOUNDARY IS WHAT ONLY A CONTAINER CAN HOLD, rather than the tag -
       * and today that is an attribute the language can hold OR a grouping
       * label. carve#1578 wrote the test as `attrs` as a proxy for that
       * principle, and its own rationale said why: "the moment a div carries any
       * attribute the language can hold, the fence comes back, because then
       * there IS something only the container can hold." A label has no spelling
       * anywhere but on an opener, so it is exactly as much "only a container
       * can hold it" as an attribute is; the proxy was simply narrower than the
       * principle it stood in for, and when the two disagree the rationale
       * governs (markup-carve/carve-rs#1315, markup-carve/carve#1650).
       *
       * Keeping the narrow test was not a declarable loss either, which is what
       * settles it. `::: [g]` came back as a `{.div-label}` PARAGRAPH - the
       * container gone and the label now body content, so the document said
       * something it never said. A loss can be declared and an ADDITION cannot.
       *
       * The test is still on what the div KEPT, not on its markup: a label the
       * lift REFUSED was never lifted, so such a div kept nothing and unwraps
       * exactly as before, and `<div style="color:red">` keeps nothing after the
       * style map refuses the declaration.
       */
      if (tag !== 'div' || (!attrs && !lifted)) return children
      return [
        {
          type: 'div',
          ...(lifted ? { label: lifted.label } : {}),
          children,
          ...(attrs ? { attrs } : {}),
        },
      ]
    }
    // The four block tags with no mapping: `address`, `fieldset`, `form` and
    // `hgroup`. The EMBEDS do not reach here - none of them is in `BLOCK`, so
    // they take the inline arm of this same pair of answers, where the policy
    // that covers them is written down.
    if (this.mode === 'roundtrip') {
      this.add('raw-preserved', `Preserved unsupported <${tag}> element as raw HTML`, 'warning', path, node)
      return [{ type: 'raw_block', format: 'html', content: serializeOuter(node as never) }]
    }
    this.add('element-unwrapped', `Unwrapped unsupported <${tag}> element`, 'info', path, node)
    this.reportUnwrappedAttributes(node, attrs, tag, path)
    return this.blocks(node.childNodes ?? [], path, depth + 1)
  }

  /**
   * A NON-`li` CHILD IS NOT DISCARDED, and not discarded in silence either
   * (carve-js#1340). Filtering the children down to `<li>` and walking only
   * those took the WHOLE of anything else the list carried:
   * `<ul><div id="stray">z</div><li>a</li></ul>` came back as one item and an
   * EMPTY report, so the text `z` left the document with nothing anywhere
   * saying it had.
   *
   * HTML5 does not allow the shape. A sliced-up editor export produces it
   * anyway, and that is the input an importer exists for.
   *
   * The content is emitted as blocks AHEAD OF THE LIST: it keeps every word
   * and stays valid Carve, where a list holding a non-item has no Carve
   * spelling at all. The stray child goes through the ORDINARY block walk
   * rather than being unwrapped by hand, so it keeps its own element and its
   * attributes too - a `<div id="stray">` comes back as a Carve div still
   * carrying the id. Unwrapping it, the way a `<dd>` with no `<dt>` has to,
   * would drop the id for no reason: a `<dd>` has no standalone spelling and a
   * div has one, so the loss the `<dd>` is forced into is not forced here.
   *
   * `element-unwrapped` is the code: a structural note about the INPUT that
   * loses no meaning, which is what the vocabulary says that code is for. No
   * engine spells "moved", and inventing a code for it is a three-engine
   * decision rather than this defect's.
   *
   * Delegating to `blocks()` also settles the kinds that are not elements at
   * all: a margin between pretty-printed items is blank text and produces
   * nothing, a comment produces nothing, bare text directly inside the list is
   * wrapped in the paragraph it needs, and an ACTIVE element (`script`,
   * `style`, `template`, `noscript`) keeps the `element-dropped` every other
   * site gives it. That drop was a SECOND silence the filtered walk carried:
   * the element never reached the arm that reports it, so a `<script>` in a
   * list was dropped with no diagnostic at all. It gets no position note
   * beside the drop - saying it was kept ahead of the list would tell the
   * reader a script survived somewhere.
   *
   * The paths are the child's OWN indices among the LIST's children, so the
   * report points where the node sits and not where it sits in the filtered
   * array (PART 12 §16).
   */
  private list(node: P5Node, path: string, depth: number, ordered: boolean, attrs?: Attrs): BlockNode[] {
    const listItems: P5Node[] = []
    const stray: P5Node[] = []
    const strayPaths: string[] = []
    ;(node.childNodes ?? []).forEach((child, index) => {
      if (child.tagName === 'li') {
        listItems.push(child)
        return
      }
      const childPath = this.childPath(path, child, index)
      const strayTag = child.tagName
      if (strayTag !== undefined) {
        if (!ACTIVE.has(strayTag)) {
          this.add(
            'element-unwrapped',
            `A <${strayTag}> inside <${ordered ? 'ol' : 'ul'}> kept its content but not its place among the items: it is emitted as blocks ahead of the list`,
            'warning',
            childPath,
            child,
          )
        }
      } else if (child.nodeName !== '#comment' && (child.value ?? '').trim() !== '') {
        this.add(
          'element-unwrapped',
          `Text directly inside <${ordered ? 'ol' : 'ul'}> kept its content but not its place among the items: it is emitted as a paragraph ahead of the list`,
          'warning',
          childPath,
          child,
        )
      }
      stray.push(child)
      strayPaths.push(childPath)
    })
    // The strays are walked BEFORE the items, so their diagnostics and their
    // share of the node budget land in document order rather than behind every
    // item the list happens to hold.
    const before = stray.length ? this.blocks(stray, path, depth + 1, strayPaths) : []
    const items = listItems.map((li, i) => {
      const liPath = `${path}/li[${i + 1}]`
      const input = li.childNodes?.find(
        (n) => n.tagName === 'input' && this.isEnumeratedKeyword(this.attr(n, 'type'), 'checkbox'),
      )
      const liAttrs = this.attrs(li, liPath)
      return {
        type: 'list_item' as const,
        ...(input ? { checked: this.attr(input, 'checked') !== undefined } : {}),
        children: this.blocks((li.childNodes ?? []).filter((n) => n !== input), liPath, depth + 1),
        ...(liAttrs ? { attrs: liAttrs } : {}),
      }
    })
    // Tightness is decided by the ITEM SHAPE (ruled, spec docs/html-import.md
    // "Lists keep the source's tightness"; corpus-convert 27/28): a bare-text
    // `<li>one</li>` is a tight item, a paragraph-wrapped `<li><p>one</p></li>`
    // a loose one, and import preserves what the source spelled rather than
    // normalizing it.
    //
    // Carve spells tightness per LIST, not per item, so a MIXED list has to
    // resolve one way, and it resolves the way CommonMark resolves it: ONE
    // paragraph item loosens the whole list. Resolving tight instead would
    // drop the paragraph that item actually spelled - the loss this rule
    // exists to prevent.
    //
    // Only a direct `<p>` votes. A nested `<ul>` beside bare text is
    // structure, not a paragraph wrapper, so `<li>one<ul>...</ul></li>` is the
    // HTML of a tight item with a sublist; the task-list checkbox `<input>` is
    // consumed into the `[x]` marker rather than imported, so it does not vote
    // either.
    const tight = !listItems.some((li) => (li.childNodes ?? []).some((child) => child.tagName === 'p'))
    const start = this.listStart(node, path, ordered)
    const list: List = { type: 'list', ordered, tight, items, ...(start !== undefined && start !== 1 ? { start } : {}), ...this.olType(node, path, ordered, items.length, start ?? 1), ...(attrs ? { attrs } : {}) }
    return [...before, list]
  }

  /**
   * `<dl>` -> `definition_list` (PART 9 §4.5).
   *
   * Without this branch the tag fell through to the unwrap arm, and `dt`/`dd`
   * are not block tags, so every term and every definition landed in the SAME
   * inline buffer: `<dl><dt>Term<dd>Definition</dl>` imported as the single
   * paragraph `TermDefinition`. Not a degraded list - no list at all, and not
   * even a space between the two texts.
   *
   * A run of `<dt>` opens an entry and the `<dd>` run after it belongs to that
   * entry, so `<dt>a<dt>b<dd>c` is one entry with two terms, exactly the shape
   * `:: a` / `:: b` / `:  c` parses to. The HTML5 `<div>` wrapper (allowed
   * around a name-value group since HTML 5.2, and what several editors emit)
   * carries no meaning of its own and is walked through transparently.
   *
   * Anything else directly inside the `<dl>` has no slot in the model. It is
   * kept, as blocks AFTER the list rather than dropped, and reported: moving it
   * changes the document order, which is a smaller loss than deleting it.
   *
   * Three shapes are valid HTML that Carve SOURCE cannot spell, so they are
   * built into the AST and reported by whoever writes (§16): a `<dd>` with no
   * `<dt>` before it, an EMPTY `<dt>` and an EMPTY `<dd>`. Each one writes a
   * line the parser reads as something else, and the tests assert what it
   * reads as rather than only that a diagnostic appeared.
   *
   * `block()` has already counted this node against `maxNodes`, so this walk
   * counts only the elements it visits itself.
   */
  private definitionList(node: P5Node, path: string, depth: number, attrs?: Attrs): BlockNode[] {
    const items: DefinitionItem[] = []
    const trailing: P5Node[] = []
    const trailingPaths: string[] = []
    // A DROPPED ENTRY BREAKS THE LIST, and the break is a real loss
    // (markup-carve/carve#1636). Consecutive `::` lines SHARE the description
    // below them, so writing both terms into one list would hand the surviving
    // term the NEXT entry's description - an ADDITION, which no row can declare
    // and which the ceiling forbids outright. The writer splits instead; what
    // that costs is the grouping, and this is the row that declares it.
    //
    // Only a drop with a TERM after it splits anything. The last-entry shape
    // writes the term alone and stays one list, which is what carve#1627 ruled;
    // and a second description of the SAME entry is not a new entry at all -
    // that term already has it, so nothing is gained and nothing is split.
    let dropped = false
    let splitsHere = false
    let current: DefinitionItem | undefined
    const openEntry = (): DefinitionItem => {
      const entry: DefinitionItem = { terms: [], definitions: [] }
      items.push(entry)
      return entry
    }
    const visit = (children: P5Node[], parentPath: string, level: number): void => {
      children.forEach((child, index) => {
        const childPath = this.childPath(parentPath, child, index)
        if (child.nodeName === '#text' && !(child.value ?? '').trim()) return
        if (child.tagName === 'div') {
          this.enter(level)
          this.entryAttributes(child, childPath, 'div')
          // The wrapper IS the group boundary (HTML 5.2), so an entry never
          // spans two of them: without the reset a `<dd>` opening the second
          // wrapper attached to the first wrapper's term, which both merges two
          // groups and suppresses the no-term diagnostic it is owed.
          current = undefined
          visit(child.childNodes ?? [], childPath, level + 1)
          current = undefined
          return
        }
        if (child.tagName === 'dt') {
          this.enter(level)
          // A term after a definition starts the next entry; a term after a
          // term joins the one being opened.
          if (current === undefined || current.definitions.length > 0) current = openEntry()
          this.entryAttributes(child, childPath, 'dt')
          if (dropped) splitsHere = true
          const term = this.blockInlines(child.childNodes ?? [], childPath, level + 1)
          if (!this.visible(term)) {
            this.unspellable.push({
              node: child,
              path: childPath,
              message: 'An empty <dt> has no Carve spelling; the bare `::` line re-reads as a paragraph',
            })
          }
          current.terms.push(term)
          return
        }
        if (child.tagName === 'dd') {
          this.enter(level)
          // A description with no term before it: kept in the AST, where it is
          // a description of nothing, and reported when a WRITER has to spell
          // it, because `:  text` alone re-reads as a paragraph.
          if (current === undefined) {
            current = openEntry()
            this.unspellable.push({
              node: child,
              path: childPath,
              message: 'A <dd> with no <dt> before it has no Carve spelling; the definition line re-reads as a paragraph',
            })
          }
          this.entryAttributes(child, childPath, 'dd')
          const definition = this.blocks(child.childNodes ?? [], childPath, level + 1)
          // THE CONDITION IS "THIS ENTRY WRITES NOTHING", not "the description
          // is empty": a `<dd>` holding an invisible paragraph or an empty list
          // writes nothing either, and the writer drops all three alike.
          if (this.writesNothing(definition)) {
            dropped = true
            this.unspellable.push({
              node: child,
              path: childPath,
              message: 'A <dd> that writes nothing has no Carve spelling; the empty description is dropped, because the only line that could carry it is read as more of the term above it',
            })
          } else {
            dropped = false
          }
          current.definitions.push(definition)
          return
        }
        this.add('element-unwrapped', `Moved <${child.tagName ?? child.nodeName}> content out of the <dl>: only <dt> and <dd> have a place in a definition list`, 'warning', childPath, child)
        trailing.push(child)
        trailingPaths.push(childPath)
      })
    }
    visit(node.childNodes ?? [], path, depth + 1)
    if (splitsHere) {
      this.split.push({
        node,
        path,
        message: 'A <dd> that writes nothing ends the list it is in; the entries after it are written as a second <dl>, because one list would give the term above it the next entry\'s description',
      })
    }
    const list: BlockNode = { type: 'definition_list', items, ...(attrs ? { attrs } : {}) }
    return [...(items.length ? [list] : []), ...this.blocks(trailing, path, depth + 1, trailingPaths)]
  }

  /**
   * A `<dt>`, `<dd>` or group `<div>` carries attributes and the model has
   * nowhere to put them: PART 12 gives `definition_list` an `attrs` slot and
   * its ENTRIES none, so an `id` an anchor points at, a class a stylesheet
   * selects on and a `data-` pair an editor round-trips all end here. An
   * ordinary `<div>` keeps its attributes by becoming a `div` node; the wrapper
   * inside a `<dl>` cannot, because it is walked through.
   *
   * `attrs()` is still called for its diagnostics: it is where an event-handler
   * attribute is reported, and skipping the call made these three the only
   * places in the importer where active markup was dropped in silence.
   */
  private entryAttributes(
    node: P5Node,
    path: string,
    tag: 'dt' | 'dd' | 'div' | 'summary' | 'figcaption' | 'caption',
    noun?: string,
  ): void {
    const attrs = this.attrs(node, path)
    if (attrs === undefined) return
    const slot = noun ?? `a definition ${tag === 'dt' ? 'term' : tag === 'dd' ? 'description' : 'group'}`
    this.add('attribute-dropped', `Dropped ${this.attrNames(attrs).join(', ')} on <${tag}>: ${slot} has no attribute slot`, 'warning', path, node)
  }

  /**
   * The container an `<aside>` or `<div>` was RENDERED FROM, rebuilt.
   *
   * This is `renderAdmonition` read backwards, and it is written as that
   * inverse rather than as a list of names on purpose. The renderer sends an
   * `admonition` to one of exactly two shapes: a kind in
   * `CANONICAL_ADMONITION_KINDS` becomes
   * `<aside class="admonition {kind}">`, and every other kind - a tab set, a
   * code group, a panel, a Tier-2 container an extension invented - becomes
   * `<div class="{kind}">`, with the node's own extra classes appended after
   * the structural one. Inverting the mapping therefore covers the constructs
   * nobody has thought of yet; naming `tabs` and `code-group` would have
   * covered two and gone on losing the rest (markup-carve/carve-js#1316).
   *
   * WHAT IT COSTS TO UNWRAP INSTEAD is a node, not bytes, which is why an
   * HTML-to-HTML check never found it: an unwrapped `<aside>` re-renders as
   * the same `<p>` it went in as, and a `<div class="tabs">` kept as a `div`
   * node with a `.tabs` class re-renders byte-identically too. Only the AST
   * moved - `admonition` became `div`, or vanished - and the document stopped
   * being a callout while looking exactly like one
   * (markup-carve/carve-js#1295).
   *
   * THE STRUCTURAL CLASS IS CONSUMED, not kept beside the fence word, because
   * the renderer writes it back from the kind. Keeping it would make the next
   * render emit `class="tabs tabs"`, and `dropDerived` already relies on the
   * same reading to recognize the naming attributes that ride these elements.
   */
  private containerFrom(tag: string, attrs: Attrs | undefined): { kind: string; attrs?: Attrs } | undefined {
    const classes = attrs?.classes ?? []
    // An `<aside>` is the canonical half, and it is the CLASS PAIR that marks
    // one - `admonition` plus a Tier-1 kind. A bare `<aside>` is somebody
    // else's sidebar and keeps the unwrap it has always had.
    const kind =
      tag === 'aside'
        ? classes.includes('admonition')
          ? classes.find((name) => name !== 'admonition' && CANONICAL_ADMONITION_KINDS.has(name))
          : undefined
        : tag === 'div'
          ? classes[0]
          : undefined
    // The writer's own rule, not a copy of it: a class a fence opener cannot
    // spell (`2col`, `my.class`) would be written after the colons and read
    // back as a paragraph, so such an element keeps the generic `div` node
    // where the class survives as a class.
    if (kind === undefined || !isContainerKind(kind)) return undefined
    const rest = classes.filter((name) => (tag === 'aside' ? name !== 'admonition' && name !== kind : name !== kind))
    const kept: Attrs = { ...attrs }
    delete kept.classes
    if (rest.length) kept.classes = rest
    return { kind, ...(kept.id || kept.classes || kept.keyValues ? { attrs: kept } : {}) }
  }

  /**
   * A CAPTION's inlines, with the caption ELEMENT accounted for.
   *
   * A caption line holds inline content and has no attribute slot, so a
   * `<figcaption>` or a table `<caption>` is consumed for its CHILDREN and the
   * element itself contributes no node. Reading `childNodes` straight past it -
   * which all four caption sites did - meant the element's own attributes were
   * never looked at, so nothing was kept and nothing was said: an
   * `onclick` on a `<figcaption>` was stripped in silence, and a silent drop is
   * the one failure mode the report exists to prevent
   * (markup-carve/carve-js#1332).
   *
   * THIS IS THE CATEGORY, not the element. The importer already had the answer
   * for a `<dt>`, a `<dd>`, a `<dl>`'s group wrapper and a `<summary>` - route
   * the node through `attrs()` for its diagnostics even though the model has
   * nowhere to put the result - and `entryAttributes` is that answer. The two
   * caption slots were simply not wired to it, which is why the comment there
   * claiming those were "the only places where active markup was dropped in
   * silence" had stopped being true. Every consumed-for-its-children element
   * now goes through one helper, so the next slot added inherits the report
   * rather than having to remember it.
   */
  private captionInlines(node: P5Node, path: string, depth: number, tag: 'figcaption' | 'caption'): InlineNode[] {
    this.entryAttributes(node, path, tag, 'a caption line')
    return trimBlockEdges(this.inlines(node.childNodes ?? [], path, depth))
  }

  private attrNames(attrs: Attrs): string[] {
    return [
      ...(attrs.id ? ['id'] : []),
      ...(attrs.classes ? ['class'] : []),
      ...Object.keys(attrs.keyValues ?? {}),
    ]
  }

  /**
   * The attributes an UNWRAPPED element takes with it.
   *
   * `attrs()` reports the ones it cannot represent, and keeps the rest - an id
   * an anchor points at, a class a stylesheet selects on, a `data-` pair an
   * editor round-trips. When the element itself is then unwrapped there is
   * nothing left to hang them on, and they went in silence: a
   * `<video id="player">` reported that the element was unwrapped and never
   * that the id had gone with it.
   */
  /**
   * Is the ELEMENT itself one the renderer derives, rather than one the author
   * wrote?
   *
   * The same property `derivedAttributes()` answers for a value, asked of the
   * wrapper: an endnotes `<section>` is reconstructable from the document -
   * `render-html.ts` writes one around the notes whenever the document has any
   * - and no Carve construct spells a `<section>`, so nothing the AUTHOR wrote
   * goes when it is unwrapped. `element-unwrapped` names a loss, and there is
   * none to name (markup-carve/carve-php#1588).
   *
   * IT DOES NOT DEPEND ON WHAT THIS IMPORT DOES NEXT. The referenced form is
   * consumed into footnote definitions and the renderer writes the section back;
   * the reference-less form degrades to the `<hr>` and `<ol>` it is built from
   * and the renderer writes no section at all (markup-carve/carve#1558). Either
   * way the author never wrote the wrapper, so neither way is a loss. Asking
   * the OUTPUT instead is the question that made the report contradict the
   * conversion, which is what markup-carve/carve#1502 measured.
   *
   * SCOPED TO THE ROLE, not to `<section>`. A `<section id="intro">` an author
   * wrote is unwrapped and still reports both rows, because nothing derives it.
   */
  private footnotePlacementMarked = false

  private isDerivedWrapper(node: P5Node, tag: string): boolean {
    return tag === 'section' && this.attr(node, 'role') === 'doc-endnotes'
  }

  private reportUnwrappedAttributes(node: P5Node, attrs: Attrs | undefined, tag: string, path: string): void {
    if (attrs === undefined) return
    this.add('attribute-dropped', `Dropped ${this.attrNames(attrs).join(', ')} with the unwrapped <${tag}>: there is no element left to carry them`, 'warning', path, node)
  }

  /**
   * Whether a description's blocks reach the written source at all.
   *
   * An empty ARRAY is the obvious case, and it is not the only one: the two
   * further shapes measured against the writer are a paragraph with no visible
   * text (`<dd><p></p></dd>`) and a list with no items (`<dd><ul></ul></dd>`).
   * None of the three reaches the source: the writer drops a description that
   * would write nothing, because the bare `:` line it used to emit is read as
   * more of the TERM above it - losing the description AND damaging the term
   * (carve#1608). Everything else writes something the reparse keeps - an empty
   * `<li>` comes back as `:  - +` and an empty `<blockquote>` as `:  >`, which
   * are descriptions, not losses.
   *
   * A DECLARED LOSS IS A CEILING, NOT A LICENCE: this is what declares the one
   * the writer takes, and dropping the description is all it covers.
   */
  private writesNothing(blocks: BlockNode[]): boolean {
    return blocks.every(
      (block) =>
        (block.type === 'paragraph' && !this.visible(block.children)) ||
        (block.type === 'list' && block.items.length === 0),
    )
  }

  /**
   * `<ol type>` -> `olType`, the marker alphabet the list counts in.
   *
   * The attribute was already exempt from the unsupported-attribute report, so
   * `<ol type="a">` looked like something the importer handled - and nothing
   * read it, so the list came back counting `1.` `2.` `3.` with no diagnostic
   * anywhere. HTML's five values map exactly onto Carve's four plus the
   * default: `1` IS the default and carries no field, so it is not a loss.
   *
   * A value that is none of the five is not HTML's, so nothing can be derived
   * from it and it is reported here rather than exempted into silence.
   *
   * The FIELD survives every time; the written MARKER does not, and the two
   * shapes where it does not are reported as serialization losses (§16) rather
   * than traded for a silently different list. Both were measured against the
   * writer and the parser over every start from 1 to 60 in each alphabet:
   *
   * - an alphabetic list starting past the 26th letter. Carve's grammar has no
   *   multi-letter alphabetic marker at all - `aa. x` is a paragraph - so the
   *   writer's marker wraps and the list restarts at `a`.
   * - a ONE-ITEM list whose only marker is a letter the other alphabet claims.
   *   A single `i` reads as the roman numeral and every other single letter as
   *   the alphabetic one, so alphabetic 9 and roman 5, 10, 50, 100, 500 and
   *   1000 come back as the other kind. A second item settles it - `v.` `vi.`
   *   is roman 5 - which is why the count is part of the question.
   */
  /**
   * `<ol start>` under HTML's own rules for parsing integers: optional sign,
   * then digits, within a signed 32-bit range. Anything else is not a number
   * the attribute defines and the default stands, which is what a browser does
   * with it too.
   *
   * `Number()` stood here and accepts what HTML does not: `2.9` opened a list
   * at 2.9 and `1e3` at 1000, both written back as their own marker, and `foo`
   * became NaN, which the writer spelled `NaN. x`. None of it was reported.
   */
  private listStart(node: P5Node, path: string, ordered: boolean): number | undefined {
    if (!ordered) return undefined
    const raw = this.attr(node, 'start')
    if (raw === undefined) return 1
    const value = Number(raw.trim())
    if (/^[+-]?\d+$/.test(raw.trim()) && Number.isSafeInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647) return value
    this.add('attribute-dropped', `Dropped start="${raw}" on <ol>: not an integer HTML defines, so the list starts where it would without it`, 'warning', path, node)
    return 1
  }

  private olType(node: P5Node, path: string, ordered: boolean, items: number, start: number): Record<string, never> | { olType: NonNullable<List['olType']> } {
    const value = ordered ? this.attr(node, 'type') : undefined
    if (value === undefined || value === '1') return {}
    if (value !== 'a' && value !== 'A' && value !== 'i' && value !== 'I') {
      this.add('attribute-dropped', `Dropped type="${value}" on <ol>: an ordered list counts in 1, a, A, i or I`, 'warning', path, node)
      return {}
    }
    const alphabetic = value === 'a' || value === 'A'
    // An alphabet counts from ONE. `start="0"` and a negative start are valid
    // HTML and there is no letter at those positions, so this is not a marker
    // the writer loses - it is a value the mapping has no image for, and the
    // list stays the decimal one it already was. Keeping the alphabet here
    // would be worse than the loss it reports: the writer derives its letter
    // arithmetically, so zero comes out as a BACKTICK and -3 as `]`, putting
    // characters in the document that can pair with a later one.
    if (start < 1) {
      this.add('attribute-dropped', `Dropped type="${value}" on <ol> with start="${start}": an alphabet has no letter before the first`, 'warning', path, node)
      return {}
    }
    // Roman notation ends at 3999. Past it the writer has no numeral and
    // repeats the thousands letter instead, so `start="1000000000"` is a
    // 40-byte input asking for a million characters PER ITEM - the kind of
    // amplification `maxNodes` and `maxDepth` are here to refuse. The LAST
    // item is the one to ask about, not the first: a list opened at 3999 and
    // run long crosses the same boundary from inside, and its output then
    // grows as the square of its length. The list keeps its decimal counting,
    // which spells any position in its own digits.
    const last = start + Math.max(items, 1) - 1
    if (!alphabetic && last > 3999) {
      this.add('attribute-dropped', `Dropped type="${value}" on <ol> reaching ${last}: roman notation has no numeral above 3999`, 'warning', path, node)
      return {}
    }
    if (alphabetic && start > 26) {
      this.unspellable.push({
        node: node,
        path,
        message: `An alphabetic list starting at ${start} has no Carve spelling; there is no multi-letter marker, so the written list restarts at the first letter`,
      })
    } else if (items === 1 && (alphabetic ? start === 9 : [5, 10, 50, 100, 500, 1000].includes(start))) {
      this.unspellable.push({
        node: node,
        path,
        message: `A one-item ${alphabetic ? 'alphabetic' : 'roman'} list starting at ${start} has no Carve spelling; its only marker is a letter the other alphabet claims, and nothing follows it to settle which`,
      })
    }
    return { olType: value }
  }

  /**
   * `<details>/<summary>` -> the `details` admonition (`::: details "Summary"`).
   *
   * It used to become a generic `div` carrying a `details` CLASS, and the
   * `<summary>` was not recognized at all: it unwrapped into the body, so the
   * label of the disclosure became its first paragraph and re-rendered inside
   * the box rather than on it. Nothing round-tripped - `<div class="details">`
   * is not a disclosure element, and a reader had no way back to one.
   *
   * The admonition is what the `details()` extension renders as a real
   * `<details>`, with the title as the `<summary>`, so the import lands on the
   * form Carve already has for this rather than on a container that resembles
   * it. A `<details>` with no `<summary>` keeps the extension's default label,
   * which is what the element itself does in a browser.
   */
  private disclosure(node: P5Node, path: string, depth: number, attrs?: Attrs): BlockNode {
    const children0 = node.childNodes ?? []
    const summaryIndex = children0.findIndex((n) => n.tagName === 'summary')
    const summary = summaryIndex < 0 ? undefined : children0[summaryIndex]
    // The paths stay the ones the elements arrived under. Filtering the summary
    // out renumbers everything after it, so a `<script>` at `/details[1]/
    // script[2]` would be reported at `script[1]` - and a summary that is not
    // first is not `summary[1]` either.
    const summaryPath = summary ? this.childPath(path, summary, summaryIndex) : ''
    const body: P5Node[] = []
    const bodyPaths: string[] = []
    children0.forEach((child, index) => {
      if (child === summary) return
      body.push(child)
      bodyPaths.push(this.childPath(path, child, index))
    })
    let title: InlineNode[] | undefined
    if (summary) {
      // The element itself, not only its children: an empty `<summary>` is a
      // DOM node the caller's `maxNodes` is counting, and reading straight past
      // it let a document process more nodes than the limit allows.
      this.enter(depth + 1)
      this.entryAttributes(summary, summaryPath, 'summary', 'a disclosure label')
      title = this.blockInlines(summary.childNodes ?? [], summaryPath, depth + 2)
    }
    const children = this.blocks(body, path, depth + 1, bodyPaths)
    if (title && this.visible(title) && !this.spellableTitle(title)) {
      // Kept as the body's first paragraph rather than as the title. This is
      // the one place the import degrades the TREE instead of recording a
      // writer loss, because the written form here is not a degraded document
      // but a destroyed one: an unspellable title makes the opening line
      // ordinary text, and the whole disclosure - body included - re-reads as
      // one paragraph. The label survives as a paragraph instead, which is
      // where it landed before this mapping existed anyway.
      this.add(
        'element-unwrapped',
        'Unwrapped a <summary> into the body: a disclosure title cannot spell a double quote or a line break, and writing one makes the whole block a paragraph',
        'warning',
        summaryPath,
        // Set together with `title`, which this branch is guarded by.
        summary!,
      )
      return { type: 'admonition', kind: 'details', children: [{ type: 'paragraph', children: title }, ...children], ...(attrs ? { attrs } : {}) }
    }
    return {
      type: 'admonition',
      kind: 'details',
      ...(title && this.visible(title) ? { title } : {}),
      children,
      ...(attrs ? { attrs } : {}),
    }
  }

  /**
   * Whether the writer can put these inlines in the quoted title slot.
   *
   * The slot is delimited by `"` and the grammar gives it no escape, so a
   * double quote ends the title early and the opener stops being one. A line
   * break does the same thing for the same reason: the opener is a LINE.
   *
   * The question is asked of the WRITTEN form, not of the text nodes. A quote
   * reaches the title through more than its own text - an attribute VALUE is
   * written quoted, so `<span title='a"b'>hi</span>` is spelled
   * `[hi]{title="a\"b"}` and carries three of them - and enumerating the
   * spellings that can produce one is the kind of second copy of the grammar
   * that goes stale the next time a spelling is added. Rendering the inlines
   * asks the writer itself.
   */
  private spellableTitle(title: InlineNode[]): boolean {
    const written = renderCarve({ type: 'document', children: [{ type: 'paragraph', children: title }] })
    return !written.includes('"') && !written.trimEnd().includes('\n')
  }

  /**
   * A `colspan`/`rowspan` value, by HTML's rules: a non-negative integer,
   * clamped to the attribute's own maximum, defaulting when it is not one.
   *
   * The clamp is not decoration. Each unit of a span becomes a CELL below, so
   * an unclamped `colspan="1000000000"` is a 30-byte input asking for a billion
   * of them; the generated cells are charged to `maxNodes` on top of this, so
   * the two together bound what a table can cost.
   */
  private spanCount(cell: P5Node, name: 'colspan' | 'rowspan', max: number, min: number): number {
    const raw = this.attr(cell, name)
    if (raw === undefined) return 1
    const value = Number(raw.trim())
    if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(value)) return 1
    return Math.min(Math.max(value, min), max)
  }

  /**
   * The imported cells, laid out with the continuation cells Carve spells `^`
   * (this cell continues the one above) and `<` (it continues the one to its
   * left).
   *
   * The model already carried both - `table_cell.span` is in PART 12 and the
   * HTML renderer derives `rowspan`/`colspan` from a run of them - and the
   * import simply threw them away: a spanning cell was written as an ordinary
   * one and the row came up short, so `<td colspan="2">` produced a 1-cell row
   * under a 2-column header, with `table-degraded` as the only trace.
   *
   * The renderer resolves a continuation by POSITION IN THE ROW'S CELL ARRAY,
   * not by grid column - `^` attaches to the nearest row above whose cell at
   * the same index is not itself a continuation - so a carried span occupies
   * ONE array slot however many columns it covers, and the cells after it in
   * the row shift left by the rest. Placing the carried marks first and filling
   * the row's own cells around them is what keeps those indexes aligned.
   */
  private spanGrid(
    tr: P5Node[],
    built: Array<Array<{ cell: TableCell; colspan: number; rowspan: number }>>,
    rowAttrs: Array<Attrs | undefined>,
    path: string,
    depth: number,
  ): TableRow[] {
    let carried: Array<{ index: number; rows: number }> = []
    const rows: TableRow[] = []
    built.forEach((sourceCells, r) => {
      const marks = new Set(carried.map((entry) => entry.index))
      const cells: TableCell[] = []
      const opened: Array<{ index: number; rows: number }> = []
      const continuation = (span: 'rowspan' | 'colspan', header: boolean): TableCell => {
        this.enter(depth)
        return { type: 'table_cell', header, span, children: [] }
      }
      const fillMarks = (): void => {
        while (marks.has(cells.length)) cells.push(continuation('rowspan', false))
      }
      for (const { cell, colspan, rowspan } of sourceCells) {
        fillMarks()
        const columns: number[] = [cells.length]
        cells.push(cell)
        for (let k = 1; k < colspan; k++) {
          fillMarks()
          columns.push(cells.length)
          cells.push(continuation('colspan', cell.header))
        }
        // A cell spanning BOTH ways carries a mark into EACH column it covers,
        // not one for its origin. The renderer resolves a `^` against the cell
        // at the same index above it, so a single mark left the next rowspan in
        // the row resolving against a column it does not own: the gap between
        // them was filled with a cell the source did not have, reported as an
        // invention, and rendered as a `<td>` the table does not have.
        if (rowspan > 1) for (const index of columns) opened.push({ index, rows: rowspan - 1 })
      }
      // A mark past the end of this row's own cells. Placing it still costs
      // nothing - it is a cell the span already owns - but a GAP before it does:
      // the index has to be kept, and an empty cell there is one the source did
      // not have. Only that invention is reported.
      const furthest = marks.size === 0 ? -1 : Math.max(...marks)
      let invented = false
      while (cells.length <= furthest) {
        if (marks.has(cells.length)) cells.push(continuation('rowspan', false))
        else {
          this.enter(depth)
          cells.push({ type: 'table_cell', header: false, children: [] })
          invented = true
        }
      }
      if (invented) {
        this.add('table-degraded', 'Filled a row that is shorter than the spans reaching into it, with a cell the source did not have', 'warning', `${path}/tr[${r + 1}]`, tr[r])
      }
      rows.push({ type: 'table_row', cells, ...(rowAttrs[r] ? { attrs: rowAttrs[r] } : {}) })
      carried = [...carried.map((entry) => ({ ...entry, rows: entry.rows - 1 })).filter((entry) => entry.rows > 0), ...opened]
    })
    return rows
  }

  private table(node: P5Node, path: string, depth: number, attrs?: Attrs): BlockNode {
    /*
     * `<caption>` is a DIRECT child of the table and holds the table's own
     * caption, which `table.caption` has a slot for and Carve spells `^ text`
     * after the rows. The row walk below looks only for `tr`, so before this
     * the element was skipped and the caption left the document silently -
     * pandoc emits exactly this shape for every captioned table.
     */
    const captions = (node.childNodes ?? [])
      .map((n, index) => ({ node: n, index }))
      .filter(({ node: n }) => n.tagName === 'caption')
    const captionNode = captions[0]?.node
    // The PARSER keeps the first `^ ` line and reads the second as a paragraph,
    // so a table that arrives with two captions loses one either way. Reported
    // rather than dropped in silence, and the same rule as the parser's, so the
    // import and a re-read of its own output agree on which one survives.
    for (const extra of captions.slice(1)) {
      this.add(
        'table-degraded',
        'Dropped a second <caption>: a table has one caption, and the first one wins',
        'warning',
        this.childPath(path, extra.node, extra.index),
        extra.node,
      )
    }
    /*
     * `<colgroup>` has nowhere to land at all. Carve has no column model, and
     * whether it should get one is a language question (carve#1092) rather than
     * this importer's to answer - but the drop can say so meanwhile, and the
     * walk below said nothing: it looks for `tr`, descends through the element
     * and finds none.
     *
     * Only `<colgroup>` is scanned for. "In table" insertion mode answers a
     * `col` start tag by inserting an implied `<colgroup>` first, so
     * `<table><col span="2"><col>` arrives as one wrapper holding both and a
     * `<col>` is never a direct child of a `<table>` after parsing. A `col` arm
     * here could match nothing on any input - the check that cannot fail
     * (carve#755) - so the shape is pinned by a test instead.
     */
    ;(node.childNodes ?? []).forEach((child, index) => {
      if (child.tagName !== 'colgroup') return
      this.add(
        'element-dropped',
        "Dropped <colgroup>: Carve has no column model, and a table's columns are only the cells its rows carry",
        'warning',
        this.childPath(path, child, index),
        child,
      )
    })
    const tr: P5Node[] = []
    const group = new Map<P5Node, P5Node>()
    // The sections in document order, collected on the way through rather than
    // read back off the rows: a section with NO rows is one of the table's
    // sections too, and deriving the list from the rows left its attributes
    // unread and unreported.
    const sectionNodes: P5Node[] = []
    const walk = (n: P5Node, section?: P5Node): void => {
      if (n.tagName === 'tr') {
        tr.push(n)
        if (section) group.set(n, section)
        return
      }
      const isSection = ['thead', 'tbody', 'tfoot'].includes(n.tagName ?? '')
      if (isSection) sectionNodes.push(n)
      for (const child of n.childNodes ?? []) walk(child, isSection ? n : section)
    }
    walk(node)
    // The attributes of the SECTIONS, read once and in document order. Only a
    // `<tbody>` has a slot for them - the body group `rowGroups` states - so
    // `rowGroups` takes what it places out of this map and whatever is left is
    // reported. Nothing read them before: a `<tbody id="totals">` fell into the
    // empty `attrs` slot with no diagnostic at all (carve#1210).
    const sectionAttrs = new Map<P5Node, { attrs: Attrs; path: string }>()
    for (const section of sectionNodes) {
      const sectionPath = this.childPath(path, section, (node.childNodes ?? []).indexOf(section))
      const sectionOwn = this.attrs(section, sectionPath)
      if (sectionOwn) sectionAttrs.set(section, { attrs: sectionOwn, path: sectionPath })
    }
    // The leading run of all-header rows is what PART 10 §T9 gives `scope="col"`;
    // a header cell below it gets `scope="row"`. Computed over the rows rather
    // than per cell, because the run ENDS at the first row carrying a `td` and
    // a cell cannot see that on its own.
    const headerCells = (row: P5Node): P5Node[] =>
      (row.childNodes ?? []).filter((n) => n.tagName === 'td' || n.tagName === 'th')
    let leadingHeaderRows = 0
    for (const row of tr) {
      const cells = headerCells(row)
      if (cells.length === 0 || !cells.every((n) => n.tagName === 'th')) break
      leadingHeaderRows += 1
    }

    // How many rows are left in each row's own group, INCLUDING it. Computed
    // once: asking per cell meant scanning the whole table for each one, which
    // is quadratic in the row count and showed as 3000 rows in 299 ms against
    // 6000 in 852 ms.
    const remainingInGroup = new Map<P5Node, number>()
    const groupTotals = new Map<P5Node | undefined, number>()
    for (const row of tr) groupTotals.set(group.get(row), (groupTotals.get(group.get(row)) ?? 0) + 1)
    const groupSeen = new Map<P5Node | undefined, number>()
    for (const row of tr) {
      const section = group.get(row)
      const index = groupSeen.get(section) ?? 0
      groupSeen.set(section, index + 1)
      remainingInGroup.set(row, (groupTotals.get(section) ?? 1) - index)
    }

    const built: Array<Array<{ cell: TableCell; colspan: number; rowspan: number }>> = tr.map((row, r) =>
      (row.childNodes ?? []).filter((n) => n.tagName === 'td' || n.tagName === 'th').map((cell, c) => {
        const cellPath = `${path}/tr[${r + 1}]/${cell.tagName}[${c + 1}]`
        const colspan = this.spanCount(cell, 'colspan', 1000, 1)
        // A rowspan stops at its ROW GROUP in HTML, and `rowspan="0"` means
        // exactly "to the end of it". Both are resolved against the group the
        // row is actually in, so a `<tfoot>` below the body is not swallowed by
        // a cell the layout stops at the body's last row - not only the `0`
        // form, which was the half this handled first.
        const declaredRowspan = this.spanCount(cell, 'rowspan', 65534, 0)
        const left = remainingInGroup.get(row) ?? 1
        let rowspan = declaredRowspan === 0 ? left : Math.min(declaredRowspan, left)
        // And it stops at the head the RENDERER will synthesize. Carve derives
        // the head from the leading run of all-header rows, so a span reaching
        // out of that run lands in a `<thead>` with its other rows in the
        // `<tbody>` - which browsers clip, making the written table say
        // something the source table did not. Clipped here instead, where it
        // can be reported: the alternative is a document that claims a grid it
        // does not render.
        if (r < leadingHeaderRows && r + rowspan > leadingHeaderRows) {
          this.add(
            'table-degraded',
            'Clipped a rowspan at the header rows: Carve derives the head from the leading header rows, and a span leaving them crosses a boundary browsers clip anyway',
            'warning',
            cellPath,
            cell,
          )
          rowspan = leadingHeaderRows - r
        }
        const cellAttrs = this.attrs(cell, cellPath)
        // A `scope` the renderer would regenerate from position is the
        // generator's own output, not something the author typed: importing it
        // writes it back as if they had. Only a value position cannot explain
        // survives.
        const scope = cellAttrs?.keyValues?.scope
        if (scope !== undefined) {
          const positional = r < leadingHeaderRows ? 'col' : 'row'
          // Only the POSITIONAL value goes. Every other one is kept wherever
          // the cell sits, including below the header rows: `header_cell` has
          // an attribute slot now, after its markers (§5 T10), so such a cell
          // is spelled `|={scope=rowgroup}A|` and re-reads as the header cell
          // it was. It used to be dropped and reported, because the only shape
          // available then was `|{scope=…}=A|` - a DATA cell whose content is
          // the literal `=A` - and keeping the value there traded a header cell
          // for an attribute.
          if (scope === positional) {
            delete cellAttrs!.keyValues!.scope
            if (Object.keys(cellAttrs!.keyValues!).length === 0) delete cellAttrs!.keyValues
          }
        }
        const kept = cellAttrs && (cellAttrs.id || cellAttrs.classes || cellAttrs.keyValues) ? cellAttrs : undefined
        return {
          cell: { type: 'table_cell' as const, header: cell.tagName === 'th', children: this.blockInlines(cell.childNodes ?? [], cellPath, depth + 1), ...(kept ? { attrs: kept } : {}) },
          colspan,
          rowspan,
        }
      }),
    )
    // A `<tr>`'s own attributes have a slot - `table_row.attrs`, which the
    // writer spells on the closing pipe and every renderer emits on the `<tr>`
    // - and went in silence before this.
    const rowAttrs = tr.map((row, r) => this.attrs(row, `${path}/tr[${r + 1}]`))
    const rows = this.spanGrid(tr, built, rowAttrs, path, depth)
    const rowGroups = this.rowGroups(node, tr, rows, group, leadingHeaderRows, path, sectionAttrs)
    // Whatever `rowGroups` did not place. A `<thead>` and a `<tfoot>` have no
    // slot at all - the field states the head and foot as COUNTS - and a
    // `<tbody>`'s attributes reach nothing when the field itself is not kept.
    const sectionsWithRows = new Set(tr.map((row) => group.get(row)))
    for (const [section, own] of sectionAttrs) {
      const tag = section.tagName ?? 'tbody'
      // A body group IS the run of rows it consumes, so a section with none is
      // not a group and has nowhere to put them. Stating it as a zero-count
      // group would put a body in the partition that describes no rows.
      const reason = tag !== 'tbody'
        ? `a table's ${tag === 'thead' ? 'head' : 'foot'} is stated as a row count and has no attribute slot`
        : sectionsWithRows.has(section)
          ? 'the row grouping this body belongs to was not kept, and nothing else holds it'
          : 'a body group is the rows it consumes, and this one has none'
      this.add('attribute-dropped', `Dropped ${this.attrNames(own.attrs).join(', ')} on <${tag}>: ${reason}`, 'warning', own.path, section)
    }
    /*
     * THE CAPTION IS NUMBERED WHERE THE AUTHOR PUT IT (PART 12 §16,
     * markup-carve/carve#1560). A step counts among ALL of the parent's child
     * nodes, and the clause's three exemptions - an item among the items, a row
     * among the rows, a cell among the cells of its row - are the whole of it,
     * because the importer reads those parents through a shape of its own. A
     * table has at most one caption, so there is nothing to renumber and no
     * exemption to claim.
     *
     * The literal `caption[1]` this replaces never consulted a position at all,
     * and what it printed was the caption's rank among the captions - the one
     * basis the clause forbids, and the reading a reader also gets from
     * resolving the path as XPath. It agreed with the child index only for a
     * table written with no whitespace: `<table>` on its own line puts a text
     * node first, so the caption is the SECOND child and `caption[1]` named a
     * node the reader does not have. The second-caption row below already
     * counted this way, so one element spoke under two bases.
     */
    const caption = captionNode
      ? this.captionInlines(
          captionNode,
          `${path}/caption[${captions[0]!.index + 1}]`,
          depth + 1,
          'caption',
        )
      : undefined
    return { type: 'table', rows, ...(rowGroups ? { rowGroups } : {}), ...(caption ? { caption } : {}), ...(attrs ? { attrs } : {}) }
  }

  /**
   * `<thead>/<tbody>/<tfoot>` -> `table.rowGroups`, when the partition says
   * something a reader cannot derive (carve#1210 D1, ruled as (b)).
   *
   * Every renderer already derives a structure from the rows alone: the leading
   * run of all-header rows is the head, everything after it is one body, there
   * is no foot and there are no row-head columns. A `<thead>` over a `<tbody>`
   * is exactly that, so emitting the field for it would put structure into
   * every imported table that the source form cannot spell and hand-written
   * Carve never carries - which is what (a) was and what (b) rejects.
   *
   * So it is emitted only where the two DISAGREE: a `<tfoot>`, a second
   * `<tbody>`, a body with its own intermediate header rows, a body with
   * row-head columns, or a `<thead>` whose rows are not all header cells (Word
   * and pandoc both emit `<thead><tr><td>`), where the derived head is empty
   * and the stated one is not.
   *
   * A `<tbody>`'s own attributes are one of those disagreements: the derived
   * structure has no way to say them, so a body carrying any is not derivable
   * and the field is emitted to hold them in the body group's `attrs`. Only a
   * BODY has that slot - the head and the foot are stated as counts - so a
   * `<thead>` or `<tfoot>` that carries attributes is reported by the caller,
   * along with a `<tbody>` whose group was dropped for another reason.
   *
   * The counts are not checked against `rows.length` here. They are built from
   * the same row list the rows are built from, so a check at this point cannot
   * fail; PART 12 §15's MUST is enforced where a payload arrives from
   * elsewhere, in `fromAstJson`.
   */
  private rowGroups(
    node: P5Node,
    tr: P5Node[],
    rows: TableRow[],
    group: Map<P5Node, P5Node>,
    leadingHeaderRows: number,
    path: string,
    sectionAttrs: Map<P5Node, { attrs: Attrs; path: string }>,
  ): TableRowGroups | undefined {
    if (tr.length === 0) return undefined
    const sectionOf = (row: P5Node): string => group.get(row)?.tagName ?? 'tbody'
    const isHeaderRow = (row: P5Node): boolean => {
      const cells = (row.childNodes ?? []).filter((n) => n.tagName === 'td' || n.tagName === 'th')
      return cells.length > 0 && cells.every((n) => n.tagName === 'th')
    }
    // The head is a PREFIX of `rows` and the foot a SUFFIX, which is what the
    // field can express. A `<thead>` that is not first, or a `<tfoot>` with
    // rows after it, is a table this cannot describe.
    const sections = tr.map(sectionOf)
    const headRows = sections.findIndex((name) => name !== 'thead') === -1 ? tr.length : sections.findIndex((name) => name !== 'thead')
    let footRows = 0
    while (footRows < tr.length - headRows && sections[tr.length - 1 - footRows] === 'tfoot') footRows += 1
    const middle = tr.slice(headRows, tr.length - footRows)
    if (middle.some((row) => sectionOf(row) === 'thead' || sectionOf(row) === 'tfoot')) {
      this.add(
        'table-degraded',
        'Dropped the row grouping of a table whose <thead> or <tfoot> is not at the edge of its rows: the head is a prefix of the rows and the foot a suffix',
        'warning',
        path,
        node,
      )
      return undefined
    }

    const bodies: TableBodyGroup[] = []
    let index = 0
    while (index < middle.length) {
      const section = group.get(middle[index]!)
      const groupRows: P5Node[] = []
      while (index < middle.length && group.get(middle[index]!) === section) groupRows.push(middle[index++]!)
      let groupHead = 0
      while (groupHead < groupRows.length && isHeaderRow(groupRows[groupHead]!)) groupHead += 1
      // A group whose rows are ALL header rows is an intermediate header with
      // nothing under it, which is what the counts say and not something to
      // reinterpret.
      const first = tr.indexOf(groupRows[groupHead] ?? groupRows[0]!)
      const rowHeadColumns = groupHead < groupRows.length
        ? this.rowHeadColumns(rows.slice(first, first + groupRows.length - groupHead), rows, first)
        : 0
      // The `<tbody>`'s own attributes: the body group is where the exchanged
      // model puts them, and it is the only section with a slot.
      const own = section ? sectionAttrs.get(section) : undefined
      bodies.push({ headRows: groupHead, bodyRows: groupRows.length - groupHead, ...(rowHeadColumns > 0 ? { rowHeadColumns } : {}), ...(own ? { attrs: own.attrs } : {}) })
      // Claimed here rather than after the return below, because a body
      // carrying attributes is never DERIVABLE - that is what the clause on
      // `derivable` says - so the field is returned whenever one was claimed,
      // and the only return that skips this point is the one before the loop.
      // A deferral for it was here and no mutation of it could change an
      // output.
      if (section && own) sectionAttrs.delete(section)
    }

    // No `<thead>` at all: the leading run of header rows is what every renderer
    // reads as the head, so it is counted as one here too. Without this, the
    // ORDINARY table - a header row and some data rows, with only the implicit
    // `<tbody>` the HTML parser inserts - came out with an intermediate header
    // and no head, which is a different statement about the same table and puts
    // the field on nearly every document. That is exactly what (b) rejects.
    let headRows2 = headRows
    // ONE body only. With a second one, the header-only first body is a
    // BOUNDARY the field exists to record, and absorbing it away left a single
    // ordinary body that the derivation reproduces - so the two bodies went
    // silently, which is the opposite of the point.
    if (headRows2 === 0 && bodies.length === 1 && leadingHeaderRows > 0) {
      const absorbed = Math.min(leadingHeaderRows, bodies[0]!.headRows)
      headRows2 = absorbed
      bodies[0] = { ...bodies[0]!, headRows: bodies[0]!.headRows - absorbed }
      // A group carrying attributes is not empty, whatever its counts say:
      // dropping it here would drop them with it.
      if (bodies[0]!.headRows === 0 && bodies[0]!.bodyRows === 0 && bodies[0]!.rowHeadColumns === undefined && bodies[0]!.attrs === undefined) bodies.shift()
    }

    const derivable =
      headRows2 === leadingHeaderRows &&
      footRows === 0 &&
      bodies.length <= 1 &&
      bodies.every((body) => body.headRows === 0 && (body.rowHeadColumns ?? 0) === 0 && body.attrs === undefined)
    if (derivable) return undefined
    // Carve SOURCE has no spelling for the field, so a writer loses it. The
    // AST keeps it and `htmlToCarve` reports it, which is the split §16 draws.
    this.unspellable.push({
      node: node,
      path,
      message: 'A table with an explicit head/body/foot grouping has no Carve spelling; the written table keeps only the structure a reader derives from its rows',
    })
    return { headRows: headRows2, bodies, footRows }
  }

  /**
   * Leading COLUMNS that are header cells in every row of the group.
   *
   * Counted over the expanded grid rather than over the source cells, because
   * columns and cells are not the same thing: `<th colspan="2">` is one element
   * and two columns, and a `<th rowspan="2">` leaves the row below it starting
   * with a data ELEMENT while a header still occupies the column. Both made the
   * count wrong in a table that carries them.
   *
   * A continuation resolves the way the renderer resolves it: `<` to the
   * nearest cell to its left that is not one, `^` to the nearest row above
   * whose cell at the same index is not itself a `^`.
   */
  private rowHeadColumns(groupRows: TableRow[], allRows: TableRow[], firstIndex: number): number {
    if (groupRows.length === 0) return 0
    const headerAt = (r: number, c: number): boolean => {
      const cell = allRows[r]?.cells[c]
      if (cell === undefined) return false
      // A `<` needs no resolution: `spanGrid` builds a colspan continuation
      // carrying its ORIGIN's header flag, so reading the flag off the
      // continuation gives the same answer as walking left to the origin. A
      // branch for it was here and no mutation of it could change an output.
      // A `^` is different - it is built with the flag cleared, because the
      // cell it continues is in another row - so that one is resolved.
      if (cell.span === 'rowspan') {
        // Only a `^` is walked past. The cell above may be a `<`, and that one
        // ALREADY carries its origin's header flag, so reading the flag off it
        // is the answer; walking past it reached the cell two rows up, which
        // says nothing about this column and reported a header column short
        // under a `<th rowspan colspan>`.
        let up = r - 1
        while (up >= 0 && allRows[up]!.cells[c]?.span === 'rowspan') up -= 1
        return up >= 0 ? headerAt(up, c) : false
      }
      return cell.header
    }
    // Every slot is exactly one COLUMN: a source cell contributes its origin
    // plus a `<` per further column, and a carried span contributes a `^` per
    // column it covers, so the array index a continuation resolves by IS the
    // grid column here.
    const leading = (row: TableRow, r: number): number => {
      let slot = 0
      while (slot < row.cells.length && headerAt(r, slot)) slot += 1
      // An all-header row would say every column is a row head, which is what
      // an intermediate HEADER row is, not a row-head column.
      return slot === row.cells.length ? 0 : slot
    }
    return Math.min(...groupRows.map((row, offset) => leading(row, firstIndex + offset)))
  }

  /**
   * The captionable host a `<figure>` body offers, with a SYNTHESIZED paragraph
   * wrapper taken off an image (PART 9 §4b; markup-carve/carve#1606).
   *
   * §4b enumerates what a caption makes of its host - "an image, a quote, a
   * code block, a display-math paragraph" - and PART 12 §17 and
   * `docs/ast-json.md` repeat the enumeration verbatim. The image host is the
   * IMAGE; only the math host is a paragraph, which §4b spells out for that one
   * case. So the asymmetry is named rather than an omission, and a paragraph
   * around an image target is not an equivalent spelling of the same tree: it
   * renders `<figure><p><img></p>`, which is not the input, and it disagrees
   * with the source this importer writes beside it - `![a](i.png)` under a `^ `
   * line parses to `figure{target: image}`.
   *
   * The wrapper is OURS, not the author's. HTML has no block/inline slot
   * distinction, so `blocks()` puts a stray inline into a paragraph to have
   * somewhere to put it; taking that paragraph back off drops nothing the
   * document held.
   *
   * AN ATTRIBUTE-CARRYING `<p>` IS THE AUTHOR'S AND STAYS. Its tree renders
   * back to the input exactly - `<figure><p class="x"><img></p></figure>` - so
   * on that shape the wrapper is the faithful half and the loss is on the
   * writing side, where the class rides a block-attribute line that re-parses
   * onto the figure. Unwrapping it here would delete an attribute from the one
   * exit that still records it.
   */
  private captionHost(target: BlockNode | undefined): BlockNode | undefined {
    if (!target || target.type !== 'paragraph') return target
    const children = (target as Paragraph).children
    if ((target as Paragraph).attrs || children.length !== 1) return target
    const only = children[0]
    return only.type === 'image' ? (only as unknown as BlockNode) : target
  }

  private figure(node: P5Node, path: string, depth: number, attrs?: Attrs): BlockNode[] {
    // Our own composite-figure shape (PART 9 §4c): the group class marks the
    // wrapper, the panels div holds the children. Own-output round trip only;
    // a foreign nested figure without the class keeps the unwrap below.
    if ((this.attr(node, 'class') ?? '').split(/\s+/).includes('carve-figure-group')) {
      return this.figureGroup(node, path, depth, attrs)
    }
    /*
     * THE CAPTION IS LIFTED OUT, AND NOTHING ELSE MOVES (carve#1554). Both
     * lists below are read against the figure's OWN children, because that is
     * what a step's index counts among (PART 12 §16): filtering the caption out
     * and renumbering the rest reported `<figure><figcaption>c</figcaption>
     * <img onclick>` at `/figure[1]/img[1]`, one short of the position the
     * `<img>` holds in the document a reader is looking at. The caption's step
     * was a literal `figcaption[1]` for the same reason - it is wherever the
     * author put it, which is second here and fourth in a pretty-printed
     * figure.
     */
    const children = node.childNodes ?? []
    const captionAt = children.findIndex((n) => n.tagName === 'figcaption')
    const captionNode = captionAt < 0 ? undefined : children[captionAt]
    const captionPath = `${path}/figcaption[${captionAt + 1}]`
    const bodyPaths: string[] = []
    const body: P5Node[] = []
    children.forEach((child, index) => {
      if (child === captionNode) return
      body.push(child)
      bodyPaths.push(this.childPath(path, child, index))
    })
    const targets = this.blocks(body, path, depth + 1, bodyPaths)
    const target = this.captionHost(targets[0])
    if (target && ['image', 'block_quote', 'table', 'code_block', 'paragraph'].includes(target.type)) {
      /*
       * A table brings its own caption slot, so a figure-wrapped table can
       * arrive carrying TWO captions - its own `<caption>` and the figure's
       * `<figcaption>`. Carve spells one `^ ` line per host, and the wrapper
       * itself has no spelling at all, so the figure's caption is the one that
       * cannot survive. Keeping both wrote two `^ ` lines, and the second
       * re-read as a literal paragraph.
       */
      if (target.type === 'table' && (target as { caption?: unknown }).caption && captionNode) {
        this.add(
          'table-degraded',
          'Dropped a <figcaption> from a figure wrapping a table that carries its own <caption>: Carve spells one caption per table',
          'warning',
          captionPath,
          captionNode,
        )
        /*
         * THE SIXTH CAPTION SITE, and the only one where the element goes
         * WHOLE. `table-degraded` above says the caption was dropped, and says
         * nothing about what rode on it - so an `onclick` here was stripped
         * with no `attribute-dropped` row, which is the same silence this
         * change removes everywhere else. The call is what reports it: an
         * event handler is diagnosed inside `attrs()`, and anything it kept is
         * named here, because the element it would have ridden on is gone.
         */
        const own = this.attrs(captionNode, captionPath)
        if (own) {
          this.add(
            'attribute-dropped',
            `Dropped ${this.attrNames(own).join(', ')} with the <figcaption>: the element itself is not kept`,
            'warning',
            captionPath,
            captionNode,
          )
        }
        return [target, ...targets.slice(1)]
      }
      const caption = captionNode ? this.captionInlines(captionNode, captionPath, depth + 1, 'figcaption') : []
      /*
       * A FIGURE WITH NO CAPTION IS NOT A FIGURE (PART 9 §4b: the node is the
       * GENERIC CAPTIONED WRAPPER, and Carve builds one only from a `^ ` line on
       * a captionable host). A `<figure>` carrying no `<figcaption>`, or one
       * whose caption contributes nothing, therefore has nothing to build a
       * figure FROM, and building one anyway made the two exits disagree: the
       * tree said `figure` while the source said the target plus a literal `^`,
       * because a caret with nothing after it is not a caption line
       * (markup-carve/carve-js#1423). It reached every target - an image and a
       * quote came back as a paragraph, a code block and a table gained a stray
       * `<p>^</p>` after them.
       *
       * IT IS AN ADDITION AND NOT A LOSS, so it is fixed rather than declared:
       * the `^` is the document coming back saying something it never said, and
       * a `structure-unspellable` row is a ceiling an import may SIT inside, not
       * a licence to change what the document means (`bareBlockImage`, below, says the
       * same thing about the wrapper it takes off).
       *
       * The unwrap keeps `targets` as the body imported them rather than the
       * caption HOST: `captionHost` takes a wrapper off an image because a
       * figure's image target is the image itself, and with no figure there is
       * no such slot - an authored `<p>` around the image stays a paragraph and
       * takes its own declared row (markup-carve/carve-js#1422).
       */
      if (!this.captionSpellsSomething(caption)) {
        this.add('element-unwrapped', 'Unwrapped a <figure> with no caption content: a figure is the captioned wrapper, and a caret with nothing after it is not a caption line', 'warning', path, node)
        this.reportUnwrappedAttributes(node, attrs, 'figure', path)
        return targets
      }
      /*
       * PART 12 §16: the wrapper around a TABLE is the one figure this import
       * produces that Carve source cannot spell, so it survives in the AST and
       * not in the written source. Recorded rather than reported here -
       * `htmlToAst` loses nothing, and `htmlToCarve` is where the loss happens.
       *
       * Reached only when a figure is actually built: the branch above returns
       * the table itself when it already carries a caption, and no wrapper
       * exists to lose in that case.
       */
      if (target.type === 'table') {
        this.unspellable.push({
          node: node,
          path,
          message: 'A figure wrapping a table has no Carve spelling; the caption is written on the table, which renders <caption> inside it',
        })
      }
      return [{ type: 'figure', target: target as never, caption, ...(attrs ? { attrs } : {}) }, ...targets.slice(1)]
    }
    this.add('element-unwrapped', 'Unwrapped figure without a representable target', 'warning', path, node)
    this.reportUnwrappedAttributes(node, attrs, 'figure', path)
    return [...targets, ...(captionNode ? [{ type: 'paragraph' as const, children: this.captionInlines(captionNode, captionPath, depth + 1, 'figcaption') }] : [])]
  }

  private inlines(nodes: P5Node[], parentPath: string, depth: number, paths?: string[]): InlineNode[] {
    const out: InlineNode[] = []
    // A BLOCK BOUNDARY IN AN INLINE SLOT SURVIVES ONLY IN THE BYTES (PART 11
    // §1b). A caption holds inline content, so a `<figcaption>` carrying two
    // paragraphs is flattened - and the slot has nowhere to put a node for the
    // boundary, so joining the two sides silently rewrites the document:
    // `one` + `two` is the one word `onetwo`, `<strong>a</strong>` +
    // `<strong>b</strong>` is one strong run holding a literal asterisk, and
    // two code spans become one span holding the delimiters that used to end
    // and begin them. Nothing is dropped in any of those, so no diagnostic
    // fires and no gate below this one can see it.
    let previousWasBlock = false
    nodes.forEach((node, index) => {
      const produced = this.inline(node, paths?.[index] ?? this.childPath(parentPath, node, index), depth)
      const atBoundary = previousWasBlock || isFlattenedBlock(node)
      if (atBoundary && needsSeparator(out, produced)) out.push({ type: 'text', value: ' ' })
      out.push(...produced)
      // A BLOCK THAT CONTRIBUTES NO TOKEN IS NOT A SIDE, so it neither takes a
      // separator of its own nor leaves one owing to the block after it:
      // `<p>a</p><p></p><p>b</p>` is `a b`, never `a  b`.
      if (produced.length > 0) previousWasBlock = isFlattenedBlock(node)
    })
    const merged: InlineNode[] = []
    for (const node of out) {
      const last = merged.at(-1)
      if (node.type === 'text' && last?.type === 'text') last.value += node.value
      else merged.push(node)
    }

    return dropSpaceAfterHardBreak(merged)
  }

  /**
   * `inlines()` for a slot that IS a block's content - a paragraph, a heading,
   * a table cell, a caption, a term, a title - where the whitespace at the two
   * edges is not content and the re-parse will not keep it.
   */
  private blockInlines(nodes: P5Node[], parentPath: string, depth: number, paths?: string[]): InlineNode[] {
    return trimBlockEdges(this.inlines(nodes, parentPath, depth, paths))
  }

  private inline(node: P5Node, path: string, depth: number): InlineNode[] {
    this.enter(depth)
    // HTML's collapsible whitespace is the ASCII set, and `\s` is not it:
    // JavaScript counts U+00A0, U+202F and U+3000 among its whitespace, so
    // collapsing by `\s` rewrote a NO-BREAK SPACE into an ordinary one and
    // the block trim then dropped it. PART 11 §7 draws the line the other
    // way round - a no-break space is CONTENT - so the collapse names the
    // characters HTML actually collapses and leaves every other one alone.
    if (node.nodeName === '#text') {
      return [{ type: 'text', value: (node.value ?? '').replace(/[ \t\n\r\f]+/g, ' ') }]
    }
    const tag = node.tagName
    if (!tag) return []
    if (ACTIVE.has(tag)) {
      this.add('element-dropped', `Dropped active <${tag}> element`, 'warning', path, node)
      return []
    }
    // Not in `roundtrip`, which raw-preserves what Carve CANNOT express. The
    // seven semantic elements are mapped in every mode because their spelling
    // renders back as the element itself; the marks do not - a `<q>` becomes
    // text and its `cite` goes with it - so this mapping is the safe/semantic
    // answer and the raw fallback is the round-tripping one.
    if (tag === 'q' && this.mode !== 'roundtrip') return this.quotation(node, path, depth)
    /*
     * MathML -> `math`, as carve#1210's D6 rules it: a three-tier lookup for
     * TeX that is already in the source, and no MathML-to-TeX converter.
     *
     * THE DECISION IS THE THIRD TIER, and it is a drop rather than a degrade.
     * MathML's children are a token stream, so concatenating them is not a
     * lossy rendering of the equation but a different value: the children of
     * `<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>` concatenate to `12`,
     * which is what this importer wrote before this branch existed. One half
     * arriving as twelve is a plausible wrong value, and a plausible wrong
     * value survives review, where a missing equation and a warning naming it
     * do not. This is the line between math and the EMBEDS below: a `<video>`'s
     * children are fallback content the author wrote for exactly this case.
     *
     * `roundtrip` keeps the whole element instead, through the raw arm at the
     * end of this method, which is where a `<math>` already went - Carve's own
     * HTML spells math as `<span class="math">`, so a `<math>` in that mode's
     * input is foreign markup by definition and the mode's contract is to
     * preserve it verbatim.
     */
    if (tag === 'math') {
      /*
       * Charged once, before anything reads the subtree: every arm below
       * returns without walking the children, so `inlines()` never counts a
       * descendant, and `maxNodes`/`maxDepth` must not depend on which branch
       * an element takes. Before the counter, so a limit is reached by the
       * counter rather than by the read - and once, because charging in the
       * tier lookup as well counted an empty-annotation element's descendants
       * twice.
       */
      this.budget(node, depth)
      const math = this.mathml(node, path)
      if (math) return [math]
      if (this.mode === 'roundtrip') {
        // The same answer the generic arm below gave a `<math>` before this
        // branch existed, and byte for byte the same output. Reported once for
        // the element rather than once per descendant, because the descendants
        // are not preserved separately - they are inside this one raw span.
        this.add('raw-preserved', 'Preserved unsupported <math> element as raw HTML', 'warning', path, node)
        return [{ type: 'raw_inline', format: 'html', content: serializeOuter(node as never) }]
      }
      this.add('element-dropped', 'Dropped <math>: no TeX annotation and no alttext, and its children are a token stream, not an equation', 'warning', path, node)
      return []
    }
    const children = this.inlines(node.childNodes ?? [], path, depth + 1)
    const attrs = this.attrs(node, path)
    if (tag === 'em' || tag === 'i') return [{ type: 'emphasis', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'strong' || tag === 'b') return [{ type: 'strong', children, ...(attrs ? { attrs } : {}) }]
    /*
     * `<del>` and `<ins>` are HTML's change-tracking PAIR and Carve spells that
     * pair `{-x-}` / `{+x+}`, which render back as `<del>` and `<ins>`.
     * `<s>` and `<strike>` are the other thing - content no longer accurate,
     * with no edit implied - and that is `~x~`, which renders `<s>`.
     *
     * `<del>` used to import as `strike`, so a tracked deletion came back as
     * `<s>` while `<ins>` was unwrapped to its text outright. Importing `<ins>`
     * without moving `<del>` would have made that asymmetry worse: the
     * insertion of an edit surviving as an edit and the deletion beside it not.
     */
    /*
     * AN EMPTY ONE HAS NOTHING TO MARK, and inventing a brace pair for it
     * put text in the document the HTML never held (markup-carve/carve#1608).
     * `<ins></ins>` was written as an empty brace pair, which is not a
     * construct at all: it renders as the four literal characters. `<del>`
     * was worse than literal - its empty pair is the braced en dash, so the
     * import rendered a GLYPH for an element that held nothing.
     *
     * So the element is dropped, which keeps the text right because there was
     * none, and the drop is REPORTED - it is an element that left the
     * document, which is what `element-dropped` is for. Dropping in silence
     * is the other engine's half of this shape and is filed there.
     */
    if ((tag === 'del' || tag === 'ins') && children.length === 0) {
      this.add(
        'element-dropped',
        `Dropped an empty <${tag}>: Carve spells the pair around its content, and an empty brace pair is not a construct`,
        'warning',
        path,
        node,
      )
      return []
    }
    if (tag === 'del') return [{ type: 'delete', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'ins') return [{ type: 'insert', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 's' || tag === 'strike') return [{ type: 'strike', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'u') return [{ type: 'underline', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'mark') return [{ type: 'highlight', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'sub') return [{ type: 'subscript', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'sup') return [{ type: 'superscript', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'code') return [{ type: 'code', value: this.text(node), ...(attrs ? { attrs } : {}) }]
    if (tag === 'a') {
      // A DESTINATION CARVE CANNOT CARRY IS NOT A DESTINATION
      // (`spec/docs/html-import.md`). Carve spells a link's destination in one
      // slot and has NO spelling for an empty one - `[t]()` is literal text -
      // so building the link node emitted four punctuation characters the HTML
      // never held, into the middle of the prose. No link node is built: the
      // element's CONTENT stands in its place, carried by a span where an
      // attribute survives and bare where none does.
      //
      // AND THE DESTINATION IS NOT REBUILT, which is the normative half. This
      // is what Carve's own renderer emits: PART 9 section 25 blanks a
      // dangerous destination and writes no provenance for it, keeping the
      // visible text, so any route from a `title`, from the anchor's text or
      // from a round-trip attribute back to a destination would reconstruct the
      // exact value a security rule removed. The round trip owes the text.
      if (destinationIsEmpty(this.attr(node, 'href'))) {
        return this.unwrapDestinationLess(node, 'Unwrapped <a> with no destination', children, attrs, path)
      }
      const title = this.attr(node, 'title')
      // `!== undefined`, not truthiness: `<a href="u" title="">` has a title,
      // and the writer spells the empty one `[x](u "")`. Under a truthiness test
      // it vanished with no diagnostic, because `attrs()` treats a link's title
      // as consumed here rather than keeping it as `{title=…}`.
      return [{ type: 'link', href: this.attr(node, 'href') ?? '', children, ...(title !== undefined ? { title } : {}), ...(attrs ? { attrs } : {}) }]
    }
    if (tag === 'img') {
      // The same rule as the link one branch up, and it is the SAME shape: an
      // `<img>` whose `src` names no destination the source can carry builds no
      // image node either. AN IMAGE'S CONTENT IS ITS ALTERNATIVE TEXT - that is
      // what every target with no image shows for it, and what a browser shows
      // for one it cannot load - so the alt text is what stands in its place.
      //
      // The alt arrives as a raw attribute value rather than through the node
      // walk, so it becomes a TEXT node and the writer escapes it for the prose
      // slot it lands in, the same as any other imported text.
      if (destinationIsEmpty(this.attr(node, 'src'))) {
        const alt = this.attr(node, 'alt') ?? ''
        const stands: InlineNode[] = alt === '' ? [] : [{ type: 'text', value: alt }]
        return this.unwrapDestinationLess(node, 'Unwrapped <img> with no source', stands, attrs, path)
      }
      const title = this.attr(node, 'title')
      return [{ type: 'image', src: this.attr(node, 'src') ?? '', alt: this.attr(node, 'alt') ?? '', ...(title !== undefined ? { title } : {}), ...(attrs ? { attrs } : {}) }]
    }
    if (tag === 'br') {
      // A hard break has no `attrs` slot, so anything `attrs()` kept for this
      // element is lost here and has to say so - the alternative is the silence
      // that carve#1210 exists to kill.
      if (attrs) this.add('attribute-dropped', `Dropped ${this.attrNames(attrs).join(', ')} on <br>: a hard break has no attribute slot`, 'warning', path, node)
      return [{ type: 'hard_break' }]
    }
    // The synthetic element the adapter footnote pass leaves at each
    // reference site (adapterFootnotes); never present in real HTML input.
    if (tag === 'carve-footnote-ref') {
      return [{ type: 'footnote_ref', id: this.attr(node, 'label') ?? '' }]
    }
    if (SEMANTIC_SPAN_TAGS.has(tag)) return [this.semanticSpan(tag, node, children, path, attrs)]
    if (tag === 'span') {
      const math = this.carveMath(node, attrs)
      if (math) return [math]
    }
    if (tag === 'span' && attrs) return [{ type: 'span', children, attrs }]
    /*
     * THE EMBEDS END HERE, AND THAT IS THE POLICY (carve#1210 P10).
     *
     * `video`, `audio`, `iframe`, `svg`, `object`, `embed` and `canvas` are
     * none of them in `BLOCK`, so they arrive at THIS arm and take its two
     * answers: unwrapped to their fallback content in `safe` and `semantic`,
     * raw-preserved in `roundtrip`. Their `src`, and every other attribute, is
     * reported dropped on the way past.
     *
     * Not an oversight and not a to-do. Carve has no embed node, and giving it
     * one is a SPEC question - which media types, which attributes, what a
     * non-HTML renderer does with them, what a `src` means for a document that
     * has to be safe to render from an untrusted source - decided in the spec
     * repo rather than by whichever importer needed it first. Until then the
     * honest import is the one that keeps the fallback content the author wrote
     * for exactly this case, says what it dropped, and keeps the markup
     * verbatim in the mode whose contract is Carve-produced HTML.
     */
    if (this.mode === 'roundtrip') {
      this.add('raw-preserved', `Preserved unsupported <${tag}> element as raw HTML`, 'warning', path, node)
      return [{ type: 'raw_inline', format: 'html', content: serializeOuter(node as never) }]
    }
    this.add('element-unwrapped', `Unwrapped unsupported <${tag}> element`, 'info', path, node)
    this.reportUnwrappedAttributes(node, attrs, tag, path)
    return children
  }

  /**
   * Tiers 1 and 2 of D6: the TeX the producer already put in the element.
   *
   * 1. an `<annotation>` whose encoding DECLARES TeX, taken verbatim;
   * 2. else the `alttext` attribute, plus an `encoding-assumed` recording
   *    that its encoding was guessed - MathML does not declare what `alttext`
   *    holds, and `<math alttext="x squared">` is as valid as one holding TeX.
   *
   * Tier 2 reports `encoding-assumed` and not `element-unwrapped` because the
   * two say different things. Unwrapping describes the INPUT's structure and
   * loses no meaning; an assumed encoding is a claim about the OUTPUT, which
   * is only correct while the guess holds. A consumer told that an element is
   * gone cannot separate a harmless structural event from a math node whose
   * content may not be TeX at all, and that second one is the signal it could
   * act on.
   *
   * Annotation first, and the order carries a ruling: where the two disagree,
   * a declared encoding beats an undeclared attribute. carve-php's own
   * docblock documents the reverse order and is corrected to this one.
   *
   * The content keeps the TeX byte for byte, `{\displaystyle …}` wrapper and
   * all: Carve's math content is opaque TeX and unwrapping it would be a
   * second decision. Only the surrounding whitespace goes, which is the
   * pretty-printer's and not the equation's - and carve-php, which shipped
   * this ruling first, trims it too, so the two engines write one byte
   * sequence for one input.
   *
   * Whitespace-only content is treated as absent, because it is: an empty
   * `alttext` or a pretty-printed empty annotation says nothing about the
   * equation, and falling to the next tier reports the loss instead of
   * writing an empty math node.
   *
   * Returns `undefined` for tier 3, whose two answers are the caller's.
   */
  /**
   * Carve's OWN HTML spelling of math, read back as a `math` node.
   *
   * `<span class="math inline">\(x\)</span>` and its `math display` twin are
   * what `carveToHtml` writes for `` $`x` `` / `` $$`x` `` (PART 9 §18:
   * `math_inline = '$', code_span`) - and what djot.js and pandoc write as
   * well, so this is the shape an importer meets rather than one engine's
   * convention.
   *
   * Without this arm the element fell through to the generic attributed-span
   * writer and an equation came back as `[\\(x\\)]{.math .inline}`. That is
   * the worst kind of loss to catch: the re-rendered HTML is byte-identical,
   * because a span carrying the same classes renders the same tag - so an
   * HTML-to-HTML check reports success. What is gone is the NODE. The AST says
   * `span`, and every non-HTML target then writes the TeX delimiters as prose:
   * the Markdown, plain and ANSI writers have a math case and never reach it.
   *
   * TWO INDEPENDENT SIGNALS HAVE TO AGREE - the `math inline` / `math display`
   * class PAIR, and a payload delimited to match it. Either alone is not
   * evidence. A stylesheet is free to name a class `math`, and `\(x\)` in
   * running prose is an escaped paren: §18 dropped the bare `\(…\)` INPUT
   * form for exactly that reason, so the delimiters are output convention, not
   * syntax. Requiring both also lets the class say which delimiter to expect,
   * so a `math display` span holding `\(…\)` is left alone rather than
   * quietly re-labeled as display math.
   *
   * The `math` / `inline` / `display` classes and a `role="math"` are consumed
   * by the recognition itself, the way `xmlns` is on a `<math>`: the renderer
   * writes all four back from the node. Anything else the author put on the
   * element - `id`, further classes, `data-*` - rides along in `attrs` and
   * survives the round trip.
   *
   * The payload is read off the DIRECT children only (`directText`), never
   * through the recursive `text()`. The block arm reaches this before it has
   * charged the subtree, and a recursive read there would let crafted HTML
   * overflow the stack ahead of the limit that exists to stop it - the reason
   * the `<math>` arm charges its budget before reading, too. An element child
   * ends the read regardless: a delimiter payload is text.
   */
  private carveMath(node: P5Node, attrs: Attrs | undefined): Math | undefined {
    const classes = attrs?.classes
    if (!classes?.includes('math')) return undefined
    const display = classes.includes('display')
    // Not one element in both states: `math inline display` names no shape the
    // renderer can write, so it is a span with two classes, not an equation.
    if (display === classes.includes('inline')) return undefined
    const open = display ? '\\[' : '\\('
    const close = display ? '\\]' : '\\)'
    const text = this.directText(node)?.trim()
    if (text === undefined) return undefined
    if (text.length < open.length + close.length) return undefined
    if (!text.startsWith(open) || !text.endsWith(close)) return undefined
    /*
     * Carve's math content is a `code_span`, which is one line by construction,
     * so a payload folded across source lines has exactly one spelling: the
     * whitespace run collapsed the way `inline()` collapses every other
     * imported text run. TeX reads a newline as whitespace, so the equation is
     * the same equation; a `math` node holding a newline would not be
     * writable at all.
     */
    const content = text.slice(open.length, text.length - close.length).replace(/\s+/g, ' ').trim()
    // `\(\)` carries the delimiters and no equation. There is no empty math.
    if (content === '') return undefined
    return { type: 'math', display, content, ...(this.mathAttrs(attrs!, display) ?? {}) }
  }

  /**
   * The concatenated text of a node's DIRECT children, or `undefined` as soon as
   * one of them is an element. Bounded and non-recursive, unlike `text()`.
   */
  private directText(node: P5Node): string | undefined {
    let out = ''
    for (const child of node.childNodes ?? []) {
      if (child.nodeName !== '#text') return undefined
      out += child.value ?? ''
    }
    return out
  }

  /** What is left of a math element's attributes once recognition has eaten its own. */
  private mathAttrs(attrs: Attrs, display: boolean): { attrs: Attrs } | undefined {
    const classes = [...(attrs.classes ?? [])]
    // The FIRST of each: `class="math math"` keeps the second as an author
    // class, because the renderer only writes the base pair once.
    classes.splice(classes.indexOf('math'), 1)
    classes.splice(classes.indexOf(display ? 'display' : 'inline'), 1)
    const keyValues = { ...(attrs.keyValues ?? {}) }
    // `role="math"` is what the HTML renderer puts on every math node it emits.
    // Keeping it would spell the same attribute twice - once from the node's
    // type and once as `{role=math}` in the source - so it is consumed by
    // having been recognized. A role saying anything else is the author's and
    // stays.
    if (keyValues.role === 'math') delete keyValues.role
    const rest: Attrs = {}
    if (attrs.id) rest.id = attrs.id
    if (classes.length) rest.classes = classes
    if (Object.keys(keyValues).length) rest.keyValues = keyValues
    return rest.id || rest.classes || rest.keyValues ? { attrs: rest } : undefined
  }

  private mathml(node: P5Node, path: string): InlineNode | undefined {
    const annotated = this.texAnnotation(node)
    const content = (annotated ?? this.attr(node, 'alttext') ?? '').trim()
    if (content === '') return undefined
    // After the tier is settled, so a dropped element does not also report
    // attributes on its way out: the `element-dropped` warning covers it.
    const attrs = this.attrs(node, path)
    // On which tier SUPPLIED the content, not on which one was available: an
    // annotation that held only whitespace falls through to `alttext`, and
    // reading the presence of the element would make that fall-through the one
    // tier-2 read that says nothing.
    if (annotated === undefined) {
      this.add('encoding-assumed', 'Read <math> through its alttext: MathML does not declare the encoding of alttext, so TeX is assumed', 'info', path, node)
    }
    return { type: 'math', display: this.attr(node, 'display') === 'block', content, ...(attrs ? { attrs } : {}) }
  }

  /**
   * The `<annotation>` a `<semantics>` carries, if it declares TeX.
   *
   * Both hops are DIRECT children - `<semantics>` of the `<math>`, the
   * annotation of that `<semantics>`. A recursive search reaches the
   * `<annotation>` nested inside an `<annotation-xml>` payload, which is
   * markup describing the equation in some other language and not a
   * presentation of the outer element at all.
   *
   * An annotation that declares TeX and then holds nothing does not settle the
   * tier: the search continues, because a later sibling may hold the equation
   * and stopping at the empty one would answer with the wrong tier.
   */
  private texAnnotation(node: P5Node): string | undefined {
    for (const semantics of node.childNodes ?? []) {
      if (semantics.tagName !== 'semantics') continue
      for (const child of semantics.childNodes ?? []) {
        if (child.tagName !== 'annotation') continue
        const encoding = this.attr(child, 'encoding')
        if (encoding === undefined || !TEX_ANNOTATION_ENCODINGS.has(encoding.trim().toLowerCase())) continue
        const text = this.flatText(child).trim()
        if (text !== '') return text
      }
    }
    return undefined
  }

  /**
   * Charge a subtree the import will not walk against the budgets one it walks
   * would pay, and check its depth while doing so.
   *
   * Explicit stack rather than recursion: this runs on input the DOM parser
   * accepted at any depth, and its whole point is to reach `maxDepth` before
   * something that recurses does.
   */
  /**
   * `text()` without its recursion, for the annotation - which is read to
   * settle the tier, so it is read before any depth counter has seen it. At a
   * caller-raised `maxDepth` a recursive read is the thing that fails first,
   * and a `RangeError` is not the typed error the API promises. Document order
   * is kept by pushing the children in reverse.
   */
  private flatText(node: P5Node): string {
    let text = ''
    const pending: P5Node[] = [node]
    while (pending.length) {
      const current = pending.pop()!
      if (current.nodeName === '#text') text += current.value ?? ''
      const children = current.childNodes ?? []
      for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]!)
    }
    return text
  }

  private budget(node: P5Node, depth: number): void {
    const pending: Array<[P5Node, number]> = [[node, depth]]
    while (pending.length) {
      const [current, currentDepth] = pending.pop()!
      for (const child of current.childNodes ?? []) {
        this.enter(currentDepth + 1)
        pending.push([child, currentDepth + 1])
      }
    }
  }

  /**
   * `<q>` -> the quotation marks a browser draws for it.
   *
   * Carve has no quotation element and needs none: the element's whole rendered
   * effect is the pair of marks, which are ordinary text. So this is a MAPPING
   * rather than the unwrap it used to be - the same content reached the
   * document before, without the marks that made it a quotation.
   *
   * The marks alternate by nesting depth, as a browser's do: double outside,
   * single inside. They are the typographic characters rather than `"`, which
   * the writer escapes back to a straight quote (PART 11 §5 keeps a quote that
   * reached it as TEXT), so the curly pair is both what the element renders as
   * and what survives being written.
   *
   * Still reported, at `info`: the ELEMENT does not come back, and a converter
   * going the other way sees text where a `<q>` was. The message says the
   * mapping was deliberate rather than claiming something was unwrapped.
   */
  private quotation(node: P5Node, path: string, depth: number): InlineNode[] {
    const [open, close] = this.quoteDepth % 2 === 0 ? ['\u201c', '\u201d'] : ['\u2018', '\u2019']
    this.quoteDepth += 1
    try {
      const children = this.inlines(node.childNodes ?? [], path, depth + 1)
      const attrs = this.attrs(node, path)
      const quoted: InlineNode[] = [{ type: 'text', value: open! }, ...children, { type: 'text', value: close! }]
      this.add('element-unwrapped', 'Read <q> as quotation marks: Carve has no quotation element, so the marks are the mapping', 'info', path, node)
      return attrs ? [{ type: 'span', children: quoted, attrs }] : quoted
    } finally {
      this.quoteDepth -= 1
    }
  }

  /**
   * One of the seven semantic elements, as the span attribute that spells it.
   *
   * `<kbd>Tab</kbd>` -> `[Tab]{kbd}`, `<abbr title="X">c</abbr>` -> `[c]{abbr="X"}`,
   * `<time datetime="X">c</time>` -> `[c]{time="X"}` (carve#1140). The compact
   * form, not `:kbd[…]`: the generic spelling has no core handler and is the
   * extension's soft-deprecated compatibility form, so importing into it would
   * write a form scheduled for removal into freshly migrated documents.
   *
   * Placed with the other mapped elements rather than behind a mode branch:
   * `roundtrip` raw-preserves only what Carve CANNOT express, so an element
   * that now has a spelling is spelled in every mode - the same treatment
   * `<mark>` and `<em>` already get.
   *
   * `samp`, `var`, `cite` and `dfn` belong to the SemanticSpan extension, so a
   * CORE render returns `<span samp="">out</span>` rather than `<samp>`. Still
   * strictly better than the unwrap it replaces, where the semantic was
   * discarded outright, but it is a real difference and the tests show it.
   */
  private semanticSpan(tag: string, node: P5Node, children: InlineNode[], path: string, attrs?: Attrs): InlineNode {
    const source = SEMANTIC_SPAN_VALUE_SOURCE.get(tag)
    const value = source === undefined ? '' : this.attr(node, source) ?? ''
    const keyValues: Record<string, string> = { ...attrs?.keyValues }
    // A `title` on `<abbr>`/`<dfn>` IS the value here, not a leftover to ride
    // along: `attrs()` collected it before the tag was known, and keeping both
    // would render the same attribute onto the element twice over.
    if (source === 'title') delete keyValues.title
    // The span's own key is the semantic marker, so an attribute of the SAME
    // name cannot also be carried - `<kbd kbd="literal">` has one slot and two
    // claims on it. It used to be dropped by the keep-list before it got here;
    // now it arrives, so the collision has to be named rather than overwritten
    // in silence (markup-carve/carve-js#1156).
    if (hasOwnKey(keyValues, tag) && keyValues[tag] !== value) {
      this.add('attribute-dropped', `Dropped ${tag} on <${tag}>: the name is this span's own semantic marker`, 'warning', path, node)
    }
    keyValues[tag] = value
    return { type: 'span', children, attrs: { ...attrs, keyValues } }
  }

  private text(node: P5Node): string {
    if (node.nodeName === '#text') return node.value ?? ''
    return (node.childNodes ?? []).map((child) => this.text(child)).join('')
  }

  /**
   * Whether a caption run reaches the page at all.
   *
   * NOT `visible`, and the difference is one character. `visible` asks the host
   * language's `trim()`, which counts U+00A0 as whitespace; PART 11 §7 puts it
   * on the CONTENT side of Carve's layout/content split, so a caption holding
   * only a NO-BREAK SPACE spells something and keeps its line. Asking `visible`
   * here unwrapped `<figcaption>&nbsp;</figcaption>` and deleted a caption the
   * writer would have written - the two halves of one rule disagreeing about
   * what "nothing" means.
   */
  private captionSpellsSomething(nodes: InlineNode[]): boolean {
    return nodes.some((node) => node.type !== 'text' || trimNonNbsp(node.value) !== '')
  }

  private visible(nodes: InlineNode[]): boolean {
    return nodes.some((node) => node.type !== 'text' || node.value.trim() !== '')
  }

  /**
   * The IMAGE a synthesized wrapper was built to hold, when that is all it holds
   * (PART 9 §4b; markup-carve/carve-js#1411).
   *
   * `captionHost` already takes this wrapper off a `<figure>` body, and says why:
   * HTML has no block/inline slot distinction, so `blocks()` puts a stray inline
   * into a paragraph to have somewhere to put it, and the wrapper is OURS rather
   * than the author's. None of that depended on a `<figure>` being present -
   * `captionHost` is simply the only place that was reached from. Everywhere
   * else, a bare `<img>` built `paragraph{image}` while the SOURCE exit wrote
   * `![G](g.jpg)`, which re-parses to a bare `image` block, so this importer's
   * two exits disagreed about a document it built itself.
   *
   * THE ASYMMETRY IS WHY THE WRAPPER GOES RATHER THAN THE DISAGREEMENT BEING
   * DECLARED. A declared LOSS is a ceiling an import may sit inside; an ADDITION
   * is the document coming back saying something it never said. Only the second
   * changes what the document means, so it does not get a diagnostic row - it
   * gets fixed.
   *
   * ONLY A RUN THAT HOLDS NOTHING ELSE - one image, and nothing beside it. A run
   * carrying text, or a second image, is a paragraph the document really has: it
   * is what `![a](i.png) folding content` parses to as well.
   *
   * NO WHITESPACE TOLERANCE HERE, AND THAT WAS MEASURED RATHER THAN ASSUMED. The
   * `\n` between an `<img>` and the block after it IS buffered into the wrapper
   * by `blocks()`, which reads as needing a whitespace-skipping predicate so the
   * image is not left beside a whitespace-only sibling - and the spec's own
   * declared-lag note for `detached-caption-caret` records a tree carrying
   * exactly such a node. In THIS engine `blockInlines` has already trimmed it by
   * the time the run arrives: a sweep of 1,920 shapes - eight block levels,
   * six whitespace paddings on each side, five following blocks - produced ZERO
   * runs holding an image beside whitespace-only text, on unmodified `main`. A
   * tolerance clause would therefore be a branch no input reaches, which is the
   * check-that-cannot-fail shape (markup-carve/carve#755), so the predicate is
   * the strict one the engine can actually exercise.
   *
   * This does not reach a `<p>` the AUTHOR wrote. That arrives through `block()`
   * and never through this buffer, which is the boundary rather than an
   * oversight: taking off a wrapper the document held would be a loss, and a
   * loss is a different call from removing an addition.
   */
  private bareBlockImage(children: InlineNode[]): BlockNode | undefined {
    if (children.length !== 1 || children[0]!.type !== 'image') return undefined
    return children[0] as unknown as BlockNode
  }

  /**
   * The losses a WRITER takes, reported by whoever writes (PART 12 §16).
   *
   * A canonical Carve writer has no spelling for a figure wrapping a table, so
   * it emits the table and a `^ ` caption line, and that re-reads as the
   * table's own caption - `<caption>` inside the table rather than a
   * `<figcaption>` beside it. A description with no term before it is the same
   * kind of loss: `:  text` on its own is a paragraph, not a definition list.
   * The rendering changes in both cases, so the severity is `warning`, and the
   * limit is the importer's own: these diagnostics are not a second budget.
   */
  reportSerializationLosses(document: Document): void {
    for (const { node, path, message } of this.unspellable) {
      this.add('structure-unspellable', message, 'warning', path, node)
    }
    // SURVIVORS ONLY. A candidate whose paragraph an unwrapper took back off is
    // not a loss: the figure target and the table cell both keep the image
    // itself on BOTH exits, and a row there would declare a difference that is
    // not there. Reachability from the finished document is the whole test,
    // because taking the wrapper off is exactly what drops the node.
    const kept = reachableObjects(document)
    for (const { node, path, block, attributed, overwritten } of this.loneImageParagraphs) {
      if (!kept.has(block as unknown as object)) continue
      const head =
        'A paragraph holding nothing but an image has no Carve spelling; the image is written as a block'
      // THREE OUTCOMES, AND THE MESSAGE SAYS WHICH ONE HAPPENED. The plain one
      // loses the `<p>` and nothing else. An attributed one re-attaches what
      // the paragraph carried to the image, which is a different element to
      // carry it. And where the image sets the SAME name, the image's own
      // value wins and the paragraph's is gone - `<p id="p"><img id="i">`
      // writes `{#p}` above `![a](a){#i}` and reads back with `id="i"` alone,
      // so a message claiming the attributes were written on the image would
      // leave that loss undeclared, which is the defect this row exists for.
      const message = !attributed
        ? `${head}, which renders without the <p> around it`
        : overwritten.length === 0
          ? `${head}, so the <p> is lost and the attributes it carried are written on the image instead`
          : `${head}, so the <p> is lost and the attributes it carried are written on the image - except ${overwritten.join(', ')}, which the image's own value overwrites`
      this.add('structure-unspellable', message, 'warning', path, node)
    }
    for (const { node, path, message } of this.split) {
      this.add('structure-split', message, 'warning', path, node)
    }
  }

  /** A copy of `attrs` without one class, `undefined` when nothing remains. */
  private stripClass(attrs: Attrs | undefined, className: string): Attrs | undefined {
    if (!attrs?.classes) return attrs
    const classes = attrs.classes.filter((c) => c !== className)
    const next: Attrs = { ...attrs }
    if (classes.length) next.classes = classes
    else delete next.classes
    if (next.id === undefined && next.classes === undefined && next.keyValues === undefined) {
      return undefined
    }
    return next
  }

  /**
   * Our own `carve-figure-group` output back to a `figure_group` node (PART 9
   * §4c). The FLAT shape: panels and stray content are direct children of the
   * group figure, with the group's own figcaption LAST - a panel figure's
   * figcaption is nested a level down and never read as the group's. A
   * `carve-figure-panel` figure comes back as the panel it rendered from; a
   * bare `<figure><table/></figure>` wrapper (the table panel, which carries
   * no figcaption) unwraps to the table so the table's own caption and attrs
   * stay its own.
   */
  private figureGroup(node: P5Node, path: string, depth: number, attrs?: Attrs): BlockNode[] {
    const groupChildren = node.childNodes ?? []
    let captionAt = -1
    groupChildren.forEach((child, index) => {
      if (child.tagName === 'figcaption') captionAt = index
    })
    const captionNode = captionAt < 0 ? undefined : groupChildren[captionAt]
    const bodyNodes: P5Node[] = []
    const bodyPaths: string[] = []
    groupChildren.forEach((child, index) => {
      if (child === captionNode) return
      bodyNodes.push(child)
      bodyPaths.push(this.childPath(path, child, index))
    })
    const children = this.blocks(bodyNodes, path, depth + 1, bodyPaths)
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!
      if (child.type !== 'figure' || !child.attrs?.classes?.includes('carve-figure-panel')) continue
      const stripped = this.stripClass(child.attrs, 'carve-figure-panel')
      if (stripped) child.attrs = stripped
      else delete child.attrs
      // The explicit table-panel wrapper renders with no figcaption; the
      // generic figure import gave it an empty caption, which is not a shape
      // the parser produces - unwrap back to the table itself.
      if (child.target.type === 'table' && child.caption.length === 0 && child.attrs === undefined) {
        children[i] = child.target
      }
    }
    const group: FigureGroup = { type: 'figure_group', children }
    if (captionNode) {
      group.caption = this.captionInlines(captionNode, `${path}/figcaption[${captionAt + 1}]`, depth + 1, 'figcaption')
    }
    const groupAttrs = this.stripClass(attrs, 'carve-figure-group')
    if (groupAttrs) group.attrs = groupAttrs
    return [group]
  }

  // --------------------------------------------------------------------------
  // Adapter footnotes: word-processor footnote-shaped HTML to footnote nodes.
  //
  // Ports markup-carve/carve-php#1303 (and the branch pins of #1307). The
  // shapes were measured, not recalled - Word's two saves, Google Docs,
  // LibreOffice and Pandoc 1.x agree on almost nothing, and what all of them
  // do have is a MUTUALLY LINKED ANCHOR PAIR: the body reference addresses
  // the note and the note addresses the reference back. That pair, not a
  // vendor class name and not the `fn1`/`fnref1` id convention, is the
  // signature this matches.
  //
  // The spec permits this shape of work - "Adapters may normalize
  // editor-specific markup before the core policy" (docs/html-import.md,
  // "Required API surface") - but it does not rule on footnote import, so
  // every decision below is this importer's, written down rather than left
  // silent. No diagnostics on the edge cases, deliberately: in each of them
  // the Carve source keeps what the HTML said, so there is nothing lossy to
  // report.
  // --------------------------------------------------------------------------

  /**
   * Recognize footnote pairs, rewrite each reference site to a synthetic
   * reference element `inline()` reads as a `footnote_ref`, detach the note
   * blocks, and return their bodies keyed 1..N by document order.
   *
   * Labels are assigned 1..N over the notes in document order rather than
   * parsed out of the ids: an id is generated navigation an engine
   * regenerates, and `_ftn1` or `sdfootnote1sym` is not a label any Carve
   * source could carry anyway.
   *
   * `heuristic` is the word-processor adapters' license: with it the mutual
   * anchor pair alone binds. Without it (`generic` and the editor adapters)
   * only an anchor the producer MARKED with `role="doc-noteref"` opens a
   * pair - authored DPUB-ARIA semantics, which is what carve-php's core
   * policy reads under every adapter - so a role-less document imports
   * exactly as before.
   */
  private adapterFootnotes(root: P5Node, heuristic: boolean): Record<string, BlockNode[]> | undefined {
    const elements = this.footnoteDocumentElements(root)
    const order = new Map<P5Node, number>()
    elements.forEach((element, index) => order.set(element, index))

    const targets = this.footnoteFragmentTargets(elements)
    const candidates = this.resolveFootnotePairDirection(
      this.footnotePairCandidates(elements, targets, heuristic),
      order,
    )
    if (candidates.length === 0) return undefined

    const definitions = this.attachRemainingFootnoteReferences(
      elements,
      this.groupFootnoteDefinitions(candidates, order),
      heuristic,
    )

    const defs: Record<string, BlockNode[]> = {}
    const containers = new Set<P5Node>()

    /*
     * EVERY REFERENCE SITE IS REWRITTEN BEFORE ANY BODY IS CONVERTED
     * (markup-carve/carve-js#1380).
     *
     * These were one loop, so a note's body was converted while the reference
     * sites of every LATER note were still raw anchors. A note body that
     * references another note is exactly that case: note 1's body was
     * converted at index 0, and the anchor in it pointing at note 2 was not
     * replaced until index 1 - too late, so it imported as an ordinary link
     * and came out hand-spelled:
     *
     *     [^1]: see [{^2^}](#fn2){#fnref2 role=doc-noteref}
     *
     * The damage did not stop at the spelling. Nothing referenced `[^2]` any
     * more, so its definition never rendered and the word it held left the
     * document. The pairing was never in doubt - both notes are recognized
     * candidates - only the ORDER in which the two halves ran.
     */
    definitions.forEach((definition, index) => {
      const label = String(index + 1)
      if (index === 0) this.removeFootnoteSeparator(definition.block)

      const identities = definition.refs
        .map((reference) => this.footnoteAnchorIdentity(reference))
        .filter((identity) => identity !== '')
      this.stripFootnoteBacklinks(definition.block, identities, definition.fragments)

      for (const reference of definition.refs) {
        const site = this.footnoteReferenceSite(reference)
        const replacement: P5Node = {
          nodeName: 'carve-footnote-ref',
          tagName: 'carve-footnote-ref',
          attrs: [{ name: 'label', value: label }],
          childNodes: [],
        }
        if (site.parentNode !== undefined) replacement.parentNode = site.parentNode
        this.replaceP5Node(site, replacement)
      }
    })

    // Detached only after the conversion above has read every body, for the
    // same reason: a body detached early is a body another note cannot reach.
    definitions.forEach((definition, index) => {
      const block = definition.block
      defs[String(index + 1)] = this.blocks(block.childNodes ?? [], `footnote[${String(index + 1)}]`, 1)
      if (block.parentNode) containers.add(block.parentNode)
      this.detachP5Node(block)
    })

    // Keyed by identity, because every note in one list names the SAME
    // container: pruning it once per note walked that list's children once
    // per note, which is quadratic on a document that is mostly notes.
    for (const container of containers) this.pruneEmptyFootnoteContainer(container)

    return defs
  }

  /**
   * Every element in the subtree, in document order.
   *
   * ITERATIVE, like every walk in this pass: it runs on EVERY import now
   * (the role reading is not adapter-gated), so a document nested past the
   * JS stack has to reach the depth counter's typed refusal rather than a
   * `RangeError` here - the same §25 rule the renderers follow.
   */
  private footnoteDocumentElements(root: P5Node): P5Node[] {
    const elements: P5Node[] = []
    const stack: P5Node[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node !== root) elements.push(node)
      const children = node.childNodes ?? []
      for (let i = children.length - 1; i >= 0; i--) {
        if (children[i]!.tagName !== undefined) stack.push(children[i]!)
      }
    }
    return elements
  }

  /**
   * Map every same-document fragment name to the element it addresses.
   *
   * `id` first and `name` second, in two passes rather than one, so an `id`
   * always wins over the legacy `<a name>` form when both spell one fragment.
   */
  private footnoteFragmentTargets(elements: P5Node[]): Map<string, P5Node> {
    const targets = new Map<string, P5Node>()
    for (const element of elements) {
      const id = this.attr(element, 'id')
      if (id && !targets.has(id)) targets.set(id, element)
    }
    for (const element of elements) {
      if (element.tagName !== 'a') continue
      const name = this.attr(element, 'name')
      if (name && !targets.has(name)) targets.set(name, element)
    }
    return targets
  }

  /**
   * Every anchor that could be a footnote reference, with the block it would
   * bind to. Under the heuristic a candidate needs the mutual back-link or an
   * explicit reference marker; outside it, ONLY the authored
   * `role="doc-noteref"` opens one - the vendor classes belong to the
   * heuristic, since a class is a styling hook where the role is a statement.
   * An anchor inside its own would-be note is never a candidate.
   */
  private footnotePairCandidates(
    elements: P5Node[],
    targets: Map<string, P5Node>,
    heuristic: boolean,
  ): FootnoteCandidate[] {
    const anchors: Array<{ anchor: P5Node; fragment: string }> = []
    const used = new Set<string>()
    for (const element of elements) {
      if (element.tagName !== 'a') continue
      const href = this.attr(element, 'href') ?? ''
      if (!href.startsWith('#')) continue
      const fragment = href.slice(1)
      if (fragment === '' || !targets.has(fragment)) continue
      anchors.push({ anchor: element, fragment })
      used.add(fragment)
    }

    const candidates: FootnoteCandidate[] = []
    for (const { anchor, fragment } of anchors) {
      if (!heuristic && this.attr(anchor, 'role') !== 'doc-noteref') continue
      const block = this.resolveFootnoteDefinitionBlock(targets.get(fragment)!, used)
      if (block === null || this.p5Contains(block, anchor)) continue

      const identity = this.footnoteAnchorIdentity(anchor)
      const mutual = identity !== '' && this.footnoteBlockLinksTo(block, identity)
      // A role-carrying anchor is marked, so outside the heuristic the role
      // is both the filter above and the confirmation here: the candidate
      // stands with or without a spelled back-link.
      if (!mutual && !this.isFootnoteReferenceMarked(anchor)) continue

      candidates.push({ ref: anchor, block, fragment, mutual })
    }
    return candidates
  }

  /**
   * The block a reference's target belongs to.
   *
   * The target itself when it is already a block (Pandoc's `<li id="fn1">`),
   * otherwise the nearest block ancestor of the anchor the fragment names.
   * Then ONE guarded climb, because Word and LibreOffice wrap each note in a
   * dedicated `<div id=...>` and the body can be several paragraphs inside
   * it: the climb only happens into a wrapper that carries an id and holds
   * exactly one referenced target, which is what keeps a shared container
   * (Google Docs' one trailing `<div>` around every note) from swallowing
   * its siblings. A fragment whose nearest block is the document root itself
   * is refused - taking it would move every block in the document into one
   * note - which here is the climb running off the fragment root.
   */
  private resolveFootnoteDefinitionBlock(target: P5Node, used: Set<string>): P5Node | null {
    let block = target
    while (block.tagName === undefined || !FOOTNOTE_DEFINITION_BLOCKS.has(block.tagName)) {
      const parent = block.parentNode
      if (parent === undefined || parent.tagName === undefined) return null
      block = parent
    }

    const parent = block.parentNode
    if (
      parent !== undefined &&
      parent.tagName !== undefined &&
      FOOTNOTE_WRAPPER_BLOCKS.has(parent.tagName) &&
      (this.attr(parent, 'id') ?? '') !== '' &&
      this.countFootnoteTargets(parent, used) === 1
    ) {
      block = parent
    }
    return block
  }

  /** How many referenced fragment targets this element holds, itself included. */
  private countFootnoteTargets(node: P5Node, used: Set<string>): number {
    let count = 0
    const stack: P5Node[] = [node]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (this.isFootnoteFragmentTarget(current, used)) count++
      for (const child of current.childNodes ?? []) {
        if (child.tagName !== undefined) stack.push(child)
      }
    }
    return count
  }

  private isFootnoteFragmentTarget(node: P5Node, used: Set<string>): boolean {
    const id = this.attr(node, 'id')
    if (id && used.has(id)) return true
    if (node.tagName !== 'a') return false
    const name = this.attr(node, 'name')
    return name !== undefined && name !== '' && used.has(name)
  }

  /**
   * Keep one side of every mutually linked anchor pair.
   *
   * The pair is symmetric, so both directions produce a candidate and one of
   * them is the back-link reading as a reference. An explicit marker decides
   * where there is one; otherwise document order does, because a footnote
   * reference precedes the note it opens in every export shape measured.
   */
  private resolveFootnotePairDirection(
    candidates: FootnoteCandidate[],
    order: Map<P5Node, number>,
  ): FootnoteCandidate[] {
    const byReference = new Map<P5Node, FootnoteCandidate>()
    for (const candidate of candidates) byReference.set(candidate.ref, candidate)

    return candidates.filter((candidate) => {
      const inverse = this.inverseFootnoteCandidate(byReference, candidate)
      return !(inverse !== null && this.footnoteReferenceSideWins(inverse, candidate, order))
    })
  }

  /**
   * The candidate that reads the same mutual pair from the other end.
   *
   * Found through the back anchor the candidate's own block holds rather than
   * by comparing every candidate with every other: a document with a thousand
   * notes made that scan a thousand times a thousand containment walks, and
   * the anchor names the inverse directly.
   */
  private inverseFootnoteCandidate(
    byReference: Map<P5Node, FootnoteCandidate>,
    candidate: FootnoteCandidate,
  ): FootnoteCandidate | null {
    const identity = this.footnoteAnchorIdentity(candidate.ref)
    if (identity === '') return null

    for (const anchor of this.footnoteAnchorsUnder(candidate.block)) {
      if (this.attr(anchor, 'href') !== `#${identity}`) continue
      const inverse = byReference.get(anchor)
      if (inverse === undefined) continue
      if (this.p5Contains(inverse.block, candidate.ref)) return inverse
    }
    return null
  }

  private footnoteReferenceSideWins(
    first: FootnoteCandidate,
    second: FootnoteCandidate,
    order: Map<P5Node, number>,
  ): boolean {
    const firstMarked = this.isFootnoteReferenceMarked(first.ref)
    const secondMarked = this.isFootnoteReferenceMarked(second.ref)
    if (firstMarked !== secondMarked) return firstMarked

    const firstBack = this.isFootnoteBacklinkMarked(first.ref)
    const secondBack = this.isFootnoteBacklinkMarked(second.ref)
    if (firstBack !== secondBack) return secondBack

    return (order.get(first.ref) ?? 0) < (order.get(second.ref) ?? 0)
  }

  /**
   * One entry per definition block, carrying every reference bound to it. A
   * block that contains another definition block is a container, not a note:
   * keeping both would move a subtree into two places at once. The containers
   * are found by climbing from each block, one walk per note rather than one
   * per PAIR of notes.
   */
  private groupFootnoteDefinitions(
    candidates: FootnoteCandidate[],
    order: Map<P5Node, number>,
  ): FootnoteDefinitionGroup[] {
    const groups = new Map<P5Node, FootnoteDefinitionGroup>()
    for (const candidate of candidates) {
      let group = groups.get(candidate.block)
      if (group === undefined) {
        group = { block: candidate.block, refs: [], fragments: [] }
        groups.set(candidate.block, group)
      }
      group.refs.push(candidate.ref)
      if (!group.fragments.includes(candidate.fragment)) group.fragments.push(candidate.fragment)
    }

    for (const group of [...groups.values()]) {
      let ancestor = group.block.parentNode
      while (ancestor !== undefined) {
        if (groups.has(ancestor)) groups.delete(ancestor)
        ancestor = ancestor.parentNode
      }
    }

    return [...groups.values()].sort(
      (first, second) => (order.get(first.block) ?? 0) - (order.get(second.block) ?? 0),
    )
  }

  /**
   * Bind every remaining anchor that addresses a confirmed note.
   *
   * Once a block IS a footnote definition, an anchor pointing at it is a
   * reference to it whatever it looks like. This matters for the second and
   * later reference to one note: only one of them can be the back-link's
   * target, so the mutual pair that confirmed the note cannot confirm them,
   * and without this they stayed literal links beside a `[^1]`. An anchor
   * inside a note stays a link - a note's body may address another note.
   */
  private attachRemainingFootnoteReferences(
    elements: P5Node[],
    definitions: FootnoteDefinitionGroup[],
    heuristic: boolean,
  ): FootnoteDefinitionGroup[] {
    const byFragment = new Map<string, FootnoteDefinitionGroup>()
    for (const definition of definitions) {
      for (const fragment of definition.fragments) byFragment.set(fragment, definition)
    }

    // Which elements sit inside a note, computed once: asking each anchor
    // whether it is inside any note walked the tree once per anchor and per
    // note, which is quadratic on a document that is mostly notes.
    const inside = new Set<P5Node>()
    const stack: P5Node[] = definitions.map((definition) => definition.block)
    while (stack.length > 0) {
      const node = stack.pop()!
      inside.add(node)
      for (const child of node.childNodes ?? []) stack.push(child)
    }

    for (const element of elements) {
      if (element.tagName !== 'a') continue
      // Outside the heuristic an unmarked anchor addressing a note is a LINK,
      // not a reference: the role is the whole signal, and a content link to
      // `#fn1` in a role-marked document keeps the author's shape. (The
      // marked candidates already sit in their groups; this loop exists for
      // the unmarked second reference the heuristic binds.)
      if (!heuristic && this.attr(element, 'role') !== 'doc-noteref') continue
      const href = this.attr(element, 'href') ?? ''
      if (!href.startsWith('#')) continue
      const definition = byFragment.get(href.slice(1))
      if (definition === undefined || inside.has(element)) continue
      if (!definition.refs.includes(element)) definition.refs.push(element)
    }

    return definitions
  }

  private footnoteAnchorIdentity(anchor: P5Node): string {
    const id = this.attr(anchor, 'id')
    return id !== undefined && id !== '' ? id : this.attr(anchor, 'name') ?? ''
  }

  private footnoteBlockLinksTo(block: P5Node, fragment: string): boolean {
    for (const anchor of this.footnoteAnchorsUnder(block)) {
      if (this.attr(anchor, 'href') === `#${fragment}`) return true
    }
    return false
  }

  private footnoteAnchorsUnder(node: P5Node): P5Node[] {
    const anchors: P5Node[] = []
    const stack: P5Node[] = [node]
    while (stack.length > 0) {
      const current = stack.pop()!
      const children = current.childNodes ?? []
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i]!
        if (child.tagName === 'a') anchors.push(child)
        if (child.tagName !== undefined) stack.push(child)
      }
    }
    return anchors
  }

  /**
   * `footnoteRef` is Pandoc 1.x's spelling of `footnote-ref`, which it used
   * together with a back-link carrying no attributes at all.
   */
  private isFootnoteReferenceMarked(anchor: P5Node): boolean {
    if (this.attr(anchor, 'role') === 'doc-noteref') return true
    const classes = (this.attr(anchor, 'class') ?? '').split(/\s+/)
    return classes.includes('footnote-ref') || classes.includes('footnoteRef')
  }

  private isFootnoteBacklinkMarked(anchor: P5Node): boolean {
    if (this.attr(anchor, 'role') === 'doc-backlink') return true
    return (this.attr(anchor, 'class') ?? '').split(/\s+/).includes('footnote-back')
  }

  private p5Contains(ancestor: P5Node, node: P5Node): boolean {
    let current = node.parentNode
    while (current !== undefined) {
      if (current === ancestor) return true
      current = current.parentNode
    }
    return false
  }

  private detachP5Node(node: P5Node): void {
    const siblings = node.parentNode?.childNodes
    if (siblings === undefined) return
    const index = siblings.indexOf(node)
    if (index !== -1) siblings.splice(index, 1)
  }

  private replaceP5Node(node: P5Node, replacement: P5Node): void {
    const siblings = node.parentNode?.childNodes
    if (siblings === undefined) return
    const index = siblings.indexOf(node)
    if (index !== -1) siblings[index] = replacement
  }

  /**
   * Remove the rule that separates the notes from the body.
   *
   * Every producer measured emits one, and it is chrome rather than content:
   * Pandoc puts `<hr />` inside the section, Word `<br clear=all><hr ...>`
   * inside the footnote-list div, Google Docs a bare `<hr class="cN">` as a
   * sibling of the notes. Only the first two would be swept up by pruning an
   * emptied container, so the separator is looked for explicitly - at the
   * first note, and at each of its ancestors, taking only what immediately
   * precedes it.
   */
  private removeFootnoteSeparator(first: P5Node): void {
    let node = first
    while (true) {
      let previous = this.p5PreviousSibling(node)
      while (previous !== undefined && this.isFootnoteChromeNode(previous)) {
        previous = this.p5PreviousSibling(previous)
      }

      if (previous !== undefined && (previous.tagName === 'hr' || previous.tagName === 'br')) {
        this.detachP5Node(previous)
        continue
      }
      if (previous !== undefined) return

      const parent = node.parentNode
      if (parent === undefined || parent.tagName === undefined) return
      node = parent
    }
  }

  private p5PreviousSibling(node: P5Node): P5Node | undefined {
    const siblings = node.parentNode?.childNodes
    if (siblings === undefined) return undefined
    const index = siblings.indexOf(node)
    return index > 0 ? siblings[index - 1] : undefined
  }

  /**
   * Whether a node is part of the separator's packaging rather than content.
   *
   * Word's downlevel-revealed conditionals bracket the `<br clear=all><hr>`
   * inside the footnote-list div. `<![if ...]>` is not a comment: a parser
   * following the HTML grammar (parse5 here) reads it as a BOGUS COMMENT
   * node, and libxml hands it back as TEXT, so both spellings are recognized
   * - without this the emptied container keeps content, survives pruning, and
   * imports as a paragraph that spells the conditional out.
   */
  private isFootnoteChromeNode(node: P5Node): boolean {
    if (node.nodeName === '#comment') return true
    if (node.nodeName !== '#text') return false
    const text = (node.value ?? '').trim()
    return text === '' || RE_DOWNLEVEL_CONDITIONAL.test(text)
  }

  /**
   * Remove the navigation an engine regenerates: the back-link, and the
   * marker anchor Word, Google Docs and LibreOffice put it on.
   *
   * Carried into the note body it would render as a stray link to a fragment
   * that no longer exists, and the visible marker it wraps (`[1]`, `1`, the
   * return arrow) would be written into the note's own text. The third clause
   * - an anchor that IS the fragment target the reference points at, with a
   * fragment href - is what removes the marker anchor that is the note's
   * anchor and its back-link and its visible marker in one element.
   */
  private stripFootnoteBacklinks(block: P5Node, identities: string[], fragments: string[]): void {
    for (const anchor of this.footnoteAnchorsUnder(block)) {
      const href = this.attr(anchor, 'href') ?? ''
      const pointsBack = href.startsWith('#') && identities.includes(href.slice(1))
      const isMarker = href.startsWith('#') && fragments.includes(this.footnoteAnchorIdentity(anchor))
      if (!this.isFootnoteBacklinkMarked(anchor) && !pointsBack && !isMarker) continue

      const parent = anchor.parentNode
      this.detachP5Node(anchor)
      if (
        parent !== undefined &&
        (parent.tagName === 'sup' || parent.tagName === 'span') &&
        !(parent.childNodes ?? []).some(
          (child) => child.tagName !== undefined || (child.nodeName === '#text' && (child.value ?? '').trim() !== ''),
        )
      ) {
        this.detachP5Node(parent)
      }
    }
  }

  /**
   * The node a reference occupies: the anchor, or the `<sup>` that holds
   * nothing but the anchor.
   *
   * Google Docs and Pandoc put the `<sup>` outside the anchor, so replacing
   * only the anchor would leave `{^...^}` wrapped around the reference. One
   * carrying anything else - an element or non-blank text - keeps its
   * content, and the reference binds inside it.
   */
  private footnoteReferenceSite(reference: P5Node): P5Node {
    const parent = reference.parentNode
    if (parent === undefined || parent.tagName !== 'sup') return reference
    for (const child of parent.childNodes ?? []) {
      if (child.tagName !== undefined && child !== reference) return reference
      if (child.nodeName === '#text' && (child.value ?? '').trim() !== '') return reference
    }
    return parent
  }

  /**
   * Drop a container the notes left empty, so the `<hr>` and the `<ol>` that
   * held them do not import as a thematic break beside an empty list. A
   * separator written AFTER the notes survives the explicit search and is
   * swept up here instead.
   */
  private pruneEmptyFootnoteContainer(node: P5Node | undefined): void {
    // WHERE the container sat, so the placement below can put a marker back
    // there. Recorded at every level the walk detaches, so it names the
    // outermost thing that actually left rather than the note list inside it.
    let removedFrom: { parent: P5Node; index: number } | undefined
    outer: while (node !== undefined && node.tagName !== undefined) {
      if (node.tagName === 'body' || node.tagName === 'html') break
      for (const child of node.childNodes ?? []) {
        if (this.isFootnoteChromeNode(child)) continue
        if (child.tagName === 'hr' || child.tagName === 'br') continue
        break outer
      }
      const parent = node.parentNode
      const index = parent?.childNodes?.indexOf(node) ?? -1
      this.detachP5Node(node)
      if (parent !== undefined && index !== -1) removedFrom = { parent, index }
      node = parent
    }
    this.markFootnotePlacement(removedFrom)
  }

  /**
   * An endnotes section that is not last: POSITION IS MEANING.
   *
   * The notes are consumed into `footnoteDefs`, and the renderer appends the
   * section it rebuilds at DOCUMENT END. That reproduces the input exactly when
   * the section was already last, and silently moves it when it was not: the
   * same characters in the wrong order, with nothing said (carve#1608,
   * carve-js#1394).
   *
   * This is NOT `structure-unspellable`. Carve HAS a spelling for the position -
   * the `::: footnotes` placement directive - so discarding a position the
   * language can express is a loss with no justification. A marker goes back
   * where the section sat, and the AST-returning exit gets the placement node in
   * the same slot.
   *
   * ONLY when something actually follows it, checked outward through the
   * ancestors rather than among the immediate siblings alone: a section last in
   * a `<div>` that is itself followed by a paragraph is still not last in the
   * document. A section that IS last needs no marker, and gets none, so every
   * document that was already right stays byte-identical.
   */
  private markFootnotePlacement(removedFrom: { parent: P5Node; index: number } | undefined): void {
    if (removedFrom === undefined) return
    if (this.footnotePlacementMarked) return
    if (!this.contentFollows(removedFrom.parent, removedFrom.index)) return
    const siblings = removedFrom.parent.childNodes
    if (siblings === undefined) return
    const marker: P5Node = {
      nodeName: 'carve-footnote-placement',
      tagName: 'carve-footnote-placement',
      attrs: [],
      childNodes: [],
      parentNode: removedFrom.parent,
    }
    siblings.splice(Math.min(removedFrom.index, siblings.length), 0, marker)
    this.footnotePlacementMarked = true
  }

  /** Is there content after INDEX in PARENT, or after PARENT in any ancestor? */
  private contentFollows(parent: P5Node, index: number): boolean {
    let node: P5Node | undefined = parent
    let from = index
    while (node !== undefined) {
      const siblings = node.childNodes ?? []
      for (let i = from; i < siblings.length; i++) {
        if (!this.isFootnoteChromeNode(siblings[i]!)) return true
      }
      const up: P5Node | undefined = node.parentNode
      if (up === undefined) return false
      from = (up.childNodes?.indexOf(node) ?? -1) + 1
      if (from === 0) return false
      node = up
    }
    return false
  }
}

/**
 * The paragraph attribute names an image's OWN attribute block overwrites.
 *
 * The writer emits the paragraph's attributes as a block above the image and
 * the image's inline `{…}` after it, and the two are then read onto one node:
 * a name the image also sets is the one that survives. CLASSES ARE NOT IN THIS
 * SET - the class slot merges rather than replacing, so both groups reach the
 * rendered element and nothing is lost.
 *
 * A `title` on the image is not here either, and for a different reason: it
 * goes into the destination's title slot rather than the attribute block, so it
 * never collides with a `title=` the paragraph carried.
 */
function overwrittenAttrNames(paragraph: Attrs | undefined, image: Attrs | undefined): string[] {
  if (paragraph === undefined || image === undefined) return []
  const lost: string[] = []
  if (paragraph.id !== undefined && image.id !== undefined) lost.push('id')
  for (const key of Object.keys(paragraph.keyValues ?? {})) {
    if (ownValue(image.keyValues, key) !== undefined) lost.push(key)
  }
  return lost.sort()
}

/**
 * Every object the finished document still reaches, by IDENTITY.
 *
 * Structural rather than type-aware on purpose: a walker that enumerates the
 * container kinds is a list that goes stale the next time one is added, and it
 * would go stale SILENTLY - a missed container reads as "the paragraph was
 * unwrapped" and drops a row that was owed. Own enumerable keys visit every
 * node, since AST nodes are plain object literals.
 *
 * Iterative, and it records what it has seen: the depth here is the document's
 * own, which the importer already bounds, and the seen set makes a shared or
 * repeated subtree cost nothing extra.
 */
function reachableObjects(root: unknown): Set<object> {
  const seen = new Set<object>()
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const item = stack.pop()
    if (item === null || typeof item !== 'object') continue
    if (seen.has(item)) continue
    seen.add(item)
    if (Array.isArray(item)) {
      for (const child of item) stack.push(child)
      continue
    }
    const record = item as Record<string, unknown>
    for (const key of Object.keys(record)) stack.push(record[key])
  }
  return seen
}

export function htmlToAst(html: string, options: HtmlImportOptions = {}): HtmlImportResult<Document> {
  const importer = new Importer(options)
  const value = importer.import(html)
  return { value, report: { mode: importer.mode, adapter: importer.adapter, diagnostics: importer.diagnostics } }
}

export function htmlToCarve(html: string, options: HtmlImportOptions = {}): HtmlImportResult<string> {
  const importer = new Importer(options, true)
  const value = importer.import(html)
  // The loss belongs to serialization, not to the import: a consumer that keeps
  // the AST `htmlToAst` returns keeps the figure wrapper and loses nothing. So
  // the importer records where it built one and only this function reports it.
  importer.reportSerializationLosses(value)
  return { value: renderCarve(value), report: { mode: importer.mode, adapter: importer.adapter, diagnostics: importer.diagnostics } }
}
