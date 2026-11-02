import {
  RE_AUTOLINK,
  RE_AUTOLINK_STICKY,
  buildBracketMap,
  crossrefBodyCanEnd,
  verbatimSpanEnd,
} from './inline/parse-brackets.js'
import { createDefinitionListParser } from './block/parse-definition-list.js'
import {
  RE_INLINE_ATTR,
  RE_RAW_INLINE,
  inlineOpaqueEnds,
  spanAttrProvablyInvalid,
  suffixHasChar,
  suffixHasPair,
} from './inline/parse-inline-opaque.js'
import { createInlineScanner, type InlineScannerSession } from './inline/parse-inline-scanner.js'
import { createLineBlockParser, type LineBlockHost } from './block/parse-line-block.js'
import { createLinkDefinitionCollector } from './parse-link-definitions.js'
import { createTableBlockParser, type TableBlockHost } from './table/parse-table-block.js'
export { mergeAttrs, recordPromotedImageBlockRun } from '../extension/attribute-merge.js'
export { parseAttrs } from '../extension/attribute-parser.js'
export type { LinkDef } from './inline/inline-resolution.js'
export { normalizeRefLabel } from '../label-key.js'
export {
  AUTOLINK_BODY_EXCLUDED,
  RE_AUTOLINK,
  buildBracketMap,
  forEachCrossrefRun,
  rawBracketRunCloses,
  rawImageBracketRunCloses,
} from './inline/parse-brackets.js'
export type { BracketClose, CrossrefMemo } from './inline/parse-brackets.js'
export { isBlankLine, layoutWork } from './parse-lexer.js'
/*
 * Carve parser — linear-time, block + inline.
 *
 * Block lexer reads line by line; inline parser does a single scan
 * over each block's text content. No backtracking.
 */

import { utf8ByteLength } from '../extension/abbr-budget.js'
import type {
  Admonition,
  AbbreviationDef,
  Attrs,
  BlockNode,
  BlockQuote,
  CitationGroup,
  CodeBlock,
  DefinitionList,
  Directive,
  Div,
  Document,
  Emphasis,
  Figure,
  FigureGroup,
  Heading,
  HeadingLevel,
  Image,
  InlineNode,
  LineBlock,
  LinkReferenceDefinition,
  List,
  Math,
  Paragraph,
  Position,
  RawBlock,
  SmartPunctuation,
  Table,
  Text,
  ThematicBreak,
  VerbatimCellWrap,
} from '../ast.js'
import { GENERATED_CONTENT_KINDS } from '../ast.js'
import { AttachmentFenceClosers } from './block/attachment-fence-closers.js'
import { accumulateAttrs } from '../extension/attribute-merge.js'
import { isEmptyAttrs, isValidInlineAttrPayload, parseAttrs, unescapeAttrValue } from '../extension/attribute-parser.js'
import { backtickRunEnds } from './inline/backtick-run-index.js'
import { delimitedTable, setDelimitedPayloadLines } from '../table/delimited-table.js'
import type { CarveExtension, InlineMatch, MatcherContext } from '../extension.js'
import { extendsGrapheme } from '../grapheme-extender.js'
import { mapInlineChildren, visitInlineChildren } from './inline/inline-children.js'
import { applyAbbreviations, applyLinkDefs } from './inline/inline-resolution.js'
import { normalizeRefLabel } from '../label-key.js'
import { completeDestinationOpeners, destinationSlotEnds, linkDestinationValue } from '../link-destination.js'
import { markAboveContentColumn, markCaptionAtContentColumn, markSecondLineLazy } from './block/paragraph-indent.js'
import { Lexer, indentColumns, isBlankLine, layoutWork, normalizeNewlines, sliceColumns } from './parse-lexer.js'
import { createListParser } from './list/parse-list.js'
import { referenceImage, referenceLink } from './inline/reference-resolution.js'
import { definitionLinePosition, dropPositions, toCodepointPositions } from '../source/source-positions.js'
import { SubstitutionScanner, abortedSubstitutions } from './inline/substitution-scanner.js'
import { resolveSpanGrid } from '../table/table-spans.js'
import { isCarveWhitespace, trimEndNonNbsp, trimEndSpaceTab } from '../trim-non-nbsp.js'
import { codeContent } from '../verbatim-payload.js'
import {
  dropTrailingSpaces,
  expandLineBlockWhitespace,
  restoreVerseGaps,
  verseSourceOffset,
} from './block/verse-whitespace.js'
import { replaceLoneSurrogates } from '../well-formed.js'

