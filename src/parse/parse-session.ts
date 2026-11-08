import { anchorListsAtOwnerColumns } from '../source/list-owner-columns.js'
import { recordUnboundCaption } from './block/caption-fallback.js'
import { commentOnlyParagraphEnd, isRefusedBraceRun } from './parse-prepass-core.js'
import { markDirectiveLine } from './block/paragraph-indent.js'
import { endsAtConsumedMarker, entriesToWire } from '../ast/definition-list-wire.js'
import type { Comment, DefinitionItem, LinkReferenceDefinition } from '../ast.js'
import type {
  Admonition,
  Attrs,
  BlockNode,
  BlockQuote,
  BlockQuoteLazyState,
  CodeBlock,
  DefinitionList,
  Directive,
  Div,
  Document,
  Figure,
  FigureGroup,
  Heading,
  HeadingLevel,
  Image,
  InlineNode,
  LazyProbeFrame,
  LineBlock,
  LineBlockHost,
  LinkDefMatch,
  MatcherContext,
  Math,
  OpaqueGroup,
  Paragraph,
  ParseOptions,
  PendingAttrCarry,
  QuoteDescent,
  QuoteLazyHint,
  StrippedLineOrigin,
  Table,
  TableBlockHost,
  ThematicBreak,
} from './parse-core.js'
import {
  AttachmentFenceClosers,
  FOOTNOTE_BODY_COLUMN,
  GENERATED_CONTENT_KINDS,
  LAZY_FRAME,
  Lexer,
  MAX_NESTING_DEPTH,
  RE_ABBR_DEF,
  RE_ADMONITION_CLOSE,
  RE_ADMONITION_OPEN,
  RE_ANY_COLON_CLOSER,
  RE_ANY_FENCE_CLOSER,
  RE_BARE_IMAGE,
  RE_BLOCKQUOTE,
  RE_CAPTION,
  RE_COMMENT_BLOCK_ANY,
  RE_COMMENT_LINE,
  RE_DEFLIST_TERM,
  RE_DIV_OPEN,
  RE_FENCE,
  RE_FOOTNOTE_DEF,
  RE_HARDBREAKS_OPEN,
  RE_HEADING,
  RE_HR,
  RE_LINE_BLOCK_OPEN,
  RE_QUOTE_BLOCK_OPEN,
  RE_RAW_FENCE,
  RE_VALID_ADMONITION_OPEN,
  accumulateAttrs,
  appendLinkReferenceDefinitions,
  insertSkippedAbbreviationDefinitions,
  hoistContainerAbbreviations,
  attachBlockPos,
  ENDS_AT_LAST_PLACED_CHILD,
  unplacedBlocks,
  blockQuoteParagraphClaimOpen,
  closeBlockQuoteParagraph,
  closerIndex,
  codeContent,
  collectColonFenceBody,
  collectLinkDefsWithHelpers,
  colonBlockOpenerRun,
  colonFenceShapeEndsLazyContinuation,
  commentBlockHasCloser,
  commentCloserLookup,
  commentLineContent,
  consumeLooseKey,
  deflistMarkerLine,
  delimitedTable,
  deriveTableMetadata,
  dropPositions,
  dropTrailingWhitespace,
  explicitlyClosedQuotes,
  extractItemAttr,
  fenceCloseRe,
  fencedBlockEnd,
  imageIsBlock,
  indentColumns,
  inlineSource,
  isBlankLine,
  isBlockAttributeLine,
  isBlockImageLine,
  isContinuationMarker,
  isFigureGroupOpener,
  isLinkDefLine,
  isListMarkerLine,
  isStackedFirstBlockQuoteMarker,
  quotedNoteFirstBlockMarker,
  isTableRow,
  layoutWork,
  lazyProbeCost,
  lazyProbeFrame,
  leadingCommentEnd,
  leadingWhitespace,
  lineOpensBlock,
  lineOpensItemBlock,
  linkDestinationValue,
  literalCommentHasCloser,
  markAboveContentColumn,
  markCaptionAtContentColumn,
  markSecondLineLazy,
  markerContentColumn,
  markerDecision,
  matchLinkDef,
  mergeAttrs,
  nestedColonLexer,
  nestedSubLexer,
  normalizeRefLabel,
  normalizedSourceLines,
  opaqueGroupCloser,
  orderedMatch,
  parseAbbrDef,
  parseAttrs,
  parseCommentBlock,
  parseDefinitionListWithHelpers,
  parseLineBlockWithHelpers,
  parseListWithHelpers,
  parseRawBlock,
  parseTableBlock,
  quotePrefixDepth,
  quotedCommentHasCloser,
  quotedLineText,
  readCaptionText,
  recordPromotedImageBlockRun,
  replaceLoneSurrogates,
  setDelimitedPayloadLines,
  sliceColumns,
  sourceColumn,
  sourceColumnAt,
  sourceQuoteBody,
  sourceQuoteLocalColumn,
  sourceQuoteRest,
  startsInterruptingBlock,
  stripLazyFrame,
  stripPositions,
  probeBlockAttributes,
  parseBlockAttributeRun,
  subLexer,
  taskMatch,
  toCodepointPositions,
  trackBlockQuoteLazyState,
  commentFenceRun,
  trimEndSpaceTab,
  tryCollectBlockAttributes,
  unclosedContainerFromOpener,
  unescapeAttrValue,
  unorderedMatch,
  utf8ByteLength,
} from './parse-core.js'

import { InlineParseSession } from './inline/parse-inline-session.js'
import { withKeptFenceLookahead } from './block/parse-quote-core.js'
import { scanDirectiveShape } from '../include-directive.js'
import { parseFootnoteDef } from './block/parse-footnote-session.js'
import { recordLosingFootnoteLines } from './losing-footnote-lines.js'
import { ownLines, restoreLetters } from './block/block-ownership.js'
import { authoredAbbreviations, directCommentNodes, erasedLineNodes, erasedLinesStandAlone, restoreErasedDefinitions, restoreTransparentAbbreviations, restoreTransparentComments, transparentLineStream } from './block/transparent-lines.js'
import { isValidAttrPayload, isValidInlineAttrPayload } from '../extension/attribute-parser.js'
import { isQuoteBlankLine } from './parse-lexer.js'

// One block quote being collected: the lines it takes so far and the lazy
// state its unmarked lines are judged against.
interface QuoteCollect {
  lexer: Lexer
  firstLineIndex: number
  inner: string[]
  origins: Map<number, StrippedLineOrigin>
  innerLineNumbers: number[]
  state: BlockQuoteLazyState
  // Quoted lines not yet fed to the tracker. `state` is read only when an
  // unmarked line asks whether the paragraph is still open (or a `+` closes
  // it), so tracking waits until then. The tracker descends every nested
  // quote on the line, and a quote that ends at EOF or a blank line would
  // otherwise pay that at every level - quadratic in the nesting depth.
  untracked: Array<[content: string, lineIndex: number]>
  given: QuoteLazyHint | null
  descent: QuoteDescent
  payloadMisses?: Map<string, { from: number; maxRun: number }>
  // The state this quote hands its own nested quote; see `QuoteLazyHint`.
  handDown: QuoteLazyHint | null
  trackedBefore: boolean
  paragraphOpen: boolean | undefined
  quoteTermContinuation: boolean
  quoteRootLine: string
  quoteMarkerColumn: number
  physicalQuoteColumn: number
  // Where the last column-0 follower of a stacked `> - > +` ended in `inner`.
  // What `inner` leaves open before a line, scanned once as it grows: a fence, and a paragraph
  // that an item line started (`> - a` / `> b`), which a sibling item's stacked opener closes.
}

const ATTR_BLOCK_SRC = `\\{((?:[^}'"\\\\]|\\\\.|'(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")*)\\}`
const RE_REFERENCE_IMAGE_LINE = new RegExp(`^[ \\t]*!\\[(?:[^\\]\\\\]|\\\\.)*\\]\\[(?:[^\\]\\\\]|\\\\.)*\\]((?:${ATTR_BLOCK_SRC})*)[ \\t]*$`)

// A lone reference image, in any label spelling, with only real attribute
// blocks after it: the shape that holds a caption slot (PART 9 section 4).
function isReferenceImageLine(line: string): boolean {
  const m = RE_REFERENCE_IMAGE_LINE.exec(line)
  if (m === null) return false
  for (const block of m[1]!.matchAll(new RegExp(ATTR_BLOCK_SRC, 'g'))) {
    if (block[1]!.trim() === '' || !isValidInlineAttrPayload(block[1]!)) return false
  }
  return true
}

// The syntactic comment strip the caption-host filter shares between math and image hosts.
// A braced comment keeps the whitespace around it until the line end is trimmed.
function withoutCaptionHostComments(text: string): string {
  return text.replace(/\{%(?:(?!%\})[\s\S])*%\}/g, '\u0001').split('\n')
    .map((line) => line.replace(/(^|[ \t])%%.*$/, '$1').replace(/[ \t]+$/, '')).join('\n').replaceAll('\u0001', '')
}

// An image line that holds its caption slot once its comments are dropped (PART 9R R7).
function isCommentedImageLine(line: string): boolean {
  const trimmed = line.replace(/[ \t]+$/, '')
  const quiet = withoutCaptionHostComments(trimmed)
  // The space a braced comment keeps beside the image is content, so the image is no longer alone.
  const lead = (text: string): string => /^[ \t]*/.exec(text)![0]
  return quiet !== trimmed && lead(quiet) === lead(trimmed) && !/[ \t]$/.test(quiet) &&
    (isBlockImageLine(quiet) || isReferenceImageLine(quiet))
}

/** How many lines at the start of `at` are block attribute lines. */
function leadingAttributeRun(at: (offset: number) => string | undefined, options: ParseOptions): number {
  let count = 0
  while (at(count)?.startsWith('{')) {
    const lines: string[] = []
    for (let line = at(count); line !== undefined && !isBlankLine(line); line = at(count + lines.length)) {
      const closed = line.includes('}')
      // The same early refusal `probeBlockAttributes` makes, so a stray `{` scans one line.
      if (lines.length > 0 && !closed && !isValidAttrPayload('\n' + line + '\n')) return count
      lines.push(line)
      if (closed) break
    }
    const run = probeBlockAttributes(subLexer(lines, options, 0))
    if (run === null) break
    count += run.count
  }
  return count
}

// The line after a footnote definition at `offset` and its unbroken body, or -1.
function leadingNoteEnd(at: (offset: number) => string | undefined, offset: number): number {
  const line = at(offset)
  if (line === undefined || !RE_FOOTNOTE_DEF.test(line.replace(/^[ \t]+/, ''))) return -1
  const floor = indentColumns(line) + FOOTNOTE_BODY_COLUMN
  let k = offset + 1
  for (let next = at(k); next !== undefined && skippedNoteBodyLine(next, floor); next = at(++k)) { /* body */ }
  return k
}

// A skipped note takes its body along: lines at its body column and lazy text (CARVE-P9-067, carve#5034).
function skippedNoteBodyLine(line: string, floor: number): boolean {
  const lead = line.trimStart()
  if (isBlankLine(line) || (indentColumns(line) < floor && isBlockAttributeLine(lead))) return false
  return indentColumns(line) >= floor || (!/^::? /.test(lead) && !RE_COMMENT_LINE.test(lead) && !lineOpensItemBlock(lead))
}

/** Attribute runs, notes and comments before a `+`-attached block: the host keeps them (§17 L3, carve#5288, carve#5324). */
function leadingInvisibleRun(at: (offset: number) => string | undefined, options: ParseOptions): number {
  let count = 0
  for (;;) {
    // After a note the attribute line may stand at the note's column.
    const attrs = leadingAttributeRun(offset => count > 0 ? at(count + offset)?.trimStart() : at(count + offset), options)
    if (attrs > 0) count += attrs
    const note = leadingNoteEnd(at, count)
    const comment = note === -1 ? leadingCommentEnd(at, count) : -1
    if (note !== -1) count = note
    else if (comment !== -1 && at(comment) !== undefined) count = comment
    else if (attrs === 0) return count
  }
}

/** Whether the comment-only paragraph at the cursor sits on blank lines between two items of a list. */
function commentBetweenListSiblings(lexer: Lexer): boolean {
  const end = commentOnlyParagraphEnd((offset) => lexer.peek(offset), 0)
  if (end <= 1 || !isBlankLine(lexer.peek(end))) return false
  const column = indentColumns(lexer.peek()!)
  let next = end
  while (lexer.peek(next) !== undefined && isBlankLine(lexer.peek(next))) next++
  const after = lexer.peek(next)
  if (after === undefined || indentColumns(after) > column || !isListMarkerLine(after.trimStart())) return false
  let back = lexer.pos - 1
  if (back < 0 || !isBlankLine(lexer.lineAt(back))) return false
  while (back >= 0 && isBlankLine(lexer.lineAt(back))) back--
  const before = back >= 0 ? lexer.lineAt(back) : undefined
  return before !== undefined && (indentColumns(before) > column || isListMarkerLine(before.trimStart()))
}

/**
 * A block brace run refused only because a continuation is too shallow.
 * `memo.closerless` is the lexer index a `{%` scan reached without a `%}`; no later
 * line before it can close a run either, so the scan is not repeated per line.
 */
function refusedBraceLines(lexer: Lexer, memo: { closerless?: number } = {}): number {
  const firstRaw = lexer.peek()
  const first = firstRaw === undefined ? undefined : stripLazyFrame(firstRaw)
  if (!first?.trimStart().startsWith('{')) return 0
  if (memo.closerless !== undefined && lexer.pos < memo.closerless && first.trimStart().startsWith('{%')) return 0
  // Between a container's siblings a comment-only paragraph stays an invisible line (CARVE-P9-013).
  // A comment-only paragraph between two items of one list is an invisible line (CARVE-P9-013).
  if (!firstRaw?.startsWith(LAZY_FRAME) && first.trimStart().startsWith('{%') && commentBetweenListSiblings(lexer)) return 0
  const openerColumn = indentColumns(first)
  const comment = first.trimStart().startsWith('{%')
  const lazyBrace = firstRaw?.startsWith(LAZY_FRAME) ||
    lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos)) ||
    lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos))
  // A lazy paragraph line has already been folded into its owner here. Its
  // authored column, after quote prefixes, is the P2-035 comparison frame.
  const authoredColumn = (offset: number): number => {
    const index = lexer.pos + offset
    const root = lexer.documentRoot ?? lexer
    const source = (root.authoredRootLines ?? root.rootLines ?? root.authoredLines ?? root.lines)[lexer.lineNumber(index) - 1]
    if (source === undefined) return indentColumns(stripLazyFrame(lexer.peek(offset) ?? ''))
    return sourceQuoteLocalColumn(source, quotePrefixDepth(source))
  }
  const sourceOpenerColumn = lazyBrace ? authoredColumn(0) : openerColumn
  const lines: string[] = []
  let shallow = false
  let quoted: string | null = null
  let depth = 0
  for (let n = 0; ; n++) {
    const raw = lexer.peek(n)
    const line = raw === undefined ? undefined : stripLazyFrame(raw)
    if (line === undefined || isBlankLine(line)) {
      if (comment) memo.closerless = lexer.pos + n
      return 0
    }
    const quoteLazyContinuation = lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos + n))
    if (n > 0 && comment && !lazyBrace && quoteLazyContinuation) {
      memo.closerless = lexer.pos + n
      return 0
    }
    if (n > 0 && !comment && line.trimStart().startsWith('{')) return 0
    if (n > 0) {
      // A quote's lazy line retains its source column even when the opener was
      // a marked line. Ordinary list lines still use their local content column.
      const sourceColumns = lazyBrace || quoteLazyContinuation && !comment
      if (sourceColumns
        ? authoredColumn(n) <= (lazyBrace ? sourceOpenerColumn : authoredColumn(0))
        : indentColumns(line) <= openerColumn || lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos + n))) shallow = true
    }
    lines.push(n === 0 ? line.trimStart() : ' ' + line.trimStart())
    if (comment) {
      if (line.includes('%}')) return shallow ? n + 1 : 0
      continue
    }
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!
      if (quoted) {
        if (ch === '\\') i++
        else if (ch === quoted) quoted = null
      } else if (ch === '"' || ch === "'") quoted = ch
      else if (ch === '{') depth++
      else if (ch === '}') depth--
    }
    if (depth <= 0) return shallow && parseBlockAttributeRun(lines.join('\n')) !== null ? n + 1 : 0
  }
}

/** Whether these lines leave a code fence open at their end. */
function leavesFenceOpen(lines: readonly string[]): boolean {
  let close: RegExp | null = null
  let column = 0
  for (const line of lines) {
    const text = line.trimStart()
    // A closer counts only at its opener's column; an indented run is payload.
    if (close !== null) {
      if (indentColumns(line) === column && close.test(text)) close = null
      continue
    }
    const code = RE_FENCE.exec(text) ?? RE_RAW_FENCE.exec(text)
    if (code !== null) {
      close = fenceCloseRe(RE_FENCE.test(text) ? code[2]! : code[1]!)
      column = indentColumns(line)
    }
  }
  return close !== null
}

type Span = { endLine: number; endColumn?: number; endOffset?: number }

// A consumed `+` leaves no node (CARVE-P11-040): the writer writes what the tree holds.
function dropStandIns(doc: Document): void {
  const placed = (children: unknown[]): unknown[] => children.filter((child) => !unplacedBlocks.has(child as object))
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value === null || typeof value !== 'object') return
    const item = value as { type?: string; children?: unknown[]; definitions?: unknown[][]; definitionSpans?: Array<object | undefined> }
    // An attribute's `keyValues` may hold a `children` or `definitions` key with a string value.
    if (Array.isArray(item.definitions)) item.definitions.forEach((children, index) => {
      if (!Array.isArray(children)) return
      const recorded = item.definitionSpans?.[index]
      if (recorded !== undefined && unplacedBlocks.has(children.at(-1) as object)) endsAtConsumedMarker.add(recorded)
      item.definitions![index] = placed(children)
    })
    if (Array.isArray(item.children) && !STAND_IN_FREE.has(item.type ?? '')) item.children = placed(item.children)
    // Footnote bodies live in a side table, not in `children`.
    if (item.type === 'document') {
      const notes = (value as Document).footnoteDefs
      if (notes) for (const label of Object.keys(notes)) notes[label] = placed(notes[label]!) as BlockNode[]
    }
    if (STAND_IN_FREE.has((value as { type?: string }).type ?? '')) return
    for (const [key, child] of Object.entries(value)) if (key !== 'pos') visit(child)
  }
  visit(doc)
}

// Blocks whose content is inline or verbatim: no stand-in sits inside them.
const STAND_IN_FREE = new Set(['paragraph', 'heading', 'code_block', 'raw_block', 'table', 'line_block', 'thematic_break', 'comment'])

