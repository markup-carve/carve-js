import { TableStage, type TableStageContext } from './html-import-table-stage.js'
import { FootnoteStage, type FootnoteStageContext } from './html-import-footnote-stage.js'
import { codeLanguage } from './html-import-code-language.js'
import { parseFragment, serialize as serializeInner, serializeOuter } from 'parse5'
import { domAttrs, domContainer, domChildren, domData, domParent, domTag, domValue, type P5Node } from './html-import-dom.js'
import type {
  Admonition,
  Attrs,
  BlockNode,
  DefinitionItem,
  Document,
  FigureGroup,
  InlineNode,
  List,
  ListItem,
  Math,
  Paragraph,
  TableCell,
} from './ast.js'
import { CANONICAL_ADMONITION_KINDS, GENERATED_CONTENT_KINDS } from './ast.js'
import { DocumentIdRegistry } from './document-ids.js'
import { convertedIds, preserveHtmlTextCrossrefs } from './imported-crossrefs.js'
import { EXTENDER_LEADING_SPAN_UNSPELLABLE, ORDERED_TASK_ITEM_UNSPELLABLE } from './import-report-messages.js'
import { LEADING_EXTENDER_REASON } from './grapheme-extender.js'
import { SourceUnspellableError } from './source-unspellable-error.js'
import { emptyCodeSpansWhoseRunDoesNotEnd, flattenHardBreaks, isAttrIdentifier, isContainerKind, renderCarve, renderCarveForHtmlImport } from './render-carve.js'
import { mergeAttrs, parse } from './parse.js'
import {
  DANGEROUS_URL_SCHEMES,
  LABEL_DEFAULTS,
  SCHEME_PROBE_STRIP_RE,
  decodedStyleValue,
  isDangerousAttrName,
  isUrlListAttribute,
  renderedAttrValue,
  sanitizeUrl,
  urlListHasDeniedToken,
} from './render-html.js'
import type { LabelKey } from './render-html.js'
import { inlineText, slugify } from './heading-ids.js'
import { hasOwnKey, ownValue, setOwn } from './own-property.js'
import { normalizeRefLabel } from './label-key.js'
import { RE_AUTOLINK, RE_ESCAPABLE_PUNCTUATION, RE_FOOTNOTE_DEF, RE_RAW_INLINE_FORMAT } from './parse.js'
import { trimEndMatchingEdges, trimEndSpaceTab, trimNonNbsp } from './trim-non-nbsp.js'
import { CARRIER_CHAR, CARRIER_MARKER, MAX_CARRIED_SEPARATOR_WIDTH, RE_ID_SLOT, RESERVED_CARRIER_ATTRIBUTES, carrier, legacyCarrier, readCarrier } from './roundtrip-carriers.js'
import type { CarrierName, PrefixedCarrier } from './roundtrip-carriers.js'

export type HtmlImportMode = 'safe' | 'semantic' | 'roundtrip'
export type HtmlImportAdapter =
  | 'generic'
  | 'tiptap'
  | 'prosemirror'
  | 'ckeditor'
  | 'tinymce'
  | 'word'
  | 'google-docs'

export { HTML_IMPORT_DIAGNOSTIC_CODES } from './html-import-report.js'
export type { HtmlImportDiagnostic, HtmlImportDiagnosticCode, HtmlImportFidelity, HtmlImportConfidence } from './html-import-report.js'
import { HtmlImportReportCollector, type DiagnosticMark, type HtmlImportDiagnostic } from './html-import-report.js'
import { replaceLoneSurrogates } from './well-formed.js'

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
  /**
   * Write a table whose cells hold blocks as `::: list-table` rather than
   * flattening its cells (docs/html-import-contract.md, "A table whose cells
   * hold blocks can be written as a list table"). Off by default: ListTable is
   * a Tier-2 extension the reading processor has to enable.
   */
  listTableForBlockCells?: boolean
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
  /**
   * `diagnostics` is gone: the diagnostic cap bounds the REPORT rather than the
   * document, and it now replaces its last row with `diagnostics-truncated`
   * instead of refusing a conversion that succeeded (carve-js#2034).
   */
  constructor(public readonly limit: 'depth' | 'nodes') {
    super(`HTML import ${limit} limit exceeded`)
    this.name = 'HtmlImportLimitError'
  }
}

/** A `<template>` holds its children in `content`, and they serialize too. */
function serializedChildren(node: P5Node): P5Node[] {
  return 'content' in node ? node.content.childNodes : domChildren(node) ?? []
}

const EMPTY_DROPPED_MARKS = new Set(['del', 'ins', 'em', 'i', 'strong', 'b', 's', 'strike', 'u', 'mark', 'sub', 'sup'])
const ACTIVE = new Set(['script', 'style', 'template', 'noscript'])
const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset',
  'figure', 'footer', 'form', 'header', 'hgroup', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'ul', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
  // Synthetic, never present in real HTML input: the marker
  // `pruneFootnoteContainers` leaves where a non-final endnotes section sat. It
  // belongs here because it stands where a `<section>` stood, and a name
  // `blocks()` does not recognize is buffered as INLINE - which put the
  // placement inside the paragraph after it rather than between the two.
  'carve-footnote-placement',
])

/**
 * The tags `inline()` maps or handles before its generic unwrap arm. Any other
 * element is unsupported, and in block context it is unwrapped IN PLACE
 * (markup-carve/carve#2341). The flattened-block spellings are left out too:
 * their parents give them meaning, so a stray one is not an unknown element.
 */
const INLINE_HANDLED = new Set([
  'q', 'math', 'ruby', 'em', 'i', 'strong', 'b', 'del', 'ins', 's', 'strike', 'u',
  'mark', 'sub', 'sup', 'code', 'a', 'img', 'br', 'span', 'carve-footnote-ref',
  'summary', 'input',
])

/**
 * The media wrappers whose children are FALLBACK CONTENT (ruling
 * markup-carve/carve#1749).
 */
const MEDIA_FALLBACK = new Set(['video', 'audio', 'object', 'canvas', 'picture'])

/**
 * The states an item can be READ into (PART 10 §11). Not ` `: the bare box
 * says that, and `x` is the done state, read only beside a ticked box.
 */
const READABLE_TASK_STATES = new Set(['-', '_', '>', '?'])

function isReadableTaskState(value: string | undefined): value is NonNullable<ListItem['taskState']> {
  return value !== undefined && READABLE_TASK_STATES.has(value)
}

/** The base class PART 19 §1 gives a task list's element. */
const TASK_LIST_CLASS = 'task-list'
/**
 * Is this node a BLOCK being flattened into an inline slot?
 *
 * The list-item spellings are here beside `BLOCK` because a `<ul>` reaching a
 * caption flattens its items too, and the boundary between two `<li>` is the
 * same boundary between two `<p>` - the clause is over every inline-only slot
 * an importer can reach, not over the caption it was first measured in.
 */
function isFlattenedBlock(node: P5Node): boolean {
  const tag = domTag(node)
  if (!tag) return false

  return BLOCK.has(tag) || FLATTENED_BLOCK_EXTRA.has(tag)
}

/** The block-level containers `BLOCK` leaves out because they are never top level. */
const FLATTENED_BLOCK_EXTRA = new Set(['li', 'dt', 'dd', 'td', 'th', 'tr', 'caption', 'figcaption'])

/**
 * The figure targets a figure is REBUILT from, in EVERY mode
 * (markup-carve/carve#1704, ruling markup-carve/carve-php#1731).
 */
const FIGURE_REBUILDS = new Set(['image', 'block_quote', 'code_block', 'table'])

/**
 * ONE MESSAGE FOR AN UNWRAPPED FIGURE, at the severity every other unwrapped
 * element already reports (ruling markup-carve/carve#1716).
 */
const FIGURE_UNWRAPPED = 'Unwrapped unsupported <figure> element'
/**
 * The row a figure-wrapped table's own caption costs the figure's
 * (markup-carve/carve-js#1488).
 *
 * Says where the text WENT, because it did not go anywhere else and a reader of
 * the report has to be able to find it: the words are in the document, one block
 * further down, as prose rather than as a caption.
 */
const FIGCAPTION_DETACHED =
  "Detached a <figcaption> into a paragraph after the table: the table's own <caption> fills Carve's one caption slot, so the figure's caption keeps its text and loses its role"

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
 * separator inserted before it writes a trailing space the source never had.
 */