export function hasInvalidContainerMetadata(line: string): boolean {
  return RE_VALID_ADMONITION_OPEN.exec(line) === null && RE_CONTAINER_PREFIX.test(line)
}

export function isFigureGroupOpener(line: string, inFigureGroup: boolean): boolean {
  const match = RE_VALID_ADMONITION_OPEN.exec(line)
  return match !== null && match[2] === 'figure' && match[3] === undefined && match[4] === undefined && !inFigureGroup
}

/** The separator run on a description line, wherever it is indented. */
export const RE_DEFLIST_SEPARATOR = /^[ \t]*:( +)/
/**
 * A link reference definition, as PART 9R's `linkDefs` symbol table describes
 * it: `label -> (url, title?, attrs?)`. `attrs` come from a TRAILING attribute
 * block on the definition line and transfer to every link that resolves the
 * label (PART 9R R1, carve#604).
 */

/**
 * The ASCII punctuation a backslash escapes into an `escaped_text` node
 * (grammar `ascii_punctuation`, the full set including `& : ; ?`).
 *
 * Exported because the HTML importer rebuilds an `escaped_text` from PART 10
 * §13a's `data-carve-escaped` carrier and has to ask the question this parser
 * asks: a character outside the set spells no escape, and writing one back
 * emits a literal backslash the source never held.
 */