// A consumed `+`'s `%%` stand-in is wider than the `+`. Its span is dropped, since the source
// holds no comment there (CARVE-P12-022), and every span that ended where the stand-in ended,
// its own containers and their side tables alike, ends at the authored `+` (CARVE-P12-020).
function dropStandInPositions(doc: Document, plusEnd: (line: number) => { offset: number; column: number }): WeakSet<object> {
  const ends = new Map<string, { line: number; offset: number; column: number }>()
  const spans: Span[] = []
  const remapped = new WeakSet<object>()
  const endOf = (node: { pos?: Span }): Span | undefined => {
    const pos = node.pos
    if (pos === undefined || !unplacedBlocks.has(node)) return pos
    const end = plusEnd(pos.endLine)
    return { endLine: pos.endLine, endColumn: end.column, endOffset: end.offset }
  }
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value === null || typeof value !== 'object') return
    const pos = (value as { pos?: Span }).pos
    if (unplacedBlocks.has(value)) {
      if (pos?.endOffset !== undefined) ends.set(`${pos.endLine}:${pos.endOffset}`, { line: pos.endLine, ...plusEnd(pos.endLine) })
      delete (value as { pos?: Span }).pos
      return
    }
    // A description's recorded span covers its marker line; its children supply the end.
    const item = value as { definitions?: Array<Array<{ pos?: Span }>>; definitionSpans?: Array<Span | undefined> }
    if (Array.isArray(item.definitions)) item.definitions.forEach((children, index) => {
      if (!Array.isArray(children)) return
      const recorded = item.definitionSpans?.[index]
      const last = children.length > 0 ? endOf(children[children.length - 1]!) : undefined
      if (recorded === undefined || last?.endOffset === undefined || !children.some((child) => unplacedBlocks.has(child))) return
      recorded.endLine = last.endLine
      if (last.endColumn !== undefined) recorded.endColumn = last.endColumn
      recorded.endOffset = last.endOffset
    })
    if (typeof (value as Span).endOffset === 'number') spans.push(value as Span)
    if (pos !== undefined) spans.push(pos)
    if (STAND_IN_FREE.has((value as { type?: string }).type ?? '')) return
    for (const [key, child] of Object.entries(value)) if (key !== 'pos') visit(child)
  }
  visit(doc)
  for (const span of spans) {
    const end = ends.get(`${span.endLine}:${span.endOffset}`)
    if (end === undefined) continue
    span.endColumn = end.column
    span.endOffset = end.offset
    remapped.add(span)
  }
  return remapped
}

/** A refused final `+` is not the markup closing a nonempty host (CARVE-P12-014, carve#5246). */
function stopRemappedHostsAtChildren(doc: Document, remapped: WeakSet<object>): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child)
      return
    }
    if (value === null || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) if (key !== 'pos') visit(child)
    const node = value as { type?: string; pos?: Span; children?: Array<{ pos?: Span }>; items?: Array<{ pos?: Span }> }
    if (!node.type || !ENDS_AT_LAST_PLACED_CHILD.has(node.type) || explicitlyClosedQuotes.has(value) ||
        !node.pos || !remapped.has(node.pos)) return
    const children = node.type === 'definition_list'
      ? entriesToWire((node.items ?? []) as DefinitionItem[])
      : node.type === 'list' ? node.items : node.children
    const last = children?.at(-1)?.pos
    if (last?.endOffset === undefined || node.pos.endOffset === undefined || node.pos.endOffset <= last.endOffset) return
    node.pos.endLine = last.endLine
    if (last.endColumn !== undefined) node.pos.endColumn = last.endColumn
    node.pos.endOffset = last.endOffset
  }
  visit(doc)
}

function restoringLetters(blocks: BlockNode[], letters: string[] | null): BlockNode[] {
  if (letters !== null) restoreLetters(blocks, letters)
  return blocks
}

const holdsNothing = (block: BlockNode): boolean => block.type === 'comment' ||
  ((block.type === 'block_quote' || (block.type === 'div' && block.label === undefined)) && block.children.every(holdsNothing))

const commentOnlyParagraph = (paragraph: Paragraph): boolean =>
  paragraph.children.some(child => child.type === 'comment') && paragraph.children.every(child =>
    child.type === 'comment' || child.type === 'soft_break' || child.type === 'hard_break' ||
    child.type === 'text' && /^[ \t\n\r]*$/.test(child.value))

export class ParseSession extends InlineParseSession {
  /**
   * `text` with a trailing comment and its whole separating run removed, for a
   * container's `[label]`.
   *
   * The cut is on the STRING because the non-HTML targets write the label as the
   * source the author typed, so a label still carrying the comment would leak it
   * into Markdown, plain text and ANSI. WHERE it cuts is the label's own inline
   * run's answer: the run is scanned and the boundary is its top-level comment
   * node's start, so a `%%` that a closed construct scopes is not a marker here
   * either (ruled on markup-carve/carve#2618).
   *
   * Deriving it rather than restating it is the point. A second scan spelling out
   * which constructs are opaque answers differently the day one of them moves, and
   * each miss deletes visible label text - markup-carve/carve-rs#2158 found three
   * in a row that way. An escape or a nested comment needs no rule here: the run
   * has already decided, and only its own trailing comment reaches this.
   */
  private stripTrailingComment(text: string): string {
    // A label with no marker in it cannot have a trailing comment, and most have
    // none - so the run is scanned only where the answer can differ.
    if (!text.includes('%%')) return text
    const nodes = new ParseSession().parseRefLabelInlines(text)
    const last = nodes[nodes.length - 1]
    if (last?.type !== 'comment' || last.block) return text
    const start = last.pos?.startOffset
    if (start === undefined) return text
    const kept = text.slice(0, start).replace(/ +$/, '')
    // An escaped space is no part of the separating run (carve#4274).
    return /(?:^|[^\\])(?:\\\\)*\\$/.test(kept) ? `${kept} ` : kept
  }

  private lineBlockHost: LineBlockHost | undefined
  private tableBlockHost: TableBlockHost | undefined
  captionLineScopes: Set<number>[] = []
  private blockLineSpans = new WeakMap<BlockNode, { start: number; end: number; startColumn: number }>()
  private authoredBlankPrefixes = new WeakMap<readonly string[], number[]>()

  blockLineSpan(node: BlockNode): { start: number; end: number; startColumn: number } | undefined {
    return this.blockLineSpans.get(node)
  }

  hasAuthoredBlankBetween(
    lexer: Lexer, beforeLine: number, afterLine: number, opaqueBlankLines?: ReadonlySet<number>,
  ): boolean {
    if (afterLine <= beforeLine + 1) return false
    const lines = lexer.rootLines ?? lexer.lines
    let prefix = this.authoredBlankPrefixes.get(lines)
    if (prefix === undefined) {
      prefix = [0]
      for (const line of lines) {
        const quoteBlank = isQuoteBlankLine(line)
        prefix.push(prefix[prefix.length - 1]! + Number(isBlankLine(line) || quoteBlank))
      }
      this.authoredBlankPrefixes.set(lines, prefix)
    }
    const start = Math.max(0, Math.min(beforeLine, lines.length))
    const end = Math.max(0, Math.min(afterLine - 1, lines.length))
    if (prefix[end]! === prefix[start]!) return false
    if (opaqueBlankLines === undefined || opaqueBlankLines.size === 0) return true
    for (let lineNumber = start + 1; lineNumber <= end; lineNumber++) {
      if (opaqueBlankLines.has(lineNumber)) continue
      const line = lines[lineNumber - 1]!
      if (isBlankLine(line) || isQuoteBlankLine(line)) return true
    }
    return false
  }
  private measuringAttachedBlock = false

  private recordAttachedCaption(lexer: Lexer, index: number): void {
    if (!this.probingLazyParagraph && !this.measuringAttachedBlock) {
      this.captionLineScopes.at(-1)?.add(lexer.lineNumber(index))
    }
  }
  // Cache successful lexical matches; container ownership is checked at each use.
  private linkDefMatches: Map<string, LinkDefMatch> | undefined

  private matchLinkDef(line: string): LinkDefMatch | null {
    if (!line.includes(']:')) return null
    const cached = this.linkDefMatches?.get(line)
    if (cached) return cached
    const matched = matchLinkDef(line)
    if (matched) (this.linkDefMatches ??= new Map()).set(line, matched)
    return matched
  }

  private isLinkDefLine(line: string): boolean {
    return this.matchLinkDef(line) !== null || RE_ABBR_DEF.test(line)
  }

  private markerPrefixMemos = new WeakMap<readonly string[], Map<number, Map<number, number>>>()
  markerFenceMemos = new WeakMap<Map<number, number>, Map<number, { offset: number; column: number; close: RegExp | null }>>()
  markerFenceHolderColumns = new WeakMap<readonly string[], Map<number, number>>()

  // Only literal source suffixes share numeric offsets; reconstructed lines do not.
  markerPrefixMemo(lexer: Lexer, index: number): Map<number, number> | undefined {
    if (!lexer.hasDocumentOffsets || !lexer.prefixMemoAllowed(index)) return undefined
    const root = lexer.rootLines ?? lexer.lines
    let lines = this.markerPrefixMemos.get(root)
    if (!lines) this.markerPrefixMemos.set(root, lines = new Map())
    const line = lexer.lineNumber(index)
    let memo = lines.get(line)
    if (!memo) lines.set(line, memo = new Map())
    return memo
  }

  // A definition pre-pass probe parses a source fragment through the block layer.
  // Matchers remain active during that parse, but its own definition scan must not
  // start another probe (a matcher may recursively call ctx.parseBlocks too).
  private probingLazyParagraph = false
  // Set on the line-ownership probe only: a paragraph's inlines never decide
  // which lines a block consumes, so the probe leaves them unscanned.
  private skipParagraphInlines = false
  private skipPositionDrop = false
  private lineLocalRestore = true
  private skippedAbbreviationLines = new Set<number>()
  private skippedCommentFences = new Map<number, { closer: number; content: string }>()
  /** Document lines whose consumed `+` the ownership walk wrote as a `%%` stand-in. */
  private consumedMarkerLines = new Set<number>()
  private quoteSiblingSeparators = new Set<number>()
  private walkLazyLines = new Set<number>()

  isQuoteSiblingSeparator(line: number): boolean {
    return this.quoteSiblingSeparators.has(line)
  }

  /** Whether the ownership walk folded this document line lazily (PART 0 S4). */
  isWalkLazyLine(line: number): boolean {
    return this.walkLazyLines.has(line)
  }

  private parseWithAuthoredRestore(source: string, opts: ParseOptions, transparent: boolean,
    precomputedOwnership?: ReturnType<typeof ownLines>): Document {
    const session = new ParseSession()
    session.lineLocalRestore = false
    session.skipPositionDrop = this.skipPositionDrop
    return session.parse(source, opts, transparent, precomputedOwnership)
  }

  parse(source: string, opts: ParseOptions = {}, transparent = true,
    precomputedOwnership?: ReturnType<typeof ownLines>): Document {
    const callerSource = source
    const callerOpts = opts
    const sourceByteLength = utf8ByteLength(source)
    const dropRequested = opts.positions === false
    this.recordPositions = opts.positions !== false
    this.blockLineSpans = new WeakMap()
    this.authoredBlankPrefixes = new WeakMap()
    this.newlineIndexCache.clear()
    this.markerPrefixMemos = new WeakMap()
    this.markerFenceMemos = new WeakMap()
    this.markerFenceHolderColumns = new WeakMap()
    this.activeQuoteCharacters = opts.extensions
      ?.map((extension) => extension.quoteCharacters)
      .filter((quotes): quotes is readonly [string, string, string, string] => quotes !== undefined)
      .at(-1) ?? this.activeQuoteCharacters
    this.quoteGlyphHasNul = this.activeQuoteCharacters.some((glyph) => glyph.includes('\0'))
    // Strip a single leading UTF-8 BOM (U+FEFF) at the DOCUMENT start so `﻿# T`
    // is a heading, not literal text. Only here in the root entry -- nested
    // sub-lexers (blockquote/admonition/extension bodies) keep a leading BOM
    // literal (`> ﻿# T` stays a quoted paragraph), matching carve-php / carve-rs.
    const authoredSource = source
    const strippedBom = source.charCodeAt(0) === 0xfeff
    if (strippedBom) source = source.slice(1)
    // Replace any NUL (U+0000) with the U+FFFD replacement character so a control
    // byte never reaches output (decided cross-impl behavior; WHATWG-style).
    if (source.includes('\0')) source = source.replace(/\0/g, '�')
    // A lone surrogate becomes U+FFFD too, so output is always well-formed
    // (CARVE-P0-023).
    source = replaceLoneSurrogates(source)
    const transparentLines = transparent ? transparentLineStream(source) : null
    // Restoration needs source positions even when the public AST omits them.
    // Parse once with positions, then remove them at the return boundary.
    if (transparentLines && dropRequested) {
      opts = { ...opts, positions: true }
      this.recordPositions = true
    }
    const authoredOptions = { ...opts, positions: true }
    delete authoredOptions.onUnclosedContainer
    delete authoredOptions.onUnclosedCodeFence
    delete authoredOptions.onRefusedContinuationMarker
    delete authoredOptions.onDroppedComment
    delete authoredOptions.onOverindentedOpener
    delete authoredOptions.onInvalidContainerMetadata
    delete authoredOptions.onDanglingBlockAttributes
    // The restoration pass only harvests core comment and definition nodes.
    // Extension callbacks may have state, so only the visible parse invokes them.
    delete authoredOptions.extensions
    const directComments = transparentLines && authoredSource === source && !source.includes('\r')
      ? directCommentNodes(transparentLines) : null
    // Confirming the line-local reading may need a second visible parse, which would call the caller's hooks twice.
    // Replacing a NUL or a lone surrogate keeps every offset; only a BOM moves them.
    const hooked = !!opts.extensions?.length || Object.values(opts).some((value) => typeof value === 'function')
    const lineNodes = transparentLines && !directComments && !strippedBom && !hooked && this.lineLocalRestore
      ? erasedLineNodes(transparentLines, (text) => new ParseSession().parse(text, authoredOptions, false)) : null
    const authored = transparentLines && !directComments && !lineNodes ? new ParseSession().parse(authoredSource, authoredOptions, false,
      authoredSource === source ? transparentLines.authoredOwnership : undefined) : null
    const erasedAbbreviations = lineNodes?.abbreviations ??
      (transparentLines && authored ? authoredAbbreviations(authored, transparentLines.erased) : [])
    const erasedLines = new Set(transparentLines?.erased)
    const erasedDefinitions = lineNodes?.linkDefinitions ?? (authored?.children ?? []).filter((node): node is LinkReferenceDefinition =>
      node.type === 'link_reference_definition' && !!node.pos && erasedLines.has(node.pos.startLine - 1))
    const originalLexer = transparentLines ? new Lexer(source, opts) : null
    const lexer = new Lexer(
      transparentLines?.lines ?? source,
      opts,
      0,
      opts.onUnclosedContainer || opts.onDanglingBlockAttributes || opts.onInvalidContainerMetadata ? new Set<string>() : undefined,
    )
    if (transparentLines && originalLexer) {
      lexer.authoredLineOffsets = originalLexer.lineOffsets
      lexer.sourceLineMap = transparentLines.sourceLines.map((index) => index + 1)
      lexer.sourceOffsetMap = transparentLines.sourceLines.map((index) => originalLexer.lineOffsets[index]! + (strippedBom ? 1 : 0))
      if (strippedBom) lexer.linePrefixWidths = transparentLines.sourceLines.map((index) => index === 0 ? 1 : 0)
      const erased = new Set(transparentLines.erased)
      let previousVisible = ''
      lexer.rootLines = transparentLines.original.map((line, index) => {
        if (erased.has(index)) return previousVisible
        previousVisible = line
        return line
      })
      lexer.documentLineCount = originalLexer.documentLineCount
      lexer.documentLacksFinalBreak = originalLexer.documentLacksFinalBreak
    }
    // POSITIONS STILL INDEX THE FILE, not the stripped text. Slicing the mark off
    // shifted every offset in the document by one codepoint, so a consumer that
    // sliced the original bytes by a reported span got the character before the
    // one the node holds - `text` at 2..3 was the space, where the node said `T`
    // (carve#876). All three engines did this the same way.
    //
    // `sourceOffsetMap` is the mechanism a container sub-lexer already uses to
    // map its stripped view back to the document; the BOM is the same problem
    // with a fixed width of one, so it reuses it rather than adding a second
    // spelling. `linePrefixWidths` moves with it: the mark occupies the first
    // column of the first line, so the content of that line starts at column 2.
    if (strippedBom && !transparentLines) {
      lexer.sourceOffsetMap = lexer.lineOffsets.map((offset) => offset + 1)
      lexer.linePrefixWidths = lexer.lineOffsets.map((_offset, index) => (index === 0 ? 1 : 0))
    }
    lexer.atDocumentLevel = true
    // Consume leading frontmatter first so `lexer.pos` marks the end of the
    // metadata region; the def passes and parseBlocks all start from there.
    if (!transparentLines || transparentLines.sourceLines[0] === 0) lexer.consumeFrontmatter()
    const sourceLines = transparentLines?.original ?? lexer.lines
    const ownership = precomputedOwnership ?? ownLines(lexer.lines as string[], lexer.pos)
    lexer.applyOwnership(ownership)
    if (transparentLines && lexer.rootLines) {
      // Without the erased lines the root has no `rootLines` and containers read the
      // walk's lines, so read those here too (carve#5129).
      lexer.authoredRootLines = lexer.rootLines
      const visibleRoot = lexer.rootLines.slice()
      const erased = new Set(transparentLines.erased)
      for (let index = 0; index < transparentLines.sourceLines.length; index++) {
        const originalIndex = transparentLines.sourceLines[index]!
        visibleRoot[originalIndex] = lexer.lines[index] ?? visibleRoot[originalIndex]!
        for (let next = originalIndex + 1; erased.has(next); next++) {
          visibleRoot[next] = visibleRoot[originalIndex]!
        }
      }
      lexer.rootLines = visibleRoot
    }
    this.skippedAbbreviationLines = new Set([...ownership.skippedAbbreviations.keys()]
      .filter((index) => !ownership.separatingAbbreviations.has(index)).map((index) => lexer.lineNumber(index)))
    this.skippedCommentFences = new Map([...ownership.skippedFences].map(([index, { closer, content }]) =>
      [lexer.lineNumber(index), { closer: lexer.lineNumber(closer), content }]))
    this.consumedMarkerLines = new Set([...ownership.consumedMarkers].map((index) => lexer.lineNumber(index)))
    this.quoteSiblingSeparators = new Set([...ownership.quoteSiblingSeparators].map((index) => lexer.lineNumber(index)))
    this.walkLazyLines = new Set([...ownership.lazyLines].map((index) => lexer.lineNumber(index)))
    this.activeDocument = strippedBom ? '﻿' + source : source
    // ACTIVATED BEFORE THE DEFINITION PREPASS, not after. The pass itself calls
    // no matcher, but it now asks whether one is registered: an extension's
    // `matchBlock` may claim any line, and a claimed line reads as prose to a
    // line-shape test. `makeMatcherCtx` captures the definition maps by
    // reference, so building it first sees the same tables the pass fills.
    this.activeMatchers = (opts.extensions ?? []).filter((e) => e.matchInline || e.matchBlock)
    this.activeMatcherCtx = this.activeMatchers.length ? this.makeMatcherCtx(lexer, opts) : null
    // First pass: collect abbreviation and reference-link definitions so
    // they can be resolved regardless of document order (grammar §6).
    this.collectLinkDefs(lexer)
    if (transparentLines) {
      const visibleAbbreviations = new Map<string, number>()
      for (const [index, [name]] of lexer.collectedAbbreviations ?? []) {
        visibleAbbreviations.set(name, transparentLines.sourceLines[index]!)
      }
      for (const definition of erasedAbbreviations) {
        if (definition.pos!.startLine - 1 <= (visibleAbbreviations.get(definition.abbr) ?? -1)) continue
        lexer.abbrDefs.set(definition.abbr, definition.expansion)
      }
    }
    if (transparentLines) {
      for (const node of erasedDefinitions) {
        const key = normalizeRefLabel(node.label)
        if (lineNodes?.contested.has(key)) continue
        const current = lexer.linkDefs.get(key)
        const currentLine = current?.line === undefined ? -1 : transparentLines.sourceLines[current.line]!
        if (currentLine >= node.pos!.startLine - 1) continue
        lexer.linkDefs.set(key, {
          rawLabel: node.label, href: node.href,
          ...(node.title === undefined ? {} : { title: node.title }),
          ...(node.attrs === undefined ? {} : { attrs: node.attrs }),
        })
      }
    }
    const children = this.parseBlocks(lexer, 0)
    hoistContainerAbbreviations(lexer)
    insertSkippedAbbreviationDefinitions(children, lexer, sourceLines, strippedBom ? '\ufeff' + source : source)
    appendLinkReferenceDefinitions(children, lexer, strippedBom ? '\ufeff' + source : source)
    const doc: Document = { type: 'document', children }
    if (lexer.frontmatter) doc.frontmatter = lexer.frontmatter
    if (lexer.footnoteDefs.size) doc.footnoteDefs = Object.fromEntries(lexer.footnoteDefs)
    if (lexer.footnoteDefPos.size) doc.footnoteDefPos = Object.fromEntries(lexer.footnoteDefPos)
    recordLosingFootnoteLines(doc, lexer.losingFootnoteLines)
    if (ownership.letters !== null) restoreLetters(doc, ownership.letters)
    if (this.consumedMarkerLines.size > 0) {
      const bom = strippedBom ? 1 : 0
      const remapped = dropStandInPositions(doc, (line) => {
        const plus = sourceLines[line - 1]!.lastIndexOf('+')
        // `line` numbers the source, not the stream with erased lines removed.
        return { offset: (originalLexer ?? lexer).lineOffsets[line - 1]! + bom + plus + 1, column: (line === 1 ? bom : 0) + plus + 2 }
      })
      dropStandIns(doc)
      stopRemappedHostsAtChildren(doc, remapped)
    }
    // Record the source byte length so renderers can size the
    // abbreviation-expansion budget (DoS guard); see render-html/markdown/ansi.
    doc.srcByteLength = sourceByteLength
    if (opts.positions === false && !transparentLines) {
      return this.skipPositionDrop ? doc : dropPositions(doc)
    }
    toCodepointPositions(doc, strippedBom ? '\ufeff' + source : source)
    anchorListsAtOwnerColumns(doc, strippedBom ? '\ufeff' + source : source)
    if (lineNodes && !erasedLinesStandAlone(doc, transparentLines!, lineNodes)) {
      return this.parseWithAuthoredRestore(callerSource, callerOpts, transparent, precomputedOwnership)
    }
    if (transparentLines) {
      if (!restoreErasedDefinitions(doc, erasedDefinitions, lexer.linkDefs, lineNodes, sourceLines)) {
        return this.parseWithAuthoredRestore(callerSource, callerOpts, transparent, precomputedOwnership)
      }
      restoreTransparentComments(doc, authored, transparentLines, directComments ?? lineNodes?.comments)
      restoreTransparentAbbreviations(doc, erasedAbbreviations, transparentLines)
    }
    if (dropRequested) {
      return this.skipPositionDrop ? doc : dropPositions(doc)
    }
    return doc
  }