function needsSeparator(before: InlineNode[], after: InlineNode[]): boolean {
  const last = before.at(-1)
  const first = after[0]
  if (last === undefined || first === undefined) return false
  if (last.type === 'hard_break' || first.type === 'hard_break') return false
  // ASCII layout only: U+00A0 is content, so it is a side and not a separator.
  if (last.type === 'text' && /[ \t\n\r\f]$/.test(last.value)) return false
  if (first.type === 'text' && /^[ \t\n\r\f]/.test(first.value)) return false

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
 * The relevant cases are a hard break whose next line begins with a space, a
 * padded table cell, a caption separator that became a text run, and an
 * overindented lazy continuation.
 * Each leaves a space at a boundary where the re-parse does not keep it.
 */
function textEdge(node: InlineNode | undefined, side: 'start' | 'end', preserveTabs = false): boolean {
  if (node === undefined || node.type !== 'text') return false
  // NOT the whitespace class: JavaScript counts U+00A0 as whitespace and a
  // non-breaking space is CONTENT - it is the one character here whose whole
  // point is that the renderer does not collapse it.
  return (preserveTabs ? (side === 'start' ? /^ / : / $/) : (side === 'start' ? /^[ \t]/ : /[ \t]$/)).test(node.value)
}

/**
 * A link's or span's edge whitespace stands outside it, as one space that
 * merges with whitespace already there (carve#2361). Whitespace-only content
 * stays, and so does U+00A0, which is content rather than layout.
 */
function hoistEdgeSpace(nodes: InlineNode[], withinLinkOrSpan = false, preserveTabs = false): InlineNode[] {
  const out: InlineNode[] = []
  let owed = false
  // Through nested inlines: a strong ending in a space already has one there.
  const blankEdge = (node: InlineNode | undefined, side: 'start' | 'end'): boolean => {
    if (node === undefined || textEdge(node, side, preserveTabs)) return node !== undefined
    const children = 'children' in node && Array.isArray(node.children) ? (node.children as InlineNode[]) : undefined
    return children !== undefined && blankEdge(side === 'start' ? children[0] : children.at(-1), side)
  }
  const pay = (next: InlineNode | undefined) => {
    if (owed && !blankEdge(next, 'start')) out.push({ type: 'text', value: ' ' })
    owed = false
  }
  for (const node of nodes) {
    const linkOrSpan = !withinLinkOrSpan && (node.type === 'link' || node.type === 'span')
    const formatting = withinLinkOrSpan && (
      node.type === 'strong' || node.type === 'emphasis' || node.type === 'underline'
      || node.type === 'strike' || node.type === 'highlight' || node.type === 'insert'
      || node.type === 'delete' || node.type === 'superscript' || node.type === 'subscript'
    )
    if (!(linkOrSpan || formatting) || !('children' in node)) {
      pay(node)
      out.push(node)
      continue
    }
    // Nested links and spans have already hoisted their children.
    node.children = dropSpaceAfterHardBreak(hoistEdgeSpace(node.children, true, preserveTabs), preserveTabs)
    if (!node.children.some((c) => c.type !== 'text' || !(preserveTabs ? /^ *$/ : /^[ \t]*$/).test(c.value))) {
      pay(node)
      out.push(node)
      continue
    }
    let children = [...node.children]
    const lead = textEdge(children[0], 'start', preserveTabs)
    let leadingCount = 0
    while (textEdge(children[leadingCount], 'start', preserveTabs)) {
      const value = (children[leadingCount] as { value: string }).value.replace(preserveTabs ? /^ +/ : /^[ \t]+/, '')
      if (value === '') leadingCount++
      else {
        children[leadingCount] = { ...(children[leadingCount] as object), value } as InlineNode
        break
      }
    }
    if (leadingCount > 0) children = children.slice(leadingCount)
    const trail = textEdge(children.at(-1), 'end', preserveTabs)
    while (textEdge(children.at(-1), 'end', preserveTabs)) {
      const value = trimInlineEnd((children.at(-1) as { value: string }).value, preserveTabs)
      if (value === '') children.pop()
      else {
        children[children.length - 1] = { ...(children.at(-1) as object), value } as InlineNode
        break
      }
    }
    if (lead) owed = true
    if (owed && !blankEdge(out.at(-1), 'end')) out.push({ type: 'text', value: ' ' })
    owed = false
    // In place: `inlineOrigins` is keyed by node identity.
    if (lead || trail) node.children = children
    out.push(node)
    owed = trail
  }
  pay(undefined)

  return out
}

/**
 * A line's leading whitespace, dropped after a hard break.
 *
 * Only text DIRECTLY after the break starts the line. After a break that ends
 * a `<strong>`, the closer is written first on the new line, so a space behind
 * it is mid-line content and stays.
 */
function dropSpaceAfterHardBreak(nodes: InlineNode[], preserveTabs = false): InlineNode[] {
  const out: InlineNode[] = []
  for (const node of nodes) {
    if (node.type === 'text' && out.at(-1)?.type === 'hard_break') {
      const value = node.value.replace(preserveTabs ? /^ +/ : /^[ \t]+/, '')
      if (value === '') continue
      out.push({ ...node, value })
      continue
    }
    out.push(node)
  }

  return out
}

/**
 * Is this text node LAYOUT rather than content (PART 11 §7,
 * markup-carve/carve#1628)?
 *
 * The line is Carve's `whitespace` terminal and nothing wider: SPACE, TAB, LF
 * and CR. EVERY OTHER CHARACTER IS CONTENT, U+00A0 included, and so are
 * U+202F, U+2002 and U+3000.
 *
 * NOT `String.prototype.trim`, which is where this went wrong
 * (markup-carve/carve-js#1493). JS trims every Unicode space, so a text node
 * holding one NO-BREAK SPACE tested as layout, was never buffered, and the
 * character left the document with no row - while `<p>&#160;</p>`, which reads
 * its content through a trim that knows the difference, kept it. One class,
 * two answers, in one file.
 */
function isLayoutOnlyText(node: P5Node): boolean {
  return node.nodeName === '#text' && trimNonNbsp(domValue(node) ?? '') === ''
}

function trimInlineEnd(text: string, preserveTabs: boolean): string {
  return preserveTabs ? trimEndMatchingEdges(text, code => code === 0x20) : trimEndSpaceTab(text)
}

/** Trim block-edge padding and redundant padding inside formatting. */
function trimBlockEdges(nodes: InlineNode[], preserveTabs = false): InlineNode[] {
  return trimFormattingEdges(nodes, true, true, preserveTabs)
}

function trimFormattingEdges(nodes: InlineNode[], leading: boolean, trailing: boolean, preserveTabs = false): InlineNode[] {
  let out = [...nodes]
  let leadingCount = 0
  while (leading) {
    const first = out[leadingCount]
    if (first?.type !== 'text') break
    const value = first.value.replace(preserveTabs ? /^ +/ : /^[ \t]+/, '')
    if (value === '') leadingCount++
    else {
      out[leadingCount] = { ...first, value }
      break
    }
  }
  if (leadingCount > 0) out = out.slice(leadingCount)
  while (trailing && out.at(-1)?.type === 'text') {
    const last = out.at(-1) as { type: 'text'; value: string }
    const value = trimInlineEnd(last.value, preserveTabs)
    if (value === '') out.pop()
    else {
      out[out.length - 1] = { ...last, value }
      break
    }
  }
  const endsWithSpace = (node: InlineNode | undefined): boolean => {
    if (node === undefined) return false
    if (textEdge(node, 'end', preserveTabs)) return true
    if (node.type === 'link' || node.type === 'span' || isFormatting(node)) return endsWithSpace(node.children.at(-1))
    return false
  }
  for (let index = 0; index < out.length; index++) {
    const node = out[index]!
    if (!isFormatting(node) || node.children.every((child) => child.type === 'text' && (preserveTabs ? /^ *$/ : /^[ \t]*$/).test(child.value))) continue
    const next = out[index + 1]
    node.children = trimFormattingEdges(
      node.children,
      index === 0 ? leading : out[index - 1]?.type === 'hard_break' || endsWithSpace(out[index - 1]),
      next === undefined ? trailing : next.type === 'hard_break' || textEdge(next, 'start', preserveTabs),
      preserveTabs,
    )
  }
  return out
}

function isFormatting(node: InlineNode): node is Extract<InlineNode, { type: 'strong' | 'emphasis' | 'underline' | 'strike' | 'highlight' | 'insert' | 'delete' | 'superscript' | 'subscript' }> {
  return node.type === 'strong' || node.type === 'emphasis' || node.type === 'underline'
    || node.type === 'strike' || node.type === 'highlight' || node.type === 'insert'
    || node.type === 'delete' || node.type === 'superscript' || node.type === 'subscript'
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

/** MathML whose text reads in order: no element here lays its children out. */
const LINEAR_MATH_CONTAINERS = new Set(['mrow', 'mstyle', 'mpadded'])
const LINEAR_MATH_TOKENS = new Set(['mi', 'mn', 'mo', 'mtext'])

const isBlankOrComment = (node: P5Node): boolean =>
  node.nodeName === '#comment' || (node.nodeName === '#text' && /^[ \t\n\r\f]*$/.test(domValue(node) ?? ''))

/** No text an author wrote, anywhere below `root`. */
function holdsNoText(root: P5Node): boolean {
  const stack: P5Node[] = [root]
  while (stack.length) {
    const node = stack.pop()!
    if (node.nodeName === '#text' && !/^[ \t\n\r\f]*$/.test(domValue(node) ?? '')) return false
    for (const child of domChildren(node) ?? []) stack.push(child)
  }
  return true
}

/**
 * The text of a `<math>` with no TeX, when flattening cannot change its value
 * (carve#2361): tokens in order, inside grouping elements only. A fraction or a
 * script would flatten into a different number, so any other element refuses.
 */
function linearMathText(math: P5Node): string | undefined {
  let text = ''
  let spaced = false
  const read = (nodes: P5Node[]): boolean => {
    for (const node of nodes) {
      if (isBlankOrComment(node)) continue
      const tag = domTag(node)
      if (tag === 'semantics') {
        const first = (domChildren(node) ?? []).find((child) => !isBlankOrComment(child))
        if (!first || !read([first])) return false
      } else if (tag !== undefined && LINEAR_MATH_CONTAINERS.has(tag)) {
        if (!read(domChildren(node) ?? [])) return false
      } else if (tag !== undefined && LINEAR_MATH_TOKENS.has(tag)) {
        const children = domChildren(node) ?? []
        if (children.some((child) => child.nodeName !== '#text')) return false
        const token = children.map((child) => domValue(child) ?? '').join('').replace(/[ \t\n\r\f]+/g, ' ').replace(/^ | $/g, '')
        // A space keeps two words or numbers apart, so 1, space, 2 is not 12.
        if (spaced && /[\p{L}\p{N}]$/u.test(text) && /^[\p{L}\p{N}]/u.test(token)) text += ' '
        text += token
        spaced = false
      } else if (tag === 'mspace') {
        spaced = true
      } else {
        return false
      }
    }
    return true
  }
  return read(domChildren(math) ?? []) && text !== '' ? text : undefined
}

/** The effective inline `display` is `none`: the last declaration wins, an `!important` one first. */
const hidden = (node: P5Node | undefined): boolean => {
  let display: string | undefined
  let important = false
  for (const declaration of (domAttrs(node)?.find((a) => a.name.toLowerCase() === 'style')?.value ?? '').split(';')) {
    const colon = declaration.indexOf(':')
    if (colon < 0 || declaration.slice(0, colon).trim().toLowerCase() !== 'display') continue
    const value = declaration.slice(colon + 1).toLowerCase()
    const isImportant = /!\s*important\s*$/.test(value)
    if (important && !isImportant) continue
    display = value.replace(/!\s*important\s*$/, '').trim()
    important = isImportant
  }
  return display === 'none'
}

/** Sibling positions, built once per parent so a run of formulas stays linear. */
const siblingIndex = new WeakMap<P5Node, Map<P5Node, number>>()
const indexIn = (parent: P5Node, node: P5Node): number => {
  const children = domChildren(parent) ?? []
  let index = siblingIndex.get(parent)?.get(node)
  if (index === undefined || children[index] !== node) {
    const positions = new Map<P5Node, number>(children.map((child, at) => [child, at]))
    siblingIndex.set(parent, positions)
    index = positions.get(node)
  }
  return index ?? -1
}

/** A `<math>` hidden by `display: none`, on itself or on the `<span>` holding only it. */
function mathIsHidden(math: P5Node): boolean {
  const wrapper = domParent(math)
  return hidden(math) || (domTag(wrapper) === 'span' && hidden(wrapper) && (domChildren(wrapper) ?? []).every((child) => child === math || isBlankOrComment(child)))
}

/**
 * The `<img>` that renders a formula for a reader without MathML: the next
 * element after the `<math>`, or after a `<span>` holding nothing but it.
 */
function fallbackImage(math: P5Node): P5Node | undefined {
  const next = (node: P5Node): P5Node | undefined => {
    const parent = domParent(node)
    if (!parent) return undefined
    const siblings = domChildren(parent) ?? []
    for (let index = indexIn(parent, node) + 1; index < siblings.length; index += 1) {
      if (!isBlankOrComment(siblings[index]!)) return siblings[index]
    }
    return undefined
  }
  let found = next(math)
  const wrapper = domParent(math)
  if (found === undefined && wrapper !== undefined && domTag(wrapper) === 'span' && domChildren(wrapper)?.every((child) => child === math || isBlankOrComment(child))) found = next(wrapper)
  return domTag(found) === 'img' ? found : undefined
}

/**
 * The `data-` names that are A SERIALIZER'S PROTOCOL, not an author's content.
 *
 * Everything else the source carries is kept, so these need naming:
 * `RESERVED_CARRIER_ATTRIBUTES` is PART 10 §13a's whole inventory, under both
 * the canonical `data-carve-` spelling and the deprecated `data-djot-` one that
 * released carve-php versions wrote, plus the verbatim-source names §13a
 * excludes from export. Re-emitting one as an authored attribute
 * is what markup-carve/carve#2902 ruling 5 stops: a `<hr data-char="_">` came
 * back as `{data-char=_}` plus `---`, and a reference link as
 * `[text](/u){data-carve-ref=lbl}`, so the importer's own output claimed a
 * protocol name it had no business writing - and the next render then read that
 * authored attribute as a carrier.
 *
 * REFUSING IS NOT A TRUST DECISION and does not depend on the import mode
 * (ruling 5): the names are refused in `safe` exactly as in `roundtrip`.
 */
const ROUND_TRIP_MARKER_ATTRIBUTES = RESERVED_CARRIER_ATTRIBUTES

/**
 * Whether a `data-carve-ref` value can name a reference definition.
 *
 * A LEADING `^` SPELLS A FOOTNOTE DEFINITION, not a reference one: the
 * `[^r]: /u` line this would write is read back as a footnote and the link is
 * gone, so the carrier cannot be honored.
 */
function isReferenceLabel(label: string): boolean {
  return label.trim() !== '' && !/[[\]\r\n]/.test(label) && !label.startsWith('^')
}

/** What one element's §13a carriers were read as (`HtmlImporter.carrierReads`). */
interface CarrierRead {
  names: Set<CarrierName>
  /** `data-carve-ref`: the label, and the Carve source of the link's own text.
   *  `rawRef` is finished in the arm, where the kept attributes are known. */
  ref?: string
  labelSource?: string
  /** `data-carve-autolink`: the display text, absent where it is the default. */
  autolinkText?: string
}



/**
 * Does this URL attribute name no destination at all?
 *
 * EMPTY IS A PROPERTY OF THE STRING, read the way an HTML URL attribute is
 * read: a value of zero length, or of zero length once leading and trailing
 * ASCII whitespace is stripped, because that is what a URL parser strips before
 * resolving one. A value that is merely unusual is not empty and is kept - the
 * rule is over the DESTINATION, not over the reason it is missing.
 *
 * An absent attribute is handled separately from an explicit empty value.
 *
 * The character list is the URL spec's ASCII whitespace rather than the regex
 * `\s` class, which adds a vertical tab and the Unicode spaces that are not
 * whitespace here.
 */
function destinationIsEmpty(value: string | undefined): boolean {
  return value === undefined || /^[ \t\n\f\r]*$/.test(value)
}

/**
 * Whether the renderer's §25 sink would blank this destination
 * (markup-carve/carve#2254). Asks the sink itself so the two cannot disagree
 * on how a scheme is read.
 */
function destinationIsDenied(value: string | undefined): boolean {
  return value !== undefined && !destinationIsEmpty(value) && sanitizeUrl(value, {}) === ''
}

function destinationIsCarried(value: string | undefined): boolean {
  return value !== undefined && (value === '' || !destinationIsEmpty(value)) && !destinationIsDenied(value)
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

/** A `url(...)` argument, with the quotes CSS allows around it stripped. */
const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi

/**
 * How the refusal policy reads a `style` value: the subject the row names and
 * whether what it preserved is LIVE (markup-carve/carve#2267).
 *
 * The reason comes from a closed set of two, so the wording is derived rather
 * than chosen per call - a denied scheme inside `url(...)`, else anything the
 * renderer's own `style` sanitizer blanks the value for. Asking
 * `renderedAttrValue` rather than restating its needles is what keeps the
 * importer from refusing a different set than the renderer does - including the
 * TEXT they read, which is `decodedStyleValue` and not the raw attribute
 * (markup-carve/carve-js#2058).
 */
function styleRefusal(value: string): { subject: string; live: boolean } {
  for (const match of decodedStyleValue(value).matchAll(CSS_URL_RE)) {
    if (destinationIsDenied((match[1] ?? match[2] ?? match[3] ?? '').trim())) {
      return { subject: 'style with a denied URL scheme in a declaration value', live: true }
    }
  }
  // BLANKED, not empty. `renderedAttrValue` answers `''` for `style=""` too, so
  // asking whether it changed the value is what keeps an empty attribute out of
  // the refused class.
  if (renderedAttrValue('style', value) !== value) {
    return { subject: 'style with a construct the CSS sanitizer refuses', live: true }
  }
  return { subject: 'style', live: false }
}

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
  const seen = new Set<string>()
  const push = (slot: string) => {
    if (!seen.has(slot)) {
      seen.add(slot)
      order.push(slot)
    }
  }
  const keyValues = held.keyValues ?? {}
  for (const attr of domAttrs(node) ?? []) {
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

/**
 * Put a `<section id>` back on the heading the renderer hoisted it off
 * (markup-carve/carve-js#1475), and return what the wrapper still carries.
 */
function restoreHoistedSectionId(
  tag: string,
  attrs: Attrs | undefined,
  blocks: BlockNode[],
  explicitId: boolean,
  generatedId: boolean,
  writing: boolean,
  slot: number,
  elementSlots: (held: Attrs) => string[],
): Attrs | undefined {
  if (tag !== 'section' || attrs?.id === undefined) return attrs
  // The heading the wrapper was built around is its FIRST block. Anything else
  // and the `<section>` is not this renderer's, so its id is not a hoist and
  // stays reported.
  const heading = blocks[0]
  if (heading?.type !== 'heading') return attrs
  // A heading that already carries an id was never hoisted off - two ids in the
  // rendered document mean two different facts, and overwriting the heading's
  // own with the wrapper's would lose one of them.
  if (heading.attrs?.id !== undefined) return attrs
  const { id, ...rest } = attrs
  // An id that was the whole of the wrapper's attributes leaves NOTHING behind,
  // and nothing is what `reportUnwrappedAttributes` reads as "no row" - an
  // empty object would write a row naming no attribute at all.
  const kept = Object.keys(rest).length > 0 ? (rest as Attrs) : undefined
  if (generatedId || (!explicitId && isGeneratedHeadingId(id, inlineText(heading.children)))) return kept
  heading.attrs = { ...(heading.attrs ?? {}), id }
  // The carrier says the id was authored, and `attrs.order` is where a tree
  // records that, so a carried id publishes its slot on both exits.
  if (writing || explicitId) {
    const slots = (heading.attrs.order ?? elementSlots(heading.attrs)).filter((entry) => entry !== '#id')
    slots.splice(slot, 0, '#id')
    heading.attrs.order = slots
  }
  return kept
}


class Importer {
  readonly mode: HtmlImportMode
  readonly adapter: HtmlImportAdapter
  private readonly listTableForBlockCells: boolean
  private readonly report: HtmlImportReportCollector
  private readonly footnotes: FootnoteStage
  private readonly tables: TableStage
  /**
   * Every node of the parsed tree, numbered in DOCUMENT ORDER
   * (markup-carve/carve#1586).
   */
  /**
   * The cell alignment a `style` attribute mapped, keyed by the cell it was
   * read off. `attrs()` fills it and `table()` moves it onto the cell node,
   * because a cell alignment is a FIELD of the cell rather than an attribute -
   * `|>` and `|?^` are the marker run, not `{align=…}` and `{valign=…}`
   * (markup-carve/carve#1745).
   */
  private readonly cellAlignment = new Map<P5Node, { align?: string; valign?: string }>()

  private readonly indexBackrefEntries = new WeakMap<P5Node, { term: string; ordinals: Map<P5Node, number> }>()
  private readonly codeLanguageWrappers = new WeakMap<P5Node, P5Node | null>()
  private readonly documentOrder = new Map<P5Node, number>()

  get diagnostics(): HtmlImportDiagnostic[] { return this.report.diagnostics }
  /** Where the import built a structure only a serializer loses (§16). */
  private readonly unspellable: Array<{ node: P5Node; path: string; message: string }> = []
  /** The element each empty code span came from, for `dropUnspellableEmptyCodeSpans`. */
  private readonly emptyCodeSpans = new WeakMap<object, { node: P5Node; path: string }>()
  private hasEmptyCodeSpans = false
  /** The element each inline node came from, for `unwrapUnspellable`. */
  private readonly firstHeadings = new WeakMap<P5Node, P5Node | null>()
  private readonly headingOrigins = new WeakMap<BlockNode, P5Node>()
  private readonly inlineOrigins = new WeakMap<object, { node: P5Node; path: string }>()
  /** Fallback images of formulas that imported as math, dropped where they stand. */
  private readonly formulaImages = new Set<P5Node>()
  /** The element each hard break came from, for `dropHardBreaksInTableCells`. */
  private readonly hardBreaks = new WeakMap<object, { node: P5Node; path: string }>()
  /**
   * Where a figure's own attribute is DISPLACED by its target's (§16, ruling
   * markup-carve/carve#1721).
   *
   * A rebuilt figure whose target is not an image writes two block attribute
   * lines - the figure's, then the target's - and the parse MERGES them. The
   * merge is not symmetric: `id` is a single slot the last line wins, a
   * key-value pair is the same, and `class` is a set the two lines union. So
   * the TARGET'S VALUE wins the collision, which is the ruling, and whatever
   * the figure set under a name the target also sets is gone from the source.
   *
   * A LOSS THE AST DOES NOT TAKE, which is why it buffers here instead of
   * reporting at the point it is found. `htmlToAst` keeps `figure.attrs` and
   * `target.attrs` apart and loses nothing; only the writer has to put them on
   * two lines that meet.
   */
  private readonly displacedFigureAttrs: Array<{ node: P5Node; path: string; name: string }> = []
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
  private cellDepth = 0
  private headingDepth = 0
  private separatorsInserted = 0
  /**
   * The id PART 9 §16a's counter derives for each `<p class="admonition-title">`,
   * keyed by the node, so the drop is an equality match on the value the
   * renderer would write at that position. Built on first use, off `root`.
   */
  private admonitionTitleIds: Map<P5Node, string> | undefined
  /**
   * What the importer decided to REBUILD from each node's §13a carriers.
   *
   * Decided before `attrs()` reads the element, because `attrs()` consults it:
   * a carrier that reached a node is consumed in silence, exactly as
   * `data-delim` is, where one left unreadable is still refused by ruling 5.
   */
  private readonly carrierReads = new Map<P5Node, CarrierRead>()
  /** Reserved names a contradiction row (§13d) already covers on an element. */
  private readonly contradicted = new Map<P5Node, Set<string>>()
  /**
   * The reference definitions `data-carve-ref` asks for, first-seen order. A
   * resolved reference writes back as `[text][label]`, which needs the
   * `[label]: /url` line beside it or it reads as literal text.
   */
  private readonly referenceDefinitions = new Map<string, { label: string; href: string; title: string | undefined }>()
  /** The labels a rebuilt reference actually used, so an unusable carrier
   *  does not leave a definition nothing points at. */
  private readonly referenceLabelsUsed = new Set<string>()
  private root: P5Node | undefined
  private readonly maxDepth: number
  private readonly maxNodes: number

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
    this.report = new HtmlImportReportCollector(options.maxDiagnostics ?? 1_000, (node) => this.positionOf(node))
    this.footnotes = new FootnoteStage(this.footnoteContext())
    this.labels = { ...LABEL_DEFAULTS, ...options.labels }
    this.listTableForBlockCells = options.listTableForBlockCells === true
    this.tables = new TableStage(this.tableContext())
  }

  private footnoteContext(): FootnoteStageContext {
    return {
      report: this.report,
      attr: (node, name) => this.attr(node, name),
      hasCarrier: (node, name) => this.hasCarrier(node, name),
      carrierValue: (node, name) => this.carrierValue(node, name),
      blocks: (nodes, path, depth) => this.blocks(nodes, path, depth),
      flatText: (node) => this.flatText(node),
      invalidateSiblingIndex: (node) => { siblingIndex.delete(node) },
      indexIn: (parent, node) => indexIn(parent, node),
    }
  }

  private tableContext(): TableStageContext {
    return {
      report: this.report,
      unspellable: this.unspellable,
      cellAlignment: this.cellAlignment,
      writing: this.writing,
      listTableForBlockCells: this.listTableForBlockCells,
      enter: (depth) => this.enter(depth),
      attr: (node, name) => this.attr(node, name),
      childPath: (path, node, index) => this.childPath(path, node, index),
      indexIn: (parent, node) => indexIn(parent, node),
      attrs: (node, path) => this.attrs(node, path),
      attrNames: (attrs) => this.attrNames(attrs),
      captionInlines: (node, path, depth) => this.captionInlines(node, path, depth, 'caption'),
      blocks: (nodes, path, depth) => this.blocks(nodes, path, depth),
      blockInlines: (nodes, path, depth) => this.blockInlines(nodes, path, depth),
      withCellDepth: (read) => { this.cellDepth++; try { return read() } finally { this.cellDepth-- } },
      carrierValue: (node, name) => this.carrierValue(node, name),
      carriedSeparatorWidths: (node) => this.carriedSeparatorWidths(node),
    }
  }

  import(html: string): Document {
    const fragment = parseFragment(html, { sourceCodeLocationInfo: true })
    this.root = fragment
    // BEFORE the adapter pass, which rewrites footnote-shaped HTML and imports
    // the definitions it finds: the numbers have to be on the tree as the
    // AUTHOR wrote it, or a definition's diagnostics would sort by where the
    // rewrite left it rather than by where it stands in the document.
    this.numberDocumentOrder(fragment)
    // Before the walk: the `<abbr>` arm asks which expansions the author
    // DEFINED, and the template that says so sits at document end.
    this.footnotes.readAbbreviationCarrier(fragment)
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
    const footnoteDefs = this.footnotes.adapterFootnotes(
      fragment,
      FOOTNOTE_SHAPED_ADAPTERS.has(this.adapter),
    )
    const children = this.blocks(domChildren(fragment) ?? [], '', 0)
    // The `[label]: /url` lines every rebuilt `data-carve-ref` points at. At
    // document end rather than where the author wrote them: HTML keeps no
    // record of that position, and a definition resolves from anywhere.
    children.push(...this.reconstructedDefinitions())
    // `*[abbr]: expansion` leads the document, where Carve's own writer puts a
    // definition the prose below it uses.
    children.unshift(...[...this.footnotes.abbreviationDefs].map(([abbr, expansion]): BlockNode => ({ type: 'abbreviation_def', abbr, expansion })))
    const doc: Document = { type: 'document', children }
    if (footnoteDefs) this.footnotes.pruneInlinedFootnotes(footnoteDefs, children)
    if (footnoteDefs && Object.keys(footnoteDefs).length > 0) doc.footnoteDefs = footnoteDefs
    return doc
  }

  private enter(depth: number): void {
    if (depth > this.maxDepth) throw new HtmlImportLimitError('depth')
    if (++this.nodes > this.maxNodes) throw new HtmlImportLimitError('nodes')
  }

  /**
   * Report an element kept whole as raw HTML: its own refused attributes, the
   * `raw-preserved` row, then every refused attribute of every element inside
   * it, in document order (markup-carve/carve#2261).
   *
   * Own rows are rewritten IN PLACE so they keep their `seq` and still stand
   * ahead of the `raw-preserved` row. Matching on the node keeps it to the
   * element's own rows.
   */
  private keepRaw(node: P5Node, path: string, message: string): void {
    // `style-unmapped` names a CSS mapping kept bytes do not run, so it goes
    // first and the refusal row below is the only one the reader gets for a
    // `style` here (markup-carve/carve#2267).
    this.report.preserveOwner(node)
    this.report.add('raw-preserved', message, 'warning', path, node)
    const pending: Array<[P5Node, string]> = []
    const queueChildren = (parent: P5Node, parentPath: string) => {
      const children = serializedChildren(parent)
      for (let i = children.length - 1; i >= 0; i--) pending.push([children[i]!, this.childPath(parentPath, children[i]!, i)])
    }
    queueChildren(node, path)
    while (pending.length > 0) {
      const [child, childPath] = pending.pop()!
      if (domTag(child) === undefined) continue
      // `attrs()` is the own-attribute policy; only its refusal rows are kept,
      // so the rows it discards are not charged against the cap.
      this.report.preserveDescendant(child, node, () => this.attrs(child, childPath, true))
      queueChildren(child, childPath)
    }
  }

  /** Drop what the walk into a now-raw element recorded, keeping the rows after `walked`. */
  private discardWalk(before: ReturnType<Importer['mark']>, walked: ReturnType<Importer['mark']>): void {
    this.report.discardWalk(before[0], walked[0])
    this.unspellable.length = before[1]
    this.loneImageParagraphs.length = before[2]
    this.displacedFigureAttrs.length = before[3]
  }

  /**
   * The report as it stands, so an arm that ends up PRESERVING an element whole
   * can discard what the walk into it recorded (markup-carve/carve#1704).
   *
   * Every loss channel is append-only and every entry is a claim about
   * something the document did not keep. When `figure()` decides to hand the
   * element back verbatim, the walk's claims are all false - the attribute it
   * called dropped rides on bytes the output still carries - so the mark is
   * taken before the walk and the arm rewinds to it.
   *
   * The truncation flag rewinds WITH them. A cap the discarded walk reached is a
   * claim about rows that are being discarded too, and left standing it made the
   * marker replace a row the report does keep - so a document under the cap came
   * back saying it was over it, with a real finding swallowed (carve-js#2034).
   */
  private mark(): [DiagnosticMark, number, number, number] {
    return [
      this.report.mark(),
      this.unspellable.length,
      this.loneImageParagraphs.length,
      this.displacedFigureAttrs.length,
    ]
  }

  private restore([report, unspellable, loneImages, displaced]: [DiagnosticMark, number, number, number]): void {
    this.report.restore(report)
    this.unspellable.length = unspellable
    this.loneImageParagraphs.length = loneImages
    this.displacedFigureAttrs.length = displaced
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
    for (let current = node; current !== undefined; current = domParent(current)) {
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
      const children = serializedChildren(node)
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
  private attrs(node: P5Node, path: string, rawKept = false): Attrs | undefined {
    const attrs: Attrs = {}
    const classes: string[] = []
    const keyValues: Record<string, string> = {}
    const styleSlots = new Set<string>()
    {
      const cell = domTag(node) === 'td' || domTag(node) === 'th'
      for (const declaration of (this.attr(node, 'style') ?? '').split(';')) {
        const split = declaration.indexOf(':')
        if (split < 0) continue
        const mapped = this.mappedStyleDeclaration(declaration.slice(0, split).trim().toLowerCase(), declaration.slice(split + 1).trim().toLowerCase(), cell)
        if (mapped && (cell || mapped.key === 'align')) styleSlots.add(mapped.key)
      }
    }
    for (const attr of domAttrs(node) ?? []) {
      const name = attr.name.toLowerCase()
      if (isDangerousAttrName(name)) {
        // `srcdoc` and `formaction` are not event handlers, so they get their
        // own wording - but not their own membership test. The set is the
        // renderer's.
        const kind = name.startsWith('on') ? 'event-handler' : 'injection-sink'
        this.report.refuseAttribute(node, path, `${kind} attribute ${name}`, '', 'warning', true)
        continue
      }
      const refusedBefore = this.report.mark()
      if (name === 'style') {
        this.styles(node, attr.value, keyValues, path)
      } else if (name === 'id') {
        attrs.id = attr.value
      } else if (name === 'class') {
        classes.push(...attr.value.split(/\s+/).filter(Boolean))
      } else if (ROUND_TRIP_MARKER_ATTRIBUTES.has(name)) {
        // A serializer's own marker rather than the author's content, so it is
        // not re-emitted as an attribute of the imported document (ruling 5).
        // Where the importer REBUILT what it holds it is consumed in silence,
        // exactly as `data-delim` is: a row here would name a loss that did
        // not happen.
        if (!this.isReconstructedCarrier(node, domTag(node) ?? '', name) && !this.contradicted.get(node)?.has(name)) {
          const lostRaw = this.mode === 'roundtrip' && (name === 'data-carve-raw' || name === 'data-djot-raw')
          this.report.refuseAttribute(node, path, `round-trip marker attribute ${name}`, '', lostRaw ? 'warning' : 'info', destinationIsDenied(attr.value))
        }
      } else if ((name === 'data-carve-ext' || name === 'data-carve-selected') && this.isReconstructedCarrier(node, domTag(node) ?? '', name)) {
        // Extension carriers are consumed only when their marked structure was rebuilt.
      } else if (styleSlots.has(name) && (rawKept || !this.isConsumedHtmlAttribute(node, domTag(node) ?? '', name))) {
        this.report.refuseAttribute(node, path, name, ': a mapped CSS declaration already sets it', 'info', destinationIsDenied(attr.value))
      } else if (this.isConsumedHtmlAttribute(node, domTag(node) ?? '', name)) {
        // Read as content or as an instruction somewhere else in this importer,
        // so keeping it here as well would give the same source two spellings.
      } else if (SEMANTIC_SPAN_TAGS.has(domTag(node) ?? '') && name === domTag(node)) {
        this.report.refuseAttribute(node, path, name, ": the semantic span's marker owns that key", rawKept ? 'info' : 'warning', destinationIsDenied(attr.value))
      } else if (!isAttrIdentifier(name)) {
        this.report.refuseAttribute(node, path, `unsupported attribute ${name}`, ': not spellable as a Carve attribute name', 'info', false)
      } else if (/[\r\n]/.test(attr.value)) {
        // A quoted attribute value ENDS at the line break, so writing this back
        // produces an attribute block that does not reparse as one: it lands in
        // the document as literal `{name="first` text and the attribute is gone
        // anyway. Refused loudly rather than emitted as corruption.
        this.report.refuseAttribute(node, path, name, ': its value spans a line break, which a Carve attribute value cannot', 'warning', false)
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
          this.report.refuseAttribute(node, path, name, ': a mapped CSS declaration already sets it', 'info', false)
        } else {
          // A URL-list value is probed at every candidate on render
          // (CARVE-P9-055), so a later denied token is reached there.
          const laundered = isUrlListAttribute(name) ? undefined : launderableScheme(attr.value)
          if (laundered !== undefined) {
            this.report.refuseAttribute(node, path, name, `: its value carries a ${laundered} URL the renderer does not reach`, 'warning', true)
          } else {
            // `setOwn`, not `keyValues[name] = …`: a `<p __proto__="x">` would
            // run the prototype setter, store nothing, and lose the attribute
            // in silence (markup-carve/carve-js#886's class, reached here by
            // keeping attribute names the document chose).
            setOwn(keyValues, name, attr.value)
          }
        }
      }
      if (this.mode === 'roundtrip' && (destinationIsDenied(attr.value) || urlListHasDeniedToken(name, attr.value)) && !this.report.hasOwnedSince(refusedBefore, node)) {
        this.report.refuseIfKept(node, path, `${name} with a denied URL scheme`)
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
    const tag = domTag(node) ?? ''
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
      const title = (domChildren(node) ?? []).find((child) => this.isCountedAdmonitionTitle(child))
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
    const parent = domParent(node)
    const siblings = domChildren(parent) ?? []
    const at = parent ? indexIn(parent, node) : -1
    for (let i = at - 1; i >= 0; i--) {
      const previous = siblings[i]!
      if (previous.nodeName === '#text' && (domValue(previous) ?? '').trim() === '') continue
      if (domTag(previous) === undefined) continue
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
    const parent = domParent(node)
    if (!parent) return undefined
    let entry = this.indexBackrefEntries.get(parent)
    if (!entry) {
      const ordinals = new Map<P5Node, number>()
      const terms: string[] = []
      for (const child of domChildren(parent) ?? []) {
        const isBackref = domTag(child) === 'a'
          && (this.attr(child, 'class') ?? '').split(/\s+/).includes('index-backref')
        if (isBackref) ordinals.set(child, ordinals.size + 1)
        else terms.push(this.text(child))
      }
      entry = { term: terms.join('').trim(), ordinals }
      this.indexBackrefEntries.set(parent, entry)
    }
    const ordinal = entry.ordinals.get(node)
    const term = entry.term
    if (ordinal === undefined || term === '') return undefined
    const label = this.labels.indexBackref
    const heldName = this.attr(node, 'aria-label')
    if (heldName === undefined || heldName.length < label.length + term.length + 1) return undefined
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
        if (this.footnotes.detachedFootnoteBlocks.has(current)) continue
        if (this.isCountedAdmonitionTitle(current)) {
          titles.push(current)
        } else {
          const id = this.attr(current, 'id')
          if (id !== undefined) reserved.push(id)
        }
        const children = domChildren(current) ?? []
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
      domTag(node) === 'p' &&
      (this.attr(node, 'class') ?? '').split(/\s+/).includes('admonition-title')
    )
  }

  private isDivLabel(node: P5Node): boolean {
    return (
      domTag(node) === 'p' && (this.attr(node, 'class') ?? '').split(/\s+/).includes('div-label')
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
    for (const child of domChildren(node) ?? []) {
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
    const at = body.findIndex((child) => domTag(child) !== undefined)
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
      if (before.nodeName === '#text' && (domValue(before) ?? '').trim() !== '') return undefined
    }
    /*
     * ITS INLINE CONTENT, WRITTEN BACK AS THE LABEL'S SOURCE. The label is an
     * inline run (ruled on markup-carve/carve#2572), so markup in it has a
     * spelling on the opener and the paragraph can be lifted whole. This used to
     * refuse anything but text, because the label was published escaped and
     * lifting `<strong>` would have flattened it without a word.
     *
     * The written form is what the refusals below are asked of, for the reason
     * `spellableTitle` gives: enumerating the spellings that can produce a `]`
     * is a second copy of the grammar, and the writer already knows.
     */
    const kids = domChildren(body[at]!) ?? []
    const labelPath = bodyPaths[at] ?? ''
    const label = this.containerLabelSource(kids, labelPath, depth)
    if (label === undefined) return undefined
    /*
     * AND NOTHING THE OPENER CANNOT SPELL. `]` closes the label and a newline
     * ends the opener line, so neither can ride back out - a label carrying one
     * would be written into source that re-reads as something else. Whatever else
     * an inline run can spell, the parser answers for; see `labelReadsBack`.
     */
    if (label.includes(']') || label.includes('\n') || !this.labelReadsBack(label)) return undefined
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
    const own = this.attrs(body[at]!, labelPath)
    const leftover = own && {
      ...own,
      classes: (own.classes ?? []).filter((name) => name !== 'div-label'),
    }
    if (leftover && !leftover.classes.length) delete (leftover as Attrs).classes
    if (leftover && (leftover.id || leftover.classes || leftover.keyValues)) {
      this.report.add(
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
    const parent = domParent(node)
    if (!parent || domTag(parent) !== 'aside') return false
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
    this.report.add('element-unwrapped', message, 'info', path, node)
    if (!attrs) return children
    return [{ type: 'span', children, attrs }]
  }

  /**
   * The destination-less shape for a destination the §25 sink blanks, reported
   * as the one dropped attribute it is rather than as an unwrap.
   */
  private dropDeniedDestination(
    node: P5Node,
    name: 'href' | 'src',
    children: InlineNode[],
    attrs: Attrs | undefined,
    path: string,
  ): InlineNode[] {
    this.report.add('attribute-dropped', `Dropped ${name} with a denied URL scheme on <${domTag(node)}>`, 'warning', path, node)
    if (!attrs) return children
    return [{ type: 'span', children, attrs }]
  }

  /**
   * A §13a carrier's value, the canonical `data-carve-` spelling first and the
   * deprecated `data-djot-` one second, so documents released carve-php
   * versions exported keep round-tripping (markup-carve/carve#2902 ruling 0).
   */
  private carrierValue(node: P5Node, name: CarrierName): string | undefined {
    return readCarrier((attribute) => this.attr(node, attribute), name)
  }

  /** `data-carve-col-widths` where every entry is in its grammar, else `undefined`. */
  private carriedSeparatorWidths(node: P5Node): number[] | undefined {
    const raw = this.carrierValue(node, 'col-widths')
    if (raw === undefined) return undefined
    const widths = raw.split(',').map((part) => {
      if (!/^[0-9]+$/.test(part)) return undefined
      const width = Number(part)
      return Number.isSafeInteger(width) && width >= 1 && width <= MAX_CARRIED_SEPARATOR_WIDTH ? width : undefined
    })
    return widths.length > 0 && widths.every((width) => width !== undefined) ? (widths as number[]) : undefined
  }

  /** A presence carrier: §13a reads PRESENCE and does not compare the value. */
  private hasCarrier(node: P5Node, name: CarrierName): boolean {
    return this.carrierValue(node, name) !== undefined
  }

  /** The reserved name a carrier was found under, for the consumed test. */
  private carrierName(node: P5Node, name: CarrierName): string | undefined {
    for (const spelling of name === 'ext' || name === 'selected' ? [carrier(name)] : [carrier(name), legacyCarrier(name)]) {
      if (this.attr(node, spelling) !== undefined) return spelling
    }
    return undefined
  }

  /**
   * `data-marker` read as the authored list marker, or `undefined`.
   *
   * A VALUE OUTSIDE THE ENUMERATION IS NOT THE CARRIER, by PART 10 §12's
   * precedent - the rule `readsDelim` and `readsTaskState` already apply. Nor
   * is it the author's attribute: ruling 5 refuses every reserved name on the
   * way out, so an unreadable value is dropped with a row rather than kept.
   */
  private readsMarker(list: P5Node): '*' | ')' | undefined {
    const value = this.attr(list, CARRIER_MARKER)
    if (domTag(list) === 'ol') return value === ')' ? ')' : undefined
    return value === '*' ? '*' : undefined
  }

  /** `data-char` read as the authored thematic-break character. */
  private readsChar(hr: P5Node): '-' | '*' | '_' | undefined {
    const value = this.attr(hr, CARRIER_CHAR)
    return value === '-' || value === '*' || value === '_' ? value : undefined
  }

  /** Whether this reserved name was READ as the node's own content here. */
  private isReconstructedCarrier(node: P5Node, tag: string, name: string): boolean {
    if (name === CARRIER_MARKER) return (tag === 'ul' || tag === 'ol') && this.readsMarker(node) !== undefined
    if (name === CARRIER_CHAR) return tag === 'hr' && this.readsChar(node) !== undefined
    for (const read of this.carrierReads.get(node)?.names ?? []) {
      if (this.carrierName(node, read) === name) return true
    }
    return false
  }

  /**
   * §13d: two carriers that contradict each other restore neither meaning. One
   * row covers the pair, and `attrs()` then drops both names without another.
   */
  private refuseContradiction(node: P5Node, path: string, first: PrefixedCarrier, second: PrefixedCarrier): void {
    const names = [first, second]
      .flatMap((name) => [carrier(name), legacyCarrier(name)])
      .filter((spelling) => this.attr(node, spelling) !== undefined)
    this.contradicted.set(node, new Set(names))
    this.report.refuseAttribute(
      node,
      path,
      `contradictory carriers ${names.join(' and ')}`,
      ': neither meaning is restored',
      'warning',
      names.some((spelling) => destinationIsDenied(this.attr(node, spelling) ?? '')),
    )
  }

  private readIdCarriers(node: P5Node, path: string, wrapper: boolean): void {
    const explicit = this.hasCarrier(node, 'explicit-id')
    const generated = this.hasCarrier(node, 'generated-id')
    if (explicit && generated) {
      this.refuseContradiction(node, path, 'explicit-id', 'generated-id')
      return
    }
    if (generated) this.recordCarrier(node, 'generated-id')
    if (!explicit) return
    this.recordCarrier(node, 'explicit-id')
    const slot = this.carrierValue(node, 'id-slot') ?? ''
    if (wrapper && RE_ID_SLOT.test(slot)) this.recordCarrier(node, 'id-slot')
  }

  private recordCarrier(node: P5Node, name: CarrierName, read: Omit<CarrierRead, 'names'> = {}): void {
    const existing = this.carrierReads.get(node)
    if (existing) {
      existing.names.add(name)
      Object.assign(existing, read)
      return
    }
    this.carrierReads.set(node, { names: new Set([name]), ...read })
  }

  /**
   * The Carve source of an imported inline run, or `undefined` where the run
   * has none. `rawRef` is literal source text, so a reference link is only
   * rebuilt where its own label content can be written back.
   */
  private carveInlineSource(children: InlineNode[]): string | undefined {
    try {
      // ONLY THE WRITER'S TERMINATOR comes off. `trimEnd()` also took a
      // trailing no-break space, which is content the label held.
      const written = renderCarve({ type: 'document', children: [{ type: 'paragraph', children }] }).replace(/\n+$/, '')
      return /[\r\n]/.test(written) ? undefined : written
    } catch {
      return undefined
    }
  }

  /**
   * The label a `data-carve-ref` names, where a definition can be written for
   * it and this document has not already bound it elsewhere. Binding it here
   * is what makes the second link under a reused label read the first one's
   * destination rather than silently inherit the wrong one.
   */
  private readsRef(node: P5Node, href: string, title: string | undefined): string | undefined {
    const label = this.carrierValue(node, 'ref')
    if (label === undefined || !isReferenceLabel(label)) return undefined
    // KEYED ON THE RESOLUTION KEY, not on the spelling: `r` and ` r ` are one
    // label to the resolver, so comparing the spellings let two carriers bind
    // two destinations under one key and sent both links to the second one.
    const key = normalizeRefLabel(label)
    const bound = this.referenceDefinitions.get(key)
    if (bound !== undefined) return bound.href === href && bound.title === title ? bound.label : undefined
    this.referenceDefinitions.set(key, { label, href, title })
    return label
  }

  /**
   * The Carve spelling of an attribute block, `''` for none, or `undefined`
   * where it has none.
   *
   * `rawRef` is returned VERBATIM by the writer, so a reference link's own
   * attributes have to be inside it: without this `[t][r]{.foo}` came back as
   * `[t][r]` and the class was gone.
   */
  private carveAttributeSuffix(attrs: Attrs | undefined): string | undefined {
    if (attrs === undefined) return ''
    const written = this.carveInlineSource([{ type: 'span', children: [{ type: 'text', value: 'x' }], attrs }])
    if (written === undefined || !written.startsWith('[x]')) return undefined
    return written.slice(3)
  }

  /**
   * Decide the inline carriers on this element BEFORE `attrs()` reads it.
   *
   * The arms below then only spend the answer, which keeps one decision in one
   * place and lets the attribute pass know which names were consumed.
   */
  private readInlineCarriers(node: P5Node, tag: string, children: InlineNode[], path: string): void {
    if (tag === 'a' && this.hasCarrier(node, 'xref') && /^#[^> \n\r]+$/.test(this.attr(node, 'href') ?? '')) {
      const footnoteLabel = this.carrierValue(node, 'footnote-label')
      const validFootnoteLabel = footnoteLabel !== undefined && !/[\r\n\u2028\u2029]/u.test(footnoteLabel)
        && RE_FOOTNOTE_DEF.exec(`[^${footnoteLabel}]: x`)?.[1] === footnoteLabel
      const other = isReferenceLabel(this.carrierValue(node, 'ref') ?? '') ? 'ref'
        : this.hasCarrier(node, 'autolink') ? 'autolink'
        : validFootnoteLabel ? 'footnote-label'
        : undefined
      if (other) {
        this.refuseContradiction(node, path, 'xref', other)
        return
      }
      this.recordCarrier(node, 'xref')
      return
    }
    if (tag === 'span' && this.hasCarrier(node, 'substitution')) {
      // One `<del>` then one `<ins>`, nothing else on the span or its halves.
      const names = [carrier('substitution'), legacyCarrier('substitution')]
      const bare = (domAttrs(node) ?? []).every(attribute => names.includes(attribute.name.toLowerCase()))
      const elements = domChildren(node) ?? []
      const pair = elements.length === 2 && domTag(elements[0]!) === 'del' && domTag(elements[1]!) === 'ins'
        && elements.every((element) => (domAttrs(element) ?? []).length === 0)
      if (bare && pair && children.length === 2 && children[0]!.type === 'delete' && children[1]!.type === 'insert') {
        this.recordCarrier(node, 'substitution')
      }
    }
    if (tag === 'span' && this.hasCarrier(node, 'caption-number')) {
      const bare = (domAttrs(node) ?? []).every(attribute => [carrier('caption-number'), legacyCarrier('caption-number')].includes(attribute.name))
      if (bare && (domChildren(node) ?? []).every(child => child.nodeName === '#text')) this.recordCarrier(node, 'caption-number')
    }
    if (tag === 'span') {
      // NEITHER A RAW INLINE NOR AN ESCAPE HAS AN ATTRIBUTE SLOT its writer
      // emits, so rebuilding one over an element carrying anything else
      // deletes it silently. Asked of the ELEMENT rather than of `attrs()`,
      // which has not run yet, and which would in any case have refused a
      // dangerous name this still has to see.
      const bare = (domAttrs(node) ?? []).every((attribute) => RESERVED_CARRIER_ATTRIBUTES.has(attribute.name.toLowerCase()))
      const format = this.carrierValue(node, 'raw')
      const holdsElements = (domChildren(node) ?? []).some((child) => domTag(child) !== undefined)
      const value = bare && !holdsElements ? this.flatText(node) : ''
      const escaped = this.hasCarrier(node, 'escaped') && [...value].length === 1 && RE_ESCAPABLE_PUNCTUATION.test(value)
      // The writer normalizes a format, so one the parser would not read is not a carrier.
      const raw = format !== undefined && bare && RE_RAW_INLINE_FORMAT.test(format)
        && (holdsElements || this.flatText(node) !== '')
      if (escaped && raw) {
        this.refuseContradiction(node, path, 'escaped', 'raw')
        return
      }
      if (raw && (this.mode === 'roundtrip' || (format!.toLowerCase() !== 'html' && !holdsElements))) this.recordCarrier(node, 'raw')
      if (escaped) this.recordCarrier(node, 'escaped')
      return
    }
    if (tag !== 'a' && tag !== 'img') return
    // §13d: an autolink has no label and a reference is not an autolink. An
    // invalid label is not a carrier (§13e) and contradicts nothing.
    if (tag === 'a' && this.hasCarrier(node, 'autolink') && isReferenceLabel(this.carrierValue(node, 'ref') ?? '')) {
      this.refuseContradiction(node, path, 'autolink', 'ref')
      return
    }
    const destination = this.attr(node, tag === 'a' ? 'href' : 'src')
    // A destination §25 blanked or the source never had stays blanked: no
    // carrier routes a value back past a security rule, and no node is built
    // for the carrier to ride (§13b).
    if (!destinationIsCarried(destination)) return
    if (tag === 'a' && this.hasCarrier(node, 'autolink')) {
      const display = children.every((child) => child.type === 'text')
        ? children.map((child) => (child as { value: string }).value).join('')
        : undefined
      const bare = destination!.startsWith('mailto:') ? destination!.slice(7) : destination!
      // THE TEXT OF AN AUTOLINK IS ITS DESTINATION, AND IT HAS TO SPELL ONE.
      // The writer emits `<text>`, so a text that is not the destination gives
      // a `<hi>` that re-parses as literal text and loses the link, and a
      // destination with no autolink spelling gives a `</u>` that does the
      // same. The grammar's own matcher answers the second question, rather
      // than a second hand-spelling of it.
      //
      // A TITLE IS THE THIRD WAY THE CARRIER CANNOT BE HONORED: an autolink
      // node has no title field, and `attrs()` has already consumed the
      // attribute as the link's own, so rebuilding one would drop it silently.
      // THE WHOLE TEXT, not a prefix of it: the matcher is anchored at the
      // start only, so a destination with a `>` in it matched its valid head
      // and the tail came back as literal text.
      const matched = display === undefined ? null : RE_AUTOLINK.exec(`<${display}>`)
      const spellable = matched !== null && matched[0].length === display!.length + 2
      if (spellable && display !== undefined && this.attr(node, 'title') === undefined && (display === bare || display === destination)) {
        this.recordCarrier(node, 'autolink', display === bare ? {} : { autolinkText: display })
        return
      }
    }
    const title = this.attr(node, 'title')
    const label = this.readsRef(node, destination!, title)
    if (label === undefined) return
    const source = tag === 'img'
      ? this.carveInlineSource([{ type: 'text', value: this.attr(node, 'alt') ?? '' }])
      : this.carveInlineSource(children)
    if (source === undefined) return
    this.recordCarrier(node, 'ref', { ref: label, labelSource: `${tag === 'img' ? '!' : ''}[${source}]` })
  }

  /**
   * `ref` and `rawRef` for a rebuilt reference, or nothing.
   *
   * The attribute block is part of `rawRef` because the writer emits that
   * string verbatim. An attribute block with no Carve spelling leaves the link
   * inline, which keeps the attributes and loses only the reference form.
   */
  private referenceFields(carried: CarrierRead | undefined, attrs: Attrs | undefined): { ref?: string; rawRef?: string } {
    if (carried?.ref === undefined || carried.labelSource === undefined) return {}
    const suffix = this.carveAttributeSuffix(attrs)
    if (suffix === undefined) return {}
    this.referenceLabelsUsed.add(normalizeRefLabel(carried.ref))
    const collapsed = carried.labelSource === `[${carried.ref}]` || carried.labelSource === `![${carried.ref}]`
    return { ref: carried.ref, rawRef: `${carried.labelSource}[${collapsed ? '' : carried.ref}]${suffix}` }
  }

  /** The reference definitions every rebuilt `data-carve-ref` needs beside it. */
  private reconstructedDefinitions(): BlockNode[] {
    const defs: BlockNode[] = []
    for (const [key, { label, href, title }] of this.referenceDefinitions) {
      if (!this.referenceLabelsUsed.has(key)) continue
      defs.push({ type: 'link_reference_definition', label, href, ...(title !== undefined ? { title } : {}) })
    }
    return defs
  }

  /**
   * Whether `data-delim` IS this list's delimiter: the one PART 10 §12 writes.
   * Any other value is the author's attribute, and kept.
   */
  private readsDelim(ol: P5Node): boolean {
    return this.attr(ol, 'data-delim') === ')'
  }

  /**
   * Whether `data-task-state` IS this item's state: one PART 10 §11 writes,
   * an extended state on an EMPTY box or `x` on a ticked one. Anything else
   * is the author's attribute, and kept.
   */
  private readsTaskState(li: P5Node): boolean {
    const state = this.attr(li, 'data-task-state')
    const input = this.taskCheckbox(li)
    if (input === undefined) return false
    const ticked = this.attr(input, 'checked') !== undefined
    if (state === 'x') return ticked
    return isReadableTaskState(state) && !ticked
  }

  /** The item's task-list checkbox, which carries half of its state. */
  private taskCheckbox(li: P5Node): P5Node | undefined {
    return domChildren(li)?.find(
      (n) => domTag(n) === 'input' && this.isEnumeratedKeyword(this.attr(n, 'type'), 'checkbox'),
    )
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
      return name === 'title' && !this.carrierReads.get(node)?.names.has('xref') && destinationIsCarried(this.attr(node, 'href'))
    }
    if (tag === 'img') {
      // `alt` stays consumed either way: with a source it is the image node's
      // `alt` field, and without one it is the CONTENT that stands in the
      // element's place, so it is in the emitted document as prose rather than
      // in an attribute position.
      if (name === 'src' || name === 'alt') return true
      return name === 'title' && destinationIsCarried(this.attr(node, 'src'))
    }
    if (tag === 'ol') return name === 'start' || name === 'type' || (name === 'data-delim' && this.readsDelim(node))
    if (tag === 'li' && name === 'data-task-state') return this.readsTaskState(node)
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

  /**
   * The Carve slot a CSS declaration maps to, or `undefined` where nothing in
   * the language spells it.
   */
  private mappedStyleDeclaration(property: string, value: string, cell: boolean): { key: 'align' | 'valign'; value: string } | undefined {
    if (this.mode === 'safe' && !(cell && property === 'text-align')) return undefined
    if (property === 'text-align' && ['left', 'right', 'center'].includes(value)) return { key: 'align', value }
    if (property === 'vertical-align' && ['top', 'middle', 'bottom'].includes(value)) return { key: 'valign', value }
    return undefined
  }

  /**
   * A declaration the language has no slot for, owned by its element so the
   * raw-keep path can withhold it where the mapping never runs.
   */
  private styleUnmapped(node: P5Node, path: string, property: string): void {
    if (!this.report.add('style-unmapped', `CSS declaration ${property} was not mapped`, 'info', path, node)) return
    this.report.ownLast(node)
  }

  /**
   * `style`, through the CSS mapping AND through the refusal policy every other
   * attribute goes through (markup-carve/carve#2267).
   *
   * The mapping answers for a document the import rewrites, where an unmapped
   * declaration is a `style-unmapped` row. Inside an element `roundtrip` keeps
   * whole, no mapping runs and the bytes carry the CSS into the output, so the
   * same latent-refusal channel `refuseIfKept` gives a denied destination
   * reports the attribute as `attribute-preserved` and `keepRaw` withholds the
   * mapping rows it stands in for.
   */
  private styles(node: P5Node, value: string, keyValues: Record<string, string>, path: string): void {
    const cell = domTag(node) === 'td' || domTag(node) === 'th'
    if (this.mode === 'roundtrip') {
      const { subject, live } = styleRefusal(value)
      this.report.refuseIfKept(node, path, subject, live)
    }
    for (const declaration of value.split(';')) {
      const split = declaration.indexOf(':')
      if (split < 0) continue
      const property = declaration.slice(0, split).trim().toLowerCase()
      const val = declaration.slice(split + 1).trim().toLowerCase()
      if (!property) continue
      const mapped = this.mappedStyleDeclaration(property, val, cell)
      // A CELL TAKES THE MARKER RUN, NOT AN ATTRIBUTE. `|>` is written back as
      // `style="text-align: right;"` and `{align=right}` as `align="right"`, so
      // only the marker returns the declaration the import was handed - and
      // only the marker keeps `carve -> html -> carve -> html` stable, which the
      // attribute spelling did not (markup-carve/carve#1745).
      if (mapped && cell) {
        const slot = this.cellAlignment.get(node) ?? {}
        slot[mapped.key] = mapped.value
        this.cellAlignment.set(node, slot)
      } else if (mapped?.key === 'align') {
        // OFF A CELL there is no marker, and `align` is a legacy presentational
        // attribute HTML defines for exactly these elements, so the key-value
        // is the faithful spelling rather than a second-best one.
        keyValues.align = mapped.value
      } else if (mapped) {
        // `valign` is defined for table cells and nothing else, so writing it
        // onto a paragraph would emit an attribute no reader honours - a
        // spelling that looks like a mapping and is not one.
        this.styleUnmapped(node, path, property)
      } else {
        this.styleUnmapped(node, path, property)
      }
    }
  }

  private attr(node: P5Node, name: string): string | undefined {
    return domAttrs(node)?.find((a) => a.name.toLowerCase() === name)?.value
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
    const name =
      domTag(node) ??
      (node.nodeName === '#text' ? 'text()' : node.nodeName === '#comment' ? 'comment()' : node.nodeName)
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
    // A node inside a spliced wrapper keeps the depth it really sits at.
    let inlineDepths: number[] = []
    const flush = (): void => {
      const buffered = inlineBuffer
      const bufferedPaths = inlinePaths
      const bufferedDepths = inlineDepths
      inlineBuffer = []
      inlinePaths = []
      inlineDepths = []
      /*
       * A RUN THAT HOLDS NOTHING BUT COMMENTS IS A BLOCK COMMENT RUN, not a
       * paragraph carrying inline ones (markup-carve/carve#1709).
       *
       * The POSITION decides the spelling and the comment is not relocated, and
       * this is where the two positions are told apart. `blocks()` buffers
       * every non-block node into an inline run, so `<p>a</p><!--n--><p>b</p>`
       * arrives here as a run holding one comment and nothing else - which is a
       * comment sitting AMONG BLOCKS, however the buffer got it here. A run
       * that also carries text is a real inline run and its comment is inline:
       * `<div>text <!--n--> more</div>` is one paragraph, and splitting it at
       * the comment would move the words either side of it into two.
       *
       * Whitespace-only text is not "something else". It is the layout between
       * the blocks, which is exactly what a comment between two of them sits
       * in, and treating it as content would make the answer depend on whether
       * the author indented their HTML.
       */
      const commentsOnly =
        buffered.length > 0 &&
        buffered.some((node) => node.nodeName === '#comment') &&
        buffered.every(
          (node) => node.nodeName === '#comment' || isLayoutOnlyText(node),
        )
      if (commentsOnly || this.commentsBesideNothing(buffered, bufferedPaths, bufferedDepths)) {
        buffered.forEach((node, index) => {
          if (node.nodeName !== '#comment') return
          out.push({ type: 'comment', block: true, content: domData(node) ?? '' })
          void bufferedPaths[index]
        })
        return
      }
      const children = this.blockInlines(buffered, parentPath, depth + 1, bufferedPaths, bufferedDepths)
      if (!this.visible(children)) return
      out.push(this.bareBlockImage(children) ?? { type: 'paragraph', children })
    }
    for (const { node, path, level, splice } of this.spliceUnsupported(nodes, parentPath, paths)) {
      if (splice) {
        // The wrapper's children take its place in this stream, so an inline
        // run around it stays one run and a block inside it stays a block.
        this.enter(depth + level)
        const unwrapped = this.reportUnsupportedElement(node, domTag(node)!, path)
        this.reportUnwrappedAttributes(node, this.attrs(node, path), domTag(node)!, path, unwrapped)
        continue
      }
      if (isLayoutOnlyText(node)) {
        if (inlineBuffer.length) {
          inlineBuffer.push(node)
          inlinePaths.push(path)
          inlineDepths.push(depth + level + 1)
        }
        continue
      }
      /*
       * A MEDIA WRAPPER'S FALLBACK IS CONVERTED AS BLOCKS (ruling
       * markup-carve/carve#1749). It is not in `BLOCK` and must not be - see
       * `MEDIA_FALLBACK` for why `roundtrip` keeps the inline raw span - so the
       * ruling is applied here, at the one position where the children have
       * somewhere block-shaped to go.
       */
      const tag = domTag(node)
      if (tag && MEDIA_FALLBACK.has(tag) && this.mode !== 'roundtrip') {
        flush()
        out.push(...this.mediaFallback(node, tag, path, depth + level + 1))
        continue
      }
      if (!tag || !BLOCK.has(tag)) {
        inlineBuffer.push(node)
        inlinePaths.push(path)
        inlineDepths.push(depth + level + 1)
        continue
      }
      flush()
      const produced = this.block(node, path, depth + level + 1)
      const previous = out.at(-1)
      const next = produced[0]
      // Carve source has no boundary between two definition lists, so an
      // attribute-less one following another joins it (carve#2369).
      if (previous?.type === 'definition_list' && next?.type === 'definition_list' && !next.attrs) {
        previous.items.push(...next.items)
        if (next.loose) previous.loose = true
        produced.shift()
        this.report.add('element-unwrapped', 'Merged <dl> into the definition list before it: Carve source has no boundary between two adjacent definition lists', 'info', path, node)
      }
      out.push(...produced)
    }
    flush()
    return out
  }

  /**
   * `nodes` with every unsupported element that holds a block replaced by a
   * marker entry followed by its own children, at any nesting.
   *
   * An element holding only inline content is left alone: `blocks()` buffers
   * it and the inline arm unwraps it, which already keeps its content in place.
   * Iterative, so a deep chain of wrappers cannot overflow the stack.
   */
  private spliceUnsupported(
    nodes: P5Node[],
    parentPath: string,
    paths?: string[],
  ): Array<{ node: P5Node; path: string; level: number; splice: boolean }> {
    const out: Array<{ node: P5Node; path: string; level: number; splice: boolean }> = []
    if (this.mode === 'roundtrip') {
      nodes.forEach((node, index) => out.push({ node, path: paths?.[index] ?? this.childPath(parentPath, node, index), level: 0, splice: false }))
      return out
    }
    const holdsBlock = new Map<P5Node, boolean>()
    const spliceable = (node: P5Node): boolean => {
      const tag = domTag(node)
      if (!tag || BLOCK.has(tag) || ACTIVE.has(tag) || MEDIA_FALLBACK.has(tag)) return false
      if (INLINE_HANDLED.has(tag) || SEMANTIC_SPAN_TAGS.has(tag) || FLATTENED_BLOCK_EXTRA.has(tag)) return false
      return true
    }
    // Post-order over the unsupported elements only, so each is weighed once.
    const pending: Array<{ node: P5Node; expanded: boolean }> = nodes.filter(spliceable).map((node) => ({ node, expanded: false }))
    while (pending.length) {
      const top = pending[pending.length - 1]!
      if (holdsBlock.has(top.node)) {
        pending.pop()
        continue
      }
      const children = domChildren(top.node) ?? []
      if (!top.expanded) {
        top.expanded = true
        for (const child of children) if (spliceable(child) && !holdsBlock.has(child)) pending.push({ node: child, expanded: false })
        continue
      }
      pending.pop()
      holdsBlock.set(
        top.node,
        children.some((child) => {
          const tag = domTag(child)
          return tag !== undefined && (BLOCK.has(tag) || MEDIA_FALLBACK.has(tag) || holdsBlock.get(child) === true)
        }),
      )
    }
    const frames: Array<{ nodes: P5Node[]; parentPath: string; paths?: string[] | undefined; level: number; index: number }> = [
      { nodes, parentPath, paths, level: 0, index: 0 },
    ]
    while (frames.length) {
      const frame = frames[frames.length - 1]!
      if (frame.index >= frame.nodes.length) {
        frames.pop()
        continue
      }
      const index = frame.index++
      const node = frame.nodes[index]!
      const path = frame.paths?.[index] ?? this.childPath(frame.parentPath, node, index)
      if (holdsBlock.get(node) === true) {
        out.push({ node, path, level: frame.level + 1, splice: true })
        frames.push({ nodes: domChildren(node) ?? [], parentPath: path, level: frame.level + 1, index: 0 })
        continue
      }
      out.push({ node, path, level: frame.level, splice: false })
    }
    return out
  }

  /**
   * A media wrapper standing among blocks, unwrapped to its fallback
   * (markup-carve/carve#1749).
   */
  private mediaFallback(node: P5Node, tag: string, path: string, depth: number): BlockNode[] {
    const attrs = this.attrs(node, path)
    const unwrapped = this.reportUnsupportedElement(node, tag, path)
    this.reportUnwrappedAttributes(node, attrs, tag, path, unwrapped)

    return this.blocks(domChildren(node) ?? [], path, depth)
  }

  private firstHeadingWithin(root: P5Node): P5Node | undefined {
    const pending: Array<[P5Node, boolean]> = [[root, false]]
    while (pending.length > 0) {
      const [node, visited] = pending.pop()!
      if (this.firstHeadings.has(node)) continue
      if (/^h[1-6]$/.test(domTag(node) ?? '')) {
        this.firstHeadings.set(node, node)
      } else if (!visited) {
        pending.push([node, true])
        const children = domChildren(node) ?? []
        for (let index = children.length - 1; index >= 0; index--) {
          const child = children[index]!
          if (!this.firstHeadings.has(child)) pending.push([child, false])
        }
      } else {
        const child = (domChildren(node) ?? []).find(child => this.firstHeadings.get(child) != null)
        this.firstHeadings.set(node, child ? this.firstHeadings.get(child)! : null)
      }
    }
    return this.firstHeadings.get(root) ?? undefined
  }

  private block(node: P5Node, path: string, depth: number): BlockNode[] {
    this.enter(depth)
    const tag = domTag(node)!
    // Read by `readAbbreviationCarrier` before the walk and emitted at the top
    // of the document, so it is consumed rather than dropped as an active
    // element - the carrier is the serializer's protocol, not page content.
    if (tag === 'template' && this.hasCarrier(node, 'abbreviations')) {
      // CHARGED, THEN DROPPED. The carrier was read before the walk, so
      // without this its subtree is the one input that reaches a reconstructed
      // node without passing the caller's `maxNodes` and `maxDepth`.
      this.budget(node, depth)
      for (let count = this.footnotes.abbreviationDefs.size; count > 0; count -= 1) this.enter(depth)
      return []
    }
    if (ACTIVE.has(tag)) {
      this.report.add('element-dropped', `Dropped active <${tag}> element`, 'warning', path, node)
      return []
    }
    if (tag === 'section' && this.attr(node, 'id') !== undefined) {
      this.readIdCarriers(node, path, true)
    } else if (/^h[1-6]$/.test(tag) && this.attr(node, 'id') !== undefined) {
      this.readIdCarriers(node, path, false)
    }
    // Read in `table()`; recorded here so `attrs()` does not report it as dropped.
    if (tag === 'table' && this.carriedSeparatorWidths(node) !== undefined) this.recordCarrier(node, 'col-widths')
    // Tightness is read by presence, regardless of the value.
    if ((tag === 'ul' || tag === 'ol') && this.hasCarrier(node, 'tight')) {
      this.recordCarrier(node, 'tight')
    }
    // §13a presence carriers: a `line_block` is read from its carrier, never
    // from `class="line-block"` alone, which the admonition renders too.
    const carriedLineBlock = tag === 'div' && this.hasCarrier(node, 'line-block')
    if (carriedLineBlock) this.recordCarrier(node, 'line-block')
    const carriedDiv = tag === 'div' && !carriedLineBlock && this.hasCarrier(node, 'div')
    if (carriedDiv) this.recordCarrier(node, 'div')
    const carriedLabel = tag === 'pre' && domChildren(node)?.some(n => domTag(n) === 'code') ? this.carrierValue(node, 'label') : undefined
    const label = carriedLabel !== undefined && !/[\]\r\n]/.test(carriedLabel) ? carriedLabel : undefined
    if (label !== undefined) this.recordCarrier(node, 'label')
    if (tag === 'div' && (this.carrierValue(node, 'ext') === 'tabs' || this.carrierValue(node, 'ext') === 'code-group')) {
      const group = this.extensionGroup(node, path, depth)
      if (group) return [group]
    }
    const attrs = this.attrs(node, path)
    if (/^h[1-6]$/.test(tag)) {
      this.headingDepth++
      let raw: InlineNode[]
      try {
        raw = this.inlines(domChildren(node) ?? [], path, depth + 1)
      } finally {
        this.headingDepth--
      }
      const children = trimBlockEdges(raw)
      // Carve spells no empty heading; even without attributes, dropping it loses its level.
      if (children.length === 0) {
        this.report.add(
          'element-dropped',
          raw.length > 0
            ? `Dropped whitespace-only <${tag}> holding no content character`
            : `Dropped <${tag}> holding no content`,
          'warning',
          path,
          node,
        )
        return []
      }
      let held = attrs
      if (held?.id !== undefined) {
        if (this.carrierReads.get(node)?.names.has('generated-id')) {
          const { id: _dropped, ...rest } = held
          held = Object.keys(rest).length > 0 ? (rest as Attrs) : undefined
        } else if (this.writing || this.carrierReads.get(node)?.names.has('explicit-id')) {
          held.order = slotOrderFromElement(node, held)
        }
      }
      const heading: BlockNode = { type: 'heading', level: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6, children, ...(held ? { attrs: held } : {}) }
      this.headingOrigins.set(heading, node)
      return [heading]
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
      const raw = this.inlines(domChildren(node) ?? [], path, depth + 1)
      const children = trimBlockEdges(raw)
      if (children.length === 0 && raw.length > 0) {
        this.report.add(
          'element-dropped',
          `Dropped whitespace-only <${tag}> holding no content character`,
          'warning',
          path,
          node,
        )
        return []
      }
      // An empty paragraph has no spelling, and its attribute line alone would
      // attach to the next block, so it is dropped with one row covering them.
      if (children.length === 0 && attrs) {
        this.report.add('element-dropped', `Dropped <${tag}> holding no content`, 'warning', path, node)
        return []
      }
      // A bare one carries nothing, and the writer writes nothing for it.
      if (children.length === 0) return []
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
    if (tag === 'blockquote') return [{ type: 'block_quote', children: this.blocks(domChildren(node) ?? [], path, depth + 1), ...(attrs ? { attrs } : {}) }]
    if (tag === 'ul' || tag === 'ol') return this.list(node, path, depth, tag === 'ol', attrs)
    if (tag === 'dl') return this.definitionList(node, path, depth, attrs)
    if (tag === 'pre') {
      const code = domChildren(node)?.find((n) => domTag(n) === 'code')
      const lang = codeLanguage(node, code, this.codeLanguageWrappers)
      // Rendered code blocks conventionally carry one newline before </code>.
      // It TERMINATES the last payload line rather than adding one, so it comes
      // off - but a text of one newline is then one BLANK line and not none, and
      // dropping it unconditionally lost a line on every all-blank payload,
      // including this engine's own HTML (carve-js#2342, raised by codex review).
      const content = this.codeText(node, path, depth, true, code, lang)
      return [{ type: 'code_block', content, ...(lang ? { lang } : {}), ...(label !== undefined ? { label } : {}), ...(attrs ? { attrs } : {}) }]
    }
    // The synthetic element `pruneFootnoteContainers` leaves where an endnotes
    // section sat that was NOT last; never present in real HTML input. It reads
    // back as the `::: footnotes` placement directive, which is what puts the
    // rebuilt section back in that slot instead of at document end.
    if (tag === 'carve-footnote-placement') return [{ type: 'directive', kind: 'footnotes', children: [] }]
    if (tag === 'hr') {
      // §13a `data-char`: the break character the author wrote. Every `<hr>` is
      // otherwise the same bytes, so HTML has nowhere else to put it.
      const marker = this.readsChar(node)
      return [{ type: 'thematic_break', ...(marker !== undefined ? { marker } : {}), ...(attrs ? { attrs } : {}) }]
    }
    if (tag === 'table') {
      const unspellableBefore = this.unspellable.length
      const table = this.tables.run(node, path, depth, attrs)
      if (this.writing && table.type === 'table' && table.rows.length === 0) {
        this.unspellable.length = unspellableBefore
        return []
      }
      return [table]
    }
    if (tag === 'figure') return this.figure(node, path, depth, attrs)
    if (tag === 'details') return [this.disclosure(node, path, depth, attrs)]
    if (carriedLineBlock) {
      const classes = (attrs?.classes ?? []).filter((name) => name !== 'line-block')
      const kept: Attrs = { ...attrs }
      delete kept.classes
      if (classes.length) kept.classes = classes
      const own = kept.id || kept.classes || kept.keyValues ? kept : undefined
      return [{ type: 'line_block', children: this.blocks(domChildren(node) ?? [], path, depth + 1), ...(own ? { attrs: own } : {}) }]
    }
    if (tag === 'div' && !carriedDiv) {
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
      const container = carriedDiv ? undefined : this.containerFrom(tag, attrs)
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
        const children0 = domChildren(node) ?? []
        // A directive has NO title slot (CARVE-P12-057 closes the node without
        // one), so nothing is lifted out of a generated-content container: a
        // `<p class="admonition-title">` inside one stays the ordinary paragraph
        // it reads as, rather than being lifted into a field that does not exist
        // and dropped on the way.
        const generated = GENERATED_CONTENT_KINDS.has(container.kind)
        const titleAt = generated ? -1 : children0.findIndex((child) => this.isAdmonitionTitle(child))
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
            this.report.add(
              'attribute-dropped',
              `Dropped ${this.attrNames(leftover).join(', ')} on <p>: an admonition title has no attribute slot`,
              'warning',
              titlePath,
              titleNode,
            )
          }
          title = this.blockInlines(domChildren(titleNode) ?? [], titlePath, depth + 3)
        }
        // THE GROUPING LABEL IS THE CONTAINER'S TOO, and it sits after the
        // title the renderer wrote, so it is lifted off what the title lift
        // left behind (markup-carve/carve-js#1413).
        const lifted = this.containerLabel(body, bodyPaths, depth)
        const containerChildren = this.blocks(
          lifted?.body ?? body,
          path,
          depth + 1,
          lifted?.bodyPaths ?? bodyPaths,
        )
        if (generated) {
          return [
            {
              type: 'directive',
              kind: container.kind,
              ...(lifted ? { label: lifted.label } : {}),
              children: containerChildren,
              ...(container.attrs ? { attrs: container.attrs } : {}),
            },
          ]
        }
        return [
          {
            type: 'admonition',
            kind: container.kind,
            ...(title ? { title } : {}),
            ...(lifted ? { label: lifted.label } : {}),
            children: containerChildren,
            ...(container.attrs ? { attrs: container.attrs } : {}),
          },
        ]
      }
      // The ELEMENT row is the one a derived wrapper does not earn. What it
      // still CARRIED is reported below, as it always was: `attrs` there is
      // what survived `dropDerived`, so an author's `class` on the section, or
      // an `aria-label` the default does not match, still goes out with a row.
      // Suppressing both together silenced two real losses.
      //
      // WHICH ROW IT EARNS FOLLOWS THE CONTENT, like every other unsupported
      // element (markup-carve/carve#1738): an empty `<section>` had nothing an
      // unwrap could preserve. The two exemptions come FIRST and read as
      // unwrapped, because neither writes an element row at all and the
      // attribute rows below them keep the sentence they already had.
      const unwrapped =
        tag === 'div' || this.isDerivedWrapper(node, tag) || this.reportUnsupportedElement(node, tag, path)
      // THE LABEL IS LIFTED FIRST, because it is half of the test below. This
      // arm never had a lift at all - it lived only on the container-CLASS arm
      // above, so `::: figure [g]` reached it and a plain `<div>` never did.
      const own = domChildren(node) ?? []
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
      // THE BODY IS BUILT BEFORE THE ATTRIBUTE ROWS so the wrapper's id has a
      // heading to land on. Whether that id is the renderer's or the author's
      // is a question about the HEADING's own text, and only the imported node
      // carries the inline projection that answers it.
      //
      // This does not reorder the report. Rows sort by the position of the
      // LOSING ELEMENT, and a wrapper stands before everything it wraps, so
      // moving one call across another only changes the order rows were
      // CONSTRUCTED in - which the sort keeps only as a tie-break between rows
      // at the same position, and the wrapper's own two rows keep their
      // relative order because `element-unwrapped` is still added first.
      let hoistedChildren = children
      if (tag === 'section') {
        const firstHeading = this.attr(node, 'id') === undefined ? undefined : this.firstHeadingWithin(node)
        const heading = children[0]
        const mapped = heading?.type === 'heading' && firstHeading !== undefined &&
          this.headingOrigins.get(heading) === firstHeading && heading.attrs?.id === undefined
        if (!mapped) hoistedChildren = []
        // No heading took the id, so nothing was rebuilt from the wrapper's carriers.
        for (const read of ['explicit-id', 'id-slot', 'generated-id'] as const) {
          if (mapped || !this.carrierReads.get(node)?.names.delete(read)) continue
          const name = this.carrierName(node, read)!
          this.report.refuseAttribute(node, path, `round-trip marker attribute ${name}`, '', 'info', destinationIsDenied(this.attr(node, name) ?? ''))
        }
      }
      const sectionReads = this.carrierReads.get(node)?.names
      const headingElement = tag === 'section' ? this.firstHeadingWithin(node) : undefined
      const heading = hoistedChildren[0]
      if (sectionReads?.has('id-slot') && heading?.type === 'heading' && headingElement) {
        const slots = slotOrderFromElement(headingElement, heading.attrs ?? {}).filter((slot) => slot !== '#id')
        if (Number(this.carrierValue(node, 'id-slot')) > slots.length) {
          sectionReads.delete('id-slot')
          this.report.refuseAttribute(node, path, `round-trip marker attribute ${this.carrierName(node, 'id-slot')!}`, '', 'info', false)
        }
      }
      if (tag !== 'div') {
        this.reportUnwrappedAttributes(
          node,
          restoreHoistedSectionId(
            tag,
            attrs,
            hoistedChildren,
            sectionReads?.has('explicit-id') === true,
            sectionReads?.has('generated-id') === true,
            this.writing,
            sectionReads?.has('id-slot') ? Number(this.carrierValue(node, 'id-slot')) : 0,
            (held) => (headingElement ? slotOrderFromElement(headingElement, held) : []),
          ),
          tag,
          path,
          unwrapped,
        )
      }
      /*
       * A DIV CARRYING NOTHING ONLY A CONTAINER CAN HOLD IS NOT A CONTAINER
       * WORTH SPELLING, so it unwraps to its content and the `:::` fence is not
       * written (markup-carve/carve#1578). A bare `<div>` carries no meaning of
       * its own: the fence buys the reader nothing and costs two lines of markup
       * nobody asked for.
       */
      if (tag !== 'div' || (!attrs && !lifted && !carriedDiv)) return children
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
      this.keepRaw(node, path, `Preserved unsupported <${tag}> element as raw HTML`)
      return [{ type: 'raw_block', format: 'html', content: serializeOuter(node) }]
    }
    const unwrapped = this.reportUnsupportedElement(node, tag, path)
    this.reportUnwrappedAttributes(node, attrs, tag, path, unwrapped)
    return this.blocks(domChildren(node) ?? [], path, depth + 1)
  }

  /**
   * A NON-`li` CHILD IS NOT DISCARDED, and not discarded in silence either
   * (carve-js#1340). Filtering the children down to `<li>` and walking only
   * those took the WHOLE of anything else the list carried:
   * `<ul><div id="stray">z</div><li>a</li></ul>` came back as one item and an
   * EMPTY report. Stray children therefore take the ordinary block walk ahead
   * of the list, preserving their content and diagnostics.
   */
  private list(node: P5Node, path: string, depth: number, ordered: boolean, attrs?: Attrs): BlockNode[] {
    const listItems: P5Node[] = []
    const stray: P5Node[] = []
    const strayPaths: string[] = []
    ;(domChildren(node) ?? []).forEach((child, index) => {
      if (domTag(child) === 'li') {
        listItems.push(child)
        return
      }
      const childPath = this.childPath(path, child, index)
      const strayTag = domTag(child)
      if (strayTag !== undefined) {
        if (!ACTIVE.has(strayTag)) {
          this.report.add(
            'element-unwrapped',
            `A <${strayTag}> inside <${ordered ? 'ol' : 'ul'}> kept its content but not its place among the items: it is emitted as blocks ahead of the list`,
            'warning',
            childPath,
            child,
          )
        }
      } else if (child.nodeName === '#comment') {
        /*
         * A COMMENT BETWEEN TWO ITEMS MOVES, and now that it is KEPT the move
         * has to be said (markup-carve/carve#1709). It used to be dropped, so
         * there was nothing to declare and the row was suppressed here.
         *
         * `info`, where the text row beside it is `warning`, and the split is
         * principled rather than a dial: moved TEXT changes the rendered
         * document, and a comment renders nothing in either language, so the
         * move costs a reader of the OUTPUT nothing and a reader of the SOURCE
         * one position. It is emitted ahead of the list rather than refused
         * because that is what every other stray child of a list does here; a
         * comment being the one exception would make the list's own rule say
         * two things.
         */
        this.report.add(
          'element-unwrapped',
          `An HTML comment directly inside <${ordered ? 'ol' : 'ul'}> kept its text but not its place among the items: it is emitted as a comment ahead of the list`,
          'info',
          childPath,
          child,
        )
      } else if ((domValue(child) ?? '').trim() !== '') {
        this.report.add(
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
    // No item, no list: an empty list has no spelling, and its attributes would
    // be an attribute line with no block under it (carve#2367).
    if (listItems.length === 0) {
      this.report.add('element-dropped', `Dropped <${ordered ? 'ol' : 'ul'}> holding no item`, 'warning', path, node)
      return before
    }
    const items = listItems.map((li, i) => {
      const liPath = `${path}/li[${i + 1}]`
      const input = this.taskCheckbox(li)
      const liAttrs = this.attrs(li, liPath)
      // The state the renderer wrote (PART 10 §11), which is the only place an
      // extended state survives: all five unchecked spellings render the same
      // box, so without this `[-]` comes back as `[ ]` and nothing can see the
      // difference. It is READ rather than dropped as derived - the same
      // treatment the checkbox `<input>` already gets.
      const checked = input ? this.attr(input, 'checked') !== undefined : undefined
      // `x` is the done state the ticked box already gives, so the AST records
      // nothing for it (PART 12).
      const readState = this.readsTaskState(li) ? this.attr(li, 'data-task-state') : undefined
      const taskState = readState === 'x' ? undefined : (readState as ListItem['taskState'])
      // UNSPELLABLE BEHIND AN ORDERED MARKER. `task_marker` in
      // `resources/spec/03-blocks-core.ebnf` hangs off `unordered_item` alone,
      // so no Carve source carries a box on an ordered item and the writer
      // dropped both the box and the characters it was read from
      // (carve-js#2053). The bracket pair is kept as text where the `<input>`
      // stood and the row says what could not be spelled. The AST holds the box
      // either way, so this runs on the writing exit alone (PART 12 §16).
      //
      // The message is the contract's, shared with the Markdown entry point:
      // one loss with one cause reads the same from either direction, and the
      // grammar clause behind it stays in the contract's prose rather than in
      // the row (carve-js#2062).
      const orderedTask = ordered && input !== undefined && this.writing
      if (orderedTask) {
        this.report.add(
          'structure-unspellable',
          ORDERED_TASK_ITEM_UNSPELLABLE,
          'warning',
          this.childPath(liPath, input, (domChildren(li) ?? []).findIndex(child => child === input)),
          input,
        )
      }
      const content = (domChildren(li) ?? []).flatMap((child) => {
        if (child !== input) return [child]
        // PART 11 §6g's default, and the `data-task-state` character where the
        // renderer wrote one: the bracket pair the writer would have spelled
        // behind a bullet. It stands where the `<input>` stood rather than at
        // the head of the item, so `before <input> after` keeps its order.
        return orderedTask
          ? [{ nodeName: '#text', value: `[${taskState ?? (checked ? 'x' : ' ')}]`, parentNode: domContainer(li) } satisfies P5Node]
          : []
      })
      return {
        type: 'list_item' as const,
        ...(checked !== undefined && !orderedTask ? { checked } : {}),
        ...(taskState !== undefined && !orderedTask ? { taskState } : {}),
        children: this.blocks(content, liPath, depth + 1),
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
    // Seen through the unsupported wrappers `blocks()` splices away.
    // §13a `data-carve-tight` wins over what the items' `<p>` elements imply.
    const tight = this.carrierReads.get(node)?.names.has('tight')
      ? true
      : !listItems.some((li) =>
        this.spliceUnsupported(domChildren(li) ?? [], path).some((entry) => !entry.splice && domTag(entry.node) === 'p'),
      )
    const start = this.listStart(node, path, ordered)
    // The delimiter the renderer wrote (PART 10 §12), which is the only place
    // it survives: `1)` and `1.` rendered the same bytes before that clause.
    const delim = ordered && (this.readsDelim(node) || this.readsMarker(node) === ')') ? (')' as const) : undefined
    // §13a `data-marker`: the bullet the author wrote. An ordered list's marker
    // IS its delimiter, which `delim` above already reads, so only the bullet
    // adds a field here.
    const bulletChar = !ordered && this.readsMarker(node) === '*' ? ('*' as const) : undefined
    // The task list's base class (PART 19 §1) is structural, not authored: it is
    // read only where an item carries the box that makes the list a task list.
    if (!ordered && listItems.every((li) => this.taskCheckbox(li) !== undefined)) attrs = this.stripClass(attrs, TASK_LIST_CLASS)
    const list: List = { type: 'list', ordered, tight, items, ...(start !== undefined && start !== 1 ? { start } : {}), ...this.olType(node, path, ordered, items.length, start ?? 1), ...(delim !== undefined ? { delim } : {}), ...(bulletChar !== undefined ? { bulletChar } : {}), ...(attrs ? { attrs } : {}) }
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
   * TWO shapes are valid HTML that Carve SOURCE cannot spell, so they are built
   * into the AST and reported by whoever writes (§16): a `<dd>` with no `<dt>`
   * before it, and an EMPTY `<dt>`. Each one writes a line the parser reads as
   * something else, and the tests assert what it reads as rather than only that
   * a diagnostic appeared.
   *
   * An empty `<dd>` is not one of them: the writer spells it `: {empty}`, so
   * the entry survives and no row is owed for it.
   *
   * `block()` has already counted this node against `maxNodes`, so this walk
   * counts only the elements it visits itself.
   */
  private definitionList(node: P5Node, path: string, depth: number, attrs?: Attrs): BlockNode[] {
    const items: DefinitionItem[] = []
    const before: BlockNode[] = []
    const trailing: P5Node[] = []
    const trailingPaths: string[] = []
    // Every entry is written, so a `<dl>` imports and writes back as ONE list:
    // no term acquires the next entry's description and nothing splits.
    let current: DefinitionItem | undefined
    const openEntry = (): DefinitionItem => {
      const entry: DefinitionItem = { terms: [], definitions: [] }
      items.push(entry)
      return entry
    }
    const visit = (children: P5Node[], parentPath: string, level: number): void => {
      children.forEach((child, index) => {
        const childPath = this.childPath(parentPath, child, index)
        if (child.nodeName === '#text' && !(domValue(child) ?? '').trim()) return
        if (domTag(child) === 'div') {
          this.enter(level)
          this.entryAttributes(child, childPath, 'div')
          // The wrapper IS the group boundary (HTML 5.2), so an entry never
          // spans two of them: without the reset a `<dd>` opening the second
          // wrapper attached to the first wrapper's term, which both merges two
          // groups and suppresses the no-term diagnostic it is owed.
          current = undefined
          visit(domChildren(child) ?? [], childPath, level + 1)
          current = undefined
          return
        }
        if (domTag(child) === 'dt') {
          this.enter(level)
          // A term after a definition starts the next entry; a term after a
          // term joins the one being opened.
          if (current === undefined || current.definitions.length > 0) current = openEntry()
          this.entryAttributes(child, childPath, 'dt')
          const term = this.blockInlines(domChildren(child) ?? [], childPath, level + 1)
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
        if (domTag(child) === 'dd') {
          this.enter(level)
          // A description before the list's first term: its content is written
          // as blocks ahead of the list, in both exits, because `: text` with
          // no term re-reads as a paragraph (carve#2384).
          if (current === undefined && items.length === 0) {
            this.report.add(
              'element-unwrapped',
              'A <dd> with no <dt> before it kept its content but not its role: it is emitted as blocks ahead of the definition list',
              'warning',
              childPath,
              child,
            )
            this.entryAttributes(child, childPath, 'dd')
            before.push(...this.blocks(domChildren(child) ?? [], childPath, level + 1))
            return
          }
          // A description with no term in a later group: kept in the AST, where
          // it is a description of nothing, and reported when a WRITER has to
          // spell it.
          if (current === undefined) {
            current = openEntry()
            this.unspellable.push({
              node: child,
              path: childPath,
              message: 'A <dd> with no <dt> before it has no Carve spelling; the definition line re-reads as a paragraph',
            })
          }
          this.entryAttributes(child, childPath, 'dd')
          const definition = this.blocks(domChildren(child) ?? [], childPath, level + 1)
          // A `<dd>` that writes nothing takes the `{empty}` sentinel, which
          // reads back as a description holding no blocks, so the entry
          // survives the round trip and owes no row (markup-carve/carve#1827).
          current.definitions.push(definition)
          return
        }
        this.report.add('element-unwrapped', `Moved <${domTag(child) ?? child.nodeName}> content out of the <dl>: only <dt> and <dd> have a place in a definition list`, 'warning', childPath, child)
        trailing.push(child)
        trailingPaths.push(childPath)
      })
    }
    visit(domChildren(node) ?? [], path, depth + 1)
    const list: BlockNode = { type: 'definition_list', items, ...(attrs ? { attrs } : {}) }
    if (!items.length && attrs) {
      for (const name of this.attrNames(attrs)) {
        this.report.add('attribute-dropped', `Dropped ${name} on <dl>: a definition list holding no entry is not written`, 'warning', path, node)
      }
    }
    // A leading `<dd>` can end in a definition list, which this list would
    // join on the reparse, so it joins here the way a sibling `<dl>` does.
    const lead = before.at(-1)
    if (items.length && !attrs && lead?.type === 'definition_list') {
      lead.items.push(...items)
      this.report.add('element-unwrapped', 'Merged <dl> into the definition list before it: Carve source has no boundary between two adjacent definition lists', 'info', path, node)
      return [...before, ...this.blocks(trailing, path, depth + 1, trailingPaths)]
    }
    return [...before, ...(items.length ? [list] : []), ...this.blocks(trailing, path, depth + 1, trailingPaths)]
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
    this.report.add('attribute-dropped', `Dropped ${this.attrNames(attrs).join(', ')} on <${tag}>: ${slot} has no attribute slot`, 'warning', path, node)
  }

  private extensionGroup(node: P5Node, path: string, depth: number): Admonition | undefined {
    const kind = this.carrierValue(node, 'ext')
    if (kind !== 'tabs' && kind !== 'code-group') return undefined
    const elements = (domChildren(node) ?? []).filter(child => domTag(child) !== undefined)
    const staticPanels = domTag(elements[0]!) === 'section'
    const aria = domTag(elements[0]!) === 'button'
    const controls: P5Node[] = []
    let index = 0
    if (staticPanels) {
      if (elements.some(element => domTag(element) !== 'section')) return undefined
      controls.push(...elements)
    } else {
      while (index < elements.length && domTag(elements[index]!) === (aria ? 'button' : 'input')) {
        controls.push(elements[index++]!)
        if (!aria && domTag(elements[index++]!) !== 'label') return undefined
      }
    }
    if (controls.length === 0 || (!staticPanels && elements.length - index !== controls.length)) return undefined
    const panels = staticPanels ? elements : elements.slice(index)
    if (panels.some(panel => domTag(panel) !== (staticPanels ? 'section' : 'div'))) return undefined
    const selected = controls.map(control => staticPanels ? this.hasCarrier(control, 'selected') : aria ? this.attr(control, 'aria-selected') === 'true' : this.attr(control, 'checked') !== undefined)
    if (selected.filter(Boolean).length !== 1) return undefined
    const children: BlockNode[] = []
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i]!
      if (staticPanels) this.recordCarrier(panel, 'selected')
      if (kind === 'tabs' && this.hasCarrier(panel, 'explicit-id')) this.recordCarrier(panel, 'explicit-id')
      const carried = kind === 'tabs' ? this.carrierValue(panel, 'label') : undefined
      if (carried !== undefined && !/[\r\n]/.test(carried)) this.recordCarrier(panel, 'label')
      const panelPath = this.childPath(path, panel, index + i)
      const panelAttrs = this.attrs(panel, panelPath)
      const structural = kind === 'tabs' ? 'tabs-panel' : 'code-group-panel'
      if (panelAttrs?.classes) panelAttrs.classes = panelAttrs.classes.filter(name => name !== structural)
      if (panelAttrs?.classes?.length === 0) delete panelAttrs.classes
      if (panelAttrs?.keyValues) {
        delete panelAttrs.keyValues.role
        delete panelAttrs.keyValues['aria-label']
        delete panelAttrs.keyValues['aria-labelledby']
      }
      if (this.attr(panel, 'hidden') !== undefined) {
        if (panelAttrs?.keyValues) delete panelAttrs.keyValues.hidden
      }
      if (this.attr(panel, 'id') !== undefined && !this.hasCarrier(panel, 'explicit-id')) {
        if (panelAttrs) delete panelAttrs.id
      }
      let child: BlockNode
      if (kind === 'tabs') {
        const body = [...(domChildren(panel) ?? [])]
        if (staticPanels) {
          const labelIndex = body.findIndex(entry => domTag(entry) !== undefined)
          const label = body[labelIndex]
          if (label && domTag(label) === 'h3') body.splice(labelIndex, 1)
        }
        child = { type: 'admonition', kind: 'tab', children: this.blocks(body, panelPath, depth + 1),
          ...(carried !== undefined && !/[\r\n]/.test(carried) ? { label: carried } : {}) }
      } else {
        const pre = (domChildren(panel) ?? []).find(entry => domTag(entry) === 'pre')
        if (!pre) return undefined
        const code = this.block(pre, this.childPath(panelPath, pre, 0), depth + 1)[0]
        if (!code || code.type !== 'code_block') return undefined
        child = code
      }
      if (kind === 'tabs' && panelAttrs && (panelAttrs.id || panelAttrs.classes?.length || Object.keys(panelAttrs.keyValues ?? {}).length)) child.attrs = panelAttrs
      if (selected[i] && i > 0) {
        const chosen = child.attrs ??= {}
        chosen.keyValues = { ...(chosen.keyValues ?? {}), selected: '' }
      }
      children.push(child)
    }
    this.recordCarrier(node, 'ext')
    const attrs = this.attrs(node, path)
    const wrapper = attrs ? { ...attrs } : undefined
    if (wrapper?.classes) {
      wrapper.classes = wrapper.classes.filter(name => name !== kind)
      if (wrapper.classes.length === 0) delete wrapper.classes
    }
    if (wrapper?.keyValues) {
      delete wrapper.keyValues.role
      delete wrapper.keyValues['aria-label']
    }
    return { type: 'admonition', kind, children, ...(wrapper && (wrapper.id || wrapper.classes?.length || Object.keys(wrapper.keyValues ?? {}).length) ? { attrs: wrapper } : {}) }
  }

  /**
   * The container an `<aside>` or `<div>` was RENDERED FROM, rebuilt.
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
    // spell (`-2col`, `my.class`) would be written after the colons and read
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
   */
  private captionInlines(node: P5Node, path: string, depth: number, tag: 'figcaption' | 'caption'): InlineNode[] {
    this.entryAttributes(node, path, tag, 'a caption line')
    return trimBlockEdges(this.inlines(domChildren(node) ?? [], path, depth))
  }

  private attrNames(attrs: Attrs): string[] {
    return [
      ...(attrs.id ? ['id'] : []),
      ...(attrs.classes ? ['class'] : []),
      ...Object.keys(attrs.keyValues ?? {}),
    ]
  }

  /** Whether a non-final generated endnotes section has already left a placement marker. */

  /** Whether the renderer derives this wrapper rather than the author writing it. */
  private isDerivedWrapper(node: P5Node, tag: string): boolean {
    return tag === 'section' && this.attr(node, 'role') === 'doc-endnotes'
  }

  /**
   * Whether an element brought anything for an unwrap to leave behind.
   *
   * `element-unwrapped` makes a claim about CONTENT: the wrapper went and what
   * it held stayed. An element that held nothing cannot have been unwrapped -
   * there was nothing to put in its place - and calling it unwrapped states
   * something about content that did not happen. `element-dropped` says the
   * element and its content both went, which for an empty one is exactly true,
   * and the severity follows: an unwrap preserves text and is `info`, a drop
   * does not and is `warning` (markup-carve/carve#1738).
   *
   * ASKED OF THE INPUT, NOT OF THE OUTPUT. Whether an element had children is a
   * property of the document handed in, the same framing
   * markup-carve/carve#1723 used, and it is decidable without correlating the
   * emitted source back to the node it came from. Reading it off the built
   * children instead would answer differently for an `<audio><span></span>`,
   * whose child element is right there in the input and contributes nothing to
   * the output - and that is a loss belonging to the `<span>`, which reports
   * its own row.
   *
   * NOT A LIST OF TAG NAMES. The four elements markup-carve/carve#1738 names
   * agree with carve-php whenever they have children and diverge only when they
   * do not, so the condition is content and a name list would be back next
   * sweep (markup-carve/carve#1704).
   *
   * WHITESPACE IS NOT CONTENT and an ACTIVE element is not either: neither
   * survives an unwrap, so neither can be what an unwrap preserved. This is
   * carve-php's `hasImportContentToUnwrap()` predicate, deliberately, because
   * the point of the ruling is that the two engines answer alike.
   *
   * AND WHITESPACE IS PART 11 §7's WHITESPACE, which is what the row now has to
   * follow: the unwrap keeps a NO-BREAK SPACE, so a `<progress>` holding one is
   * unwrapped rather than dropped, and `String.prototype.trim` said the
   * opposite (markup-carve/carve-js#1493). carve-php reports
   * `element-unwrapped` for that input, which is the answer this predicate
   * exists to match.
   */
  private hasContentToUnwrap(node: P5Node): boolean {
    for (const child of domChildren(node) ?? []) {
      const childTag = domTag(child)
      if (childTag !== undefined) {
        if (!ACTIVE.has(childTag)) return true
        continue
      }
      if (trimNonNbsp(domValue(child) ?? domData(child) ?? '') !== '') return true
    }
    return false
  }

  /**
   * The row for an element this importer has no mapping for, unwrapped or
   * dropped by what it carried (markup-carve/carve#1738).
   *
   * EVERY ARM THAT WRITES THE GENERAL ROW, which is what keeps the three
   * engines answering alike. The row is written from three places - a
   * sectioning wrapper, the four unmapped block tags `address`, `fieldset`,
   * `form` and `hgroup`, and the inline arm that catches everything else - and
   * the same tag reaches a different one of them in each engine, so a rule
   * applied to one arm would have fixed thirty-two shapes and broken seven.
   *
   * A `<figure>` is NOT one of them. It has its own rows and its own rulings
   * (markup-carve/carve#1716, markup-carve/carve#1723), and reaches none of
   * these three arms.
   */
  private reportUnsupportedElement(node: P5Node, tag: string, path: string): boolean {
    if (this.hasContentToUnwrap(node)) {
      this.report.add('element-unwrapped', `Unwrapped unsupported <${tag}> element`, 'info', path, node)

      return true
    }
    this.report.add('element-dropped', `Dropped empty <${tag}> element`, 'warning', path, node)

    return false
  }

  /** One `info` row per attribute lost with an unwrapped or dropped element (carve-php#1731). */
  private reportUnwrappedAttributes(node: P5Node, attrs: Attrs | undefined, tag: string, path: string, unwrapped = true): void {
    if (attrs === undefined) return
    for (const name of this.attrNames(attrs)) {
      const what = unwrapped ? `the unwrapped <${tag}>` : `the dropped empty <${tag}>`
      this.report.add('attribute-dropped', `Dropped ${name} with ${what}: there is no element left to carry it`, 'info', path, node)
    }
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
    this.report.add('attribute-dropped', `Dropped start="${raw}" on <ol>: not an integer HTML defines, so the list starts where it would without it`, 'warning', path, node)
    return 1
  }

  private olType(node: P5Node, path: string, ordered: boolean, items: number, start: number): Record<string, never> | { olType: NonNullable<List['olType']> } {
    const value = ordered ? this.attr(node, 'type') : undefined
    if (value === undefined || value === '1') return {}
    if (value !== 'a' && value !== 'A' && value !== 'i' && value !== 'I') {
      this.report.add('attribute-dropped', `Dropped type="${value}" on <ol>: an ordered list counts in 1, a, A, i or I`, 'warning', path, node)
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
      this.report.add('attribute-dropped', `Dropped type="${value}" on <ol> with start="${start}": an alphabet has no letter before the first`, 'warning', path, node)
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
      this.report.add('attribute-dropped', `Dropped type="${value}" on <ol> reaching ${last}: roman notation has no numeral above 3999`, 'warning', path, node)
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
    const children0 = domChildren(node) ?? []
    const summaryIndex = children0.findIndex((n) => domTag(n) === 'summary')
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
      title = this.blockInlines(domChildren(summary) ?? [], summaryPath, depth + 2)
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
      this.report.add(
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

  private preserveLabelTabs = false

  /**
   * A container label's source, written from the inline content of the
   * `<p class="div-label">` the renderer degraded it to, or `undefined` when the
   * writer has no spelling for it.
   *
   * A THROWAWAY WALK, rewound in full. It is a measurement whose only result is a
   * string: the real budget is charged once by the `chargeSubtree` call the lift
   * already makes, and every diagnostic the walk files would be filed a second
   * time by the body walk when the lift is refused - two identical `raw-preserved`
   * rows for one element, and the report's cap spent twice (raised by codex
   * review). `mark` and `restore` are the same pair the figure arm rewinds with.
   */
  private containerLabelSource(kids: P5Node[], labelPath: string, depth: number): string | undefined {
    const rewind = this.mark()
    const nodes = this.nodes
    const preserveTabs = this.preserveLabelTabs
    this.preserveLabelTabs = true
    try {
      const inlines = this.blockInlines(kids, labelPath, depth + 2)
      // Flanking text keeps label-edge tabs inside the writer's paragraph.
      const children: InlineNode[] = [{ type: 'text', value: 'x ' }, ...inlines, { type: 'text', value: ' x' }]
      const written = renderCarve({ type: 'document', children: [{ type: 'paragraph', children }] })
      return written.startsWith('x ') && written.endsWith(' x\n') ? written.slice(2, -3) : undefined
    } catch (error) {
      // NO SPELLING IS A REFUSAL, NOT A CRASH. An empty `<code>` has no Carve
      // source while its open run does not end, and the writer says so; the
      // paragraph then stays in the body, where the ordinary walk reports the
      // loss exactly as it did before the label was a run.
      if (error instanceof SourceUnspellableError) return undefined
      throw error
    } finally {
      this.preserveLabelTabs = preserveTabs
      this.nodes = nodes
      this.restore(rewind)
    }
  }

  /**
   * Whether the opener `::: [label]` reads that label back.
   *
   * The two characters an opener cannot carry are refused by name above, because
   * each has its own reason. Everything else is asked of the PARSER, for the
   * reason `spellableTitle` gives: enumerating the spellings that break an opener
   * is a second copy of the grammar and goes stale. An empty code span writes two
   * backticks, which turn the opener into a paragraph.
   */
  private labelReadsBack(label: string): boolean {
    const first = parse(`::: [${label}]\nx\n:::\n`).children[0]

    return first?.type === 'div' && first.label === label
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
   * The captionable host a `<figure>` body offers, with a SYNTHESIZED paragraph
   * wrapper taken off an image (PART 9 §4b; markup-carve/carve#1606).
   */
  private captionHost(target: BlockNode | undefined): BlockNode | undefined {
    if (!target || target.type !== 'paragraph') return target
    const children = (target as Paragraph).children
    if ((target as Paragraph).attrs || children.length !== 1) return target
    const only = children[0]!
    return only.type === 'image' ? (only as unknown as BlockNode) : target
  }

  /**
   * The figure attributes its TARGET's own attribute line displaces (§16,
   * ruling markup-carve/carve#1721).
   */
  private recordDisplacedFigureAttrs(node: P5Node, path: string, own: Attrs | undefined, target: BlockNode): void {
    if (!own || target.type === 'image') return
    const theirs = (target as { attrs?: Attrs }).attrs
    if (!theirs) return
    const displaced = [
      ...(own.id !== undefined && theirs.id !== undefined ? ['id'] : []),
      ...Object.keys(own.keyValues ?? {}).filter((key) => theirs.keyValues?.[key] !== undefined),
    ]
    for (const name of displaced) this.displacedFigureAttrs.push({ node, path, name })
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
    const children = domChildren(node) ?? []
    const captionAt = children.findIndex((n) => domTag(n) === 'figcaption')
    const captionNode = captionAt < 0 ? undefined : children[captionAt]
    const captionPath = `${path}/figcaption[${captionAt + 1}]`
    // Split at the caption, so an unwrapped figure can put it back where it was.
    const halves: { body: P5Node[]; paths: string[] }[] = [{ body: [], paths: [] }, { body: [], paths: [] }]
    children.forEach((child, index) => {
      if (child === captionNode) return
      const half = halves[captionAt >= 0 && index > captionAt ? 1 : 0]!
      half.body.push(child)
      half.paths.push(this.childPath(path, child, index))
    })
    const before = this.mark()
    const ahead = this.blocks(halves[0]!.body, path, depth + 1, halves[0]!.paths)
    const targets = [...ahead, ...this.blocks(halves[1]!.body, path, depth + 1, halves[1]!.paths)]
    // One caption line captions one block: a second body block would have to
    // move past the caption, so such a figure is not rebuilt (as in carve-rs).
    const target = targets.length === 1 ? this.captionHost(targets[0]) : undefined
    const captionable = target !== undefined && FIGURE_REBUILDS.has(target.type)
    const caption = captionNode ? this.captionInlines(captionNode, captionPath, depth + 1, 'figcaption') : []
    /*
     * TWO CAPTIONS AND ONE SLOT (ruling markup-carve/carve-js#1488).
     */
    const doubleCaption =
      captionable &&
      target !== undefined &&
      target.type === 'table' &&
      this.captionSpellsSomething((target as { caption?: InlineNode[] }).caption ?? []) &&
      captionNode !== undefined &&
      this.captionSpellsSomething(caption)
    /*
     * `roundtrip` PRESERVES THE ELEMENT WHEN NO CARVE SPELLING REPRODUCES IT
     * (markup-carve/carve#1704). It is the only mode that CAN preserve; which
     * targets rebuild at all is `FIGURE_REBUILDS`, above, and it answers for
     * every mode.
     */
    if (this.mode === 'roundtrip' && this.captionSpellsSomething(caption) && (!captionable || doubleCaption)) {
      this.restore(before)
      this.keepRaw(node, path, 'Preserved a <figure> as raw HTML: no Carve spelling reproduces a figure around this target')
      return [{ type: 'raw_block', format: 'html', content: serializeOuter(node) }]
    }
    if (captionable) {
      /*
       * A FIGURE WITH NO CAPTION IS NOT A FIGURE (PART 9 §4b: the node is the
       * GENERIC CAPTIONED WRAPPER, and Carve builds one only from a `^ ` line on
       * a captionable host). A `<figure>` carrying no `<figcaption>`, or one
       * whose caption contributes nothing, therefore has nothing to build a
       * figure from; building one would add structure that cannot round-trip
       * (markup-carve/carve-js#1423).
       */
      if (!this.captionSpellsSomething(caption)) {
        this.report.add('element-unwrapped', FIGURE_UNWRAPPED, 'info', path, node)
        this.reportUnwrappedAttributes(node, attrs, 'figure', path)
        return targets
      }
      /*
       * AN EMPTY `<caption>` FILLS NO SLOT, so the figure's caption takes it and
       * the table's own is removed rather than carried. Left in place it reached
       * the writer as a caption line spelling nothing, which is a bare `^` and
       * not a caption line at all (markup-carve/carve-js#1423): the table wrote
       * one caret of its own and the figure wrote another, so an input holding a
       * single caption came back as two literal ones.
       */
      if (
        target.type === 'table' &&
        !this.captionSpellsSomething((target as { caption?: InlineNode[] }).caption ?? [])
      ) {
        delete (target as { caption?: InlineNode[] }).caption
      }
      /*
       * THE DOUBLE-CAPTION REBUILD (ruling markup-carve/carve-js#1488), reached
       * only by the modes that could not preserve: `roundtrip` returned above.
       *
       * The table is written with its own `<caption>` and the figcaption's text
       * follows as a paragraph, which loses the association and no bytes. ONE
       * row is owed and it names the `<figcaption>` - not `table-degraded`,
       * which says a table was degraded and nothing about where a caption went,
       * and not `structure-unspellable`, which is the row for the wrapper that
       * disappears when a figure around a table is BUILT. Nothing is built here.
       *
       * THE FIGURE'S ATTRIBUTES RIDE ONTO THE TABLE, under the merge
       * markup-carve/carve#1721 rules for a rebuilt figure: the figure's
       * attribute line comes first and the target's wins the names both set. The
       * arm used to drop them outright, so an `id` an anchor pointed at went
       * with zero rows - the exact silence that ruling removed for every other
       * figure, still standing in this one. The collision is declared by the
       * same buffer as everywhere else, so equal values report too.
       */
      if (doubleCaption) {
        this.recordDisplacedFigureAttrs(node, path, attrs, target)
        if (attrs) {
          ;(target as { attrs?: Attrs }).attrs = mergeAttrs(attrs, (target as { attrs?: Attrs }).attrs ?? {})
        }
        this.report.add('element-unwrapped', FIGCAPTION_DETACHED, 'warning', captionPath, captionNode as P5Node)
        /*
         * DIRECTLY AFTER THE TABLE, which is what the row says and what the
         * ordinary rebuild does: a figure's caption stays with its target, and a
         * body block the figure also held follows both. Appending it to the end
         * instead put a trailing `<p>` between the table and its own caption -
         * so a figure holding a table and a paragraph came back with the caption
         * text reading as a note on the paragraph.
         */
        return [target, { type: 'paragraph' as const, children: caption }, ...targets.slice(1)]
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
      this.recordDisplacedFigureAttrs(node, path, attrs, target)
      // Only an image has an attribute slot of its own under a caption line;
      // any other target shares the figure's line, merged the way the parser
      // merges two stacked lines (carve#2370).
      let figureAttrs = attrs
      const targetAttrs = (target as { attrs?: Attrs }).attrs
      if (target.type !== 'image' && targetAttrs) {
        figureAttrs = mergeAttrs(attrs, targetAttrs)
        if (!attrs?.order && !targetAttrs.order) delete figureAttrs.order
        delete (target as { attrs?: Attrs }).attrs
      }
      return [{ type: 'figure', target: target as never, caption, ...(figureAttrs ? { attrs: figureAttrs } : {}) }, ...targets.slice(1)]
    }
    /*
     * A TARGET THAT CANNOT CARRY A CAPTION LINE UNWRAPS AND DECLARES, in every
     * mode `roundtrip` does not claim (ruling markup-carve/carve-php#1731).
     *
     * The body stays as it imported and the caption becomes a paragraph of its
     * own. The figure is gone either way; what this arm buys over writing the
     * caption line anyway is that no character is invented. `x` then `^ Cap`
     * under a paragraph re-reads as ONE paragraph holding a literal caret, so
     * the document gains a `^` its author never typed. `x`, a blank line, then
     * `Cap` re-reads as two paragraphs: the association is lost and every byte
     * the author wrote is still their own.
     *
     * THE WRAPPER'S ATTRIBUTES ARE DROPPED RATHER THAN LANDED ON THE BODY.
     * Writing `{#f}` above the paragraph would keep one anchor resolvable at
     * one fewer declared loss, and it was considered and rejected: the id
     * identified a FIGURE, a block with a caption, and moving it to a bare
     * paragraph makes it identify something the author never marked. A loss
     * that is declared beats a silent substitution.
     */
    this.report.add('element-unwrapped', FIGURE_UNWRAPPED, 'info', path, node)
    this.reportUnwrappedAttributes(node, attrs, 'figure', path)
    if (!captionNode) return targets
    return [...ahead, { type: 'paragraph' as const, children: caption }, ...targets.slice(ahead.length)]
  }

  private inlines(nodes: P5Node[], parentPath: string, depth: number, paths?: string[], depths?: number[]): InlineNode[] {
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
      const path = paths?.[index] ?? this.childPath(parentPath, node, index)
      const produced = this.inline(node, path, depths?.[index] ?? depth)
      const previous = nodes[index - 1]
      const last = out.at(-1)
      const terminal = index === nodes.length - 1 || index === nodes.length - 2
        && nodes[index + 1]?.nodeName === '#text' && /^[ \t\r\n]*$/.test(domValue(nodes[index + 1]!) ?? '')
      if (terminal && this.cellDepth === 0 && produced.length === 1
          && produced[0]?.type === 'code' && produced[0].value === ''
          && previous?.nodeName === '#text' && /\n[ \t]*$/.test(domValue(previous) ?? '')
          && last?.type === 'text' && last.value.trim() !== '') {
        // The terminal empty run starts on its own line in the exported paragraph.
        last.value = last.value.replace(/ +$/, '')
        out.push({ type: 'soft_break' })
      }
      for (const item of produced) if (!this.inlineOrigins.has(item)) this.inlineOrigins.set(item, { node, path })
      const atBoundary = previousWasBlock || isFlattenedBlock(node)
      if (atBoundary && needsSeparator(out, produced)) {
        out.push({ type: 'text', value: ' ' })
        this.separatorsInserted++
      }
      // The separator is ONE space, merging with layout already on both sides.
      const first = produced[0]
      if (atBoundary && first?.type === 'text' && textEdge(out.at(-1), 'end')) {
        const value = first.value.replace(/^ +/, '')
        if (value === '') produced.shift()
        else first.value = value
      }
      out.push(...produced)
      // A BLOCK THAT CONTRIBUTES NO TOKEN IS NOT A SIDE, so it neither takes a
      // separator of its own nor leaves one owing to the block after it:
      // `<p>a</p><p></p><p>b</p>` is `a b`, never `a  b`.
      if (produced.length > 0) previousWasBlock = isFlattenedBlock(node)
    })
    const merged: InlineNode[] = []
    for (const node of hoistEdgeSpace(out, false, this.preserveLabelTabs)) {
      const last = merged.at(-1)
      if (node.type === 'text' && last?.type === 'text') last.value += node.value
      else merged.push(node)
    }

    return dropSpaceAfterHardBreak(merged, this.preserveLabelTabs)
  }

  /**
   * `inlines()` for a slot that IS a block's content - a paragraph, a heading,
   * a table cell, a caption, a term, a title - where the whitespace at the two
   * edges is not content and the re-parse will not keep it.
   */
  private blockInlines(nodes: P5Node[], parentPath: string, depth: number, paths?: string[], depths?: number[]): InlineNode[] {
    return trimBlockEdges(this.inlines(nodes, parentPath, depth, paths, depths), this.preserveLabelTabs)
  }

  private codeText(node: P5Node, path: string, depth: number, block = false, languageWrapper?: P5Node, lang?: string): string {
    const context = block ? 'pre' : 'code'
    const description = block ? 'a code block' : 'a code span'
    const runs = ['']
    type Frame = { node: P5Node, path: string, depth: number } | { boundary: true }
    const pending: Frame[] = []
    const pushChildren = (parent: P5Node, parentPath: string, parentDepth: number): void => {
      const children = domChildren(parent) ?? []
      for (let i = children.length - 1; i >= 0; i--) {
        pending.push({ node: children[i]!, path: this.childPath(parentPath, children[i]!, i), depth: parentDepth + 1 })
      }
    }
    pushChildren(node, path, depth)
    while (pending.length) {
      const frame = pending.pop()!
      if ('boundary' in frame) {
        runs.push('')
        continue
      }
      const child = frame.node
      this.enter(frame.depth)
      if (child.nodeName === '#text') {
        runs[runs.length - 1] += domValue(child) ?? ''
        continue
      }
      if (child.nodeName === '#comment') {
        this.report.add('element-dropped', `Dropped a comment inside <${context}>: ${description} holds only text`, 'warning', frame.path, child)
        continue
      }
      const tag = domTag(child)
      if (!tag) {
        pushChildren(child, frame.path, frame.depth)
        continue
      }
      if (ACTIVE.has(tag)) {
        this.report.add('element-dropped', `Dropped active <${tag}> element`, 'warning', frame.path, child)
        this.budget(child, frame.depth)
        continue
      }
      const rawAttrs = domAttrs(child) ?? []
      if (!(tag === 'span' && rawAttrs.length === 0) && !(block && tag === 'code')) {
        const dropped = (domChildren(child)?.length ?? 0) === 0
        this.report.add(dropped ? 'element-dropped' : 'element-unwrapped', `${dropped ? 'Dropped' : 'Unwrapped'} <${tag}> inside <${context}>`, dropped ? 'warning' : 'info', frame.path, child)
      }
      for (const attr of rawAttrs) {
        if (child === languageWrapper && lang && !attr.prefix && ((attr.name === 'class' && /[^ \t\r\n\f]/.test(attr.value) && attr.value.split(/[ \t\r\n\f]+/).filter(Boolean).every(token => token === `language-${lang}` || token === `lang-${lang}`)) || (attr.name === 'data-lang' && attr.value.replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, '') === lang))) continue
        const name = attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name
        const dangerous = isDangerousAttrName(name)
        const deniedUrl = ((tag === 'a' && name === 'href') || (tag === 'img' && name === 'src')) && destinationIsDenied(attr.value)
        this.report.refuseAttribute(child, frame.path, name, ` inside <${context}>: ${description} holds only text`, dangerous || (block && deniedUrl) ? 'warning' : 'info', dangerous || destinationIsDenied(attr.value))
      }
      if (isFlattenedBlock(child) || ['dialog', 'menu', 'search'].includes(tag)) {
        runs.push('')
        pending.push({ boundary: true })
      }
      pushChildren(child, frame.path, frame.depth)
    }
    if (!block && runs.filter(run => /[^ \t\r\n\f]/.test(run)).length > 1) {
      this.report.add('structure-unspellable', "A code span's value cannot hold the block boundary inside <code>", 'warning', path, node)
    }
    return runs.join('')
  }

  private codeSpan(node: P5Node, path: string, depth: number): InlineNode[] {
    const attrs = this.attrs(node, path)
    const value = this.codeText(node, path, depth)
    if (this.writing && this.cellDepth > 0 && /[\r\n]/.test(value)) {
      this.report.add('structure-unspellable', 'Flattened a line break in <code> inside a table cell: a table row is one line', 'warning', path, node)
    }
    const code: InlineNode = { type: 'code', value: this.writing && this.cellDepth > 0 ? value.replace(/\r\n?|\n/g, ' ') : value, ...(attrs ? { attrs } : {}) }
    if (code.value === '') {
      this.emptyCodeSpans.set(code, { node, path })
      this.hasEmptyCodeSpans = true
    }
    return [code]
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
      const text = domValue(node) ?? ''
      // A literal tab in paragraph text is content, including unresolved links.
      const value = text.replace(/[ \t\n\r\f]+/g, run => /[\n\r\f]/.test(run) ? ' ' : run.replace(/ +/g, ' '))
      return [{ type: 'text', value }]
    }
    /*
     * AN HTML COMMENT IS A CARVE COMMENT, and this is the INLINE position of it
     * (markup-carve/carve#1709). The block position is `blocks()`'s `flush`.
     *
     * The usual reason this importer drops something is that Carve cannot
     * express the shape. That reason never applied here: Carve has comments, so
     * dropping one was a choice to lose bytes the format can hold, in a mode
     * whose whole job is fidelity, made by nobody. A comment renders nothing in
     * either language, so keeping it is invisible in the output and lossless in
     * the source.
     */
    if (node.nodeName === '#comment') return this.comment(node, path)
    const tag = domTag(node)
    if (!tag) return []
    if (ACTIVE.has(tag)) {
      this.report.add('element-dropped', `Dropped active <${tag}> element`, 'warning', path, node)
      return []
    }
    if (this.formulaImages.has(node)) {
      this.report.add('element-dropped', 'Dropped <img>: the fallback image of a formula imported as math', 'info', path, node)
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
      if (this.mode === 'roundtrip' && !(this.cellDepth > 0 && /[\r\n]/.test(serializeOuter(node)))) {
        // The same answer the generic arm below gave a `<math>` before this
        // branch existed, and byte for byte the same output. Reported once for
        // the element rather than once per descendant, because the descendants
        // are not preserved separately - they are inside this one raw span.
        this.keepRaw(node, path, 'Preserved unsupported <math> element as raw HTML')
        return [{ type: 'raw_inline', format: 'html', content: serializeOuter(node) }]
      }
      const text = this.mode === 'roundtrip' ? undefined : linearMathText(node)
      if (text !== undefined) {
        this.report.add('element-unwrapped', 'Imported <math> as its text: no TeX annotation and no alttext, and its tokens read in order', 'warning', path, node)
        return [{ type: 'text', value: text }]
      }
      this.report.add('element-dropped', 'Dropped <math>: no TeX annotation and no alttext, and its children are a token stream, not an equation', 'warning', path, node)
      return []
    }
    if (tag === 'ruby') return this.ruby(node, path, depth)
    if (tag === 'code') return this.codeSpan(node, path, depth)
    const beforeWalk = this.mark()
    const children = this.inlines(domChildren(node) ?? [], path, depth + 1)
    const walked = this.mark()
    // BEFORE `attrs()`, which asks what was rebuilt here before deciding
    // whether a reserved name is a consumed carrier or a refused one.
    this.readInlineCarriers(node, tag, children, path)
    const carried = this.carrierReads.get(node)
    const attrs = this.attrs(node, path)
    if (tag === 'a' && carried?.names.has('xref')) {
      return [{ type: 'heading_ref', target: this.attr(node, 'href')!.slice(1), ...(attrs ? { attrs } : {}) }]
    }
    if (tag === 'span' && carried?.names.has('caption-number')) return [{ type: 'caption_number' }]
    if (tag === 'span' && carried?.names.has('substitution')) {
      const [removed, added] = children as [Extract<InlineNode, { type: 'delete' }>, Extract<InlineNode, { type: 'insert' }>]
      return [{ type: 'substitution', old: removed.children, new: added.children }]
    }
    if (tag === 'span' && carried?.names.has('raw')) {
      // §13a `data-carve-raw`. Without this the carrier span was read as raw
      // HTML, so `` `x`{=tex} `` came back as
      // `` `<span data-carve-raw="tex">x</span>`{=html} `` - the carrier buried
      // inside a raw inline of the WRONG format, which is worse than losing it.
      // `readInlineCarriers` has already settled that this span can hold one.
      const holdsElements = (domChildren(node) ?? []).some((child) => domTag(child) !== undefined)
      return [{
        type: 'raw_inline',
        format: this.carrierValue(node, 'raw') ?? '',
        content: holdsElements ? serializeInner(node as never) : this.flatText(node),
      }]
    }
    if (tag === 'span' && carried?.names.has('escaped')) {
      return [{ type: 'escaped_text', value: this.flatText(node) }]
    }
    // An element the HTML left empty holds nothing a reader sees, so it is
    // dropped without a row (ruling markup-carve/carve-rs#1719): an empty brace
    // pair reads back as literal text, and `{--}` as the braced en dash. Its
    // attributes can still matter (an `id` is a link target), and an empty span
    // is spellable, so they move onto one.
    if (EMPTY_DROPPED_MARKS.has(tag) && children.length === 0) {
      return attrs ? [{ type: 'span', children: [], attrs }] : []
    }
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
    if (tag === 'em' || tag === 'i') return [{ type: 'emphasis', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'strong' || tag === 'b') return [{ type: 'strong', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'del') return [{ type: 'delete', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'ins') return [{ type: 'insert', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 's' || tag === 'strike') return [{ type: 'strike', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'u') return [{ type: 'underline', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'mark') return [{ type: 'highlight', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'sub') return [{ type: 'subscript', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'sup') return [{ type: 'superscript', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'a') {
      // An absent href unwraps the anchor. An explicit empty href has a
      // native Carve link spelling and reaches the link branch below.
      //
      // AND THE DESTINATION IS NOT REBUILT, which is the normative half. This
      // is what Carve's own renderer emits: PART 9 section 25 blanks a
      // dangerous destination and writes no provenance for it, keeping the
      // visible text, so any route from a `title`, from the anchor's text or
      // from a round-trip attribute back to a destination would reconstruct the
      // exact value a security rule removed. The round trip owes the text.
      if (this.attr(node, 'href') !== '' && destinationIsEmpty(this.attr(node, 'href'))) {
        return this.unwrapDestinationLess(node, 'Unwrapped <a> with no destination', children, attrs, path)
      }
      if (destinationIsDenied(this.attr(node, 'href'))) {
        return this.dropDeniedDestination(node, 'href', children, attrs, path)
      }
      const title = this.attr(node, 'title')
      // §13a `data-carve-autolink`: HTML writes `<https://e>` and
      // `[https://e](https://e)` as the same bytes, and the AST tells them
      // apart - an autolink is its own node type.
      if (carried?.names.has('autolink')) {
        return [{
          type: 'autolink',
          href: this.attr(node, 'href') ?? '',
          ...(carried.autolinkText !== undefined ? { text: carried.autolinkText } : {}),
          ...(attrs ? { attrs } : {}),
        }]
      }
      // `!== undefined`, not truthiness: `<a href="u" title="">` has a title,
      // and the writer spells the empty one `[x](u "")`. Under a truthiness test
      // it vanished with no diagnostic, because `attrs()` treats a link's title
      // as consumed here rather than keeping it as `{title=…}`.
      return [{
        type: 'link',
        href: this.attr(node, 'href') ?? '',
        children,
        ...(title !== undefined ? { title } : {}),
        ...this.referenceFields(carried, attrs),
        ...(attrs ? { attrs } : {}),
      }]
    }
    if (tag === 'img') {
      // An absent src unwraps the image to its alt text. An explicit empty
      // src reaches the image branch below.
      //
      // The alt arrives as a raw attribute value rather than through the node
      // walk, so it becomes a TEXT node and the writer escapes it for the prose
      // slot it lands in, the same as any other imported text.
      if (this.attr(node, 'src') !== '' && destinationIsEmpty(this.attr(node, 'src'))) {
        const alt = this.attr(node, 'alt') ?? ''
        const stands: InlineNode[] = alt === '' ? [] : [{ type: 'text', value: alt }]
        return this.unwrapDestinationLess(node, 'Unwrapped <img> with no source', stands, attrs, path)
      }
      if (destinationIsDenied(this.attr(node, 'src'))) {
        const alt = this.attr(node, 'alt') ?? ''
        const stands: InlineNode[] = alt === '' ? [] : [{ type: 'text', value: alt }]
        return this.dropDeniedDestination(node, 'src', stands, attrs, path)
      }
      const title = this.attr(node, 'title')
      return [{
        type: 'image',
        src: this.attr(node, 'src') ?? '',
        alt: this.attr(node, 'alt') ?? '',
        ...(title !== undefined ? { title } : {}),
        ...this.referenceFields(carried, attrs),
        ...(attrs ? { attrs } : {}),
      }]
    }
    if (tag === 'br') {
      // A hard break has no `attrs` slot, so anything `attrs()` kept for this
      // element is lost here and has to say so - the alternative is the silence
      // that carve#1210 exists to kill.
      if (attrs) this.report.add('attribute-dropped', `Dropped ${this.attrNames(attrs).join(', ')} on <br>: a hard break has no attribute slot`, 'warning', path, node)
      const hardBreak: InlineNode = { type: 'hard_break' }
      this.hardBreaks.set(hardBreak, { node, path })
      return [hardBreak]
    }
    // The synthetic element the adapter footnote pass leaves at each
    // reference site (adapterFootnotes); never present in real HTML input.
    if (tag === 'carve-footnote-ref') {
      const label = this.attr(node, 'label') ?? ''
      const inline = this.footnotes.inlineFootnoteBodies.get(label)
      if (attrs?.keyValues) {
        delete attrs.keyValues.label
        if (Object.keys(attrs.keyValues).length === 0) delete attrs.keyValues
      }
      const authored = attrs && (attrs.id !== undefined || attrs.classes || attrs.keyValues) ? { attrs } : {}
      if (inline !== undefined) return [{ type: 'inline_footnote', inline, ...authored }]
      return [{ type: 'footnote_ref', label, ...authored }]
    }
    if (tag === 'abbr') {
      // A use of an abbreviation the document DEFINED is prose: the expansion
      // belongs on the definition line, not on every use, and writing it on
      // each one is what `[HTML]{abbr=…}` did. Only where the title IS the
      // defined expansion and the element carries nothing else, so an `<abbr>`
      // the author wrote by hand still imports as the span.
      const expansion = this.attr(node, 'title')
      const onlyTitle = attrs === undefined
        || (attrs.id === undefined && attrs.classes === undefined
          && Object.keys(attrs.keyValues ?? {}).every((key) => key === 'title'))
      if (expansion !== undefined && onlyTitle && this.footnotes.abbreviationDefs.get(this.flatText(node)) === expansion) return children
    }
    if (SEMANTIC_SPAN_TAGS.has(tag)) return [this.semanticSpan(tag, node, children, attrs)]
    if (tag === 'span') {
      const math = this.carveMath(node, attrs)
      if (math) return [math]
    }
    if (tag === 'span' && attrs) return [{ type: 'span', children, attrs }]
    if (tag === 'span' && this.mode === 'roundtrip' && this.contradicted.has(node)) return children
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
    // carve#3044: a refused generic-span carrier is consumed in every mode (CARVE-P10-021).
    const refusedSpanCarrier = tag === 'span' && (this.hasCarrier(node, 'raw') || this.hasCarrier(node, 'escaped'))
    if (this.mode === 'roundtrip' && !refusedSpanCarrier && !(this.cellDepth > 0 && /[\r\n]/.test(serializeOuter(node)))) {
      // The walk into the children reported bytes this arm keeps.
      this.discardWalk(beforeWalk, walked)
      this.keepRaw(node, path, `Preserved unsupported <${tag}> element as raw HTML`)
      return [{ type: 'raw_inline', format: 'html', content: serializeOuter(node) }]
    }
    const unwrapped = this.reportUnsupportedElement(node, tag, path)
    this.reportUnwrappedAttributes(node, attrs, tag, path, unwrapped)
    return children
  }

  private ruby(node: P5Node, path: string, depth: number): InlineNode[] {
    const attrs = this.attrs(node, path)
    const input: Array<{ node: P5Node; path: string }> = []
    const retainedRtc: InlineNode[][] = []

    const dropComponentAttrs = (component: P5Node, componentPath: string): void => {
      const held = this.attrs(component, componentPath)
      this.reportUnwrappedAttributes(component, held, domTag(component) ?? 'ruby component', componentPath)
    }
    const acceptRp = (rp: P5Node, rpPath: string, rpDepth: number): void => {
      this.enter(rpDepth)
      this.budget(rp, rpDepth)
      dropComponentAttrs(rp, rpPath)
      const text = this.text(rp).trim()
      if (text !== '' && text !== '(' && text !== ')' && text !== '（' && text !== '）') {
        this.report.add('element-dropped', 'Dropped non-standard <rp> fallback content', 'warning', rpPath, rp, 'degraded')
      }
    }

    ;(domChildren(node) ?? []).forEach((child, index) => {
      const childPath = this.childPath(path, child, index)
      if (domTag(child) === 'rb') {
        this.enter(depth + 1)
        dropComponentAttrs(child, childPath)
        ;(domChildren(child) ?? []).forEach((nested, nestedIndex) => {
          input.push({ node: nested, path: this.childPath(childPath, nested, nestedIndex) })
        })
        return
      }
      if (domTag(child) === 'rtc') {
        this.enter(depth + 1)
        dropComponentAttrs(child, childPath)
        const content: InlineNode[] = []
        ;(domChildren(child) ?? []).forEach((nested, nestedIndex) => {
          const nestedPath = this.childPath(childPath, nested, nestedIndex)
          if (domTag(nested) === 'rp') acceptRp(nested, nestedPath, depth + 2)
          else {
            if (domTag(nested) === 'rt') {
              this.enter(depth + 2)
              dropComponentAttrs(nested, nestedPath)
            }
            content.push(...this.inlines(domTag(nested) === 'rt' ? (domChildren(nested) ?? []) : [nested], nestedPath, depth + 1))
          }
        })
        retainedRtc.push(content)
        this.report.add('element-unwrapped', 'Unwrapped obsolete <rtc> annotation level', 'warning', childPath, child)
        return
      }
      input.push({ node: child, path: childPath })
    })

    const output: InlineNode[] = []
    let run: Array<{ base: InlineNode[]; annotation: InlineNode[] }> = []
    let base: InlineNode[] = []
    let hasAssociatedBase = false
    let emittedRuby = false
    const flushRun = (): void => {
      if (run.length === 0) return
      output.push({ type: 'ruby', pairs: run })
      emittedRuby = true
      run = []
    }
    const unpairedBase = (): void => {
      if (base.length === 0) return
      flushRun()
      output.push(...base)
      this.report.add('element-unwrapped', 'Unwrapped ruby base with no annotation', 'info', path, node, 'normalized')
      base = []
    }

    let whitespaceEnd = 0
    for (let index = 0; index < input.length; index++) {
      const item = input[index]!
      if (item.node.nodeName === '#comment') continue
      if (domTag(item.node) === 'rp') {
        acceptRp(item.node, item.path, depth + 1)
        continue
      }
      if (domTag(item.node) === 'rt') {
        this.enter(depth + 1)
        dropComponentAttrs(item.node, item.path)
        const annotation = this.inlines(domChildren(item.node) ?? [], item.path, depth + 1)
        if (hasAssociatedBase) {
          flushRun()
          output.push({ type: 'text', value: '(' }, ...annotation, { type: 'text', value: ')' })
          this.report.add('element-unwrapped', 'Flattened an additional ruby annotation level', 'warning', item.path, item.node)
        } else if (base.length === 0) {
          flushRun()
          output.push({ type: 'text', value: '(' }, ...annotation, { type: 'text', value: ')' })
          this.report.add('element-unwrapped', 'Unwrapped ruby annotation with no base', 'warning', item.path, item.node)
        } else {
          run.push({ base, annotation })
          base = []
          hasAssociatedBase = true
        }
        continue
      }
      if (
        hasAssociatedBase &&
        item.node.nodeName === '#text' &&
        /^[\t\n\f\r ]*$/.test(domValue(item.node) ?? '')
      ) {
        let lookahead = Math.max(index + 1, whitespaceEnd)
        while (
          lookahead < input.length &&
          input[lookahead]!.node.nodeName === '#text' &&
          /^[\t\n\f\r ]*$/.test(domValue(input[lookahead]!.node) ?? '')
        ) lookahead++
        whitespaceEnd = lookahead
        if (lookahead === input.length || domTag(input[lookahead]!.node) === 'rt' || domTag(input[lookahead]!.node) === 'rp') continue
      }
      hasAssociatedBase = false
      base.push(...this.inline(item.node, item.path, depth + 1))
    }
    unpairedBase()
    flushRun()
    for (const content of retainedRtc) {
      output.push({ type: 'text', value: '(' }, ...content, { type: 'text', value: ')' })
    }
    if (emittedRuby) {
      this.unspellable.push({
        node,
        path,
        message: 'Flattened <ruby> annotations: Carve 0.1 has no source spelling for their pairing',
      })
      if (attrs !== undefined) {
        if (output.length === 1 && output[0]!.type === 'ruby') output[0]!.attrs = attrs
        else return [{ type: 'span', children: output, attrs }]
      }
    } else if (attrs !== undefined) {
      this.reportUnwrappedAttributes(node, attrs, 'ruby', path)
    }
    return output
  }

  /**
   * Tiers 1 and 2 of D6: the TeX the producer already put in the element.
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
    for (const child of domChildren(node) ?? []) {
      if (child.nodeName !== '#text') return undefined
      out += domValue(child) ?? ''
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
    const alttext = this.attr(node, 'alttext')?.trim() || undefined
    const image = fallbackImage(node)
    const imageAlt = image && this.attr(image, 'alt')?.trim()
    // Adjacency alone is no evidence: the alt stands in for the formula only
    // where the page hid the MathML so the image renders instead.
    const content = (annotated ?? alttext ?? (mathIsHidden(node) ? imageAlt : undefined) ?? '').trim()
    if (content === '') return undefined
    if (image && imageAlt === content) this.formulaImages.add(image)
    // After the tier is settled, so a dropped element does not also report
    // attributes on its way out: the `element-dropped` warning covers it.
    const attrs = this.attrs(node, path)
    // On which tier SUPPLIED the content, not on which one was available: an
    // annotation that held only whitespace falls through to `alttext`, and
    // reading the presence of the element would make that fall-through the one
    // tier-2 read that says nothing.
    if (annotated === undefined && alttext !== undefined) {
      this.report.add('encoding-assumed', 'Read <math> through its alttext: MathML does not declare the encoding of alttext, so TeX is assumed', 'info', path, node)
    } else if (annotated === undefined) {
      this.report.add('encoding-assumed', "Read <math> through its fallback image's alt: nothing declares the encoding of alt, so TeX is assumed", 'info', path, node)
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
    for (const semantics of domChildren(node) ?? []) {
      if (domTag(semantics) !== 'semantics') continue
      for (const child of domChildren(semantics) ?? []) {
        if (domTag(child) !== 'annotation') continue
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
      if (current.nodeName === '#text') text += domValue(current) ?? ''
      const children = domChildren(current) ?? []
      for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]!)
    }
    return text
  }

  private budget(node: P5Node, depth: number): void {
    const pending: Array<[P5Node, number]> = [[node, depth]]
    while (pending.length) {
      const [current, currentDepth] = pending.pop()!
      for (const child of serializedChildren(current)) {
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
      const children = this.inlines(domChildren(node) ?? [], path, depth + 1)
      const attrs = this.attrs(node, path)
      const quoted: InlineNode[] = [{ type: 'text', value: open! }, ...children, { type: 'text', value: close! }]
      this.report.add('element-unwrapped', 'Read <q> as quotation marks: Carve has no quotation element, so the marks are the mapping', 'info', path, node)
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
  private semanticSpan(tag: string, node: P5Node, children: InlineNode[], attrs?: Attrs): InlineNode {
    const source = SEMANTIC_SPAN_VALUE_SOURCE.get(tag)
    const value = source === undefined ? '' : this.attr(node, source) ?? ''
    const keyValues: Record<string, string> = { ...attrs?.keyValues }
    // A `title` on `<abbr>`/`<dfn>` IS the value here, not a leftover to ride
    // along: `attrs()` collected it before the tag was known, and keeping both
    // would render the same attribute onto the element twice over.
    if (source === 'title') delete keyValues.title
    keyValues[tag] = value
    return { type: 'span', children, attrs: { ...attrs, keyValues } }
  }

  private text(node: P5Node): string {
    if (node.nodeName === '#text') return domValue(node) ?? ''
    const pieces: string[] = []
    const pending = [node]
    while (pending.length > 0) {
      const current = pending.pop()!
      if (current.nodeName === '#text') {
        pieces.push(domValue(current) ?? '')
      } else {
        const children = domChildren(current) ?? []
        for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]!)
      }
    }
    return pieces.join('')
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

  /**
   * An HTML comment in an INLINE position, as the delimited Carve comment
   * (markup-carve/carve#1709).
   */
  private comment(node: P5Node, path: string): InlineNode[] {
    const content = domData(node) ?? ''
    const closesEarly = content.includes('%}')
    const endsTheRun = /\n[ \t]*\n/.test(content)
    if (closesEarly || endsTheRun) {
      this.report.add(
        'element-dropped',
        `Dropped an HTML comment: its text ${closesEarly ? 'holds the comment closer' : 'holds a blank line'}, which ends a Carve inline comment early, and the comment is not moved out of the run to make it spellable`,
        'warning',
        path,
        node,
      )
      return []
    }
    // A pipe-table row is one line, so a line break has no spelling in a cell
    // (carve#2372).
    if (this.cellDepth > 0 && /[\r\n]/.test(content)) {
      this.report.add('element-dropped', 'Dropped an HTML comment in a table cell: its text holds a line break, and a table row is one line', 'warning', path, node)
      return []
    }
    // A heading is one line too (carve#2396).
    if (this.headingDepth > 0 && /[\r\n]/.test(content)) {
      this.report.add('element-dropped', 'Dropped an HTML comment in a heading: its text holds a line break, and a heading is one line', 'warning', path, node)
      return []
    }
    return [{ type: 'comment', block: false, delimited: true, content }]
  }

  /**
   * Does this run hold anything PART 11 §7 calls content?
   *
   * `trimNonNbsp` rather than `String.prototype.trim`, for the reason
   * `isLayoutOnlyText` gives: the second one eats every Unicode space, so a run
   * holding one NO-BREAK SPACE answered no and the paragraph around it was
   * never built (markup-carve/carve-js#1493). `captionSpellsSomething` is the
   * same predicate for a caption slot and was corrected first; this is the
   * other half of one rule.
   */
  private visible(nodes: InlineNode[]): boolean {
    return nodes.some((node) => node.type !== 'text' || trimNonNbsp(node.value) !== '')
  }

  /**
   * A run of comments whose other members are elements importing to nothing
   * is still a block comment run: the elements leave no inline run behind
   * (markup-carve/carve-rs#2029). The elements are converted here, once, so
   * their own rows stand; a probe that finds content rolls its rows back.
   */
  private commentsBesideNothing(buffered: P5Node[], paths: string[], depths: number[]): boolean {
    if (!buffered.some((node) => node.nodeName === '#comment')) return false
    const elements = buffered.flatMap((node, index) => (domTag(node) ? [index] : []))
    if (!elements.length) return false
    if (!buffered.every((node) => {
      const tag = domTag(node)
      return tag ? ACTIVE.has(tag) || holdsNoText(node) : isBlankOrComment(node)
    })) return false
    const before = this.mark()
    const counted = this.nodes
    for (const index of elements) {
      if (this.visible(this.inlines([buffered[index]!], paths[index]!, depths[index]!, [paths[index]!], [depths[index]!]))) {
        this.restore(before)
        this.nodes = counted
        return false
      }
    }
    return true
  }

  /**
   * The IMAGE a synthesized wrapper was built to hold, when that is all it holds
   * (PART 9 §4b; markup-carve/carve-js#1411).
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
  /**
   * Unwraps the node a writer refusal names and reports the loss. False when
   * the node is not in the tree or came from no element.
   */
  unwrapUnspellable(document: Document, target: object, targets: readonly object[] = [target], message?: string): boolean {
    const wanted = new Set(targets.filter(node => this.inlineOrigins.has(node) && Array.isArray((node as { children?: unknown }).children)))
    const removed = new Set<object>()
    const stack: unknown[] = [document]
    while (stack.length > 0) {
      const node = stack.pop()
      if (node === null || typeof node !== 'object') continue
      if (Array.isArray(node)) {
        const kept: unknown[] = []
        const append = (item: unknown): void => {
          if (item !== null && typeof item === 'object' && wanted.has(item)) {
            removed.add(item)
            for (const child of (item as { children?: InlineNode[] }).children ?? []) append(child)
          } else kept.push(item)
        }
        for (const item of node) append(item)
        node.length = 0
        for (const item of kept) node.push(item)
      }
      for (const value of Object.values(node)) stack.push(value)
    }
    for (const node of targets) {
      if (!removed.has(node)) continue
      const origin = this.inlineOrigins.get(node)!
      const tag = domTag(origin.node) ?? 'element'
      this.report.add(
        'structure-unspellable',
        message ?? `Unwrapped <${tag}> inside a span of the same kind: two braced spans of one kind cannot nest in Carve`,
        'warning', origin.path, origin.node,
      )
      const attrs = (node as InlineNode).attrs
      if (attrs !== undefined && this.attrNames(attrs).length > 0) {
        this.report.add('attribute-dropped', `Dropped ${this.attrNames(attrs).join(', ')} on <${tag}>: the element was unwrapped`, 'warning', origin.path, origin.node)
      }
    }
    return removed.size > 0
  }

  /**
   * A table row is one line, so a hard break in a cell flattens to one space
   * and the loss is reported (markup-carve/carve#2067).
   */
  dropHardBreaksInTableCells(document: Document): void {
    const stack: unknown[] = [document]
    while (stack.length > 0) {
      const node = stack.pop()
      if (node === null || typeof node !== 'object') continue
      if ((node as { type?: unknown }).type === 'table_cell') {
        flattenHardBreaks((node as TableCell).children ?? [], (hardBreak) => {
          const origin = this.hardBreaks.get(hardBreak)
          if (origin === undefined) return
          this.report.add(
            'structure-unspellable',
            'Flattened a <br> in a table cell to a space: a table row is one line, so a hard break has no Carve spelling there',
            'warning',
            origin.path,
            origin.node,
          )
        })
        continue
      }
      for (const value of Object.values(node)) stack.push(value)
    }
  }

  /**
   * An empty code span survives only where its open run ends (PART 3, UNCLOSED
   * RUN). Elsewhere the writer refuses it, so the span is dropped and the loss
   * reported; one that survives loses its attributes, which need a closing run
   * (carve-js#1789).
   */
  dropUnspellableEmptyCodeSpans(document: Document): void {
    if (!this.hasEmptyCodeSpans) return
    // Whitespace behind a kept span is trimmed rather than read into its run.
    const blank = (item: object) => (item as InlineNode).type === 'text' && /^[ \t\r\n]*$/.test((item as { value: string }).value)
    const dropped = new Set(emptyCodeSpansWhoseRunDoesNotEnd(document, blank))
    const parents = new Map<object, [object, unknown[]]>()
    const kept: object[] = []
    const stack: unknown[] = [document]
    while (stack.length > 0) {
      const node = stack.pop()
      if (node === null || typeof node !== 'object') continue
      if (Array.isArray(node)) {
        let write = 0
        for (const item of node) if (!dropped.has(item)) node[write++] = item
        node.length = write
      }
      const origin = this.emptyCodeSpans.get(node)
      if (origin !== undefined) {
        this.dropEmptyCodeSpanAttrs(node as InlineNode, origin)
        kept.push(node)
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) for (const item of value) if (item !== null && typeof item === 'object') parents.set(item, [node, value])
        stack.push(value)
      }
    }
    for (let current of kept) {
      for (let link = parents.get(current); link !== undefined; current = link[0], link = parents.get(current)) {
        const [parent, siblings] = link
        siblings.splice(siblings.indexOf(current) + 1)
        if ((parent as { type?: string }).type !== 'abbreviation') break
      }
    }
    for (const code of dropped) {
      const origin = this.emptyCodeSpans.get(code)
      if (origin === undefined) continue
      this.dropEmptyCodeSpanAttrs(code as InlineNode, origin)
      this.report.add(
        'structure-unspellable',
        'Dropped an empty <code>: its backtick run is closed by the end of a block or by a forced span, and here the run would read what follows it as code instead',
        'warning',
        origin.path,
        origin.node,
      )
    }
  }

  private dropEmptyCodeSpanAttrs(code: InlineNode, origin: { node: P5Node; path: string }): void {
    if (code.attrs === undefined) return
    const names = this.attrNames(code.attrs)
    delete code.attrs
    if (names.length === 0) return
    this.report.add(
      'attribute-dropped',
      `Dropped ${names.join(', ')} on <code>: an empty code span has no closing run to attach attributes to`,
      'warning',
      origin.path,
      origin.node,
    )
  }

  reportSerializationLosses(document: Document): void {
    for (const { node, path, message } of this.unspellable) {
      this.report.add('structure-unspellable', message, 'warning', path, node)
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
      this.report.add('structure-unspellable', message, 'warning', path, node)
    }
    // ONE ROW PER DISPLACED NAME, at `info`, which is what this code means
    // everywhere else: an attribute the output does not carry. The figure's
    // target now gets its own attribute line written (`renderFigure`), and this
    // is the other half of that ruling - the side that loses is DECLARED rather
    // than resolved in silence (markup-carve/carve#1721).
    for (const { node, path, name } of this.displacedFigureAttrs) {
      this.report.add(
        'attribute-dropped',
        `Dropped one ${name} on <figure>: the figure and its target both set ${name}, and their two attribute lines merge into a single value`,
        'info',
        path,
        node,
      )
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
    const groupChildren = domChildren(node) ?? []
    let captionAt = -1
    groupChildren.forEach((child, index) => {
      if (domTag(child) === 'figcaption') captionAt = index
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
  const value = importer.import(replaceLoneSurrogates(html))
  return { value, report: { mode: importer.mode, adapter: importer.adapter, diagnostics: importer.diagnostics } }
}

export function htmlToCarve(html: string, options: HtmlImportOptions = {}): HtmlImportResult<string> {
  const importer = new Importer(options, true)
  const value = importer.import(replaceLoneSurrogates(html))
  // The loss belongs to serialization, not to the import: a consumer that keeps
  // the AST `htmlToAst` returns keeps the figure wrapper and loses nothing. So
  // the importer records where it built one and only this function reports it.
  importer.dropUnspellableEmptyCodeSpans(value)
  importer.dropHardBreaksInTableCells(value)
  importer.reportSerializationLosses(value)
  for (;;) {
    try {
      let carve = renderCarveForHtmlImport(value)
      if (carve.includes('</\\#')) {
        preserveHtmlTextCrossrefs(value, convertedIds(carve))
        carve = renderCarveForHtmlImport(value)
      }
      return { value: carve, report: { mode: importer.mode, adapter: importer.adapter, diagnostics: importer.diagnostics } }
    } catch (error) {
      if (!(error instanceof SourceUnspellableError) || error.node === undefined) throw error
      const message = error.reason.endsWith(LEADING_EXTENDER_REASON) ? EXTENDER_LEADING_SPAN_UNSPELLABLE : undefined
      if (!importer.unwrapUnspellable(value, error.node, error.nodes, message)) throw error
    }
  }
}