export const RE_ESCAPABLE_PUNCTUATION = /[\\`*_{}\[\]()#+\-.!~^/<>@%|=,"'$&:;?]/

/**
 * Whether the `%%` at `i` opens the trailing inline comment form.
 *
 * A marker needs an immediately preceding SPACE or the start of its host run.
 * A line break also starts a run; tabs are content (CARVE-P9-041).
 *
 * A balanced bracket label starts a host run at `runStart`. Inside emphasis the marker
 * has the opening delimiter in front of it, which is not a separator, so
 * `/%% c/` keeps its text (corpus 518).
 */
export const opensInlineComment = (text: string, i: number, atRunStart = false, runStart = 0): boolean =>
  text[i] === '%' &&
  text[i + 1] === '%' &&
  (text[i - 1] === ' ' ||
    text[i - 1] === '\n' ||
    (atRunStart && i === runStart))

export function normalizedSourceLines(source: string): string[] {
  if (layoutWork.on) layoutWork.seam += source.length
  const lines = normalizeNewlines(source).split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * True when `source` would be read as OPENING A FRONTMATTER BLOCK.
 *
 * The Carve writer needs this to decide the spelling of a thematic break from
 * the bytes it is about to emit rather than from the source it was given, and
 * "would this be read as frontmatter" is a question only the lexer can answer:
 * the opener needs a CLOSER somewhere below it, so it is a property of the whole
 * text, not of line 1. A first-line regex answers a different question and
 * answers it wrongly in both directions (markup-carve/carve-js#899).
 *
 * The lexer's own `consumeFrontmatter` is run rather than reimplemented, so this
 * cannot drift from the parse it is predicting - which is the whole point of
 * asking the parser instead of pattern-matching.
 */
export function opensFrontmatter(source: string, opts: ParseOptions = {}): boolean {
  // Frontmatter is document-leading, so nothing that does not start with the
  // fence can open one. The gate keeps the line split off the common path.
  if (!source.startsWith('---')) return false
  const lexer = new Lexer(source, opts)
  lexer.consumeFrontmatter()
  return lexer.frontmatter !== undefined
}

// Shared only for the synchronous recursion budget: extensions can re-enter
// public parse(), whose document state belongs to a separate session.
export const inlineDepthState = { value: 0, bareEmphasis: 0 }

/**
 * Hoist every authored `[label]: /url` definition into the document as a
 * `link_reference_definition` node (PART 12 §10, NORMATIVE).
 *
 * It is a NODE rather than a root map because §4 requires a `pos` on everything
 * but the root and a root FIELD cannot carry one - a definition occupies real
 * bytes, and an editor, a formatter and a language server all need to find them.
 * Without it the canonical writer had nowhere to write a definition back from and
 * INLINED every resolved reference instead, which lost `ref`/`rawRef` on the
 * reparse and turned one destination into N (carve-js#690).
 *
 * SOURCE ORDER, not map order: §10 answers "which definition wins" by document
 * order, and the writer has to reproduce the lines where the author put them.
 *
 * Definitions authored inside a block quote or a list item hoist to the document
 * too, which is what §7 already requires of the other two definition kinds; the
 * container keeps the author's remaining content.
 */
export function appendLinkReferenceDefinitions(
  children: BlockNode[],
  lexer: Lexer,
  source: string,
): void {
  const authored: LinkReferenceDefinition[] = []
  for (const [key, def] of lexer.linkDefs) {
    // A definition with no recorded line came from somewhere other than the
    // source scan (a sub-lexer copy for extension content), so there is no line
    // to reproduce and nothing to hoist.
    if (def.line === undefined) continue
    const node: LinkReferenceDefinition = {
      type: 'link_reference_definition',
      label: def.rawLabel ?? key,
      href: def.href,
    }
    if (def.title !== undefined) node.title = def.title
    if (def.attrs) node.attrs = def.attrs
    node.pos = definitionLinePosition(
      lexer.lines, lexer.sourceOffsetMap ?? lexer.lineOffsets, def.line, source.length,
      lexer.lineStartColumn(def.line),
    )
    authored.push(node)
  }
  authored.sort((a, b) => (a.pos?.startOffset ?? 0) - (b.pos?.startOffset ?? 0))
  children.push(...authored)
}

/**
 * An abbreviation definition a `+` skipped stays a document-level `abbreviation_def`
 * (PART 12 §7), placed after the block whose lines it stood among.
 */
export function insertSkippedAbbreviationDefinitions(
  children: BlockNode[],
  lexer: Lexer,
  sourceLines: readonly string[],
  source: string,
): void {
  if (!lexer.skippedAbbreviations?.size) return
  const defs = [...lexer.skippedAbbreviations].sort((a, b) => a[0] - b[0])
  const merged: BlockNode[] = []
  let next = 0
  for (const child of children) {
    const startLine = child.pos?.startLine ?? 0
    while (next < defs.length && defs[next]![0] + 1 < startLine) merged.push(skippedAbbreviation(defs[next++]!))
    merged.push(child)
  }
  while (next < defs.length) merged.push(skippedAbbreviation(defs[next++]!))
  children.length = 0
  for (const node of merged) children.push(node)

  function skippedAbbreviation([line, [abbr, expansion]]: [number, [string, string]]): AbbreviationDef {
    const node: AbbreviationDef = { type: 'abbreviation_def', abbr, expansion: dropTrailingWhitespace(expansion) }
    node.pos = definitionLinePosition(sourceLines, lexer.sourceOffsetMap ?? lexer.lineOffsets, line, source.length,
      lexer.lineStartColumn(line))
    return node
  }
}

// Raw passthrough block: ```=FORMAT … ``` . Content is verbatim; the
// renderer emits it only when FORMAT matches the output (html).
export function parseRawBlock(lexer: Lexer): RawBlock {
  const start = lexer.pos
  const m = RE_RAW_FENCE.exec(lexer.consume())!
  const marker = m[1]!
  const format = m[2]!
  const closeRe = fenceCloseRe(marker)
  const lines: string[] = []
  let lastPayloadLineIndex = -1
  let closed = false
  while (!lexer.eof()) {
    if (lexer.attachmentBoundaries.has(lexer.lineNumber(lexer.pos))) break
    const ln = lexer.peek()!
    if (closeRe.test(ln)) {
      lexer.consume()
      closed = true
      break
    }
    lastPayloadLineIndex = lexer.pos
    lexer.consume()
    // SAME AS `parseFence`, and for the same reason: the frame did its work in
    // the closer test above, keeping a closing run the CONTAINER folded in from
    // closing this block, and a verbatim body is where a framed line becomes
    // text. Without this the sentinel reached rendered raw output on 180 of 400
    // nested raw-fence documents - a `=FORMAT` lead is a fence too, so the
    // collector frames its folded lines exactly as it does a code fence's.
    lines.push(stripLazyFrame(ln))
  }
  if (!closed) lexer.reportUnclosedCodeFence(start, marker, 0)
  const terminated = !lexer.documentLacksFinalBreak || lastPayloadLineIndex < 0 || lexer.lineNumber(lastPayloadLineIndex) < lexer.documentLineCount
  return { type: 'raw_block', format, content: codeContent(lines, terminated) }
}

export const definitionListHelpers = { ...listHelpers,
  openFenceScanner,
  trackItemLazyState,
  RE_ABBR_DEF,
  RE_COMMENT_BLOCK_ANY,
  RE_HEADING,
  commentLineContent,
  descriptionLeadFenceScans,
  dropTrailingWhitespace,
  endsHeadingOrQuote,
  isTableRow,
  markerRunListIsQuoteHeld,
  nestedItemHoldsOpenParagraph,
  parseCommentBlock,
  sourceColumnAt,
  trimEndSpaceTab,
}
export const parseDefinitionListWithHelpers = createDefinitionListParser(definitionListHelpers)

export const linkDefinitionHelpers = { ...listHelpers,
  RE_ABBR_DEF,
  RE_AFTER_TERM,
  RE_COMMENT_BLOCK_ANY,
  RE_DEFLIST_SEPARATOR,
  commentCloserInScope,
  composeContainerPrefix,
  containerQuoteDepth,
  dropTrailingWhitespace,
  normalizeRefLabel,
  parseAttrs,
  prepassMarker,
  prepassOpensBlock,
  scopeHoldsLine,
  spendLazyProbeBudget,
  stripContainerPrefixes,
  stripContainerPrefixesKeepIndent,
  trackWrappedAttributeRun,
  unescapeAttrValue,
  utf8ByteLength,
}
export const collectLinkDefsWithHelpers = createLinkDefinitionCollector(linkDefinitionHelpers)

export const inlineScannerHelpers = { ...listHelpers,
  ATTR_INERT_PREV,
  FORCED_TYPE,
  MAX_NESTING_DEPTH,
  NO_OPEN_KINDS,
  RE_AUTOLINK,
  RE_BRACED_EN_DASH,
  RE_CROSSREF,
  RE_ESCAPABLE_PUNCTUATION,
  RE_EXTENSION_OPEN,
  extensionCloses,
  RE_FOOTNOTE_REF,
  RE_INLINE_ATTR,
  RE_MENTION,
  RE_RAW_INLINE,
  RE_REF_TAIL,
  RE_SPAN_TAIL,
  RE_SYMBOL,
  RE_TAG,
  accumulateAttrs,
  buildBracketMap,
  completeDestinationOpeners,
  destinationSlotEnds,
  crossrefBodyCanEnd,
  execLinkTail,
  extendsGrapheme,
  isEmptyAttrs,
  isValidInlineAttrPayload,
  lastEmittedGlyph,
  newEmphasisMemo,
  opensInlineComment,
  parseAttrs,
  referenceImage,
  referenceLink,
  spanAttrProvablyInvalid,
  splitBracedOpener,
  stripVerbatimPadding,
  suffixHasChar,
  suffixHasPair,
  symbolOpensAt,
  trimEndSpaceTab,
  trimStructural,
  unescapeAttrValue,
  verbatimSpanEnd,
  get inlineDepth() { return inlineDepthState.value - inlineDepthState.bareEmphasis },
}
export const scanInlineInnerWithHelpers = createInlineScanner(inlineScannerHelpers)

export const parseListWithHelpers = createListParser(listHelpers, trackItemLazyState)

// ============================================================================
// Attribute block parsing — {#id .class key=value key="value with spaces"}
// ============================================================================

export const lineBlockHelpers = {
  RE_LINE_BLOCK_OPEN,
  collectLiteralColonFenceBody,
  dropTrailingSpaces,
  expandLineBlockWhitespace,
  inlineSource,
  isBlankLine,
  mapInlineChildren,
  restoreVerseGaps,
  stripLazyFrame,
  stripPositions,
  trimEndSpaceTab,
  verseSourceOffset,
  visitInlineChildren
}
export const parseLineBlockWithHelpers = createLineBlockParser(lineBlockHelpers)

export const tableBlockHelpers = {
  RE_CAPTION,
  RE_TABLE_CONT,
  inlineSource,
  isBlankLine,
  isGfmDelimiterRow,
  isTableRow,
  joinFragment,
  openVerbatimRun,
  parseCellMarkers,
  resolveSpanGrid,
  rowAttrsFromLine,
  splitTableRowSpans,
  stripPositions,
  stripPositionsOutsideRow,
  trimCellPadding
}
export const parseTableBlock = createTableBlockParser(tableBlockHelpers)

/** State owned by one synchronous parse operation. */

export {
  AttachmentFenceClosers,
  GENERATED_CONTENT_KINDS,
  Lexer,
  RE_AUTOLINK_STICKY,
  SubstitutionScanner,
  abortedSubstitutions,
  accumulateAttrs,
  applyAbbreviations,
  applyLinkDefs,
  backtickRunEnds,
  codeContent,
  crossrefBodyCanEnd,
  delimitedTable,
  dropPositions,
  extendsGrapheme,
  indentColumns,
  inlineOpaqueEnds,
  isCarveWhitespace,
  linkDestinationValue,
  markAboveContentColumn,
  markCaptionAtContentColumn,
  markSecondLineLazy,
  normalizeNewlines,
  replaceLoneSurrogates,
  setDelimitedPayloadLines,
  sliceColumns,
  toCodepointPositions,
  trimEndNonNbsp,
  trimEndSpaceTab,
  unescapeAttrValue,
  utf8ByteLength,
  verbatimSpanEnd,
}
export type {
  Admonition,
  Attrs,
  BlockNode,
  BlockQuote,
  CarveExtension,
  CitationGroup,
  CodeBlock,
  DefinitionList,
  Directive,
  Div,
  Document,
  Emphasis,
  Figure,
  FigureGroup,
  Heading,
  HeadingLevel,
  Image,
  InlineMatch,
  InlineNode,
  InlineScannerSession,
  LineBlock,
  LineBlockHost,
  List,
  MatcherContext,
  Math,
  Paragraph,
  Position,
  SmartPunctuation,
  Table,
  TableBlockHost,
  Text,
  ThematicBreak,
  VerbatimCellWrap,
}

import {
  RE_ABBR_DEF,
  RE_CONTAINER_PREFIX,
  RE_HEADING,
  RE_LINE_BLOCK_OPEN,
  RE_RAW_FENCE,
  RE_TABLE_CONT,
  RE_VALID_ADMONITION_OPEN,
  composeContainerPrefix,
  containerQuoteDepth,
  isTableRow,
  prepassMarker,
  prepassOpensBlock,
  rowAttrsFromLine,
  scopeHoldsLine,
  spendLazyProbeBudget,
  splitTableRowSpans,
  stripContainerPrefixes,
  stripContainerPrefixesKeepIndent,
  stripLazyFrame,
  trimStructural,
} from './parse-prepass-core.js'
export {
  FOOTNOTE_BODY_COLUMN,
  RE_INVISIBLE_BLOCK_LEAD,
  closerReachesBase,
  commentCloserLookup,
  coveredNoteComment,
  dropTrailingWhitespace,
  endsHeadingOrQuote,
  groupLineContent,
  insideOpenFence,
  isParentAuthoredBlock,
  lineOpensItemBlock,
  listStateHelpers,
  markerNoteCommentFenceOpeners,
  markerNoteFenceReach,
  markerNoteOpenerReach,
  openVerbatimRun,
  quotePrefixDepth,
  readCaptionText,
  sourceColumn,
  sourceQuotePrefixEnd,
  trackItemLazyState,
  verbatimOnlyLazyState,
} from './block/parse-block-boundaries.js'
export type { DefListOpening, GroupCloserMemo, ItemLazyState, ItemOpaqueState } from './block/parse-block-boundaries.js'
export {
  MAX_NESTING_DEPTH,
  RE_AFTER_TERM,
  RE_ANY_COLON_CLOSER,
  RE_ANY_FENCE_CLOSER,
  RE_ORDERED_HEAD,
  RE_TASK_HEAD,
  RE_UNORDERED_HEAD,
  attachDocumentOffsets,
  bodyHoldsClosableCommentSpan,
  bodyHoldsOpenCommentSpan,
  buildCloserIndex,
  closerIndex,
  codeCloserPossible,
  collectColonFenceBody,
  collectLiteralColonFenceBody,
  colonFenceKind,
  commentBlockHasCloser,
  commentCloserInScope,
  commentLineContent,
  commentRunLines,
  commentScopeEnd,
  consumeOpaqueColonFenceBodySpan,
  declinePositions,
  exactCloserPossible,
  finishCodeCloserIndex,
  literalCommentHasCloser,
  markerContentColumn,
  markerFreeContent,
  markerMatch,
  nestedColonLexer,
  nestedSubLexer,
  newCommentSpanScan,
  orderedMatch,
  parentLineIndices,
  parseCommentBlock,
  quotedCommentHasCloser,
  stripPositions,
  stripPositionsOutsideRow,
  subLexer,
  taskMatch,
  unclosedContainerFromOpener,
  unorderedMatch,
  withoutSyntheticIndent,
} from './block/parse-block-scan-core.js'
export type {
  CloserIndex,
  ColonFenceBody,
  ColonFenceBodyLine,
  ColonFenceBodyView,
  ColonFenceOpener,
  CommentScopeMemo,
  CommentSpanScan,
  DanglingBlockAttributes,
  ParseOptions,
  RefusedContinuationMarker,
  OverindentedOpenerReport,
  StrippedLineOrigin,
  UnclosedCodeFence,
  UnclosedContainer,
} from './block/parse-block-scan-core.js'
export {
  ATTR_INERT_PREV,
  BRACED_OPENER_MARKERS,
  ELISION_WORDS,
  FORCED_TYPE,
  leadingCommentsEnd,
  NO_OPEN_KINDS,
  PAIR_MARKERS,
  QUOTE_LETTER_RUN,
  RE_BRACED_EN_DASH,
  RE_CROSSREF,
  RE_EMPTY_LINK_REST_STICKY,
  RE_EXTENSION_OPEN,
  extensionCloses,
  RE_FOOTNOTE_REF,
  RE_LINK_REST_STICKY,
  RE_MENTION,
  RE_RAW_INLINE_FORMAT,
  RE_RAW_INLINE_STICKY,
  RE_REF_TAIL,
  RE_SPAN_TAIL,
  RE_SYMBOL,
  RE_TAG,
  SMART_TOKENS,
  allocateDashes,
  anchorRangeAt,
  atomicLinkRegions,
  closesAfterDash,
  codePointAfter,
  combinedSpanCloser,
  emphasisBrackets,
  execLinkTail,
  flankCharAt,
  inlineSource,
  isFlankSpace,
  isQuoteAlnum,
  isQuoteOpenContext,
  isQuoteSpace,
  lastEmittedGlyph,
  linkDestinations,
  newEmphasisMemo,
  splitBracedOpener,
  stripVerbatimPadding,
  symbolOpensAt,
} from './inline/parse-inline-core.js'
export type { AnchorRange, BarePair, EmphasisMatch, EmphasisMemo, InlinePairView, InlineSource } from './inline/parse-inline-core.js'
export {
  OpenMarkerClassifier,
  RE_COLON_RUN,
  RE_FIRST_BLOCK_MARKER,
  authoredTaskState,
  commentBlockSpans,
  deflistContentCol,
  deflistMarkerLine,
  descriptionLeadFenceScans,
  fencedBlockEnd,
  findColonCloser,
  firstBlockOpenerContent,
  insideOpenQuoteParagraph,
  isInvisibleLine,
  isPhysicalContinuationMarker,
  isRetainableLineComment,
  isStackedFirstBlockQuoteMarker,
  lazyContinuationEndsList,
  listHelpers,
  quotedNoteFirstBlockMarker,
  markerClassifiers,
  markerDecision,
  markerRunListIsQuoteHeld,
  matchListMarker,
  matchedCommentFenceEnd,
  nestedItemHoldsOpenParagraph,
  olKindMatches,
  olKindOf,
  olStartOf,
  olTypeOf,
  opaqueSpanEnd,
  orderedContinues,
  parseAbbrDef,
  quoteBodyColumn,
  quoteIndentHasTab,
  restoreVerbatimBlanks,
  romanToInt,
  sourceColumnAt,
  sourceQuoteBody,
  sourceQuoteLocalColumn,
  sourceQuoteRest,
  unorderedMarkerChar,
  verbatimOpener,
} from './list/parse-item-core.js'
export type {
  AttachedScan,
  AttachedViewScan,
  DescendantOpaque,
  ItemLineFacts,
  MarkerDecision,
  OlKind,
  OpenMarker,
} from './list/parse-item-core.js'
export {
  EMPTIED_CONTAINER_MARKUP,
  ENDS_AT_LAST_PLACED_CHILD,
  FENCE_TRAILING_WS,
  INDENT_LATITUDE,
  LAZY_FRAME,
  RE_ABBR_DEF,
  RE_ADMONITION_CLOSE,
  RE_ADMONITION_OPEN,
  RE_BLOCKQUOTE,
  RE_COMMENT_BLOCK,
  RE_COMMENT_LINE,
  RE_CONTAINER_PREFIX,
  RE_CONTINUATION_MARKER,
  RE_DEFLIST_TERM,
  RE_DESCRIPTION_PREFIX,
  RE_DESCRIPTION_PREFIX_AT,
  RE_DIV_OPEN,
  RE_EMPTY_LINK_DEF,
  RE_FENCE,
  RE_FOOTNOTE_DEF,
  RE_HARDBREAKS_OPEN,
  RE_HEADING,
  RE_HR,
  RE_ITEM_ATTR,
  RE_ITEM_ATTR_HEAD,
  RE_LINE_BLOCK_OPEN,
  RE_LINK_DEF,
  RE_ORDERED,
  RE_PREPASS_MARKER,
  RE_PREPASS_MARKER_STRIP,
  RE_PREPASS_MARKER_STRIP_AT,
  RE_QUOTE_BLOCK_OPEN,
  RE_QUOTE_RUN,
  RE_RAW_FENCE,
  RE_TABLE_CONT,
  RE_TABLE_ROW,
  RE_TASK,
  RE_TASK_CONTENT_HEAD,
  RE_UNORDERED,
  RE_VALID_ADMONITION_OPEN,
  attachBlockPos,
  balancedLabelMatcher,
  composeContainerPrefix,
  consumeLooseKey,
  containerQuoteDepth,
  deriveTableMetadata,
  explicitlyClosedQuotes,
  extractItemAttr,
  isBlockAttributeLine,
  isColonFenceOpener,
  isContinuationMarker,
  isLinkDefLine,
  isListMarkerLine,
  isTableRow,
  lazyProbeCost,
  lazyProbeFrame,
  leadingWhitespace,
  lineOpensBlock,
  markedDelimitedTable,
  matchLinkDef,
  parseBlockAttributeRun,
  peekBlockAttributes,
  prepassMarker,
  prepassOpensBlock,
  probeBlockAttributes,
  rowAttrsFromLine,
  scopeHoldsLine,
  spendLazyProbeBudget,
  splitTableRow,
  splitTableRowSpans,
  stripContainerPrefixes,
  stripContainerPrefixesKeepIndent,
  stripLazyFrame,
  trimStructural,
  tryCollectBlockAttributes,
} from './parse-prepass-core.js'
export type {
  ItemAttributeMarker,
  LazyProbeFrame,
  LinkDefMatch,
  OpenContainer,
  PeeledContainer,
  PendingAttrCarry,
  PrepassScope,
} from './parse-prepass-core.js'
export {
  PREFIX_WINDOW,
  RE_BACKTICK_FENCE_CLOSE_3,
  RE_BARE_IMAGE,
  RE_CAPTION,
  RE_COMMENT_BLOCK_ANY,
  RE_DEFLIST_DEF,
  RE_FENCE_CLOSER,
  RE_TILDE_FENCE_CLOSE_3,
  blockQuoteParagraphClaimOpen,
  blockQuoteParagraphOpen,
  bottomBlockLeavesParagraphOpen,
  classifyQuotedLine,
  closeBlockQuoteParagraph,
  colonBlockOpenerRun,
  colonFenceOpenerLen,
  colonFenceShapeEndsLazyContinuation,
  commentFenceRun,
  continueWrappedAttributeBlock,
  demoteQuotedColonCandidates,
  endsInPlus,
  fenceCloseRe,
  fenceCloserMemoRefutes,
  payloadFenceHasCloser,
  hostedAuthoredBlockOpener,
  imageIsBlock,
  isBlockImageLine,
  markerLineBottomBlock,
  markerLineQuoteState,
  markerLineState,
  markerPrefixLength,
  opaqueGroupCloser,
  openQuoteDepth,
  openFenceScanner,
  opensCodeFence,
  opensSublistHere,
  opensWrappedAttributeBlock,
  prefixWalkBound,
  quotePrefixLength,
  quotedLineText,
  startsInterruptingBlock,
  trackBlockQuoteLazyState,
  trackQuoteHostFence,
  trackWrappedAttributeRun,
  walkContainerPrefix,
  walkMarkerOwnerPrefix,
} from './block/parse-quote-core.js'
export type {
  BlockQuoteLazyMode,
  BlockQuoteLazyState,
  FenceCloserMemoEntry,
  OpaqueGroup,
  QuoteDescent,
  QuoteFenceHosts,
  QuoteLazyHint,
  QuotedFenceCloserMemo,
} from './block/parse-quote-core.js'
export {
  TABLE_ALIGNMENT_MARKERS,
  cellPayloadIsSpanMarker,
  isGfmDelimiterCell,
  isGfmDelimiterRow,
  joinFragment,
  parseCellMarkers,
  readCellAttributeBlock,
  scanCellMarkerRun,
  trimCellPadding,
} from './table/parse-table-cells.js'
export type { FragmentPlace, RawCell } from './table/parse-table-cells.js'

import { RE_CAPTION, RE_COMMENT_BLOCK_ANY, fenceCloseRe, openFenceScanner, trackWrappedAttributeRun } from './block/parse-quote-core.js'

import type { ParseOptions } from './block/parse-block-scan-core.js'
import {
  MAX_NESTING_DEPTH,
  RE_AFTER_TERM,
  collectLiteralColonFenceBody,
  commentCloserInScope,
  commentLineContent,
  parseCommentBlock,
  stripPositions,
  stripPositionsOutsideRow,
} from './block/parse-block-scan-core.js'

import {
  dropTrailingWhitespace,
  endsHeadingOrQuote,
  openVerbatimRun,
  trackItemLazyState,
} from './block/parse-block-boundaries.js'

import {
  ATTR_INERT_PREV,
  FORCED_TYPE,
  NO_OPEN_KINDS,
  RE_BRACED_EN_DASH,
  RE_CROSSREF,
  RE_EXTENSION_OPEN,
  extensionCloses,
  RE_FOOTNOTE_REF,
  RE_MENTION,
  RE_REF_TAIL,
  RE_SPAN_TAIL,
  RE_SYMBOL,
  RE_TAG,
  execLinkTail,
  inlineSource,
  lastEmittedGlyph,
  newEmphasisMemo,
  splitBracedOpener,
  stripVerbatimPadding,
  symbolOpensAt,
} from './inline/parse-inline-core.js'

import { isGfmDelimiterRow, joinFragment, parseCellMarkers, trimCellPadding } from './table/parse-table-cells.js'

import {
  descriptionLeadFenceScans,
  listHelpers,
  markerRunListIsQuoteHeld,
  nestedItemHoldsOpenParagraph,
  sourceColumnAt,
} from './list/parse-item-core.js'