  // The MatcherContext handed to an extension's matchers, bound to a specific
  // lexer's definition tables. Recursive parsing resolves that lexer's defs so
  // extension-parsed content behaves like core nested content, not an isolated
  // snippet.
  private makeMatcherCtx(lexer: Lexer, opts: ParseOptions): MatcherContext {
    const session = this
    return {
      get inLinkLabel() { return session.linkLabelDepth > 0 },
      parseInlines: (t) => this.withMatcherRequest(() => this.parseInline(t, lexer.abbrDefs, lexer.linkDefs)),
      parseBlocks: (s) => this.withMatcherRequest(() => {
        const outerScopes = this.captionLineScopes
        this.captionLineScopes = []
        try {
          return this.parseBlockSource(s, opts, lexer)
        } finally {
          this.captionLineScopes = outerScopes
        }
      }),
      linkDefs: lexer.linkDefs,
      abbrDefs: lexer.abbrDefs,
    }
  }

  private withMatcherRequest<T>(parse: () => T): T {
    const previous = this.inMatcherRequest
    this.inMatcherRequest = true
    try {
      return parse()
    } finally {
      this.inMatcherRequest = previous
    }
  }

  // Recursively parse a block source for an extension's ctx.parseBlocks. Reuses
  // the current activeMatchers (so nested content sees the same extensions)
  // without re-entering parse() — which would reset the matcher context. The
  // document's link/abbr defs are seeded first so references defined elsewhere
  // resolve inside the snippet (snippet-local defs override on top), and the
  // root footnote map is SHARED by reference — exactly as core nested containers
  // (blockquotes/lists) do — so a footnote def inside extension-owned content
  // reaches the document. While parsing, the matcher context is rebound to the
  // sub-lexer so a nested matcher reading ctx.linkDefs/abbrDefs sees the
  // snippet-local definitions.
  private parseBlockSource(source: string, opts: ParseOptions, root: Lexer): BlockNode[] {
    const sourceLines = normalizedSourceLines(source)
    const anchor = root.pos + 1
    const sourceLineMap =
      sourceLines.length > 0 &&
      sourceLines.every((line, i) => (root.authoredLines?.[anchor + i] ?? root.lineAt(anchor + i)) === line)
        ? sourceLines.map((_line, i) => root.lineNumber(anchor + i))
        : undefined
    const sub = subLexer(
      source,
      opts,
      root.lineNumberOffset + anchor,
      sourceLineMap,
      root.unclosedContainerKeys,
    )
    if (!sourceLineMap) sub.suppressPositions = true
    // Propagate nesting depth so MAX_NESTING_DEPTH still bounds extension-owned
    // recursion (a self-recursive container matcher would otherwise stack-overflow).
    sub.depth = root.depth + 1
    sub.nested = true
    for (const [k, v] of root.linkDefs) sub.linkDefs.set(k, v)
    for (const [k, v] of root.abbrDefs) sub.abbrDefs.set(k, v)
    sub.footnoteDefs = root.footnoteDefs
    sub.footnoteKeys = root.footnoteKeys
    sub.footnoteDefPos = root.footnoteDefPos
    const ownership = ownLines(sub.lines as string[], 0)
    sub.applyOwnership(ownership)
    for (const index of ownership.consumedMarkers) this.consumedMarkerLines.add(sub.lineNumber(index))
    for (const index of ownership.quoteSiblingSeparators) this.quoteSiblingSeparators.add(sub.lineNumber(index))
    for (const index of ownership.lazyLines) this.walkLazyLines.add(sub.lineNumber(index))
    this.collectLinkDefs(sub)
    if (!this.activeMatchers.length) return restoringLetters(this.parseBlocks(sub, 0), ownership.letters)
    const prevCtx = this.activeMatcherCtx
    this.activeMatcherCtx = this.makeMatcherCtx(sub, opts)
    try {
      return restoringLetters(this.parseBlocks(sub, 0), ownership.letters)
    } finally {
      this.activeMatcherCtx = prevCtx
    }
  }

  // Offer the active block matchers the line at the lexer cursor, in registration
  // order. On a match, advance the lexer by linesConsumed and return the node.
  // Core block constructs are dispatched first (see parseBlockInner), so an
  // extension only sees lines core declined.
  private tryBlockMatchers(lexer: Lexer): BlockNode | null {
    const ctx = this.activeMatcherCtx
    if (!ctx) return null
    for (const ext of this.activeMatchers) {
      if (!ext.matchBlock) continue
      const res = ext.matchBlock(lexer.authoredLines ?? lexer.lines, lexer.pos, ctx)
      if (res && res.linesConsumed > 0) {
        for (let k = 0; k < res.linesConsumed && !lexer.eof(); k++) lexer.consume()
        return res.node
      }
    }
    return null
  }

  /**
   * Does the block layer fold `candidate` into a paragraph that was already open?
   *
   * THE PROBE IS ALLOWED TO RUN MATCHERS. Grammar PART 9R R1a makes a matcher a
   * pure predicate precisely so a processor may invoke one speculatively, more
   * than once at a position, and discard the result - which core parsing already
   * does when a matcher reports a consumption the parser rejects. Without running
   * them the pre-pass cannot know an extension consumed the line above, and would
   * suppress a definition that is real metadata.
   *
   * WHAT IT HANDS THE MATCHER IS A FRAGMENT, NOT THE DOCUMENT: the run back to
   * the last blank line, rebased to index 0. A matcher keyed on its absolute
   * `start`, or one that reads lines above that blank, therefore sees a different
   * question than it will during the real parse and can answer it differently.
   * Preserving the coordinates means parsing from the top of the document per
   * candidate, which is the quadratic shape the byte budget exists to prevent, and
   * carve-rs and carve-php probe the same fragment - so the limitation is shared
   * rather than an engine quirk (markup-carve/carve#1437).
   */
  private lineFoldsIntoOpenParagraph(
    lexer: Lexer,
    candidate: number,
    budget: number,
  ): boolean | 'unknown' {
    // `'unknown'` means THE PROBE DID NOT RUN, not "it does not fold". PART 9R
    // R1a lets the bound stay but forbids spending it as an answer, so the caller
    // reaches the answer statically instead (markup-carve/carve#1895).
    if (this.probingLazyParagraph) return 'unknown'
    const priced = lazyProbeCost(lexer, candidate)
    if (!priced || priced.cost > budget) return 'unknown'
    const before = lexer.lines.slice(priced.start, candidate).join('\n')
    const after = `${before}\n${lexer.lineAt(candidate)!}`
    const probe = (source: string): LazyProbeFrame => {
      const { onUnclosedContainer: _ignored, onInvalidContainerMetadata: _invalidIgnored, ...callerOptions } = lexer.parseOptions
      const options: ParseOptions = { ...callerOptions, positions: false }
      const sub = new Lexer(source, options)
      sub.atDocumentLevel = true
      sub.suppressPositions = true
      const previousCtx = this.activeMatcherCtx
      this.activeMatcherCtx = this.activeMatchers.length ? this.makeMatcherCtx(sub, options) : null
      try {
        this.collectLinkDefs(sub)
        return lazyProbeFrame(this.parseBlocks(sub, 0))
      } finally {
        this.activeMatcherCtx = previousCtx
      }
    }
    this.probingLazyParagraph = true
    try {
      const a = probe(before)
      const b = probe(after)
      return b.endsInParagraph && a.levels.join('\0') === b.levels.join('\0')
    } finally {
      this.probingLazyParagraph = false
    }
  }

  private verseOwnedLines(lexer: Lexer): boolean[] | undefined {
    if (!lexer.lines.some((line, index) => index >= lexer.pos && line.includes('::: ') && line.trimEnd().endsWith('|')) ||
        !lexer.lines.some((line, index) => index >= lexer.pos && line.includes(']:'))) return undefined
    const owned = Array<boolean>(lexer.lineCount).fill(false)
    const parser = new ParseSession()
    parser.probingLazyParagraph = true
    parser.definitionRegionLines = new Set()
    // Ownership is a set of line numbers; spans and paragraph text are discarded.
    parser.recordPositions = false
    parser.skipParagraphInlines = true
    // Core inline callbacks do not participate in source-line ownership.
    // Explicit matcher context requests still use the complete matcher set.
    parser.activeMatchers = this.activeMatchers
    const probe = new Lexer(lexer.lines, { positions: false })
    probe.pos = lexer.pos
    probe.depth = lexer.depth
    probe.nested = lexer.nested
    probe.hostBody = lexer.hostBody
    probe.hostContentColumn = lexer.hostContentColumn
    probe.hostQuoteDepth = lexer.hostQuoteDepth
    probe.definitionLeadFromItemMarker = lexer.definitionLeadFromItemMarker
    probe.hostTaskMarker = lexer.hostTaskMarker
    probe.nonAuthoredDefinitionStarts = lexer.nonAuthoredDefinitionStarts
    probe.returnedDescriptionOwnerColumns = lexer.returnedDescriptionOwnerColumns
    probe.atDocumentLevel = lexer.atDocumentLevel
    probe.inFootnoteBody = lexer.inFootnoteBody
    parser.activeMatcherCtx = parser.activeMatchers.length ? parser.makeMatcherCtx(probe, {}) : null
    parser.parseBlocks(probe, 0)
    for (const line of parser.definitionRegionLines) {
      if (line > 0 && line <= owned.length) owned[line - 1] = true
    }
    return owned
  }

  private collectLinkDefs(lexer: Lexer) {
    const parseSession = this
    return collectLinkDefsWithHelpers({
      get definitionRegionLines() { return parseSession.definitionRegionLines },
      get activeMatchers() { return parseSession.activeMatchers },
      get probingLazyParagraph() { return parseSession.probingLazyParagraph },
      verseOwnedLines: this.verseOwnedLines.bind(this),
      isLinkDefLine: this.isLinkDefLine.bind(this),
      matchLinkDef: this.matchLinkDef.bind(this),
      lineFoldsIntoOpenParagraph: this.lineFoldsIntoOpenParagraph.bind(this),
    }, lexer)
  }

  parseBlocks(lexer: Lexer, baseIndent: number, carry?: PendingAttrCarry): BlockNode[] {
    const out: BlockNode[] = []
    const listMarkerColumns = new Set<number>()
    // Leading block-attribute lines (grammar PART 9 §15) accumulate here
    // and attach to the next block. They float across blank lines; a
    // dangling run with no following block is dropped -- unless a `carry` says
    // this stream is only HALF of one the caller split, in which case the run
    // travels to the other half instead of dying at the seam.
    let pending: Attrs | null = carry?.attrs ?? null
    // Where the OLDEST line of the current pending run sits, so A4 can say which
    // `{...}` died rather than only that one did. Null whenever `pending` is.
    let pendingAt: number | null = null
    while (!lexer.eof()) {
      const line = lexer.peek()!
      if (lexer.rootLines === undefined && lexer.consumedContinuationLines.has(lexer.lineNumber(lexer.pos))) {
        lexer.consume()
        continue
      }
      if (isBlankLine(line)) {
        // Blank lines do NOT reset pending block attributes (§15 reach).
        lexer.consume()
        continue
      }
      // Stop at lower indent (caller's responsibility to detect this)
      const indent = leadingWhitespace(line)
      if (indent < baseIndent) break

      const attrLineIndex = lexer.pos
      const ba = tryCollectBlockAttributes(lexer)
      if (ba) {
        pending = pending ? accumulateAttrs(pending, ba) : ba
        if (pendingAt === null) pendingAt = attrLineIndex
        continue
      }

      const startLine = lexer.pos
      let node = this.parseBlockInner(lexer)
      if (node) attachBlockPos(lexer, node, startLine, lexer.pos)
      // A2a AN INVISIBLE CONSTRUCT IS NOT THE NEXT BLOCK (§15, carve#529):
      // `pending` floats PAST anything that renders nothing and attaches to the
      // next VISIBLE block, so
      //
      //     {#i}
      //     [^f]: note
      //
      //     e
      //
      // is `<p id="i">e</p>`. The attribute is the author's instruction about a
      // rendered element; attaching it to a construct that emits nothing silently
      // discards it, and A4 reserves discarding for the one case where there is
      // genuinely nothing left -- end of document.
      //
      // Five kinds are invisible. A reference definition and a footnote
      // definition leave NO node (the first pass collected them), so the null
      // return is what identifies them; an abbreviation definition and the two
      // comment forms leave a node that renders nothing.
      const invisible =
        node === null || node.type === 'abbreviation_def' || node.type === 'comment'
      if (node) {
        if (pending && !invisible) {
          // Leading attrs are earlier in source; the block's own trailing
          // attrs win on conflict (id/key last), classes accumulate (§15).
          const own = node.attrs
          node.attrs = mergeAttrs(pending, node.attrs ?? {})
          if (node.type === 'image') recordPromotedImageBlockRun(node, pending, own)
        }
        const candidate = node.type === 'code_block' ? node
          : node.type === 'figure' && node.target.type === 'code_block' ? node.target : undefined
        if (candidate && node.attrs?.keyValues?.table === '') {
          const table = delimitedTable(candidate, node.attrs)
          if (table) {
            if (node.type === 'figure') {
              table.caption = node.caption
              if (node.pos) table.pos = node.pos
            }
            node = table
          }
        }
        if (node.type === 'table') deriveTableMetadata(node)
        consumeLooseKey(node)
        // A code fence's opener "header" becomes the `title` attribute on the
        // <pre>. Resolved here (after the pending merge) so a preceding
        // {title=...} line wins, and so the title lives on the node attrs --
        // rendered by every code-block path, including inside a code-group or a
        // caption figure (where parseFence returns a Figure wrapping the block).
        const cb =
          node.type === 'code_block'
            ? node
            : node.type === 'figure' && node.target.type === 'code_block'
              ? (node.target as CodeBlock)
              : undefined
        // An explicit {title=} wins: for a captioned block it merged onto the
        // wrapping Figure (node.attrs), otherwise onto the block itself.
        if (
          cb?.header !== undefined &&
          node.attrs?.keyValues?.title === undefined &&
          cb.attrs?.keyValues?.title === undefined
        ) {
          cb.attrs = {
            ...(cb.attrs ?? {}),
            keyValues: { ...(cb.attrs?.keyValues ?? {}), title: cb.header },
          }
        }
        out.push(node)
        this.blockLineSpans.set(node, {
          start: lexer.lineNumber(startLine),
          end: lexer.lineNumber(Math.max(startLine, lexer.pos - 1)),
          startColumn: lexer.lineStartColumn(startLine),
        })
        if (node.type === 'list') listMarkerColumns.add(indentColumns(line))
      }
      // A VISIBLE block absorbs any pending attrs; an invisible one leaves them
      // pending for the next block (A2a, above).
      if (!invisible) {
        pending = null
        pendingAt = null
      }
    }
    // A dangling pending run (no following block) is dropped -- or, when the
    // caller split one stream in two, handed on to the next half.
    if (carry && !carry.last) carry.attrs = pending
    // Nothing is emitted for a run that died here, so this is the only place the
    // fact exists. A half that hands its run on is excluded: there the run lives
    // on in the next half, and reporting it at the seam would name a loss that
    // is not happening (carve-js#2240). The `last` half is the stream's end.
    // Two conditions, and both are load-bearing. `hostBodyRoot` rather than
    // `hostBody` because the latter is propagated, so a `::: note` inside a
    // description body would claim to BE that body; `out.length === 0` because a
    // run below real content is not the whole body either (carve-js#2408).
    else if (pending && pendingAt !== null) {
      lexer.reportDanglingBlockAttributes(
        pendingAt,
        out.length === 0 ? (lexer.hostBodyRoot ?? undefined) : undefined,
      )
    }
    return out
  }

  /** Parse the blank and comment lines before `end`; comments render nothing, so only their nodes are kept. */
  parseInvisibleRun(lexer: Lexer, end: number): BlockNode[] {
    const out: BlockNode[] = []
    while (lexer.pos < end) {
      if (isBlankLine(lexer.peek()!)) {
        lexer.consume()
        continue
      }
      const startLine = lexer.pos
      const node = this.parseBlockInner(lexer)
      if (node) {
        attachBlockPos(lexer, node, startLine, lexer.pos)
        out.push(node)
      }
    }
    return out
  }

  private dropsCommentOnlyParagraph(lexer: Lexer, paragraph: Paragraph): boolean {
    if (!commentOnlyParagraph(paragraph)) return false
    for (const child of paragraph.children) if (child.type === 'comment') lexer.parseOptions.onDroppedComment?.(child)
    return true
  }

  private parseBlockInner(lexer: Lexer): BlockNode | null {
    const line = lexer.peek()!
    const hostedLinkDef =
      lexer.consumesHostedLinkDefs === 'all' ||
      (lexer.consumesHostedLinkDefs === 'lazy' &&
        lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos)))
    const hostedLinkDefLine = hostedLinkDef ? stripLazyFrame(line) : line

    // Past the nesting limit, stop opening recursive containers and treat the
    // line as paragraph text. Prevents a call-stack overflow on pathologically
    // nested input (e.g. thousands of `> `); see MAX_NESTING_DEPTH.
    if (lexer.depth >= MAX_NESTING_DEPTH) {
      const paragraph = this.parseParagraph(lexer, true)
      return this.dropsCommentOnlyParagraph(lexer, paragraph) ? null : paragraph
    }

    // Block-level constructs in priority order
    if (RE_RAW_FENCE.test(line)) return parseRawBlock(lexer)
    if (RE_FENCE.test(line)) return this.parseFence(lexer)
    // Comments (not rendered). Block (`%%%`) before line (`%%`). A `%%%` opener
    // with NO matching closer ahead does not open a block (PART 9 §28) — it falls
    // through to the line-comment rule below, so the following blocks still
    // render instead of being swallowed to EOF.
    const commentFence = RE_COMMENT_BLOCK_ANY.exec(line)
    if (commentFence && commentBlockHasCloser(lexer, commentFence[1]!.length)) {
      return parseCommentBlock(lexer)
    }
    if (RE_COMMENT_LINE.test(line)) {
      const l = lexer.consume()
      // The stand-in for an abbreviation definition a `+` skipped; the document holds its node.
      if (l === '%%' && this.skippedAbbreviationLines.has(lexer.lineNumber(lexer.pos - 1))) return null
      // A consumed `+`'s `%%` stand-in; dropStandIns removes it once spans are derived.
      if (l.trimStart() === '%%' && this.consumedMarkerLines.has(lexer.lineNumber(lexer.pos - 1))) {
        const standIn: Comment = { type: 'comment', block: false, content: '' }
        const root = lexer.documentRoot ?? lexer
        const authoredLine = (root.authoredRootLines ?? root.rootLines ?? root.authoredLines ?? root.lines)[lexer.lineNumber(lexer.pos - 1) - 1]
        if (authoredLine?.trimEnd().endsWith('+') && !authoredLine.includes('%%')) {
          standIn.transparentSource = authoredLine
          standIn.transparentOriginalValue = ''
        }
        unplacedBlocks.add(standIn)
        return standIn
      }
      // A comment fence a `+` skipped, whose lines read as `%%` stand-ins.
      const fence = l === '%%' ? this.skippedCommentFences.get(lexer.lineNumber(lexer.pos - 1)) : undefined
      if (fence !== undefined) {
        while (lexer.lineNumber(lexer.pos - 1) < fence.closer) lexer.consume()
        return { type: 'comment', block: true, content: fence.content }
      }
      // ONE separator character, and it is `whitespace` - a space or a tab
      // (markup-carve/carve#977, PART 7). This read `/^\s/`, the host language's
      // class, so a `%%<VT>note` line had its vertical tab eaten as the
      // separator and `carve fmt` wrote a SPACE back in its place: a character
      // the clause calls content, replaced by one the author did not write.
      const comment: Comment = { type: 'comment', block: false, content: commentLineContent(l) }
      const root = lexer.documentRoot ?? lexer
      const authoredLine = (root.authoredRootLines ?? root.rootLines ?? root.authoredLines ?? root.lines)[lexer.lineNumber(lexer.pos - 1) - 1]
      // A refused or consumed `+` is represented internally by a `%%` line.
      // After #5012, writing that stand-in changes layout, so retain its
      // authored spelling for the source writer.
      if (l === '%%' && authoredLine?.trimEnd().endsWith('+') && !authoredLine.includes('%%')) {
        comment.transparentSource = authoredLine
        comment.transparentOriginalValue = ''
      }
      return comment
    }
    if (RE_LINE_BLOCK_OPEN.test(line)) return this.parseLineBlock(lexer)
    if (RE_HARDBREAKS_OPEN.test(line)) return this.parseHardBreaksBlock(lexer)
    if (RE_QUOTE_BLOCK_OPEN.test(line)) return this.parseQuoteBlock(lexer)
    // A typed `::: word` admonition opens immediately; if no exact closer appears
    // ahead, it auto-closes at EOF.
    if (RE_ADMONITION_OPEN.test(line) && !RE_ADMONITION_CLOSE.test(line))
      return this.parseAdmonition(lexer)
    // Bare `:::` or attributes-only `::: {…}` opens a generic div (the
    // admonition branch above already claimed the `::: word` form).
    if (RE_DIV_OPEN.test(line)) return this.parseDiv(lexer)
    // PART 12 §7: only at document level. In a container the line falls through
    // to the paragraph branch and is preserved as the text the author typed.
    if (lexer.atDocumentLevel && RE_ABBR_DEF.test(line)) {
      return parseAbbrDef(lexer)
    }
    // Footnote definition: consume the def line + indented continuation
    // and stash the parsed body (tested before RE_LINK_DEF).
    if (RE_FOOTNOTE_DEF.test(line)) return this.parseFootnoteDef(lexer)
    // A NESTED footnote def, indented past a consuming container's own content
    // column, is registered on the host's behalf exactly as a link def is
    // (markup-carve/carve-js#1638). The flush test above misses it - the marker
    // sits past column 0 - but a container that consumes hosted definitions
    // consumes an indented footnote def the same way; parseFootnoteDef strips the
    // marker's indent. Footnote-shaped, so it is NOT caught by the link-def arm
    // below, which excludes `[^`.
    if (
      !line.startsWith(LAZY_FRAME) &&
      (!lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos)) ||
        lexer.hostedFootnoteLines.has(lexer.lineNumber(lexer.pos))) &&
      (lexer.inFootnoteBody || hostedLinkDef ||
        (lexer.consumesHostedLinkDefs !== 'lazy' &&
          (lexer.hostBody === 'list' || lexer.hostBody === 'description'))) &&
      RE_FOOTNOTE_DEF.test(hostedLinkDefLine.replace(/^[ \t]+/, ''))
    ) {
      return this.parseFootnoteDef(lexer)
    }
    // Reference-link definitions were collected in the first pass; the
    // line itself produces no block (consume it so it is not a paragraph).
    // Strict column-0 rule: RE_LINK_DEF is whitespace-tolerant (its leading
    // `[^\S ]*` matches spaces/tabs so a quoted/nested def is still
    // recognized in other passes), but a def is a block opener and opens ONLY at
    // its container's content column (column 0 here). An INDENTED `[x]: …` line is
    // literal paragraph text -- and, since RE_LINK_DEF also matches `[^fn]: …`, an
    // indented footnote def (missed by the flush-anchored RE_FOOTNOTE_DEF above)
    // must not be swallowed here either. A footnote body is the exception: its
    // containers absorb residual indentation at or past their content column.
    if (
      (!line.startsWith(LAZY_FRAME) || lexer.hostBody === 'list') &&
      (leadingWhitespace(hostedLinkDefLine) === 0 ||
        // A FOOTNOTE DEF IS NOT A LINK DEF, though `RE_LINK_DEF` matches both.
        // The flush-anchored test above missed an indented one, so without this
        // the note body's leniency swallowed a NESTED footnote definition and its
        // reference dangled (the oracle registers it).
        (lexer.inFootnoteBody && !/^[ \t]*\[\^/.test(hostedLinkDefLine)) ||
        (hostedLinkDef && !/^[ \t]*\[\^/.test(hostedLinkDefLine))) &&
      this.isLinkDefLine(hostedLinkDefLine) &&
      !lexer.literalLazyLinkDefLines.has(lexer.lineNumber(lexer.pos)) &&
      // NOTHING COLLECTED IT, SO NOTHING MAY REMOVE IT. Under-collecting is the
      // error PART 9R R1a licenses; deleting the author's line is the one it
      // rules out, and carve#1883 forbids returning a document missing text the
      // author typed. Falling through leaves the line as the paragraph it looks
      // like (markup-carve/carve-js#1597).
      (!lexer.declinedLinkDefLines.has(lexer.lineNumber(lexer.pos)) || hostedLinkDef)
    ) {
      lexer.consume()
      return null
    }
    // A spaced break keeps its indent, as a list marker line does.
    const rule = line.trimStart()
    if (RE_HR.test(rule)) {
      lexer.consume()
      const node: ThematicBreak = { type: 'thematic_break' }
      if (rule[0] === '*' || rule[0] === '_') node.marker = rule[0]
      return node
    }
    if (RE_HEADING.test(line)) return this.parseHeading(lexer)
    // Definition list starts on a `:: term` line (two colons, not three).
    if (RE_DEFLIST_TERM.test(line) ||
      (lexer.hostBody === 'list' && RE_DEFLIST_TERM.test(line.trimStart()) &&
        sourceColumn((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? line) >= lexer.hostContentColumn))
      return this.parseDefinitionList(lexer)
    if (quotedLineText(line, lexer.lineTerminatorFree(lexer.pos)) !== null) return this.parseBlockQuote(lexer)
    if (
      taskMatch(line, lexer.lineTerminatorFree(lexer.pos)) !== null ||
      unorderedMatch(line, lexer.lineTerminatorFree(lexer.pos)) !== null ||
      orderedMatch(line, lexer.lineTerminatorFree(lexer.pos)) !== null ||
      extractItemAttr(line, lexer.lineTerminatorFree(lexer.pos)) !== null
    )
      return parseListWithHelpers(lexer, this)
    if (isTableRow(line)) return this.parseTable(lexer)
    if (isBlockImageLine(line) && imageIsBlock(lexer)) return this.parseBlockImage(lexer)
    // Extension block matchers run after every core construct, before the
    // paragraph fallback: extensions add syntax, they never hijack core.
    if (this.activeMatchers.length) {
      const matched = this.tryBlockMatchers(lexer)
      if (matched) return matched
    }
    // A line that is nothing but a display-math span (`$$`…``) standalone on its
    // block is a candidate EQUATION; when a caption follows it is numbered like a
    // figure/table/listing (#87). Diverted here, before the paragraph fallback,
    // because parseParagraph would otherwise fold the caption line into the math
    // paragraph.
    if (line.trimStart().startsWith('$$`')) {
      const eq = this.parseEquationBlock(lexer)
      if (eq) return eq
    }
    const paragraph = this.parseParagraph(lexer)
    if (this.dropsCommentOnlyParagraph(lexer, paragraph)) return null
    const host = paragraph.children.filter((child) => child.type !== 'comment')
    if (host.length === 1 && host[0]!.type === 'math' && (host[0] as Math).display) {
      // A span over several lines is the same host as a one-line one (§4, §10 I7).
      let la = 0
      while (isBlankLine(lexer.peek(la))) la++
      const cap = la <= 1 ? RE_CAPTION.exec(lexer.peek(la) ?? '') : null
      if (cap) {
        this.recordAttachedCaption(lexer, lexer.pos + la)
        for (let i = 0; i <= la; i++) lexer.consume()
        return { type: 'figure', target: paragraph, caption: this.parseCaptionInline(lexer, cap[1]!) } as Figure
      }
    }
    if (paragraph.children.length === 1 && paragraph.children[0]!.type === 'image' &&
        isBlankLine(lexer.peek()) && RE_CAPTION.test(lexer.peek(1) ?? '')) {
      const capLine = lexer.peek(1)!
      const cap = RE_CAPTION.exec(capLine)!
      this.recordAttachedCaption(lexer, lexer.pos + 1)
      lexer.consume()
      lexer.consume()
      const image = paragraph.children[0] as Image
      const slotStart = lexer.pos
      const figure = { type: 'figure', target: image, caption: this.parseCaptionInline(lexer, cap[1]!) } as Figure
      if (image.ref !== undefined) {
        const slotEnd = lexer.pos
        lexer.pos = slotStart
        const slot = this.parseCaptionInline(lexer, capLine, false)
        lexer.pos = slotEnd
        recordUnboundCaption(figure, [image, { type: 'soft_break' }, ...slot])
      }
      return figure
    }
    return paragraph
  }

  // A paragraph so far that is one display-math span, closed or still open. An
  // open span ends at the caret line (§4 names no line count).
  private isDisplayMathHost(lines: string[], lexer: Lexer): boolean {
    const text = lines.map((ln) => ln.replace(/^[ \t]+/, '')).join('\n')
    if (this.isDisplayMathText(text, text, lexer)) return true
    // A comment renders nothing, so it does not keep the span from being the host (PART 9R R7).
    const quiet = withoutCaptionHostComments(text)
    return quiet !== text && this.isDisplayMathText(quiet, text, lexer)
  }

  // `shape` is read for the span's extent; the rendered `text` must still be the span alone.
  private isDisplayMathText(shape: string, text: string, lexer: Lexer): boolean {
    if (!shape.startsWith('$$`')) return false
    let run = 1
    while (shape[2 + run] === '`') run++
    let at = 2 + run
    for (;;) {
      at = shape.indexOf('`', at)
      if (at < 0) return true
      let end = at
      while (shape[end] === '`') end++
      if (end - at === run) break
      at = end
    }
    const only = this.parseInline(dropTrailingWhitespace(text), lexer.abbrDefs, lexer.linkDefs, { baseOffset: 0, startLine: 1, startColumn: 1 })
      .filter((node) => node.type !== 'comment')
    return only.length === 1 && only[0]!.type === 'math' && (only[0] as Math).display === true
  }

  // Parse a standalone display-math line, optionally wrapping it in a figure when
  // a caption follows (a numbered equation). Returns null when the line is not
  // solely display math, or when non-blank prose follows with no blank line (so
  // the line belongs to a normal multi-line paragraph instead).
  private parseEquationBlock(lexer: Lexer): Paragraph | Figure | null {
    // Mirror parseParagraph's leading-whitespace strip + base-position folding so
    // an indented standalone equation is still recognized and the math span keeps
    // its true source offset.
    const lineIndex = lexer.pos
    const raw = lexer.peek()!
    const firstLead = raw.match(/^[ \t]+/)?.[0].length ?? 0
    const inline = this.parseInline(raw.replace(/^[ \t]+/, ''), lexer.abbrDefs, lexer.linkDefs, {
      anchored: lexer.hasDocumentOffsets,
      baseOffset: lexer.lineOffset(lineIndex) + firstLead,
      startLine: lexer.lineNumber(lineIndex),
      startColumn: lexer.lineStartColumn(lineIndex) + firstLead,
    })
    if (inline.length !== 1) return null
    const only = inline[0]!
    if (only.type !== 'math' || !(only as Math).display) return null
    // First non-blank line after the math line, and how many blanks precede it.
    let la = 1
    while (isBlankLine(lexer.peek(la))) la++
    const after = lexer.peek(la)
    const blanks = la - 1
    const cap = after !== undefined ? RE_CAPTION.exec(after) : null
    // A display-math equation line reaches here already dispatched as a block, so
    // it stands at its container's content column by construction.
    const para: Paragraph = { type: 'paragraph', children: inline }
    // §4: a caption attaches across at most one blank line.
    if (cap && blanks <= 1) {
      this.recordAttachedCaption(lexer, lexer.pos + la)
      for (let i = 0; i <= la; i++) lexer.consume()
      // The block loop spans the FIGURE, so the equation paragraph it wraps would
      // otherwise have no position of its own (PART 12 §4). The equation occupies
      // exactly its own line; the figure spans that plus the caption.
      attachBlockPos(lexer, para, lineIndex, lineIndex + 1)
      return {
        type: 'figure',
        target: para,
        caption: this.parseCaptionInline(lexer, cap[1]!),
      } as Figure
    }
    // Non-blank, non-caption text immediately follows: let parseParagraph fold
    // the math and that text into one paragraph (preserve existing behavior).
    if (after !== undefined && blanks === 0) return null
    // Standalone display math with no caption: a plain single-math paragraph.
    lexer.consume()
    return para
  }

  private parseHeading(lexer: Lexer): Heading {
    const lineIndex = lexer.pos
    const line = lexer.consume()
    const m = RE_HEADING.exec(line)!
    const level = m[1]!.length as HeadingLevel

    // SINGLE-LINE HEADINGS (NORMATIVE, diverges from Djot): a heading ENDS AT THE
    // NEWLINE. Nothing folds into it -- not a plain line, not a same-count `#`
    // line -- so the next line begins whatever block it begins, exactly as after
    // any other closed block. Lazy continuation therefore means one thing across
    // the language: it continues an open PARAGRAPH, and a heading is not one.
    let text = line.replace(/^#{1,6} +/, '')
    // NO TRAILING WHITESPACE (PART 2; carve#926). A heading is one line by
    // construction, so the single-line form is the whole rule here.
    text = trimEndSpaceTab(text)

    const node: Heading = { type: 'heading', level, children: [] }
    // djot-strict: a heading takes its attributes on the PRECEDING block-
    // attribute line (§15), not as a trailing `{…}` on its own line. A `{…}`
    // at the end of the heading text is therefore ordinary inline content.
    // Column where the content starts on the first line (the marker + spaces).
    const textColumn = line.length - line.replace(/^#{1,6} +/, '').length + 1
    node.children = this.parseInline(text, lexer.abbrDefs, lexer.linkDefs, {
      anchored: lexer.hasDocumentOffsets,
      baseOffset: lexer.lineOffset(lineIndex) + textColumn - 1,
      startLine: lexer.lineNumber(lineIndex),
      startColumn: lexer.lineStartColumn(lineIndex) + textColumn - 1,
    })
    return node
  }

  private parseFence(lexer: Lexer): CodeBlock | Figure {
    const fenceStartIndex = lexer.pos
    const open = lexer.consume()
    const m = RE_FENCE.exec(open)!
    const marker = m[2]!
    const indent = m[1]!.length
    const lang = m[3] || undefined
    // Header is the quoted group (with or without a language); label is the
    // bracketed group from whichever alternative matched. Strip the delimiters.
    const headerRaw = m[4] ?? m[6]
    const labelRaw = m[5] ?? m[7] ?? m[8]
    const header = headerRaw ? headerRaw.slice(1, -1) : undefined
    const label = labelRaw ? labelRaw.slice(1, -1) : undefined
    const closeRe = fenceCloseRe(marker)
    const lines: string[] = []
    const payloadPositions: { offset: number; line: number; column: number; text: string }[] = []
    let lastPayloadLineIndex = -1
    let closed = false
    while (!lexer.eof()) {
      if (lexer.attachmentBoundaries.has(lexer.lineNumber(lexer.pos))) break
      const ln = lexer.peek()!
      const folded = lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos))
      if (!folded && closeRe.test(ln) && ln.length - ln.trimStart().length <= 3) {
        lexer.consume()
        closed = true
        break
      }
      lastPayloadLineIndex = lexer.pos
      lexer.consume()
      // The frame did its work in the closer test above - it is what keeps a
      // closing run the CONTAINER folded in from closing this block - and a
      // verbatim body is where a framed line becomes text, so it comes off here
      // (markup-carve/carve-js#1630).
      // Below-column payload carries host alignment, not code indentation.
      const body = folded ? stripLazyFrame(ln).replace(/^[ \t]+/, '') : stripLazyFrame(ln)
      // Strip the common indent of the opening fence (Djot rule)
      const payload = body.slice(Math.min(indent, leadingWhitespace(body)))
      lines.push(payload)
      if (lexer.hasDocumentOffsets && ln.endsWith(payload)) {
        const prefixWidth = [...ln.slice(0, ln.length - payload.length)].length
        payloadPositions.push({
          offset: lexer.lineOffset(lastPayloadLineIndex) + prefixWidth,
          line: lexer.lineNumber(lastPayloadLineIndex),
          column: lexer.lineStartColumn(lastPayloadLineIndex) + prefixWidth,
          text: payload,
        })
      }
    }
    if (!closed) lexer.reportUnclosedCodeFence(fenceStartIndex, marker, indent)
    const fenceEndIndex = lexer.pos
    // CARVE-P12-064: `content` is the payload's LITERAL text. Every line carries
    // its own break, so a zero-line payload is `""` whether the fence closed or
    // not, and only a payload whose last line is the document's last - with no
    // break behind it in the source - ends mid-line.
    const terminated =
      !lexer.documentLacksFinalBreak ||
      lastPayloadLineIndex < 0 ||
      lexer.lineNumber(lastPayloadLineIndex) < lexer.documentLineCount
    const cb: CodeBlock = { type: 'code_block', content: codeContent(lines, terminated) }
    if ((lang === 'csv' || lang === 'tsv') && payloadPositions.length === lines.length) {
      setDelimitedPayloadLines(cb, payloadPositions)
    }
    if (lang) cb.lang = lang
    if (header !== undefined) cb.header = header
    if (label !== undefined) cb.label = label
    // Optional caption (`^ …`): a captioned code block is a numbered LISTING,
    // wrapped in a figure exactly like a captioned image/blockquote/table.
    let lookahead = 0
    while (!lexer.eof() && isBlankLine(lexer.peek(lookahead))) lookahead++
    const next = lexer.peek(lookahead)
    if (next) {
      const cap = RE_CAPTION.exec(next)
      // §4: a caption attaches only when it immediately follows the block
      // or is separated by at most ONE blank line.
      if (cap && lookahead <= 1) {
        this.recordAttachedCaption(lexer, lexer.pos + lookahead)
        for (let i = 0; i <= lookahead; i++) lexer.consume()
        // The block loop spans the FIGURE, so the fence it wraps would otherwise
        // have no position of its own (PART 12 §4). It ends where the caption
        // begins - the same treatment the captioned image and blockquote already
        // get.
        attachBlockPos(lexer, cb, fenceStartIndex, fenceEndIndex)
        return {
          type: 'figure',
          target: cb,
          caption: this.parseCaptionInline(lexer, cap[1]!),
        } as Figure
      }
    }
    return cb
  }

  // Footnote definition. The def line's trailing text plus following lines
  // indented by >= 2 spaces (single blank lines allowed between chunks)
  // form the note body, parsed as blocks. First definition for a label
  // wins. Emits no block — the body is stashed on lexer.footnoteDefs and
  // rendered in the endnotes section.
  private parseFootnoteDef(lexer: Lexer): null {
    return parseFootnoteDef(lexer, {
      collectAttachedBlock: this.collectAttachedBlock.bind(this),
      parseBlocks: this.parseBlocks.bind(this),
      isConsumedMarker: (line) => this.consumedMarkerLines.has(line),
    })
  }

  private parseAdmonition(lexer: Lexer): Admonition | Directive | FigureGroup {
    const openLineIndex = lexer.pos
    const open = lexer.consume()
    const m = RE_ADMONITION_OPEN.exec(open)!
    const fence = m[1]!.length
    const kind = m[2]!
    const invalidMetadata = RE_VALID_ADMONITION_OPEN.exec(open) === null
    if (invalidMetadata) {
      const recovered = unclosedContainerFromOpener(lexer, {
        kind: GENERATED_CONTENT_KINDS.has(kind) ? 'directive' : 'admonition',
        lineIndex: openLineIndex,
        fenceWidth: fence,
      })
      recovered.endOffset = recovered.startOffset + open.length
      lexer.reportInvalidContainerMetadata(recovered)
    }
    // PART 9 §4c: a BARE `::: figure` opener - kind only, no quoted title, no
    // `[label]` - is a composite figure group, not an admonition. An opener
    // carrying either piece of metadata does not match the figure production and
    // stays a generic container (the group node has no title/label fields by
    // design). A bare opener inside an OPEN group's body is demoted the same way:
    // groups do not nest, which is what `inFigureGroup` carries through the
    // recursion.
    const isFigureGroup = isFigureGroupOpener(open, lexer.inFigureGroup)
    // The opener carries an optional quoted title only (grammar
    // quoted_title; PART 9 §12). The quotes delimit the title and are
    // stripped (not part of the rendered text); an explicitly empty `""`
    // still counts as a supplied (empty) title. No inline attributes -- the
    // opener regex already rejected any trailing `{...}`.
    const titleText = m[3] !== undefined ? m[3]!.slice(1, -1) : undefined
    // Optional inert grouping `[label]` (PART 9 §12): a group extension (tabs)
    // uses it as the tab name; core does not render it.
    const label = m[4] !== undefined ? this.stripTrailingComment(m[4]!.slice(1, -1)) : undefined
    const inner = collectColonFenceBody(lexer, {
      // Which of the two named-container types this fence opens, so an unclosed
      // one is reported as the thing it was (CARVE-P12-057).
      kind: GENERATED_CONTENT_KINDS.has(kind) ? 'directive' : 'admonition',
      lineIndex: openLineIndex,
      fenceWidth: fence,
    })
    const subLexer = nestedColonLexer(lexer, inner, openLineIndex + 1)
    subLexer.consumesHostedLinkDefs =
      lexer.hostBody === 'description' || lexer.hostBody === 'footnote' ? 'all' : false
    if (isFigureGroup) subLexer.inFigureGroup = true
    const children = this.parseBlocks(subLexer, 0)
    if (isFigureGroup) {
      const group: FigureGroup = { type: 'figure_group', children }
      // The group's CLOSING fence is §4's sixth caption host: a `^ …` line
      // directly after it (or across at most one blank line) attaches as the
      // GROUP caption - the same slot idiom the five parse-time hosts use.
      // A group auto-closed at EOF has no closer line to host the slot, and in
      // that case the lexer is already exhausted, so the lookahead finds nothing.
      let lookahead = 0
      while (!lexer.eof() && isBlankLine(lexer.peek(lookahead))) lookahead++
      const next = lexer.peek(lookahead)
      if (next) {
        const cap = RE_CAPTION.exec(next)
        // §4: a caption attaches only when it immediately follows the block
        // or is separated by at most ONE blank line.
        if (cap && lookahead <= 1) {
          this.recordAttachedCaption(lexer, lexer.pos + lookahead)
          for (let i = 0; i <= lookahead; i++) lexer.consume()
          group.caption = this.parseCaptionInline(lexer, cap[1]!)
        }
      }
      // A preceding block-attribute line is the only way to attribute the group
      // (same as the admonition below); parseBlocks applies it to the returned
      // node.
      return group
    }
    // CARVE-P12-057: a named container whose kind names GENERATED CONTENT is a
    // `directive`, not an `admonition`. The kind list is CLOSED - a seventh
    // generated-looking word (`endnotes`, `contents`) takes the admonition branch
    // below, because the clause rules that "every other named container is an
    // `admonition`".
    //
    // Keep the quoted opener title for either named container type. An explicit
    // empty title still occupies the title slot.
    let title: InlineNode[] | undefined
    if (titleText !== undefined) {
      const titleStart = open.indexOf(m[3]!) + 1
      title = this.parseInline(titleText, lexer.abbrDefs, lexer.linkDefs, {
        anchored: lexer.hasDocumentOffsets && titleStart > 0,
        baseOffset: lexer.lineOffset(openLineIndex) + titleStart,
        startLine: lexer.lineNumber(openLineIndex),
        startColumn: lexer.lineStartColumn(openLineIndex) + titleStart,
      })
    }
    if (GENERATED_CONTENT_KINDS.has(kind)) {
      const directive: Directive = { type: 'directive', kind, children }
      if (title !== undefined) directive.title = title
      if (label !== undefined) directive.label = label
      return directive
    }
    const node: Admonition = { type: 'admonition', kind, children }
    if (title !== undefined) node.title = title
    if (label !== undefined) {
      node.label = label
    }
    // No inline opener attributes (strict djot): a preceding block-attribute
    // line is the only way to attribute an admonition, and parseBlocks
    // applies it to the returned node.
    return node
  }

  private parseLineBlock(lexer: Lexer): LineBlock {
    const session = this
    const host = this.lineBlockHost ??= {
      get definitionRegionLines() { return session.definitionRegionLines },
      get inMatcherRequest() { return session.inMatcherRequest },
      get inLineBlock() { return session.inLineBlock },
      set inLineBlock(value) { session.inLineBlock = value },
      get activeMatchers() { return session.activeMatchers },
      get quoteGlyphHasNul() { return session.quoteGlyphHasNul },
      parseInline: this.parseInline.bind(this),
    }
    return parseLineBlockWithHelpers(host, lexer)
  }

  // `::: \` hard-break block. Unlike the line block, the body is parsed as
  // ordinary blocks (so nested admonitions / lists work); soft breaks are then
  // promoted to hard breaks ONLY in the div's DIRECT paragraph children, and
  // there is no leading-whitespace preservation. Emits `<div class="hardbreaks">`.
  private parseHardBreaksBlock(lexer: Lexer): Div {
    const openLineIndex = lexer.pos
    const m = RE_HARDBREAKS_OPEN.exec(lexer.consume())!
    const fence = m[1]!.length
    const inner = collectColonFenceBody(lexer, {
      kind: 'hard-break block',
      lineIndex: openLineIndex,
      fenceWidth: fence,
    })
    const subLexer = nestedColonLexer(lexer, inner, openLineIndex + 1)
    const children = this.parseBlocks(subLexer, 0)
    for (const child of children) {
      if (child.type === 'paragraph') {
        child.children = child.children.map((node) => {
          if (node.type !== 'soft_break') return node
          // Keep the break's span: it is the same source, just a different
          // meaning inside a hard-breaks block. Building a fresh object dropped
          // it, which is the same slip the line block already fixed (#462).
          const hardBreak = { type: 'hard_break' } as InlineNode
          if (node.pos) hardBreak.pos = node.pos

          return hardBreak
        })
      }
    }
    return {
      type: 'div',
      attrs: { classes: ['hardbreaks'], order: ['.class'] },
      children,
    }
  }

  // Fenced block quote. parseDiv's shape exactly, with no label slot and a
  // block_quote node instead of a div (markup-carve/carve#1718).
  private parseQuoteBlock(lexer: Lexer): BlockQuote | Figure {
    const openLineIndex = lexer.pos
    const m = RE_QUOTE_BLOCK_OPEN.exec(lexer.consume())!
    const fence = m[1]!.length
    const inner = collectColonFenceBody(lexer, {
      kind: 'block quote',
      lineIndex: openLineIndex,
      fenceWidth: fence,
    })
    const subLexer = nestedColonLexer(lexer, inner, openLineIndex + 1)
    const bq: BlockQuote = { type: 'block_quote', fenced: true, children: this.parseBlocks(subLexer, 0) }
    const quoteEndIndex = lexer.pos
    // The collector excludes its own closer from `inner`. At EOF without a
    // closer, the last consumed line is still part of the body.
    if (Array.isArray(inner) ? (inner.at(-1)?.lineIndex ?? openLineIndex) < quoteEndIndex - 1 : inner.closed) {
      explicitlyClosedQuotes.add(bq)
    }
    // §4's seventh caption host. The slot hangs on the CLOSING fence, as the
    // figure group's does, and what it produces is what the PREFIXED spelling
    // produces: a captioned quote is a figure either way, because the two
    // spellings are one node and §4's rule reads the node (carve#1742).
    // A quote auto-closed at end of input has no closer line to host the slot,
    // and there the lexer is already exhausted so the lookahead finds nothing.
    let lookahead = 0
    while (!lexer.eof() && isBlankLine(lexer.peek(lookahead))) lookahead++
    const next = lexer.peek(lookahead)
    if (next) {
      const cap = RE_CAPTION.exec(next)
      // §4: adjacent, or across at most ONE blank line.
      if (cap && lookahead <= 1) {
        this.recordAttachedCaption(lexer, lexer.pos + lookahead)
        for (let i = 0; i <= lookahead; i++) lexer.consume()
        // The TARGET keeps its own span, as every other caption host's does.
        // Wrapping without this left a captioned fenced quote as the one block
        // quote in the vocabulary with no `pos`, which the position rules would
        // report the moment a corpus document reached the shape.
        attachBlockPos(lexer, bq, openLineIndex, quoteEndIndex)
        return { type: 'figure', target: bq, caption: this.parseCaptionInline(lexer, cap[1]!) } as Figure
      }
    }
    return bq
  }


  private parseDiv(lexer: Lexer): Div {
    const openLineIndex = lexer.pos
    const m = RE_DIV_OPEN.exec(lexer.consume())!
    const fence = m[1]!.length
    // Optional inert grouping `[label]` on a typeless div (`::: [First]`).
    const label = m[2] !== undefined ? this.stripTrailingComment(m[2]!.slice(1, -1)) : undefined
    const inner = collectColonFenceBody(lexer, {
      kind: 'div',
      lineIndex: openLineIndex,
      fenceWidth: fence,
    })
    const subLexer = nestedColonLexer(lexer, inner, openLineIndex + 1)
    // No inline opener attributes (strict djot): a bare `:::` carries none;
    // a preceding block-attribute line attaches them in parseBlocks.
    const node: Div = { type: 'div', children: this.parseBlocks(subLexer, 0) }
    if (label !== undefined) {
      node.label = label
    }
    return node
  }

  // Definition list (§4.5). An entry is 1+ `:: term` lines followed by 1+
  // `: definition` lines; a definition continues on lines that REACH its own
  // body's column, which is `:` plus the width of the separator it was written
  // with (`deflistContentCol`). A `:: term` after a definition starts a new
  // entry; a single blank line between entries is allowed, anything else ends the
  // list.
  private parseDefinitionList(lexer: Lexer): DefinitionList {
    return parseDefinitionListWithHelpers({
      collectAttachedBlock: this.collectAttachedBlock.bind(this),
      parseInvisibleRun: this.parseInvisibleRun.bind(this),
      markerPrefixMemo: this.markerPrefixMemo.bind(this),
      parseBlocks: this.parseBlocks.bind(this),
      parseInline: this.parseInline.bind(this),
    }, lexer)
  }

  private openQuoteCollect(lexer: Lexer): QuoteCollect {
    const firstLineIndex = lexer.pos
    const given = firstLineIndex === 0 ? lexer.quoteLazyHint : null
    lexer.quoteLazyHint = null
    const quoteTermLead = /^\s*>[ \t]+::[ \t]+/.test(lexer.lineAt(firstLineIndex) ?? '')
    const quoteRootLine = lexer.rootLines?.[lexer.lineNumber(firstLineIndex) - 1] ?? ''
    const quoteMarkerOffset = quoteRootLine.indexOf('>')
    // A quote opened on a footnote's marker line is reached at the note's body
    // column, two past the marker, not at its own `>` (CARVE-P0-010).
    const noteLead = /^(.*?)\[\^[^\]]+\]:[ \t]+>/.exec(quoteRootLine)
    const quoteMarkerColumn = lexer.hostBodyRoot === 'footnote' && noteLead !== null &&
      noteLead[0].length - 1 === quoteMarkerOffset
      ? noteLead[1]!.length + FOOTNOTE_BODY_COLUMN
      : Math.max(0, quoteMarkerOffset)
    const localQuoteDepth = quotePrefixDepth(lexer.lineAt(firstLineIndex) ?? '')
    const localQuoteOffset = lexer.hasDocumentOffsets ? lexer.rootFrameColumn(firstLineIndex) : -1
    const authoredQuoteColumn = localQuoteOffset >= 0
      ? sourceColumnAt(quoteRootLine, localQuoteOffset)
      : Math.max(quoteMarkerColumn,
        sourceColumn(quoteRootLine, Math.max(0, quotePrefixDepth(quoteRootLine) - localQuoteDepth)))
    // The walk writes a quote nested behind the note's first quote at the body's
    // canonical column, so its `+` line stands there too (carve#4702).
    const noteQuoteColumn = lexer.hostBody === 'footnote' && noteLead !== null
      ? sourceColumnAt(quoteRootLine, noteLead[0].length - 1) : -1
    const physicalQuoteColumn = noteQuoteColumn >= 0 && authoredQuoteColumn > noteQuoteColumn
      ? authoredQuoteColumn - noteQuoteColumn + noteLead![1]!.length + FOOTNOTE_BODY_COLUMN
      : authoredQuoteColumn
    return {
      lexer,
      firstLineIndex,
      inner: [],
      origins: new Map(),
      innerLineNumbers: [],
      state: {
        mode: { kind: 'closed' },
        inTable: false,
        colonWidths: [],
        attrRun: null,
      },
      untracked: [],
      given,
      descent: { levels: 0, askedBelowTop: false },
      handDown: null,
      trackedBefore: false,
      paragraphOpen: undefined,
      quoteTermContinuation: quoteTermLead,
      quoteRootLine,
      quoteMarkerColumn,
      physicalQuoteColumn,
    }
  }

  // A line-block payload run pairs with a later quoted run at any indent;
  // a failed search refutes every later opener of that character and width.
  private quotePayloadCloser(q: QuoteCollect, marker: string, lineIndex: number): boolean {
    const { lexer } = q
    const char = marker[0]!
    const miss = (q.payloadMisses ??= new Map()).get(char)
    if (miss !== undefined && lineIndex >= miss.from && marker.length > miss.maxRun) return false
    const close = fenceCloseRe(marker)
    let maxRun = 0
    for (let i = lineIndex + 1; i < lexer.lineCount; i++) {
      const line = lexer.lineAt(i)!
      if (!/^[ \t]*>/.test(line)) break
      const text = line.replace(/^(?:[ \t]*>)+/, '').replace(/^[ \t]+/, '')
      if (close.test(text)) return true
      const run = /^(`{3,}|~{3,})[ \t]*$/.exec(text)?.[1]
      if (run !== undefined && run[0] === char) maxRun = Math.max(maxRun, run.length)
    }
    q.payloadMisses.set(char, { from: lineIndex, maxRun })
    return false
  }

  private trackQuoteLine(q: QuoteCollect, content: string, lineIndex: number): void {
    const { lexer, state, descent } = q
    q.paragraphOpen = undefined
    withKeptFenceLookahead(lexer, lineIndex, () => trackBlockQuoteLazyState(
      content,
      state,
      (fence) => quotedCommentHasCloser(lexer, fence, lineIndex),
      !lexer.quoteLazyLines.has(lexer.lineNumber(lineIndex)),
      descent,
      this.markerPrefixMemo(lexer, lineIndex),
      !lexer.quoteLazyLines.has(lexer.lineNumber(lineIndex)),
      (fence, depth, floor) => literalCommentHasCloser(lexer, fence, lineIndex, depth, floor),
      marker => this.quotePayloadCloser(q, marker, lineIndex),
    ))
    // Reuse the handed-down state only while lazy text leaves it unchanged.
    if (!descent.preserved && q.handDown && state.mode.kind === 'quote' && state.mode.inner === q.handDown.state) q.handDown = null
  }

  private trackUntrackedQuoteLines(q: QuoteCollect): void {
    const { untracked, given, state, descent } = q
    if (q.trackedBefore) {
      for (const [content, lineIndex] of untracked) this.trackQuoteLine(q, content, lineIndex)
      untracked.length = 0
      return
    }
    q.trackedBefore = true
    const prefix = untracked.length
    let depth: number
    if (given !== null && given.lines === prefix) {
      Object.assign(state, given.state)
      q.paragraphOpen = given.paragraphOpen
      depth = given.depth - 1
    } else {
      // Each line continues the inner quotes the line before it opened, so
      // the chain is one set of states down to the shallowest line's depth.
      depth = Infinity
      for (const [content, lineIndex] of untracked) {
        this.trackQuoteLine(q, content, lineIndex)
        depth = Math.min(depth, descent.levels)
      }
      if (descent.askedBelowTop) depth = 0
    }
    untracked.length = 0
    if (depth >= 1 && state.mode.kind === 'quote') {
      q.handDown = { state: state.mode.inner, lines: prefix, depth }
    }
  }

  // The attached block ends at the next line, so a fence it left open ends there
  // instead of taking the separator as payload (§17 L3). A further `+` writes its
  // own separator and boundary when it attaches.
  private endQuoteAttachment(q: QuoteCollect): void {
    const { lexer } = q
    if (lexer.eof() || /^\+[ \t]*$/.test(lexer.peek()!)) return
    const next = lexer.lineNumber(lexer.pos)
    lexer.attachmentBoundaries.add(next)
    q.inner.push('')
    q.innerLineNumbers.push(next)
  }

  private attachFirstBlockQuote(q: QuoteCollect, ln: string, lineIndex: number, content: string): void {
    const { lexer, inner, innerLineNumbers, origins } = q
    const stackedSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lineIndex) - 1] ?? ln
    const { lines: attached, lineNumbers: attachedLineNumbers } = this.collectAttachedBlock(
      lexer,
      (next) => isBlankLine(next) || /^\+[ \t]*$/.test(next),
      // A follower at a stacked opener's column is read from that column.
      isStackedFirstBlockQuoteMarker(stackedSource) ? indentColumns(lexer.peek() ?? '') : 0,
      true,
      true,
    )
    if (isContinuationMarker(content.trimStart()) && attached.length === 0 &&
        !isContinuationMarker((lexer.peek() ?? '').trimStart())) {
      // A `+` that attaches nothing stays the quote's text.
      if (lexer.lineTerminatorFree(lineIndex)) origins.set(inner.length, { text: content, parentIndex: lineIndex, prefix: ln.length - content.length })
      inner.push(content)
      innerLineNumbers.push(lexer.lineNumber(lineIndex))
    } else if (isContinuationMarker(content.trimStart())) {
      if (attached.length > 0) lexer.attachmentBoundaries.add(attachedLineNumbers[0]!)
      if (attached.length > 0 && inner.length > 0 && !isBlankLine(inner.at(-1)!)) {
        inner.push('')
        innerLineNumbers.push(attachedLineNumbers[0]!)
      }
    } else {
      // A nested quote keeps its `+` line and receives the block raw behind
      // it, so its own parse takes this same branch one level down.
      if (lexer.lineTerminatorFree(lineIndex)) origins.set(inner.length, { text: content, parentIndex: lineIndex, prefix: ln.length - content.length })
      inner.push(content)
      innerLineNumbers.push(lexer.lineNumber(lineIndex))
    }
    // An item may have framed the follower as lazy and clamped its indent; the `+` decides it,
    // so the line is read again from the source at the item's content column.
    const root = lexer.rootLines ?? lexer.lines
    const hostColumn = lexer.hostSourceContentColumn ?? lexer.hostContentColumn
    attached.forEach((attachedLine, index) => {
      const source = root[attachedLineNumbers[index]! - 1]
      inner.push(attachedLine.startsWith(LAZY_FRAME) && hostColumn > 0 && lexer.hostQuoteDepth === 0 &&
        source !== undefined && indentColumns(source) >= hostColumn
        ? sliceColumns(source, hostColumn, true)
        // A later line the item framed as lazy is no follower the `+` decides (PART 0 S4).
        : index > 0 ? attachedLine : stripLazyFrame(attachedLine))
    })
    innerLineNumbers.push(...attachedLineNumbers)
    if (attached.length > 0) this.endQuoteAttachment(q)
    this.trackUntrackedQuoteLines(q)
    closeBlockQuoteParagraph(q.state)
    q.handDown = null
  }

  private takeQuotedLine(q: QuoteCollect, ln: string, content: string): void {
    const { lexer, firstLineIndex } = q
    const lineIndex = lexer.pos
    lexer.consume()
    // The lead term's claim passes to the tracked leaf on the next quoted line.
    if (isBlankLine(content) || lineIndex !== firstLineIndex) q.quoteTermContinuation = false
    // First-block form (`> +`, as `- +` and `:  +`): a lone `+` as the whole
    // first line of a quote, at any depth, is a marker when a flush-left line
    // outside the quote follows, and that line's block is the innermost
    // quote's body. Before a blank, a quoted line or the end it stays text.
    if (lineIndex === firstLineIndex && isContinuationMarker(content.trimStart()) && lexer.peek() !== undefined) {
      this.attachFirstBlockQuote(q, ln, lineIndex, content)
      return
    }
    if (lexer.lineTerminatorFree(lineIndex)) q.origins.set(q.inner.length, { text: content, parentIndex: lineIndex, prefix: ln.length - content.length })
    q.inner.push(content)
    q.untracked.push([content, lineIndex])
    q.innerLineNumbers.push(lexer.lineNumber(lineIndex))
  }

  // Continuation marker (Carve, PART 9 §17): a lone `+` at column 0 after a
  // quoted line attaches the FOLLOWING flush-left block to the quote -- the
  // un-prefixed analogue of the list-item form, so a real block (list, fenced
  // code, table, ...) can join the quote without repeating `>`. Collect the
  // block's lines (up to a blank line or a further `+`) and
  // splice them into the quote body behind a blank-line separator, so they
  // parse as their own block instead of folding into the quoted paragraph.
  private attachesQuotedPlusBlock(q: QuoteCollect, ln: string): boolean {
    const { lexer, physicalQuoteColumn } = q
    const physicalPlus = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? ln
    const quoteMarkerLine = isContinuationMarker(ln.slice(leadingWhitespace(ln)))
    const quotePlusDecision = quoteMarkerLine ? markerDecision(lexer, lexer.pos) : undefined
    const quotePlusDepth = quotePrefixDepth(physicalPlus)
    const quotePlusColumn = sourceColumn(physicalPlus)
    // Strip source prefixes, not `^>`: a hosted quote line sits behind the item's indentation.
    const quotePlusBody = sourceQuoteRest(physicalPlus, quotePlusDepth) ?? ''
    if (!(quoteMarkerLine && isContinuationMarker(quotePlusBody.trimStart()) &&
        (quotePlusColumn === physicalQuoteColumn || quotePlusDecision?.owner?.kind === 'list' &&
          quotePlusDecision.owner.column === quotePlusColumn))) return false
    // A `+` with nothing to attach never disappears (carve#4449): a fence the quote left open takes it
    // as payload, and otherwise it is read as any other unmarked line.
    const follower = lexer.peek(1)
    if (follower === undefined || isBlankLine(follower)) {
      if (!leavesFenceOpen(q.inner)) return false
      q.innerLineNumbers.push(lexer.lineNumber(lexer.pos))
      q.inner.push(stripLazyFrame(ln))
      lexer.consume()
      return true
    }
    lexer.consume()
    const { lines: attached, lineNumbers: attachedLineNumbers } = this.collectAttachedBlock(
      lexer,
      (next) => isBlankLine(next) || /^\+[ \t]*$/.test(next),
      0,
      true,
    )
    if (attached.length > 0) {
      lexer.attachmentBoundaries.add(attachedLineNumbers[0]!)
      // An earlier probe may have read these lines as lazy; the `+` decides them.
      for (const number of attachedLineNumbers) {
        lexer.quoteLazyMarkerLines.delete(number)
        lexer.quoteLazyLines.delete(number)
      }
      // `inner` always holds the quote's first content line, so a leading
      // blank separates the attached block from it.
      // The separators are SYNTHETIC - no such blank line exists in the
      // source - so each borrows the line it sits against rather than the
      // `+` marker's. Borrowing the marker's put them BEFORE the attached
      // block in document order, and a block spanning first-to-last line then
      // reported an end offset earlier than its start (#462).
      q.inner.push('')
      q.innerLineNumbers.push(attachedLineNumbers[0]!)
      for (const attachedLine of attached) q.inner.push(stripLazyFrame(attachedLine))
      q.innerLineNumbers.push(...attachedLineNumbers)
      this.endQuoteAttachment(q)
      // The attached block closed any open paragraph: a following unmarked
      // line no longer lazily continues the quote.
      this.trackUntrackedQuoteLines(q)
      closeBlockQuoteParagraph(q.state)
    }
    return true
  }

  private quoteHoldsMarkerBody(q: QuoteCollect): boolean {
    this.trackUntrackedQuoteLines(q)
    for (let level: BlockQuoteLazyState | undefined = q.state; level; level = level.mode.kind === 'quote' ? level.mode.inner : undefined) {
      if (level.hosts?.kinds.some((kind) => kind === 'item' || kind === 'note' || kind === 'description')) return true
    }
    return false
  }

  // An unmarked line that cannot be the quote's lazy text ends the quote.
  private interruptsQuoteLazily(q: QuoteCollect, ln: string, lazyFootnote: boolean): boolean {
    const { lexer, quoteTermContinuation, quoteMarkerColumn } = q
    return isBlankLine(ln) ||
      // A marker in a marker body, or one that misses a body in this quote, opens a list (PART 0 S3, carve#4860).
      (!ln.startsWith(LAZY_FRAME) && isListMarkerLine(ln) && !isContinuationMarker(stripLazyFrame(q.inner.at(-1) ?? '').trim()) &&
        (lexer.markerOpensSublist || this.quoteHoldsMarkerBody(q))) ||
      (lexer.hostBody === 'list' && !lazyFootnote && leadingWhitespace(ln) >= FOOTNOTE_BODY_COLUMN && RE_FOOTNOTE_DEF.test(ln.trimStart())) ||
      (RE_CAPTION.test(ln) && !lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos))) ||
      colonFenceShapeEndsLazyContinuation(ln) ||
      (quoteTermContinuation && RE_HEADING.test(ln)) ||
      (quoteTermContinuation && (
        RE_HR.test(ln) || isTableRow(ln) ||
        (leadingWhitespace(ln) === 0 && (RE_FOOTNOTE_DEF.test(ln) || isLinkDefLine(ln) || isBlockAttributeLine(ln))) ||
        RE_COMMENT_LINE.test(ln)
      )) ||
      (quoteTermContinuation && (RE_FENCE.test(ln) || RE_RAW_FENCE.test(ln)) &&
        sourceColumn((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? ln) < quoteMarkerColumn + 2 &&
        startsInterruptingBlock(lexer, undefined, false)) ||
      (lexer.hostBody !== null && RE_FOOTNOTE_DEF.test(ln.trimStart()) &&
        !lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos)) &&
        indentColumns(lexer.rootLines?.[lexer.lineNumber(lexer.pos) - 1] ?? ln) >= quoteMarkerColumn) ||
      (!quoteTermContinuation && !lazyFootnote && startsInterruptingBlock(lexer, undefined, false))
  }

  private appendLazyQuoteLine(q: QuoteCollect, ln: string, lineIndex: number, termContinuation: boolean): void {
    const { lexer } = q
    // A line without the quote prefix cannot close an attribute opened inside it, at any quote depth.
    for (let level: BlockQuoteLazyState | undefined = q.state; level; level = level.mode.kind === 'quote' ? level.mode.inner : undefined) {
      level.attrRun = null
    }
    const lazyLinkDef = this.isLinkDefLine(ln)
    if (lazyLinkDef) {
      lexer.literalLazyLinkDefLines.add(lexer.lineNumber(lineIndex))
    }
    // THE LINE IS THE QUOTE'S LAZY TEXT, AND A MARKER DOES NOT SURVIVE THE
    // HAND-OVER (PART 0 lazy continuation, markup-carve/carve#1904). Below it
    // parses as the quote's body, where the marker read as an opener again and
    // put an item INSIDE the quote for a line carrying no `>`.
    //
    // AT EVERY COLUMN, including one an enclosing item hands out (ruled on
    // markup-carve/carve#1905, ported at carve-js#1615). A QUOTE IS REACHED BY
    // ITS MARKER, AND A COLUMN NEVER REACHES INTO ONE - so a line writing no
    // `>` is in no quote wherever it lands, and §24 C3 never governs it. The
    // hold-back this used to carry made the marker twin differ from the
    // paragraph twin, which folds there in every reader.
    if (isListMarkerLine(ln)) {
      lexer.quoteLazyMarkerLines.add(lexer.lineNumber(lineIndex))
    }
    // The shape-blind half of the same fact, for the consumers the two sets
    // above do not serve.
    lexer.quoteLazyLines.add(lexer.lineNumber(lineIndex))
    const lazyDefinition = RE_FOOTNOTE_DEF.test(stripLazyFrame(ln).trimStart()) ||
      (isLinkDefLine(stripLazyFrame(ln).trimStart()) &&
        indentColumns(lexer.rootLines?.[lexer.lineNumber(lineIndex) - 1] ?? ln) < q.quoteMarkerColumn)
    if (lazyDefinition) lexer.literalLazyLinkDefLines.add(lexer.lineNumber(lineIndex))
    // A lazy `+` writes no `>`, so it reaches no container in the quote and stays text.
    const lazyPlus = !ln.startsWith(LAZY_FRAME) && isContinuationMarker(ln.trimStart())
    // Inside an item the `+` is refused as that item's marker; elsewhere it is ordinary lazy text.
    if (lazyPlus && lexer.hostBody === 'list') {
      const root = lexer.rootLines ?? lexer.lines
      const follower = root[lexer.lineNumber(lineIndex)]
      const plusColumn = sourceColumn(root[lexer.lineNumber(lineIndex) - 1] ?? ln)
      if (follower === undefined || isBlankLine(follower) ||
          isListMarkerLine(sourceQuoteBody(follower).trimStart()) && sourceColumn(follower) === plusColumn) {
      }
    }
    q.inner.push(ln.startsWith(LAZY_FRAME) ? ln : isListMarkerLine(ln) || lazyPlus || lazyDefinition || termContinuation ||
      deflistMarkerLine(ln)
      ? LAZY_FRAME + ln.replace(/^[ \t]+/, '') : ln)
    q.innerLineNumbers.push(lexer.lineNumber(lineIndex))
    if (!lazyLinkDef) this.trackQuoteLine(q, ln, lineIndex)
  }

  // An open comment span tests its closer before ownership, so an unmarked closer stays in the quote (PART 0 S1, corpus 888).
  private takesUnmarkedCommentCloser(q: QuoteCollect, ln: string): boolean {
    const width = commentFenceRun(ln)
    if (width === undefined) return false
    this.trackUntrackedQuoteLines(q)
    // The span may sit in the quote itself or in an item, description or note it holds (carve#5027).
    const spanWidth = (level: BlockQuoteLazyState): number | undefined =>
      level.mode.kind === 'comment_fence' ? level.mode.length
        : level.hosts?.fence?.comment ? level.hosts.fence.marker.length : undefined
    // The column a host's span reads its closer at: the fence's floor, or the host's own column.
    const hostColumn = (level: BlockQuoteLazyState): number | undefined =>
      level.mode.kind === 'comment_fence'
        ? (level.hosts?.columns.at(-1) ?? 0) > 0 ? level.hosts!.columns.at(-1) : undefined
        : level.hosts!.fence!.floor
    let level = q.state
    let open = spanWidth(level)
    let column = open === undefined ? undefined : hostColumn(level)
    let hostDepth = 0
    for (let depth = 1; level.mode.kind === 'quote'; depth++) {
      level = level.mode.inner
      const inner = spanWidth(level)
      if (inner === undefined) continue
      open = inner
      column = hostColumn(level)
      hostDepth = depth
    }
    if (open !== width) return false
    const { lexer } = q
    const lineIndex = lexer.pos
    lexer.consume()
    if (column === undefined) {
      this.appendLazyQuoteLine(q, ln, lineIndex, false)
      return true
    }
    // A host's span reads the closer as written at the host's column, as the quoted spelling is.
    // A deeper quote gets the line as authored and reads it the same way itself.
    const content = '> '.repeat(hostDepth) + ' '.repeat(column) + ln.trimStart()
    q.inner.push(hostDepth === 0 ? content : ln)
    q.untracked.push([content, lineIndex])
    q.innerLineNumbers.push(lexer.lineNumber(lineIndex))
    return true
  }

  // False when the unmarked line ends the quote instead of continuing it.
  private takeLazyQuoteLine(q: QuoteCollect, ln: string): boolean {
    const { lexer, state } = q
    const rootLine = lexer.rootLines?.[lexer.lineNumber(lexer.pos) - 1] ?? ln
    // A line that writes a `>` is inside the quote that marker reaches, not below this quote's column.
    const lazyFootnote = RE_FOOTNOTE_DEF.test(stripLazyFrame(ln).trimStart()) &&
      indentColumns(rootLine) < q.quoteMarkerColumn && !rootLine.trimStart().startsWith('>')
    if (this.takesUnmarkedCommentCloser(q, ln)) return true
    // A caption or the follower of a refused description marker cannot extend the quote
    // when the ownership walk assigned that line to the host outside it.
    const preceding = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 2] ?? ''
    if (!this.isWalkLazyLine(lexer.lineNumber(lexer.pos)) &&
        (RE_CAPTION.test(ln.trimStart()) &&
          (indentColumns(rootLine) === q.quoteMarkerColumn || indentColumns(rootLine) === q.quoteMarkerColumn + 2) ||
          /^:[ \t]+%%$/.test(sourceQuoteBody(preceding).trimEnd()))) return false
    if (this.interruptsQuoteLazily(q, ln, lazyFootnote)) return false
    // A list marker interrupts the one-line paragraph a refused quoted note `+` forms (§10 I2).
    if (isListMarkerLine(ln) && quotedNoteFirstBlockMarker(preceding) && sourceQuoteBody(preceding).startsWith('[^')) return false
    // A non-`>` line inside an open fence/comment, or after a block that left no
    // open paragraph (heading/table/fence/thematic/div), terminates the quote
    // instead of being swallowed. This is also what ends the quote on a lazy
    // list marker when no open paragraph precedes it.
    this.trackUntrackedQuoteLines(q)
    q.paragraphOpen ??= blockQuoteParagraphClaimOpen(state)
    if (q.handDown && q.handDown.paragraphOpen === undefined) q.handDown.paragraphOpen = q.paragraphOpen
    if (!q.paragraphOpen && !lazyFootnote) return false
    let leaf = state
    while (leaf.mode.kind === 'quote') leaf = leaf.mode.inner
    const termContinuation = q.quoteTermContinuation ||
      leaf.mode.kind === 'paragraph' && (leaf.mode.term === true || leaf.hosts?.terms.at(-1) === true)
    if (leadingWhitespace(ln) === 0 && (deflistMarkerLine(ln) || isListMarkerLine(ln)) &&
        !lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos))) {
      // A marker at the surviving document column ends the open term.
      if (leaf.mode.kind === 'paragraph' && (leaf.mode.term || leaf.hosts?.terms.at(-1))) return false
    }
    const lineIndex = lexer.pos
    lexer.consume()
    this.appendLazyQuoteLine(q, ln, lineIndex, termContinuation)
    return true
  }

  private finishBlockQuote(q: QuoteCollect): BlockQuote | Figure {
    const { lexer, firstLineIndex } = q
    const subLexer = nestedSubLexer(lexer, q.inner, firstLineIndex, q.innerLineNumbers, q.origins)
    subLexer.quoteLazyHint = q.handDown
    // A QUOTE'S CONTENT COLUMN COMES FROM ITS MARKER, so the note body's leniency
    // stops here. A footnote body absorbs residual indentation because its blocks
    // are REBASED to an authored base; a quote is not rebased, and an indented
    // definition after `>` is literal text there exactly as at top level
    // (markup-carve/carve-js#1628).
    subLexer.inFootnoteBody = false
    subLexer.consumesHostedLinkDefs = lexer.hostBody === null ? false : 'lazy'
    const children = this.parseBlocks(subLexer, 0)
    const bq: BlockQuote = { type: 'block_quote', children }
    const quoteEndIndex = lexer.pos
    // §4d: a quote built out of nothing but structural-only `>` lines is not a
    // captionable host. It holds nothing the caption could be about, and taking
    // one binds the caption across the container change that opened the quote -
    // which is how `| a |` / blank / `>` / blank / `^ cap` captioned an empty
    // quote nobody wrote the caption under (markup-carve/carve#2892). A comment
    // renders nothing, so a comment-only quote is the same (carve#4220), and so is
    // a nested quote or bare div holding only such lines (carve#4573).
    if (children.every(holdsNothing)) return bq
    // Optional caption with ^
    // Allow one blank line between
    let lookahead = 0
    while (!lexer.eof() && isBlankLine(lexer.peek(lookahead))) lookahead++
    const next = lexer.peek(lookahead)
    if (next) {
      const cap = RE_CAPTION.exec(next)
      // §4: a caption attaches only when it immediately follows the block
      // or is separated by at most ONE blank line.
      if (cap && lookahead <= 1) {
        this.recordAttachedCaption(lexer, lexer.pos + lookahead)
        for (let i = 0; i <= lookahead; i++) lexer.consume()
        attachBlockPos(lexer, bq, firstLineIndex, quoteEndIndex)
        return {
          type: 'figure',
          target: bq,
          caption: this.parseCaptionInline(lexer, cap[1]!),
        } as Figure
      }
    }
    return bq
  }

  private parseBlockQuote(lexer: Lexer): BlockQuote | Figure {
    const q = this.openQuoteCollect(lexer)
    while (!lexer.eof()) {
      const ln = lexer.peek()!
      const quoted = quotedLineText(ln, lexer.lineTerminatorFree(lexer.pos))
      if (quoted !== null) {
        this.takeQuotedLine(q, ln, quoted)
        continue
      }
      if (this.attachesQuotedPlusBlock(q, ln)) continue
      if (!this.takeLazyQuoteLine(q, ln)) break
    }
    return this.finishBlockQuote(q)
  }


  private parseBlockImage(lexer: Lexer): Image | Figure {
    const imageLineIndex = lexer.pos
    const line = lexer.consume()
    const m = RE_BARE_IMAGE.exec(line)!
    // `isBlockImageLine` has already read the run as a destination, so the
    // escapes are resolved here as they are on the inline tail.
    const img: Image = { type: 'image', src: m[2] === '' ? '' : linkDestinationValue(m[2]!)!, alt: unescapeAttrValue(m[1]!) }
    const title = m[3] ?? m[4]
    if (title !== undefined) img.title = unescapeAttrValue(title)
    if (m[5]) img.attrs = parseAttrs(m[5])
    recordPromotedImageBlockRun(img, {}, img.attrs)
    // Optional caption
    let lookahead = 0
    while (!lexer.eof() && isBlankLine(lexer.peek(lookahead))) lookahead++
    const next = lexer.peek(lookahead)
    if (next) {
      const cap = RE_CAPTION.exec(next)
      // §4: a caption attaches only when it immediately follows the block
      // or is separated by at most ONE blank line.
      if (cap && lookahead <= 1) {
        this.recordAttachedCaption(lexer, lexer.pos + lookahead)
        for (let i = 0; i <= lookahead; i++) lexer.consume()
        // The block loop attaches a span to whatever this returns, so a figure
        // gets one and its TARGET would be left without - PART 12 section 4 wants
        // one on every node but the root. The image occupies exactly its own line;
        // the figure spans that plus the caption.
        attachBlockPos(lexer, img, imageLineIndex, imageLineIndex + 1)
        return {
          type: 'figure',
          target: img,
          caption: this.parseCaptionInline(lexer, cap[1]!),
        } as Figure
      }
    }
    return img
  }

  private foldedAttachedDefinitionEnd(lines: readonly string[], end: number, probe: Lexer): number {
    // The verse ownership probe omits registration, so its empty table cannot establish a boundary.
    if (this.definitionRegionLines || !lines.slice(0, end).some(line => /^[ \t]+\[/.test(line))) return end
    const ownership = subLexer(lines.slice(0, end), probe.parseOptions, 0)
    ownership.nested = true
    ownership.suppressPositions = true
    ownership.depth = probe.depth
    this.collectLinkDefs(ownership)
    const notes = new Set([...probe.footnoteDefs.keys()].map(normalizeRefLabel))
    const claimed = new Set<string>()
    const commentClose = commentCloserLookup(lines)
    let opaque: OpaqueGroup | null = null
    let termColumn: number | null = null
    for (let index = 0; index < end; index++) {
      const line = lines[index]!
      if (isBlankLine(line)) {
        if (opaque === null) termColumn = null
        continue
      }
      const column = indentColumns(line)
      const text = sliceColumns(line, column, true)
      if (opaque !== null) {
        if (opaque.closes(text)) opaque = null
        continue
      }
      if (termColumn !== null) {
        if (column > termColumn && markerContentColumn(text) < 0) {
          const folded = opaqueGroupCloser(text)
          if (folded?.char === '%' && commentClose(folded.run, index) !== -1) opaque = folded
          continue
        }
        if (
          RE_HEADING.test(text) || RE_HR.test(text) || RE_BLOCKQUOTE.test(text) ||
          this.isLinkDefLine(text) || RE_FOOTNOTE_DEF.test(text) || markerContentColumn(text) >= 0 ||
          RE_FENCE.test(text) || RE_RAW_FENCE.test(text) || RE_CAPTION.test(text) ||
          RE_COMMENT_LINE.test(text) || /^::? /.test(text)
        ) {
          termColumn = null
        }
      }
      if (RE_DEFLIST_TERM.test(text)) termColumn = column
      const group = opaqueGroupCloser(text)
      if (group !== null && (group.char !== '%' || commentClose(group.run, index) !== -1)) {
        opaque = group
        continue
      }
      const footnote = RE_FOOTNOTE_DEF.exec(text)
      const link = this.matchLinkDef(text)
      if (footnote === null && link === null) continue
      const key = normalizeRefLabel(footnote?.[1] ?? link!.label)
      const kind = footnote !== null ? 'f' : 'l'
      const registered = footnote !== null ? notes.has(key) : ownership.linkDefs.has(key)
      if (column > 0 && (claimed.has(kind + key) || !registered)) return index
      claimed.add(kind + key)
    }
    return end
  }

  /**
   * Collect the ONE flush-left block a `+` continuation marker attaches
   * (PART 9 §17 L3/L4).
   */
  /**
   * How many of the `limit` lines at the lexer's position the ONE block a `+`
   * attaches actually occupies (§17 L3).
   *
   * At least one line, always: a probe that consumed nothing would leave the
   * caller's cursor where it was and the container loop would see the same line
   * forever.
   *
   * A LEADING ATTRIBUTE RUN IS PART OF THE BLOCK IT FLOATS ONTO. Only
   * `parseBlocks` owns a pending-attribute slot and this is a `parseBlock` call,
   * so an attribute line left to it reads as a paragraph and the measurement stops
   * in front of the block the attributes were written for.
   */
  attachedBlockExtent(
    lexer: Lexer,
    limit: number,
    transform?: (line: string) => string,
    endAtFoldedDefinition = true,
    // Invisible lines the host keeps before the block; the probe measures from the line after them.
    lead = 0,
  ): number {
    if (limit <= 1) return limit
    if (lead >= limit) lead = 0
    const lines: string[] = []
    for (let k = 0; k < limit - lead; k++) {
      const line = lexer.peek(lead + k)!
      lines.push(transform ? transform(line) : line)
    }
    const probe = subLexer(lines, lexer.parseOptions, 0)
    probe.nested = true
    probe.suppressPositions = true
    // The depth the block is really parsed at. `MAX_NESTING_DEPTH` turns every
    // line into literal paragraph text once it is reached, so a probe left at 0
    // would measure a construct the real parse never builds. Stated as alignment,
    // not as a fix: no document was found where it changes the answer, because at
    // those depths a `+` has already stopped acting as a continuation marker.
    probe.depth = lexer.depth + 1
    // NO EXTENSION MATCHER RUNS FOR A MEASUREMENT. `matchBlock` and `matchInline`
    // are public callbacks and nothing requires them to be pure: one allocating
    // sequential ids would number its first authored block 2, because the probe
    // called it once for a parse whose result is thrown away. The probe only needs
    // to know where a block ENDS, and an extension block ends where the core
    // parser's fallback for those same lines ends.
    const matchers = this.activeMatchers
    const wasMeasuring = this.measuringAttachedBlock
    this.activeMatchers = []
    this.measuringAttachedBlock = true
    try {
      // A LEADING ATTRIBUTE RUN IS PART OF THE BLOCK IT FLOATS ONTO, and so is
      // whatever INVISIBLE construct sits between them. Only `parseBlocks` owns a
      // pending-attribute slot, and §15 A2a keeps that slot across a comment or a
      // reference, footnote or abbreviation definition - so a probe that stopped
      // at the first node would stop in front of the block the attributes were
      // written for and leave it outside the container, attributes dropped.
      for (;;) {
        while (!probe.eof() && tryCollectBlockAttributes(probe) !== null) {
          /* the run floats forward; keep looking for what it floats onto */
        }
        if (probe.eof()) return limit
        const startLine = probe.pos
        const node = this.parseBlockInner(probe)
        if (node) attachBlockPos(probe, node, startLine, probe.pos)
        const invisible =
          node === null || node.type === 'abbreviation_def' || node.type === 'comment'
        if (!invisible || probe.eof()) break
      }
      const end = Math.min(Math.max(probe.pos, 1), limit - lead)
      return lead + (endAtFoldedDefinition ? Math.max(1, this.foldedAttachedDefinitionEnd(lines, end, probe)) : end)
    } finally {
      this.activeMatchers = matchers
      this.measuringAttachedBlock = wasMeasuring
    }
  }

  private collectAttachedBlock(
    lexer: Lexer,
    isBoundary: (line: string, offset?: number) => boolean,
    contentColumn = 0,
    endAtFoldedDefinition = true,
    acceptFirstNonList = false,
    viewSlice = 0,
    itemHost = false,
    closerFloor = 0,
    hostCloserColumn = 0,
  ): { lines: string[]; lineNumbers: number[]; startLineIndex: number } {
    const transform = contentColumn === 0 ? undefined : (line: string) => sliceColumns(line, contentColumn)
    // The block is measured where its caller reads it, which a first-block `+` slices further.
    const view = viewSlice === 0 ? transform
      : (line: string) => sliceColumns(transform ? transform(line) : line, viewSlice, true)
    // AND FLUSH-LEFT MEANS COLUMN 0 IS ASKED HERE, ONCE, FOR EVERY CONTAINER
    // (§17 L3, markup-carve/carve#1814). The predicate existed but only the list
    // item's three attach paths called it, so the footnote body, the definition
    // description and the block quote each reached out for a line the clause
    // leaves where the author wrote it: a `<dd>` whose content column is 3 pulled
    // in a column-1 or column-2 line, a note pulled in a column-1 line, and a
    // quote took a column-2 line that A QUOTE IS REACHED BY ITS MARKER (§10 I5,
    // markup-carve/carve#1384) puts in no quote at all. Every caller already
    // treats an EMPTY result as "the marker attached nothing" and lets its own
    // ordinary rules have the line, which is exactly what the clause's comment
    // spelling does.
    const scans = lexer.attachmentScans ??= new Map()
    const cacheKey = viewSlice === 0 ? contentColumn : `${contentColumn}:${viewSlice}`
    let cache = scans.get(cacheKey)
    if (cache === undefined) {
      cache = {}
      scans.set(cacheKey, cache)
    }
    const origin = lexer.contiguousOrigin?.lexer ?? lexer
    const indexBase = lexer.contiguousOrigin?.start ?? 0
    const at = (offset: number): string | undefined => {
      const line = lexer.peek(offset)
      return line === undefined ? undefined : view ? view(line) : line
    }
    // A leading attribute run belongs to the block after it, so a fence there
    // still makes its body opaque to the container's boundaries.
    const attributeLines = leadingInvisibleRun(at, lexer.parseOptions)
    // An invisible note may stand deeper than the block it precedes. The
    // block's own column, never the prelude's, bounds an open fence.
    const blockFloor = Math.min(closerFloor, indentColumns(lexer.peek(attributeLines) ?? ''))
    const fencedFromAttributes = fencedBlockEnd({
      at: (offset) => at(offset + attributeLines),
      index: closerIndex(lexer),
      cache,
      preciseClosers: () => {
        if (origin.attachmentFenceClosers === undefined) {
          if (layoutWork.on) layoutWork.fenceCandidateLines += origin.lineCount
          origin.attachmentFenceClosers = new AttachmentFenceClosers({
            length: origin.lineCount,
            lineAt: (index) => origin.lineAt(index)!,
          }, RE_ANY_FENCE_CLOSER, RE_COMMENT_BLOCK_ANY, RE_ANY_COLON_CLOSER,
          line => RE_FENCE.exec(line) !== null || RE_RAW_FENCE.exec(line) !== null || colonBlockOpenerRun(line) !== null)
        }
        return origin.attachmentFenceClosers
      },
      end: lexer.lineCount,
      contentColumn: Math.max(contentColumn + viewSlice, hostCloserColumn),
      indexBase,
      base: lexer.pos + attributeLines,
      boundary: isBoundary,
      belowFloor: blockFloor === 0 ? undefined : (offset) => {
        const line = lexer.peek(offset + attributeLines)
        return line !== undefined && !isBlankLine(line) && indentColumns(line, blockFloor) < blockFloor
      },
    })
    const fenced = fencedFromAttributes === -1 ? -1 : fencedFromAttributes + attributeLines
    let take = 0
    if (fenced !== -1) {
      take = fenced + 1
    } else {
      const firstBlock = at(attributeLines)
      const attachedCode = firstBlock !== undefined && (RE_FENCE.test(firstBlock) || RE_RAW_FENCE.test(firstBlock))
      while (lexer.peek(take) !== undefined) {
        const candidate = lexer.peek(take)!
        // The first block may start at a nested item's marker column. Once a
        // code fence has opened there, a line below that column is outside its
        // host even when the attachment boundary accepts it as lazy text.
        if (attachedCode && itemHost && blockFloor > 0 && take > attributeLines &&
            !isBlankLine(candidate) && indentColumns(candidate) < blockFloor) break
        // A first-block marker can attach a flush-left block even when its
        // list marker is indented. Dedent ends the block only after it starts.
        // Invisible lines the host keeps before the block are skipped; the gates apply to the line after them (§17 L3).
        const first = take <= attributeLines
        const firstFlushLeft = first && contentColumn > 0 &&
          indentColumns(candidate) === 0 && !isBlankLine(candidate) && !isContinuationMarker(candidate) &&
          !lineOpensBlock(candidate)
        const firstNonList = acceptFirstNonList && first && !isBlankLine(candidate) &&
          !isContinuationMarker(candidate) && !isListMarkerLine(candidate) &&
          !deflistMarkerLine(candidate)
        // The line after a refused brace run continues its paragraph whatever it opens (CARVE-P2-035);
        // a sibling item, description or note still ends its host first.
        // A `+` at the unclosed code fence's content column stays payload (PART 0 S1, §17 L3, carve#5494).
        const payloadPlus = attachedCode && take > attributeLines && isContinuationMarker(at(take)!.trimStart()) &&
          indentColumns(at(take)!) >= indentColumns(firstBlock)
        if (!payloadPlus && isBoundary(candidate, take) && !firstFlushLeft && !firstNonList &&
          (itemHost || deflistMarkerLine(candidate) || RE_FOOTNOTE_DEF.test(candidate) || !isRefusedBraceRun(at, take))) break
        take++
      }
      const measured = this.attachedBlockExtent(lexer, take, view, endAtFoldedDefinition, attributeLines)
      if (measured < take) take = measured
    }
    const startLineIndex = lexer.pos
    const lines: string[] = []
    const lineNumbers: number[] = []
    for (let k = 0; k < take; k++) {
      const raw = lexer.peek()!
      lines.push(transform ? transform(raw) : raw)
      lineNumbers.push(lexer.lineNumber(lexer.pos))
      lexer.consume()
    }
    // An attribute after a kept note labels the offered block at the host's
    // marker column, even when it was written at the note's column.
    let afterNote = false
    for (let index = 0; index < Math.min(attributeLines, lines.length); index++) {
      if (RE_FOOTNOTE_DEF.test(lines[index]!.trimStart())) afterNote = true
      else if (afterNote && lines[index]!.trimStart().startsWith('{')) {
        const column = indentColumns(lines[index]!)
        const run = leadingAttributeRun((offset) => {
          const line = lines[index + offset]
          return line === undefined ? undefined : sliceColumns(line, column, true)
        }, lexer.parseOptions)
        for (let offset = 0; offset < run; offset++) lines[index + offset] = sliceColumns(lines[index + offset]!, column, true)
        index += Math.max(0, run - 1)
      }
    }

    return { lines, lineNumbers, startLineIndex }
  }

  collectAttachedListBlock(
    lexer: Lexer,
    isBoundary: (line: string, offset?: number) => boolean,
    baseIndent: number,
    endAtFoldedDefinition = true,
    viewSlice = 0,
    closerFloor = 0,
    hostCloserColumn = 0,
  ): { lines: string[]; lineNumbers: number[]; startLineIndex: number } {
    const attached = this.collectAttachedBlock(lexer, isBoundary, baseIndent, endAtFoldedDefinition, true,
      viewSlice, true, closerFloor, hostCloserColumn)
    const view = (line: string | undefined) => line === undefined || viewSlice === 0 ? line : sliceColumns(line, viewSlice, true)
    // Attribute lines and line comments before the block render nothing, so the fence below them is the attached block.
    let leadLines = 0
    for (let from = -1; from !== leadLines;) {
      from = leadLines
      leadLines += leadingAttributeRun(offset => leadLines > 0 ? view(attached.lines[leadLines + offset])?.trimStart() : view(attached.lines[leadLines + offset]), lexer.parseOptions)
      for (let comment = leadingCommentEnd(offset => view(attached.lines[offset]), leadLines);
        comment !== -1 && comment < attached.lines.length;
        comment = leadingCommentEnd(offset => view(attached.lines[offset]), leadLines)) leadLines = comment
      const note = leadingNoteEnd(offset => view(attached.lines[offset]), leadLines)
      if (note !== -1) leadLines = note
    }
    const first = view(attached.lines[leadLines])
    const last = view(attached.lines.at(-1))
    const code = first === undefined ? null : RE_FENCE.exec(first) ?? RE_RAW_FENCE.exec(first)
    const codeMarker = code === null ? null : RE_FENCE.test(first!) ? code[2]! : code[1]!
    // The opener alone is no closer of its own (`- +` / ``` / `- x`).
    const closedCode = codeMarker !== null && attached.lines.length > leadLines + 1 && last !== undefined &&
      fenceCloseRe(codeMarker).test(last)
    const colon = first === undefined ? null : colonBlockOpenerRun(first)
    const closedColon = colon !== null && isFigureGroupOpener(first!, lexer.inFigureGroup) &&
      last !== undefined && RE_ADMONITION_CLOSE.exec(last)?.[1]?.length === colon
    // An unclosed attached fence takes the rest of its container when no blank line or closer
    // follows; otherwise its extent is the attached block's (§17 L3, CARVE-P9-067).
    if (codeMarker !== null && !closedCode && viewSlice === 0) {
      const closer = fenceCloseRe(codeMarker)
      let rest = 0
      for (let line = lexer.peek(rest); line !== undefined; line = lexer.peek(++rest)) {
        if (isBlankLine(line) || closer.test(view(baseIndent === 0 ? line : sliceColumns(line, baseIndent))!)) {
          rest = 0
          break
        }
      }
      for (; rest > 0; rest--) {
        attached.lines.push(lexer.peek()!)
        attached.lineNumbers.push(lexer.lineNumber(lexer.pos))
        lexer.consume()
      }
    }
    if ((closedCode || closedColon) && lexer.peek() !== undefined && RE_CAPTION.test(lexer.peek()!)) {
      attached.lines.push(lexer.peek()!)
      attached.lineNumbers.push(lexer.lineNumber(lexer.pos))
      lexer.consume()
    }
    return attached
  }

  private parseTable(lexer: Lexer): Table | Figure {
    const host = this.tableBlockHost ??= {
      parseInline: this.parseInline.bind(this),
      recordAttachedCaption: this.recordAttachedCaption.bind(this),
      parseCaptionInline: this.parseCaptionInline.bind(this),
    }
    return parseTableBlock(host, lexer)
  }

  // Whether the peeked line ENDS an open heading or blockquote (and starts a
  // sibling block). A list marker (bullet, task, ordered, or abutting-attr) ends
  // them and starts a sibling list -- unlike paragraph interruption, where a list
  // marker FOLDS in (symmetric §10): a list folds into a PARAGRAPH but ends a
  // heading/quote, matching djot. Every paragraph-interrupter ends them too.
  // Consume a caption's continuation lines. A caption is multi-line inline
  // content, so it folds following lines exactly like a PARAGRAPH (§10), NOT like
  // a heading: a list marker FOLDS in (djot — a list needs a blank line to
  // interrupt), while a heading / blockquote / table / fenced code / `:::` div /
  // thematic break / `%%%` comment interrupts and ends the caption. A blank line
  // or a further `^ ` caption line also ends it. Continuation lines join with
  // `\n`. The lexer is positioned on the line AFTER the caption's first line;
  // `firstLine` is that first line's already-extracted text (`cap[1]`).
  /**
   * Parse a caption's inline content, anchored to the source.
   *
   * The caption's text IS a suffix of its line (`^ text` keeps everything after
   * the marker), and its continuation lines are appended verbatim - so unlike a
   * line block's expanded whitespace or a table's reassembled cells, an exact
   * mapping exists and there is nothing to invent. Captions were nonetheless run
   * through `stripPositions`, which is why 41 of this engine's 61 unplaced corpus
   * nodes were inside a `caption`.
   *
   * The suffix test is kept as a guard rather than assumed: if the line the lexer
   * is sitting on does not end with the caption text, the mapping is not exact
   * and the positions are dropped, as before.
   */
  private parseCaptionInline(lexer: Lexer, firstLine: string, captionContext = true): InlineNode[] {
    const capIndex = lexer.pos - 1
    const capLine = lexer.lineAt(capIndex)
    const anchors: Array<{ offset: number; column: number; line: number }> = []
    const anchorable =
      lexer.hasDocumentOffsets && capLine !== undefined && capLine.endsWith(firstLine)
    if (anchorable) {
      const within = capLine.length - firstLine.length
      anchors.push({
        offset: lexer.lineOffset(capIndex) + within,
        column: lexer.lineStartColumn(capIndex) + within,
        line: lexer.lineNumber(capIndex),
      })
    }
    const text = readCaptionText(lexer, firstLine, anchorable ? anchors : undefined)
    if (!anchorable) {
      return stripPositions(
        this.parseInline(text, lexer.abbrDefs, lexer.linkDefs, undefined, captionContext),
      )
    }
    return this.parseInline(
      text,
      lexer.abbrDefs,
      lexer.linkDefs,
      inlineSource({
        anchored: true,
        baseOffset: anchors[0]!.offset,
        startLine: lexer.lineNumber(capIndex),
        startColumn: anchors[0]!.column,
        lineAnchors: anchors,
      }),
      captionContext,
    )
  }

  /** Parse a list lead once the caller has ruled out every block opener. */
  parseSimpleListParagraph(content: string, lexer: Lexer): Paragraph {
    const text = dropTrailingWhitespace(content)
    return {
      type: 'paragraph',
      children: this.skipParagraphInlines && !this.inMatcherRequest
        ? [] : this.parseInline(text, lexer.abbrDefs, lexer.linkDefs,
          this.recordPositions ? {
            anchored: lexer.hasDocumentOffsets,
            baseOffset: lexer.lineOffset(0),
            startLine: lexer.lineNumber(0),
            startColumn: lexer.lineStartColumn(0),
          } : undefined),
    }
  }

  /**
   * `flattened` marks the MAX_NESTING_DEPTH degradation path (§25): past the cap
   * every opener "becomes literal paragraph text", so NOTHING interrupts here and
   * consecutive flattened openers plus any text after them form ONE paragraph,
   * ending at the first blank line. Grouping them one-per-opener was an artifact
   * of where the degrade path handed back to the block parser, not a rule -
   * "degrades to literal text" is the whole rule, and literal text groups the way
   * the same characters typed by an author would. (carve#547, carve#494)
   */
  private parseParagraph(lexer: Lexer, flattened = false): Paragraph {
    const lines: string[] = []
    const literalLines: Array<[number, number]> = []
    let afterRefusal = false
    const braceScan: { closerless?: number } = {}
    let refusedFence: RegExp | null = null
    let openInlineCode = 0
    const scanInlineCode = (line: string): void => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '\\') { i++; continue }
        if (line[i] !== '`') continue
        let end = i + 1
        while (line[end] === '`') end++
        const width = end - i
        if (openInlineCode === 0) openInlineCode = width
        else if (openInlineCode === width) openInlineCode = 0
        i = end - 1
      }
    }
    let imageCaptionSlot = false
    let captionAtContentColumn = false
    let mathCaptionChecked = false
    let imageCaptionChecked = false
    const startLineIndex = lexer.pos
    let secondLineLazy = false
    // A code include at block start owns exactly its source line. This is
    // decided before resolution, including when the resolver later refuses it.
    const firstLine = lexer.peek()!
    const trimmedFirst = firstLine.trim()
    const shape = !flattened && trimmedFirst.startsWith('{{') ? scanDirectiveShape(trimmedFirst) : null
    const codeInclude = shape?.end === trimmedFirst.length && shape.options.some(([key]) => key === 'code')
    // Unexpanded, a bare path stays literal in every host (PART 10 I2); a quoted one keeps core inline.
    const codeIncludeLiteral = codeInclude && !shape!.quoted
    while (!lexer.eof()) {
      const ln = lexer.peek()!
      if (isBlankLine(ln)) break
      let openedRefusedFence = false
      if (afterRefusal && refusedFence === null) {
        // Any fence opener keeps its closer, whatever info string it carries (CARVE-P2-035).
        const text = ln.trimStart()
        const opener = RE_FENCE.exec(text)?.[2] ?? RE_RAW_FENCE.exec(text)?.[1]
        if (opener) {
          const closer = new RegExp(`^[ \\t]*${opener[0]}{${opener.length},}[ \\t]*$`)
          for (let n = 1; lexer.peek(n) !== undefined && !isBlankLine(lexer.peek(n)!); n++) {
            if (closer.test(lexer.peek(n)!)) { refusedFence = closer; openedRefusedFence = true; break }
          }
        }
      }
      // Every line start is block position, a continuation line included (carve#5189).
      if (codeInclude && lines.length > 0) break
      const refusedLines = flattened || openInlineCode !== 0 ? 0 : refusedBraceLines(lexer, braceScan)
      if (refusedLines > 0) {
        const start = lines.length
        for (let n = 0; n < refusedLines; n++) lines.push(stripLazyFrame(lexer.consume()!))
        literalLines.push([start, lines.length])
        afterRefusal = true
        continue
      }
      // A reference image can remain literal after resolution. Its first
      // caption marker still occupies a slot; a second marker starts a block.
      if (imageCaptionSlot && RE_CAPTION.test(ln)) break
      // Later lines cannot make a paragraph that failed here a sole span again.
      if (!mathCaptionChecked && RE_CAPTION.test(ln)) {
        mathCaptionChecked = true
        if (this.isDisplayMathHost(lines, lexer)) break
      }
      if (RE_CAPTION.test(ln)) captionAtContentColumn = true
      if (lines.length > 0 && !imageCaptionChecked && RE_CAPTION.test(ln)) {
        // Only the first caret line can find an image alone; later ones follow caption text.
        imageCaptionChecked = true
        if ((lines.length === 1 && isReferenceImageLine(lines[0]!)) || isCommentedImageLine(lines.join('\n')))
          imageCaptionSlot = true
      }
      // Paragraph interruption (grammar PART 9 §10): a VISIBLE block (heading,
      // list, quote, table, fence, thematic break, admonition/div) interrupts
      // an open paragraph with no blank line before it, at the top level AND
      // nested — the Markdown-like rule. Invisible constructs (reference
      // definitions, comments) interrupt too. A bare image does not interrupt,
      // and an ordered marker interrupts only as `1.`/`1)`. See
      // startsInterruptingBlock.
      //
      // Only a paragraph that already holds a line can be interrupted: the FIRST
      // line is always consumed. In normal dispatch the first line reaching
      // parseParagraph is never a block opener (parseBlockInner would have
      // claimed it), so this does not change interruption. It DOES guarantee
      // progress on the MAX_NESTING_DEPTH degradation path, where a marker line
      // (e.g. a `>` past the depth cap) is routed here to become literal text —
      // without this guard startsInterruptingBlock would break before consuming,
      // looping forever on the same line.
      if (
        !flattened &&
        lines.length > 0 && !afterRefusal &&
        !lexer.literalLazyLinkDefLines.has(lexer.lineNumber(lexer.pos)) &&
        ((((!ln.startsWith(LAZY_FRAME) || (lexer.hostBody === 'list' &&
          !RE_FOOTNOTE_DEF.test(stripLazyFrame(ln)))) && (lexer.consumesHostedLinkDefs === 'all' ||
          (lexer.consumesHostedLinkDefs === 'lazy' &&
            lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos))))) &&
          this.isLinkDefLine(stripLazyFrame(ln))) ||
          startsInterruptingBlock(lexer) ||
          (lexer.hostedFootnoteLines.has(lexer.lineNumber(lexer.pos)) &&
            !ln.startsWith(LAZY_FRAME) && RE_FOOTNOTE_DEF.test(ln.trimStart())))
      )
        break
      if (lines.length === 1 && (ln.startsWith(LAZY_FRAME) || lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos))))
        secondLineLazy = true
      lexer.consume()
      // The frame did its work in the interruption test above; a paragraph is
      // where a framed line becomes text, so it comes off here.
      const received = stripLazyFrame(ln)
      lines.push(received)
      scanInlineCode(received)
      if (openedRefusedFence) afterRefusal = true
      else if (refusedFence !== null) {
        if (refusedFence.test(received)) { refusedFence = null; afterRefusal = false }
        else afterRefusal = true
      } else afterRefusal = false
    }
    // Every paragraph line has its leading whitespace stripped (djot /
    // CommonMark): `a\n   b` renders as `a\nb`, and a leading-indented first
    // line (` c`, or a fresh paragraph after a list closes) renders as `c` —
    // Carve has no indented code blocks, so indentation never survives into a
    // paragraph. The first line's stripped width is folded into the inline
    // base position so source offsets/columns stay accurate.
    // CARVE-P2-010: an item's tab after its marker separator is content and stays.
    const keptLead = firstLine.startsWith(LAZY_FRAME + '\t')
    const firstLead = keptLead ? 0 : lines[0]!.match(/^[ \t]+/)?.[0].length ?? 0
    const text = dropTrailingWhitespace(lines.length === 1
      ? lines[0]!.slice(firstLead)
      : lines.map((ln, i) => i === 0 ? ln.slice(firstLead) : ln.replace(/^[ \t]+/, '')).join('\n'))
    // Each line contributes its OWN leading whitespace on top of whatever prefix
    // the container stripped, so a continuation line needs its own origin rather
    // than a single base offset plus a local one (#444).
    const anchors =
      lines.length > 1
        ? lines.map((ln, i) => {
            const lead = i === 0 ? firstLead : ln.match(/^[ \t]+/)?.[0].length ?? 0
            return {
              offset: lexer.lineOffset(startLineIndex + i) + lead,
              column: lexer.lineStartColumn(startLineIndex + i) + lead,
              line: lexer.lineNumber(startLineIndex + i),
            }
          })
        : undefined
    const paragraphNode: Paragraph = {
      type: 'paragraph',
      children: (codeIncludeLiteral || this.skipParagraphInlines && !this.inMatcherRequest) ? [] : this.parseInline(text, lexer.abbrDefs, lexer.linkDefs, {
        anchored: lexer.hasDocumentOffsets,
        baseOffset: lexer.lineOffset(startLineIndex) + firstLead,
        startLine: lexer.lineNumber(startLineIndex),
        startColumn: lexer.lineStartColumn(startLineIndex) + firstLead,
        ...(anchors ? { lineAnchors: anchors } : {}),
      }),
    }
    if (literalLines.length > 0) {
      const normalizedLines = text.split('\n')
      const offsets = [0]
      for (const line of normalizedLines) offsets.push(offsets.at(-1)! + line.length + 1)
      const positionAt = (offset: number): { line: number; column: number; offset: number } => {
        let line = 0
        while (line + 1 < offsets.length && offsets[line + 1]! <= offset) line++
        const point = anchors?.[line] ?? {
          offset: lexer.lineOffset(startLineIndex + line) + (line === 0 ? firstLead : 0),
          column: lexer.lineStartColumn(startLineIndex + line) + (line === 0 ? firstLead : 0),
          line: lexer.lineNumber(startLineIndex + line),
        }
        const delta = offset - offsets[line]!
        return { line: point.line, column: point.column + delta, offset: point.offset + delta }
      }
      const parseSegment = (from: number, to: number): Paragraph['children'] => {
        const segment = text.slice(from, to)
        const start = positionAt(from)
        const lineAnchors = [start]
        for (let i = 0; i < segment.length; i++) if (segment[i] === '\n') lineAnchors.push(positionAt(from + i + 1))
        return this.parseInline(segment, lexer.abbrDefs, lexer.linkDefs, {
          anchored: lexer.hasDocumentOffsets,
          baseOffset: start.offset,
          startLine: start.line,
          startColumn: start.column,
          ...(lineAnchors.length > 1 ? { lineAnchors } : {}),
        })
      }
      let at = 0
      paragraphNode.children = []
      const addLiteralText = (from: number, to: number): void => {
        if (from === to) return
        const startPosition = positionAt(from), endPosition = positionAt(to)
        const value = text.slice(from, to)
        // A run joined across a stripped indent or quote prefix is not a source slice (CARVE-P12-022).
        const pieces = value.split('\n')
        let first = 0
        while (first + 1 < offsets.length && offsets[first + 1]! <= from) first++
        const sourceLine = (line: number): string => (lexer.rootLines ?? lexer.lines)[
          (anchors?.[line]?.line ?? lexer.lineNumber(startLineIndex + line)) - 1] ?? ''
        let contiguous = pieces.length === 1 || sourceLine(first).endsWith(pieces[0]!)
        for (let piece = 1; piece < pieces.length && contiguous; piece++) {
          const line = sourceLine(first + piece)
          contiguous = piece === pieces.length - 1 ? line.startsWith(pieces[piece]!) : line === pieces[piece]
        }
        paragraphNode.children.push({ type: 'text', value,
          ...(lexer.hasDocumentOffsets && contiguous ? { pos: {
            startLine: startPosition.line, startColumn: startPosition.column, startOffset: startPosition.offset,
            endLine: endPosition.line, endColumn: endPosition.column, endOffset: endPosition.offset,
          } } : {}),
        })
      }
      for (const [start, end] of literalLines) {
        const from = offsets[start]!
        const to = offsets[end]! - 1
        if (from > at) paragraphNode.children.push(...parseSegment(at, from))
        // Every line ending in a refused run is a soft_break, attribute runs too (carve-js#4430).
        let lineStart = from
        for (let i = from; i < to; i++) if (text[i] === '\n') {
          addLiteralText(lineStart, i)
          const before = positionAt(i), after = positionAt(i + 1)
          paragraphNode.children.push({ type: 'soft_break',
            ...(lexer.hasDocumentOffsets ? { pos: {
              startLine: before.line, startColumn: before.column, startOffset: before.offset,
              endLine: after.line, endColumn: after.column, endOffset: after.offset,
            } } : {}),
          })
          lineStart = i + 1
        }
        addLiteralText(lineStart, to)
        at = to
      }
      if (at < text.length) paragraphNode.children.push(...parseSegment(at, text.length))
    }
    if (codeIncludeLiteral) {
      const startOffset = lexer.lineOffset(startLineIndex) + firstLead
      const startColumn = lexer.lineStartColumn(startLineIndex) + firstLead
      paragraphNode.children = [{ type: 'text', value: text,
        ...(lexer.hasDocumentOffsets ? { pos: {
          startLine: lexer.lineNumber(startLineIndex), endLine: lexer.lineNumber(startLineIndex),
          startColumn, endColumn: startColumn + [...text].length,
          startOffset, endOffset: startOffset + [...text].length,
        } } : {}) }]
    }
    // The container prefix is already stripped by the lexer, so a first line with
    // leading whitespace LEFT sat above the container's content column. Recorded
    // here because this is the last place the answer exists: the indentation is
    // thrown away two lines up, and the block-image promotion phase has no way to
    // recover it from the tree (carve-js#1553).
    if (firstLead > 0) markAboveContentColumn(paragraphNode)
    if (captionAtContentColumn) markCaptionAtContentColumn(paragraphNode)
    if (codeInclude) markDirectiveLine(paragraphNode)
    // A caption line below the container's column reaches no host (§10 I7).
    if (secondLineLazy) markSecondLineLazy(paragraphNode)
    return paragraphNode
  }
}

/** Keep parser-only location fields on an HTML tree that is never returned. */
export function parseTransientForHtml(source: string, opts: ParseOptions): Document {
  const session = new ParseSession()
  session['skipPositionDrop'] = true
  return session.parse(source, opts)
}

