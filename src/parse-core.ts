import type { BracketClose,CrossrefMemo } from './parse-brackets.js'
import { RE_AUTOLINK,RE_AUTOLINK_STICKY,buildBracketMap,crossrefBodyCanEnd,verbatimSpanEnd } from './parse-brackets.js'
import { createDefinitionListParser } from './parse-definition-list.js'
import {
  RE_INLINE_ATTR,
  RE_RAW_INLINE,
  inlineOpaqueEnds,
  spanAttrProvablyInvalid,
  suffixHasChar,
  suffixHasPair,
} from './parse-inline-opaque.js'
import { createInlineScanner,type InlineScannerSession } from './parse-inline-scanner.js'
import { createLineBlockParser,type LineBlockHost } from './parse-line-block.js'
import { createLinkDefinitionCollector } from './parse-link-definitions.js'
import { createListStateTracker } from './parse-list-state.js'
import { createRebasePass } from './parse-rebase.js'
import { createTableBlockParser,type TableBlockHost } from './parse-table-block.js'
export { mergeAttrs } from './attribute-merge.js'
export { parseAttrs } from './attribute-parser.js'
export type { LinkDef } from './inline-resolution.js'
export { normalizeRefLabel } from './label-key.js'
export {
  AUTOLINK_BODY_EXCLUDED,
  RE_AUTOLINK,
  buildBracketMap,
  forEachCrossrefRun,
  rawBracketRunCloses,
  rawImageBracketRunCloses,
} from './parse-brackets.js'
export type { BracketClose,CrossrefMemo } from './parse-brackets.js'
export { isBlankLine,layoutWork } from './parse-lexer.js'
/*
 * Carve parser — linear-time, block + inline.
 *
 * Block lexer reads line by line; inline parser does a single scan
 * over each block's text content. No backtracking.
 */

import { utf8ByteLength } from './abbr-budget.js'
import { AppendOnlyCloser } from './append-only-closer.js'
import type {
AbbreviationDef,
Admonition,
Attrs,
BlockNode,
BlockQuote,
CitationGroup,
CodeBlock,
Comment,
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
TaskState,
Text,
ThematicBreak,
VerbatimCellWrap
} from './ast.js'
import { GENERATED_CONTENT_KINDS,SMART_PUNCTUATION_GLYPHS } from './ast.js'
import { AttachmentFenceClosers,FailedScanRanges } from './attachment-fence-closers.js'
import { accumulateAttrs } from './attribute-merge.js'
import { isEmptyAttrs,isValidInlineAttrPayload,parseAttrs,unescapeAttrValue } from './attribute-parser.js'
import { backtickRunEnds } from './backtick-run-index.js'
import { delimitedTable,setDelimitedPayloadLines } from './delimited-table.js'
import type { CarveExtension,InlineMatch,MatcherContext } from './extension.js'
import { extendsGrapheme } from './grapheme-extender.js'
import type { AsciiHeadingIdMode } from './heading-ids.js'
import { mapInlineChildren,visitInlineChildren } from './inline-children.js'
import { applyAbbreviations,applyLinkDefs } from './inline-resolution.js'
import { normalizeRefLabel } from './label-key.js'
import {
  RE_EMPTY_LINK_REST,
  RE_LINK_REST,
  completeDestinationOpeners,
  linkDestinationValue,
  scanDestination,
} from './link-destination.js'
import { LiteralCommentClosers } from './literal-comment-closers.js'
import { markAboveContentColumn,markSecondLineLazy } from './paragraph-indent.js'
import { Lexer,TRAILING_WS,indentColumns,isBlankLine,layoutWork,normalizeNewlines,sliceColumns } from './parse-lexer.js'
import { createListParser } from './parse-list.js'
import { referenceImage,referenceLink } from './reference-resolution.js'
import { ScopedFenceClosers } from './scoped-fence-closers.js'
import { definitionLinePosition,dropPositions,toCodepointPositions } from './source-positions.js'
import { SubstitutionScanner } from './substitution-scanner.js'
import { resolveSpanGrid } from './table-spans.js'
import { isCarveWhitespace,trimEndNonNbsp,trimEndSpaceTab,trimNonNbsp } from './trim-non-nbsp.js'
import { codeContent } from './verbatim-payload.js'
import { dropTrailingSpaces,expandLineBlockWhitespace,restoreVerseGaps,verseSourceOffset } from './verse-whitespace.js'
import { replaceLoneSurrogates } from './well-formed.js'

export interface ParseOptions {
  /**
   * Record source positions on the returned tree. Default true. Set false for
   * a smaller tree to serialize or compare. Internal spans needed for source
   * ownership remain available during parsing; lint and source-line rendering
   * require positions. This option is not a guarantee of faster parsing.
   */
  positions?: boolean
  /** Format label applied to a bare `---` frontmatter fence. Default 'yaml'. */
  defaultFrontmatterFormat?: string
  /**
   * Lowercase auto-generated heading ids (GitHub/SSG-style anchors), folded per
   * code point so it stays portable. Default false: ids are case-preserving.
   * Cross-references compare ids exactly either way.
   */
  lowercaseHeadingIds?: boolean
  /**
   * Fold auto-generated heading ids to ASCII for share-safe URL/CSS-fragment
   * portability. Default false (off). `true` / `'fold'` is best-effort:
   * transliterate non-ASCII, but scripts the map can't handle (Greek, CJK,
   * Arabic, emoji) are kept verbatim. `'strict'` additionally drops that
   * unmappable residue, guaranteeing a pure-ASCII id (a heading made entirely
   * of unmappable script then falls back to `s`). Orthogonal to
   * `lowercaseHeadingIds`; combine both for a fully lowercase ASCII slug.
   */
  asciiHeadingIds?: AsciiHeadingIdMode
  /**
   * Extensions whose parse-stage matchers (`matchInline` / `matchBlock`) add
   * syntax to the parse. Extensions with only render/transform hooks need not
   * be passed here; `carveToHtml` forwards them automatically.
   */
  extensions?: CarveExtension[]
  /**
   * Called for each colon-fence container opener that is still open when its
   * containing parse reaches end of input. This reports parser state that is
   * intentionally not serialized into the AST.
   */
  onUnclosedContainer?: (container: UnclosedContainer) => void
  onUnclosedCodeFence?: (fence: UnclosedCodeFence) => void
  onRefusedContinuationMarker?: (marker: RefusedContinuationMarker) => void
  /** Reports a recognized container whose malformed metadata was dropped. */
  onInvalidContainerMetadata?: (container: UnclosedContainer) => void
  /**
   * Called for each block-attribute run that reached no block, because the
   * document or the container holding it ended first (PART 9 §15 A4). Like
   * {@link onUnclosedContainer}, this reports parser state that is intentionally
   * not serialized: nothing is emitted for the run, so the AST cannot say it was
   * ever written.
   */
  onDanglingBlockAttributes?: (run: DanglingBlockAttributes) => void
}

export interface DanglingBlockAttributes {
  line: number
  column: number
  startOffset: number
  endOffset: number
  /**
   * Set when the run is the ENTIRE body of a footnote definition or a
   * description, where deleting the line destroys the construct rather than
   * tidying it (PART 2, MARKER REQUIRES CONTENT).
   */
  wholeBodyOf?: 'footnote' | 'description'
}

export interface UnclosedContainer {
  kind: 'div' | 'admonition' | 'directive' | 'line block' | 'hard-break block' | 'block quote'
  line: number
  column: number
  startOffset: number
  endOffset: number
  fenceWidth: number
}

export interface UnclosedCodeFence {
  line: number
  column: number
  marker: string
  endLine: number
  reason: 'document' | 'container' | 'continuation'
}

export interface RefusedContinuationMarker {
  line: number
  column: number
  host: 'document' | 'list item' | 'definition description' | 'footnote' | 'block quote'
  reason: 'blank' | 'document' | 'sibling' | 'left' | 'right' | 'wrong-column'
  firstBlock?: boolean
}
/** A colon run, whichever of the colon-fence blocks it goes on to open. */
export const RE_COLON_RUN = /^:{3,}/

/** PART 11 §6g. A checked box records nothing: `[X]` and `[x]` are one state. */
export function authoredTaskState(state: string, checked: boolean): TaskState | undefined {
  if (checked || state === ' ') return undefined
  return state as TaskState
}

export const trimCellPadding = (text: string): string => {
  let start = 0
  let end = text.length
  while (start < end && text.charCodeAt(start) === 0x20) start++
  while (end > start && text.charCodeAt(end - 1) === 0x20) end--
  if (start === 0 && end === text.length) return text

  return text.slice(start, end)
}

export const RE_FIRST_BLOCK_MARKER = new RegExp('^[ \\t]*\\+' + TRAILING_WS)

export function isPhysicalContinuationMarker(line: string): boolean {
  return /^(?:>(?: ?))*\+[ \t]*$/.test(line)
}

export function isStackedFirstBlockQuoteMarker(line: string): boolean {
  return /^[ \t]*(?:(?:[-*] (?:\[[ xX]\] )?|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z])[.)] )+|: +|\[\^[^\]]+\]: +)(?:> ?)+\+[ \t]*$/.test(line.replace(/^(?:> ?)+/, ''))
}

export function firstBlockOpenerContent(line: string): boolean {
  if (!endsInPlus(line)) return false
  let rest = line.trimStart()
  for (let depth = 0; depth < 8; depth++) {
    if (isContinuationMarker(rest)) return true
    const marker = taskMatch(rest) ?? unorderedMatch(rest) ?? orderedMatch(rest)
    if (marker !== null) { rest = marker.at(-1) ?? ''; continue }
    const quote = quotedLineText(rest, false)
    if (quote !== null) { rest = quote; continue }
    return false
  }
  return false
}

export function hasInvalidContainerMetadata(line: string): boolean {
  return RE_VALID_ADMONITION_OPEN.exec(line) === null && RE_CONTAINER_PREFIX.test(line)
}

export function isFigureGroupOpener(line: string, inFigureGroup: boolean): boolean {
  const match = RE_VALID_ADMONITION_OPEN.exec(line)
  return match !== null && match[2] === 'figure' && match[3] === undefined && match[4] === undefined && !inFigureGroup
}

/**
 * Whether `line`, read at its own content, is a definition TERM or DESCRIPTION
 * marker line. Both patterns are anchored, so the indentation comes off first.
 */
export const deflistMarkerLine = (line: string): boolean => {
  const flush = line.replace(/^[ \t]+/, '')
  return RE_DEFLIST_TERM.test(flush) || RE_DEFLIST_DEF.test(flush)
}

/**
 * The content column a description marker hands its body out at: `:` plus the
 * width of its separator run.
 *
 * Named because the prepass, the fence scope and the body collector all measure
 * against it, and a rule with several spellings is how one of them comes to
 * answer differently (carve#755) - which is exactly what happened to the fixed
 * `3` this replaces.
 */
export function deflistContentCol(separator: string): number {
  return 1 + separator.length
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

// A footnote body's own column: the indent §16 requires of a continuation line.
// The body is dedented by exactly this much, never by the first continuation
// line's actual indent - see `parseFootnoteDef` (carve-js#677).
export const FOOTNOTE_BODY_COLUMN = 2
// NO TRAILING WHITESPACE (PART 2, NORMATIVE; carve#926). A `whitespace` run at
// the END OF A CONTENT LINE is DROPPED. It does not reach the output and it is
// not content.
//
// TWO THINGS WERE NARROWER HERE. The class was `[ \t\f\r]`, and `whitespace` in
// this language is a SPACE OR A TAB and nothing else (PART 1, carve#890) - so a
// trailing form feed was dropped from a heading and a caption while every other
// invisible character survived, for no reason the grammar states. U+000C and
// U+000B are CONTENT, exactly as U+00A0 and U+FEFF already were here.
//
// And the rule held only on a BLOCK'S FINAL LINE. It holds on every content
// line - see `dropTrailingWhitespace` below. PART 12 §7 asserted the opposite,
// twice, claiming a space before a SOFT BREAK renders `<p>a \nb</p>` and
// arguing from that claim that stripping breaks `to_html(fmt(x)) ==
// to_html(x)`. It has been corrected: the executable spec does not render it
// that way, and the PARSER is the half that moves.

/**
 * `text` with EVERY line's trailing space-and-tab run removed.
 */
export function dropTrailingWhitespace(text: string): string {
  let from = 0
  let pieces: string[] | undefined
  for (let end = text.indexOf('\n');;) {
    if (end < 0) end = text.length
    let keep = end
    while (keep > from && (text.charCodeAt(keep - 1) === 32 || text.charCodeAt(keep - 1) === 9)) keep--
    if (keep !== end) {
      (pieces ??= []).push(text.slice(from, keep))
      from = end
    }
    if (end === text.length) break
    end = text.indexOf('\n', end + 1)
  }
  return pieces ? pieces.join('') + text.slice(from) : text
}

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

// Maximum block-container nesting depth, applied UNIFORMLY to blockquote, list,
// fenced-div / admonition (and footnote) nesting. Each level recurses
// parseBlocks -> parseBlock -> parseContainer -> parseBlocks, so unbounded
// nesting (e.g. `> ` repeated thousands of times, a deeply indented list, or a
// stack of varied-length `:::` fences) would overflow the call stack. Every
// container sub-lexer carries `depth = parent.depth + 1` and re-enters
// parseBlockInner, where this single gate degrades the opener to literal
// paragraph text past the cap - so all container kinds flatten the same way
// rather than crashing. The same constant also bounds the inline recursion
// (see scanInline). Far above any real document; only adversarial input reaches
// it. Exported so callers/tests can assert the exact, shared cap.
export const MAX_NESTING_DEPTH = 200

export function normalizedSourceLines(source: string): string[] {
  if (layoutWork.on) layoutWork.seam += source.length
  const lines = normalizeNewlines(source).split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function subLexer(
  source: string | readonly string[],
  opts: ParseOptions,
  lineNumberOffset: number,
  sourceLineMap?: number[],
  unclosedContainerKeys?: Set<string>,
  inherited?: Lexer,
): Lexer {
  const sub = new Lexer(source, opts, lineNumberOffset, unclosedContainerKeys, inherited)
  if (sourceLineMap) sub.sourceLineMap = sourceLineMap
  // A source fragment's EOF uses the same line coordinates as its payload.
  if (typeof source === 'string') sub.documentLineCount = sub.lineNumber(sub.lineCount - 1)
  return sub
}

/** Recorded at a literal prefix strip; discard if later collection changes the text. */
export interface StrippedLineOrigin {
  text: string
  parentIndex: number
  prefix: number
  /** Virtual syntax borrows one source boundary but contributes no characters. */
  virtual?: boolean
}

export function nestedSubLexer(
  parent: Lexer,
  lines: readonly string[],
  startLineIndex: number,
  sourceLineMap?: number[],
  origins?: ReadonlyMap<number, StrippedLineOrigin>,
  contiguous = false,
): Lexer {
  // The default map is parallel to the Lexer's OWN lines, which drop one
  // trailing blank (see the constructor), so it is built to that length -
  // the length `normalizedSourceLines` used to report for the joined text.
  // Parallel to the Lexer's OWN lines, which no longer drop a trailing blank
  // from an array source, so the map covers every line handed over.
  contiguous = contiguous && layoutWork.reuseColonViews
  const mapLength = lines.length
  if (layoutWork.on && !sourceLineMap && !contiguous) layoutWork.geometryEntries += mapLength
  const sub = subLexer(
    lines,
    parent.parseOptions,
    parent.lineNumberOffset + startLineIndex,
    sourceLineMap ?? (contiguous ? undefined : Array.from({ length: mapLength }, (_l, i) => parent.lineNumber(startLineIndex + i))),
    parent.unclosedContainerKeys,
    parent,
  )
  sub.columnParent = parent
  sub.columnOrigins = origins
  sub.usesContainerFenceLookahead = true
  sub.nested = true
  sub.documentLineCount = parent.documentLineCount
  sub.documentLacksFinalBreak = parent.documentLacksFinalBreak
  sub.rootLines = parent.rootLines ?? parent.lines
  sub.depth = parent.depth + 1
  sub.inFigureGroup = parent.inFigureGroup
  sub.inFootnoteBody = parent.inFootnoteBody
  sub.hostBody = parent.hostBody
  sub.hostMarkerColumn = parent.hostMarkerColumn
  sub.hostContentColumn = parent.hostContentColumn
  sub.hostQuoteDepth = parent.hostQuoteDepth
  sub.nonAuthoredDefinitionStarts = parent.nonAuthoredDefinitionStarts
  sub.returnedDescriptionOwnerColumns = parent.returnedDescriptionOwnerColumns
  sub.definitionLeadFromItemMarker = parent.definitionLeadFromItemMarker
  sub.consumesHostedLinkDefs = parent.consumesHostedLinkDefs
  if (contiguous) {
    const origin = parent.contiguousOrigin
    sub.contiguousOrigin = { lexer: origin?.lexer ?? parent, start: (origin?.start ?? 0) + startLineIndex }
  } else {
    attachDocumentOffsets(sub, parent, startLineIndex, origins)
  }
  return sub
}

/**
 * Map a sub-lexer's lines back to their DOCUMENT offsets and columns.
 *
 * A container strips a prefix (`> `, `- `, the admonition indent) from each
 * line, and the sub-lexer then measures offsets against that stripped text. Line
 * NUMBERS were already mapped (`sourceLineMap`), which is why a lint diagnostic
 * inside a blockquote had the right line and a column short by the prefix
 * (#444).
 *
 * Only a line that is literally a SUFFIX of its document line gets a mapping:
 * then the prefix width is the length difference and the arithmetic is exact.
 * Anything reconstructed rather than stripped - a line block's expanded leading
 * whitespace, a table's reassembled cells - fails that test and is left alone,
 * because a guessed offset is what PART 12 section 4 forbids. Those keep the
 * behavior they had.
 */
export function attachDocumentOffsets(sub: Lexer, parent: Lexer, startLineIndex: number, origins?: ReadonlyMap<number, StrippedLineOrigin>): void {
  // A parent whose own offsets are local cannot anchor a child: the child would
  // inherit local numbers and believe they were document ones, which is how a
  // list inside a `+`-continued blockquote reported "\n- i" for the text "item".
  if (!parent.hasDocumentOffsets) return
  const offsets: number[] = []
  const widths: number[] = []
  const boundaries: NonNullable<Lexer['sourceBoundaries']> = []
  const prefixMemoLines: boolean[] = []

  // Where a sub-line came from, when its lines are NOT a contiguous run of the
  // parent's. A `+` continuation splices a flush-left block into a quote body
  // and inserts blank separators, and a definition list re-indents its body, so
  // `startLineIndex + i` walks off the real source after the first splice and
  // the suffix test below then fails for every following line - which is why a
  // whole `+`-continued quote came out unplaced (#462).
  //
  // The per-line map already exists: the caller passes it so line NUMBERS are
  // right. This reuses it for offsets by inverting it back to parent indices.
  let previousIndex = -1
  // ALL indices per line number, not one. A `+` continuation's synthetic blank
  // separators borrow the line they sit against, so several sub-lines can carry
  // the same number - and picking one of them blindly chose a blank where the
  // real content line was meant, which failed the suffix test and unplaced a
  // list nested inside the continuation (#462).
  //
  // MEMOIZED ON THE PARENT, because that is all it reads: `parent.lines` and
  // `parent.lineNumber`, both fixed once the Lexer constructor has run. Rebuilt
  // per child it made an ordinary flat list quadratic (see the field's docblock
  // and markup-carve/carve-js#885).

  for (let i = 0; i < sub.lineCount; i++) {
    if (layoutWork.on) layoutWork.geometryEntries++
    const mapped = sub.sourceLineMap?.[i]
    const subLine = sub.lineAt(i)
    if (subLine === undefined) return
    const origin = origins?.get(i)
    if (origin && origin.text === subLine && origin.parentIndex >= previousIndex &&
        (mapped === undefined || mapped === parent.lineNumber(origin.parentIndex))) {
      const parentIndex = origin.parentIndex
      previousIndex = parentIndex
      boundaries.push({ parent, line: parentIndex, start: origin.prefix, synthetic: origin.virtual ? subLine.length : 0 })
      const lead = leadingWhitespace(subLine)
      const anchor = parent.sourceBoundary(parentIndex, origin.prefix + lead)
      offsets.push(anchor.offset - lead)
      widths.push(anchor.column - 1 - lead)
      prefixMemoLines.push(!origin.virtual && parent.prefixMemoAllowed(parentIndex))
      if (!origin.virtual) {
        sub.inheritTerminatorFree(i, parent, parentIndex)
        sub.inheritLeadingWhitespace(i, parent, parentIndex, origin.prefix)
      }
      continue
    }
    let literalSuffix: boolean | undefined
    // A LAZY-FRAMED LINE IS STILL PLACEABLE (markup-carve/carve-js#1624). The
    // frame is three characters no document can spell, prepended by the quote
    // collector, and the line's indentation is stripped with it - so the frame
    // makes the sub-line neither a suffix of its document line nor a
    // synthetic-indent case, and this used to decline the whole sub-lexer.
    // Declining costs every position under it: the folded paragraph and each of
    // its inlines came out with no `pos` at all, while the containers above
    // ended at the line before the text they own. The real content IS a suffix,
    // which is all an anchor needs.
    const unframed = stripLazyFrame(subLine)
    const framed = unframed !== subLine
    const anchorsTo = (candidate: number): boolean => {
      const parentLine = parent.lineAt(candidate) ?? ''
      literalSuffix = parentLine.endsWith(subLine)
      return (
        literalSuffix ||
        parentLine.endsWith(withoutSyntheticIndent(subLine)) ||
        (framed && parentLine.endsWith(unframed))
      )
    }
    const parentIndex =
      mapped === undefined
        ? startLineIndex + i
        : (parentLineIndices(parent).get(mapped) ?? []).find(
            (candidate) => candidate >= previousIndex && anchorsTo(candidate),
          )
    if (parentIndex === undefined) return declinePositions(sub)
    // Document order must not go backwards, or a block spanning first-to-last
    // line reports an end before its start. A map that jumps back is one this
    // cannot reason about, so it declines rather than emitting that.
    if (i > 0 && parentIndex < previousIndex) return declinePositions(sub)
    previousIndex = parentIndex
    const parentLine = parent.lineAt(parentIndex)
    if (parentLine === undefined) return
    // SYNTHESIZED LEADING SPACES. Dedenting a line whose indentation ends in a
    // tab that straddles the content column re-emits the unconsumed columns as
    // spaces (`sliceColumns` with keepResidual), so the sub-line is no longer a
    // literal suffix of its document line - ` \t- c` dedented by 2 becomes
    // `  - c`. Those spaces are not in the source, and charging them to it is
    // what put a nested paragraph at document offset 0 (carve-js#771).
    //
    // The line's real content still IS a suffix, so the anchor is exact when
    // the synthetic run fits inside the prefix the strip removed. Where it does
    // not, there is no honest offset to record and this declines - which now
    // means NO positions rather than local ones (see below).
    const isLiteralSuffix = literalSuffix ?? parentLine.endsWith(subLine)
    if (isLiteralSuffix) {
      sub.inheritTerminatorFree(i, parent, parentIndex)
      sub.inheritLeadingWhitespace(i, parent, parentIndex, parentLine.length - subLine.length)
    }
    prefixMemoLines.push(isLiteralSuffix && (parent.prefixMemoAllowed(parentIndex)))
    let prefix = parentLine.length - subLine.length
    let synthetic = 0
    if (framed && parentLine.endsWith(unframed)) {
      // The frame occupies no source, so the anchor is the unframed content's
      // own prefix - the three characters are charged nowhere. The frame is
      // gone before any length is measured off this line: the paragraph
      // collector strips it as it pushes, which is where a framed line becomes
      // text.
      prefix = parentLine.length - unframed.length
      synthetic = subLine.length - unframed.length
    } else if (!isLiteralSuffix) {
      // Only reached when the line is NOT a literal suffix, which is the
      // straddling-tab case alone - so the synthetic-indent trim is computed
      // here rather than for every line.
      const trimmed = withoutSyntheticIndent(subLine)
      synthetic = subLine.length - trimmed.length
      if (synthetic === 0 || !parentLine.endsWith(trimmed)) return declinePositions(sub)
      prefix = parentLine.length - trimmed.length
      // The residual indentation is a view of the boundary after the tab.
      // It advances no authored source codepoint.
    }

    // A parent frame has already been excluded from its source offset.
    if (!parent.sourceBoundaries?.[parentIndex] && !parent.contiguousOrigin) {
      prefix -= parentLine.length - stripLazyFrame(parentLine).length
    }

    if (boundaries.length <= i) boundaries.push({ parent, line: parentIndex, start: prefix, synthetic })

    const lead = leadingWhitespace(subLine)
    const anchor = parent.sourceBoundary(parentIndex, prefix + Math.max(0, lead - synthetic))
    const offset = anchor.offset - lead
    const width = anchor.column - 1 - lead
    // The virtual base may be negative when synthetic indentation precedes
    // the first source character. Only the projected boundary must be valid.
    if (anchor.offset < 0) return declinePositions(sub)

    // Inline scanners add local indexes to these virtual bases.
    offsets.push(offset)
    widths.push(width)
  }

  sub.prefixMemoLines = prefixMemoLines
  sub.sourceOffsetMap = offsets
  sub.linePrefixWidths = widths
  sub.sourceBoundaries = boundaries
}

/**
 * Every index of `lexer.lines` carrying each DOCUMENT line number, built once.
 *
 * Shared by all of a parent's children rather than rebuilt per child: see the
 * `lineIndicesByNumber` field. The result is treated as read-only by its
 * callers, which only ever `get` a bucket and `find` within it.
 */
export function parentLineIndices(lexer: Lexer): Map<number, number[]> {
  const cached = lexer.lineIndicesByNumber
  if (cached !== undefined) return cached
  const built = new Map<number, number[]>()
  for (let i = 0; i < lexer.lineCount; i++) {
    const number = lexer.lineNumber(i)
    const bucket = built.get(number)
    if (bucket) bucket.push(i)
    else built.set(number, [i])
  }
  lexer.lineIndicesByNumber = built
  return built
}

/** A dedented line's content, with any synthesized leading spaces removed. */
export function withoutSyntheticIndent(line: string): string {
  return line.replace(/^[ \t]+/, '')
}

/**
 * A sub-lexer that cannot be anchored publishes NO positions.
 *
 * Declining used to mean falling back to the sub-lexer's own local offsets,
 * which are indistinguishable from document ones downstream: a nested paragraph
 * reported `[0, 1]` inside a list item at `[6, 11]`, so a span sat outside its
 * parent and two siblings overlapped. A missing `pos` is a state PART 12 §4
 * already lets a consumer detect; a confidently wrong one is not (carve-js#771).
 */
export function declinePositions(sub: Lexer): void {
  sub.suppressPositions = true
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
export const inlineDepthState = { value: 0 }

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
export const RE_AFTER_TERM = /^[ \t]*(?:::(?!:)|:)[ \t]/

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

// A closer of each fence shape, spelled PERMISSIVELY: a leading indentation run
// is tolerated where the real closers anchor at column 0. See `CloserIndex`.
export const RE_ANY_COLON_CLOSER = /^[ \t]*(:{3,})[ \t]*$/
// The CODE closer's trailing run matches `FENCE_TRAILING_WS` above: a
// tab after a closer's marker is trailing, so the line IS a closer
// (carve#1295). The leading run stays permissive - that is the dedent this
// index is a superset for.
//
// THE DIRECTION OF THE ERROR IS WHAT MATTERS HERE, and it is not symmetric,
// because `codeCloserPossible` only ever REFUTES:
//
//   index wider than the real matcher  ->  a wasted scan, still correct
//   index NARROWER than it             ->  a WRONG answer
//
// Too wide, a line the real matcher rejects turns "no closer ahead" into "go
// and scan", and the scan runs to end of document. That is only slow - the
// quadratic path this index exists to close.
//
// Too narrow, an opener is told no closer exists and swallows the rest of the
// document past a closer that is really there. So this constant follows the
// real matcher whenever the real matcher WIDENS, and may lag it only when it
// narrows.
export const RE_ANY_FENCE_CLOSER = new RegExp('^[ \\t]*(`{3,}|~{3,})' + FENCE_TRAILING_WS)

export const RE_PREPASS_ANY_FENCE_CLOSER = new RegExp(
  '^(?:[ \\t]*>)*[ \\t]*(?:(?:[-*+]|[0-9]+[.)]|[A-Za-z][.)])[ \\t]+)*[ \\t]*(`{3,}|~{3,})' + FENCE_TRAILING_WS,
)

/**
 * Where a closer of each fence shape LAST occurs in a lexer's lines.
 *
 * A "no closer ahead" answer is what makes the lookahead scans linear. Without
 * it every unterminated opener re-reads the whole suffix, which is quadratic on
 * a document of openers with DISTINCT widths - the shape that took ~1.9 MiB of
 * comment openers from 8.5s to nothing when this map was first built for `%%%`.
 *
 * PERMISSIVE ON PURPOSE. A caller may read a DEDENTED view of these lines,
 * where MORE lines are closer-shaped than in the raw text, so the patterns
 * tolerate a leading run. The index is therefore a SUPERSET of what any view
 * can match, and "no closer ahead" holds for every view. It only ever refutes;
 * a positive answer sends the caller to the real scan.
 *
 * A comment and a colon closer match on EXACT length, so each is a width -> last
 * index map. A CODE closer matches at length OR LONGER, so its entry is the
 * ascending distinct runs paired with the suffix-maximum of their last indices:
 * the answer for length L is the entry of the smallest recorded run >= L.
 */
export interface CloserIndex {
  comment: Pick<ReadonlyMap<number, number>, 'get'>
  colon: Pick<ReadonlyMap<number, number>, 'get'>
  code: Map<string, { runs: number[]; lastAtLeast: number[] }>
  scopedCode?: (marker: string, after: number) => boolean
}

/**
 * The CODE half of `buildCloserIndex`, over whatever closer pattern the caller
 * reads its lines with.
 *
 * Factored out because there is a second view of these lines: the definition
 * prepass matches a closer after stripping container prefixes, so more lines are
 * closer-shaped there than `RE_ANY_FENCE_CLOSER` admits. Both indexes are the
 * same suffix-maximum structure over a different pattern; spelling that twice is
 * how the two would drift.
 */
export function buildCodeCloserIndex(lines: readonly string[], re: RegExp): CloserIndex['code'] {
  const codeLast = new Map<string, Map<number, number>>()
  for (let i = 0; i < lines.length; i++) {
    const f = re.exec(lines[i]!)
    if (f) {
      const run = f[1]!
      let byRun = codeLast.get(run[0]!)
      if (byRun === undefined) {
        byRun = new Map<number, number>()
        codeLast.set(run[0]!, byRun)
      }
      byRun.set(run.length, i)
    }
  }
  return finishCodeCloserIndex(codeLast)
}

export function finishCodeCloserIndex(codeLast: Map<string, Map<number, number>>): CloserIndex['code'] {
  const code = new Map<string, { runs: number[]; lastAtLeast: number[] }>()
  for (const [char, byRun] of codeLast) {
    const runs = [...byRun.keys()].sort((a, b) => a - b)
    const lastAtLeast = new Array<number>(runs.length)
    let best = -1
    for (let i = runs.length - 1; i >= 0; i--) {
      best = Math.max(best, byRun.get(runs[i]!)!)
      lastAtLeast[i] = best
    }
    code.set(char, { runs, lastAtLeast })
  }

  return code
}

export function buildCloserIndex(lines: readonly string[]): CloserIndex {
  const comment = new Map<number, number>()
  const colon = new Map<number, number>()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const c = RE_COMMENT_BLOCK_ANY.exec(line)
    if (c) comment.set(c[1]!.length, i)
    const d = RE_ANY_COLON_CLOSER.exec(line)
    if (d) colon.set(d[1]!.length, i)
  }

  return { comment, colon, code: buildCodeCloserIndex(lines, RE_ANY_FENCE_CLOSER) }
}

/** `buildCloserIndex` over a lexer's own lines, built at most once. */
export function closerIndex(lexer: Lexer): CloserIndex {
  if (!lexer.fenceCloserIndex && lexer.contiguousOrigin) {
    const { lexer: origin, start } = lexer.contiguousOrigin
    if (!origin.scopedFenceCloserIndex) {
      if (layoutWork.on) layoutWork.closerLines += origin.lineCount
      origin.scopedFenceCloserIndex = new ScopedFenceClosers(origin.lines, RE_ANY_FENCE_CLOSER, RE_COMMENT_BLOCK_ANY, RE_ANY_COLON_CLOSER)
    }
    const shared = origin.scopedFenceCloserIndex
    const end = start + lexer.lineCount
    const last = (kind: 'comment' | 'colon') => ({ get(width: number): number | undefined {
      const at = shared.last(kind, width, start, end)
      return at === undefined ? undefined : at - start
    } })
    lexer.fenceCloserIndex = { comment: last('comment'), colon: last('colon'), code: new Map(),
      scopedCode: (marker, after) => shared.codeIn(marker, start + after + 1, end) }
  }
  lexer.fenceCloserIndex ??= buildCloserIndex(lexer.lines)

  return lexer.fenceCloserIndex
}

/** Whether a code/raw closer for `marker` may occur after line index `after`. */
export function codeCloserPossible(index: CloserIndex, marker: string, after: number): boolean {
  return index.scopedCode ? index.scopedCode(marker, after) : codeCloserPossibleIn(index.code, marker, after)
}

/** `codeCloserPossible` against a code index built over any closer pattern. */
export function codeCloserPossibleIn(code: CloserIndex['code'], marker: string, after: number): boolean {
  const entry = code.get(marker[0]!)
  if (entry === undefined) return false
  let lo = 0
  let hi = entry.runs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (entry.runs[mid]! < marker.length) lo = mid + 1
    else hi = mid
  }

  return lo < entry.runs.length && entry.lastAtLeast[lo]! > after
}

/** Whether a closer of EXACTLY `len` may occur after line index `after`. */
export function exactCloserPossible(last: Pick<ReadonlyMap<number, number>, 'get'>, len: number, after: number): boolean {
  const at = last.get(len)

  return at !== undefined && at > after
}

/**
 * From a `%%%` opener at line `after`, is there a matching closer ahead? A
 * comment closer matches on EXACT delimiter length (longer fences nest), so ANY
 * later line whose delimiter run has that length is a valid closer. Used to
 * reject an unclosed `%%%` as a block opener (PART 9 §28): without this an
 * unclosed opener swallows the rest of the document, silently dropping every
 * following block.
 *
 * `after` DEFAULTS TO THE CURSOR AND IS PASSED EXPLICITLY BY THE PREPASS. Every
 * block-parsing caller asks about the opener it is standing on, so `lexer.pos`
 * is that opener's line for them. The definition prepass is not a cursor: it
 * sweeps the document with an index of its own while `lexer.pos` stays parked
 * at the end of the frontmatter, which is line 0 for a document without any.
 * Asking "is there a closer after line 0" on behalf of an opener on line 7 let
 * the opener match ITSELF - the index stores the LAST line carrying a run of
 * that length, which for an unclosed fence is the opener - so the check could
 * only ever fail for an opener on line 0 (markup-carve/carve-js#1118).
 */
export function commentBlockHasCloser(lexer: Lexer, fence: number, after: number = lexer.pos): boolean {
  return exactCloserPossible(closerIndex(lexer).comment, fence, after)
}

/**
 * From a `%%%` opener at line `from`, is there a matching closer BEFORE THE
 * CONTAINER THE OPENER SITS IN ENDS?
 *
 * The definition prepass's own bound, and the reason it cannot use the
 * document-wide index: a fence inside a list item or a quote is bounded by that
 * container, so the closer has to arrive before the first non-blank line that
 * leaves it, with blank lines transparent (carve-js#1146). `scopeHoldsLine` is
 * the same container test the fence, verse and depth trackers in this pass
 * already share, so all four agree on what "still inside" means.
 *
 * THE SCOPE IS ASKED BEFORE THE CLOSER, which is the opposite of the order the
 * CODE fence uses a few hundred lines up - and the two orders are both right,
 * because the two fence kinds close differently. A code fence re-bases its
 * closer on the column it opened at, so a run written at column 0 for a fence
 * opened at an item's content column is its closer by construction and has to
 * be read before the container question. A comment fence has no such re-basing:
 *
 * ````
 * - item
 *   %%%
 *   [r]: /url
 * %%%
 * ````
 *
 * The column-0 run ENDS THE ITEM, so it is not inside the fence's container and
 * closes nothing; the opener degrades to a line comment and `[r]: /url` is an
 * ordinary definition. Reading the closer first opened a region over it and the
 * definition vanished. Verified against the executable spec oracle.
 *
 * A CLOSER IS WHATEVER THE LOOP THAT CONSUMES THE REGION WOULD CLOSE ON, i.e.
 * a `%` run of this width in the `stripContainerPrefixes` view - see
 * `commentRunLines`. Reading raw lines here instead looked like the smaller
 * change and was not: a quoted fence with a quoted closer, plus any raw run of
 * its width later in the document, passed the index and then found no closer in
 * scope, so a definition the author had commented out went live. The raw-line
 * question survives where it belongs, in the index that answers first.
 *
 * The scan is bounded by the container, so it is linear in that container
 * rather than in the document, and it is reached only for an opener that HAS a
 * container - a document-level opener keeps the O(1) index, where the
 * unbounded question is the correct one anyway.
 */
export function commentCloserInScope(
  lexer: Lexer,
  fence: number,
  from: number,
  scope: PrepassScope,
  memo: CommentScopeMemo,
): boolean {
  // THE LINE INDEX ANSWERS BEFORE THE CONTAINER IS WALKED. "No `%` run of this
  // width anywhere ahead" refutes an opener outright, and that is the answer
  // for every unterminated opener - so a document that is a run of them stays
  // linear instead of paying a boundary scan each. This is the hot-path guard
  // the RAW document-wide index used to provide one caller up; it has to live
  // here now, because that index cannot see a `> %%%` and refuted the quoted
  // spelling wrongly (markup-carve/carve#1341).
  const at = commentRunLines(lexer).get(fence)
  if (at === undefined) return false
  // The first line of this width strictly after the opener. `at` is ascending,
  // so a binary search answers it without walking the container - which is what
  // keeps a run of openers inside one item linear rather than quadratic.
  let lo = 0
  let hi = at.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (at[mid]!.line <= from) lo = mid + 1
    else hi = mid
  }
  if (lo >= at.length) return false
  // ONLY A RUN AT THE OPENER'S OWN QUOTE DEPTH CLOSES IT, and the two
  // directions fail for different reasons:
  //
  //   - a SHALLOWER run is the line that ENDED the opener's quote. `> > %%%`
  //     is not closed by a `> %%%`, because the inner quote is over by then;
  //   - a DEEPER run is inside a quote of its own, and the block parser reads
  //     it as one. `> %%%` is not closed by a `> > %%%`: the opener degrades
  //     to a line comment, its body RENDERS, and the definition beside it is
  //     ordinary. Accepting it suppressed a definition the parser publishes,
  //     which is the same two-halves-disagree shape this whole change is
  //     about, one quote deeper.
  //
  // A non-matching run is skipped and the next one of this width is asked, so
  // an opener is not refuted by a line that was never its closer. Bounded by
  // the container the same way the boundary is: the walk stops at the first run
  // past `end`, so it reads only runs written inside the opener's own scope.
  const end = commentScopeEnd(lexer, from, scope, memo)
  for (let i = lo; i < at.length && at[i]!.line < end; i++) {
    if (at[i]!.depth === scope.quoteDepth) return true
  }

  return false
}

/**
 * Every line carrying a `%` run, keyed by run length and ascending, WITH THE
 * QUOTE DEPTH THE RUN WAS WRITTEN AT.
 */
export function commentRunLines(lexer: Lexer): Map<number, { line: number; depth: number }[]> {
  if (lexer.commentRunLines !== undefined) return lexer.commentRunLines
  const m = new Map<number, { line: number; depth: number }[]>()
  for (let i = 0; i < lexer.lineCount; i++) {
    const raw = lexer.lineAt(i)!
    const afterTerm = RE_AFTER_TERM.test(stripContainerPrefixes(lexer.lineAt(i - 1) ?? ''))
    const c = RE_COMMENT_BLOCK_ANY.exec(stripContainerPrefixes(raw, afterTerm))
    if (c === null) continue
    const entry = {
      line: i,
      // THE OPENER AND THE CLOSER ARE MEASURED THE SAME WAY, which is the whole
      // point of naming this once: `- - > %%%` measured its own depth as 0 here
      // while its closer `    > %%%` measured 1, so no run at the opener's depth
      // existed and the region never opened (carve-js#1181).
      depth: containerQuoteDepth(raw),
    }
    const at = m.get(c[1]!.length)
    if (at !== undefined) at.push(entry)
    else m.set(c[1]!.length, [entry])
  }
  lexer.commentRunLines = m

  return m
}

/** Remember each container boundary across its comment openers. */
export type CommentScopeMemo = Map<string, { from: number; end: number }>

/**
 * The first line after `from` at which the opener's container is over.
 */
export function commentScopeEnd(
  lexer: Lexer,
  from: number,
  scope: PrepassScope,
  memo: CommentScopeMemo,
): number {
  const key = `${scope.quoteDepth}|${scope.contentCol}`
  const e = memo.get(key)
  if (e !== undefined && from >= e.from && from < e.end) return e.end
  let end = lexer.lineCount
  for (let i = from + 1; i < lexer.lineCount; i++) {
    const raw = lexer.lineAt(i)!
    // The blank-line half first: it is two array reads, where the quote and
    // column measurements below are regexes, and it rejects almost every line.
    if (isBlankLine(raw) || !isBlankLine(lexer.lineAt(i - 1) ?? '')) continue
    // AND A CONTINUATION MARKER IS NOT A DEPARTURE. `+` at column 0 after a
    // blank line attaches the next block to the item rather than ending it
    // (PART 17), so the fence is still inside its container and the closer
    // below the marker is still its own. Taken as the boundary, the region
    // never opened and the definition inside it went live while the comment
    // body above it stayed invisible - the leak, one marker over.
    if (isContinuationMarker(raw)) continue
    // A QUOTED SCOPE IS OVER AT THE BLANK, whatever stands after it. A
    // blockquote does not survive a blank line, so the next non-blank line
    // opens a NEW one even when it carries the same markers - and a `%%%` run
    // there belongs to that quote, not to the fence above.
    if (scope.quoteDepth > 0) {
      end = i
      break
    }
    const depth = containerQuoteDepth(raw)
    const view = raw.replace(/^(?:>(?: |$))+/, '')
    if (
      depth < scope.quoteDepth ||
      // VISUAL COLUMNS, the way the parser measures reach: a tab is worth up to
      // four. The cap keeps it O(the column) rather than O(the indentation run).
      (scope.contentCol > 0 && indentColumns(view, scope.contentCol) < scope.contentCol)
    ) {
      end = i
      break
    }
  }
  memo.set(key, { from, end })

  return end
}

/**
 * Whether a comment fence of width `fence` closes LATER IN THIS QUOTE.
 */
export function quotedCommentHasCloser(lexer: Lexer, fence: number, fromIndex: number): boolean {
  for (let i = fromIndex + 1; i < lexer.lineCount; i++) {
    const quoted = RE_BLOCKQUOTE.exec(lexer.lineAt(i)!)
    if (!quoted) return false
    const run = RE_COMMENT_BLOCK_ANY.exec(quoted[1] ?? '')
    if (run && run[1]!.length === fence) return true
  }

  return false
}

export function literalCommentHasCloser(lexer: Lexer, width: number, from: number, depth: number, floor: number): boolean {
  const cache = lexer.literalCommentClosers ??= new Map()
  let run = cache.get(depth)
  if (run === undefined || from < run.start || from >= run.end) {
    const start = depth < 0 ? 0 : from
    let end = start
    const columns: number[] = []
    const widths: Array<number | undefined> = []
    for (; end < lexer.lineCount; end++) {
      const line = lexer.lineAt(end)!
      let at = 0
      for (let level = 0; level <= depth; level++) {
        const prefix = quotePrefixLength(line, at, line.length)
        if (prefix === 0) { at = -1; break }
        at += prefix
      }
      if (at < 0) break
      const content = line.slice(at)
      columns.push(isBlankLine(content) || RE_COMMENT_LINE.test(content) ? Infinity : indentColumns(content))
      widths.push(commentFenceRun(content))
    }
    run = { start, end, index: new LiteralCommentClosers(columns, widths) }
    cache.set(depth, run)
  }
  return run.index.hasCloser(width, from - run.start, floor)
}

/**
 * Find a code or raw fence closer within this list item. The memo uses only
 * the fence character as its key. A column key diverged from the
 * executable spec; re-measure before changing it.
 */
export function itemFenceHasCloser(
  lexer: Lexer,
  marker: string,
  fromIndex: number,
  contentCol: number,
  memo: QuotedFenceCloserMemo,
  // Where the container has ended, so nothing further is this fence's to
  // close. The memo stays sound because that line does not depend on which
  // opener asked.
  endsContainer: (line: string, afterBlank: boolean, index: number) => boolean,
  columnAt?: (index: number) => number | undefined,
  literalPayload = false,
  quoteDepth?: number,
  quoteColumn = 0,
  alternateCloserColumn?: number,
): boolean {
  const char = marker[0]!
  const start = fromIndex + 1
  if (fenceCloserMemoRefutes(memo, char, marker.length, start)) return false
  const closeRe = fenceCloseRe(marker)
  let maxRun = 0
  let afterBlank = false
  for (let i = start; i < lexer.lineCount; i++) {
    if (columnAt && layoutWork.on) layoutWork.closerLines++
    const line = lexer.lineAt(i)!
    if (endsContainer(line, afterBlank, i)) break
    if (isBlankLine(line)) {
      afterBlank = true
      continue
    }
    afterBlank = false
    const column = columnAt ? columnAt(i) : alternateCloserColumn === undefined ? indentColumns(line, contentCol) : indentColumns(line)
    if (column === undefined || column < contentCol || (columnAt && column !== contentCol)) continue
    if (alternateCloserColumn !== undefined && column !== contentCol && column !== alternateCloserColumn) continue
    let dedented = literalPayload ? line.replace(/^[ \t]+/, '') : columnAt ? line.slice(lexer.lineLeadingWhitespace(i)) : sliceColumns(line, contentCol, true)
    if (column === alternateCloserColumn) dedented = dedented.trimStart()
    if (quoteDepth !== undefined) {
      dedented = sliceColumns(line, contentCol, true)
      let missing = false
      for (let depth = 0; depth <= quoteDepth; depth++) {
        const width = quotePrefixLength(dedented, 0, dedented.length)
        if (width === 0) { missing = true; break }
        dedented = dedented.slice(width)
      }
      if (missing) continue
      const indent = indentColumns(dedented)
      if (quoteColumn >= 0 && indent !== quoteColumn) continue
      if (quoteColumn === -2 && indent === 0) continue
      dedented = dedented.replace(/^[ \t]+/, '')
    }
    if (closeRe.test(dedented)) return true
    const closer = RE_FENCE_CLOSER.exec(dedented)
    if (closer && closer[1]![0] === char) maxRun = Math.max(maxRun, closer[1]!.length)
  }
  memo.set(char, { from: start, maxRun })

  return false
}

/**
 * A line's content with every leading list marker walked off.
 *
 * AN OPENER MAY BE WRITTEN ON A MARKER LINE, and only where a block may begin:
 * `:  - ``` ` opens a code block, while the same marker-shaped line with no blank
 * above it folds into the open paragraph (§10 I2) and opens nothing.
 */
export function markerFreeContent(line: string): string {
  // A CHARACTER OFFSET, not a column strip. `markerContentColumn` measures the
  // marker's width on the flushed line, and `sliceColumns` only removes
  // whitespace, so it cannot walk a marker off.
  let content = line.replace(/^[ \t]+/, '')
  for (;;) {
    // AN ABUTTING ATTRIBUTE COMES OFF FIRST, because that is the spelling
    // `markerContentColumn` measures: it reports the width of `-{.x} ` with the
    // braces already gone, so slicing the ORIGINAL line by it lands inside the
    // attribute and the rest of the line reads as prose.
    const attr = extractItemAttr(content)
    const marked = attr ? attr.stripped : content
    // THE CHECKBOX GOES WITH THE MARKER. `markerContentColumn` reports a task's
    // content column as the bullet's width, which is what §17 measures a body
    // against - but the box is part of what the marker writes, and a fence behind
    // one opens the same block a bare bullet's does.
    const task = RE_TASK.exec(marked)
    if (task !== null) {
      content = task[task.length - 1]!.replace(/^[ \t]+/, '')
      continue
    }
    const width = markerContentColumn(marked)
    if (width <= 0) return content
    content = marked.slice(width).replace(/^[ \t]+/, '')
  }
}

/**
 * Does a container's own collected stream hold an OPEN comment span? -- §28,
 * markup-carve/carve#2488.
 *
 * A container ends at a comment written below its content column, which is right
 * for an OPENER and for the `%%` line form and wrong INSIDE a span the container
 * already holds: §28 pairs the delimiters, indentation is part of neither
 * (markup-carve/carve#2471), and everything between them is payload. Ending there
 * split the span, the container's own parse then read an opener with no closer -
 * one `%%` line comment - and PUBLISHED the payload while dropping both
 * delimiters.
 *
 * The caller still asks the SHAPE. Only a comment-shaped line is exempt: a payload
 * line below the column is not comment-shaped, so §24 C3 still hands it to the
 * enclosing parse.
 *
 * ASKED OF THE COLLECTED LINES, not of a fence tracker's flag. The trackers read
 * each line at the container's dedent and their opener tests refuse an indented
 * run, so a span a DESCENDANT holds is invisible to them.
 *
 * A verbatim fence's payload is opaque, so a `%%%` written inside one is content.
 */
/**
 * One container's resumable walk. A collector only ever APPENDS to its own line
 * array, so a walk that read the first `index` of them needs to read no line
 * twice - which is what keeps a container holding many spans linear instead of
 * re-reading its whole body per delimiter.
 */
export interface CommentSpanScan {
  index: number
  opaque: { comment: boolean; char: string; run: number } | null
  atBlockStart: boolean
}

export const newCommentSpanScan = (): CommentSpanScan => ({ index: 0, opaque: null, atBlockStart: true })

export function bodyHoldsOpenCommentSpan(
  lines: readonly string[],
  scan: CommentSpanScan,
  // Openers with no closer anywhere: each is one line comment (§28) and opens no span.
  degraded?: ReadonlySet<number>,
): boolean {
  for (; scan.index < lines.length; scan.index++) {
    const line = stripLazyFrame(lines[scan.index]!).replace(/^[ \t]+/, '')
    const open = scan.opaque
    if (open !== null) {
      let closed = false
      if (open.comment) closed = commentFenceRun(line) === open.run
      else {
        const run = RE_FENCE_CLOSER.exec(line)
        closed = run !== null && run[1]![0] === open.char && run[1]!.length >= open.run
      }
      if (closed) {
        scan.opaque = null
        scan.atBlockStart = true
      }
      continue
    }
    if (line === '') {
      scan.atBlockStart = true
      continue
    }
    const opener = scan.atBlockStart ? markerFreeContent(line) : line
    scan.atBlockStart = false
    const code = RE_FENCE.exec(opener) ?? RE_RAW_FENCE.exec(opener)
    if (code !== null) {
      const marker = RE_FENCE.test(opener) ? code[2]! : code[1]!
      scan.opaque = { comment: false, char: marker[0]!, run: marker.length }
      continue
    }
    const comment = commentFenceRun(opener)
    if (comment !== undefined && degraded?.has(scan.index) !== true) scan.opaque = { comment: true, char: '%', run: comment }
  }

  return scan.opaque?.comment === true
}

/** Search within one quote depth; cache misses only through its next boundary. */
export function quotedFenceHasCloser(
  lexer: Lexer,
  marker: string,
  fromIndex: number,
  memo: QuotedFenceCloserMemo,
  depth = 0,
  column = 0,
): boolean {
  const char = marker[0]!
  const key = `${depth}:${column}:${char}`
  const start = fromIndex + 1
  if (fenceCloserMemoRefutes(memo, key, marker.length, start)) return false
  const closeRe = fenceCloseRe(marker)
  let maxRun = 0
  let end = start
  for (; end < lexer.lineCount; end++) {
    const line = lexer.lineAt(end)!
    let at = 0
    for (let level = 0; level <= depth; level++) {
      const width = quotePrefixLength(line, at, line.length)
      if (width === 0) {
        at = -1
        break
      }
      at += width
    }
    if (at < 0) break
    const residual = line.slice(at)
    if (column >= 0 && indentColumns(residual) !== column) continue
    if (column === -2 && indentColumns(residual) === 0) continue
    const content = column < 0 ? residual.replace(/^[ \t]+/, '') : sliceColumns(residual, column, true)
    if (closeRe.test(content)) return true
    const closer = RE_FENCE_CLOSER.exec(content)
    if (closer && closer[1]![0] === char) maxRun = Math.max(maxRun, closer[1]!.length)
  }
  memo.set(key, { from: start, end, maxRun })

  return false
}

// Block comment: a `%%%`+ opener, closed by a line whose delimiter run has the
// SAME length (more `%` nest). Not rendered.
export function commentLineContent(line: string): string {
  // ONE separator character, and it is `whitespace` (markup-carve/carve#977).
  return trimEndSpaceTab(line.replace(/^[ \t]*%%/, '').replace(/^[ \t]/, ''))
}

export function parseCommentBlock(lexer: Lexer): Comment {
  // A comment fence delimiter is STRUCTURAL, not content: only the leading run
  // of `%` is matched, so neither trailing text (`%%% TODO`) nor a stray
  // non-breaking space can desync the closer and swallow the rest of the
  // document. The opener's trailing text is kept as the body's first line so
  // `carve fmt` round-trips the words instead of deleting them; a closer's
  // trailing text is discarded, like a code fence's closing info.
  const openerLine = lexer.consume()
  const m = RE_COMMENT_BLOCK_ANY.exec(openerLine)!
  const fence = m[1]!.length
  // Container prefixes are already removed; the remaining payload keeps its bytes.
  const lines: string[] = []
  // PART 7's four characters: a tail of one vertical tab is a NON-EMPTY tail.
  const openerTail = trimNonNbsp(m[2]!)
  if (openerTail !== '') lines.push(openerTail)
  while (!lexer.eof()) {
    const ln = lexer.peek()!
    const c = RE_COMMENT_BLOCK_ANY.exec(ln)
    if (c && c[1]!.length === fence) {
      lexer.consume()
      break
    }
    lexer.consume()
    lines.push(stripLazyFrame(ln))
  }
  return { type: 'comment', block: true, content: lines.join('\n') }
}

/**
 * Drop `pos` from a subtree whose positions cannot be mapped to the document.
 *
 * PART 12 section 4: an implementation that cannot produce a position "MUST NOT
 * emit `pos` with invented values, and MUST NOT omit it silently". Omitting is
 * the conformant half; the omission is recorded in carve-js#441.
 *
 * Both callers re-parse RECONSTRUCTED text - a line block expands each line's
 * leading whitespace, and a table cell is scanned out of a row and re-joined -
 * so the inline scanner measures against a string that does not appear verbatim
 * in the source. The offsets it produced were not merely imprecise: a table
 * cell reported the document's first three characters for every cell.
 */
export function stripPositions(nodes: InlineNode[]): InlineNode[] {
  for (const node of nodes) {
    // A cell wrap points to the authored `+`, even when surrounding text
    // cannot be mapped after fragments from different rows are joined.
    if (node.type !== 'cell_wrap') delete node.pos
    if (node.type === 'citation_group') {
      for (const item of node.items) delete item.pos
    }
    visitInlineChildren(node, stripPositions, undefined)
  }
  return nodes
}

export function stripPositionsOutsideRow(nodes: InlineNode[], start: number, end: number): InlineNode[] {
  for (const node of nodes) {
    // A marker from a later row can record a join here, outside this row's
    // own source span (carve#3172).
    if (node.pos && node.pos.startOffset !== undefined && node.pos.endOffset !== undefined &&
      (node.pos.startOffset < start || node.pos.endOffset > end)) delete node.pos
    if (node.type === 'citation_group') {
      for (const item of node.items) {
        if (item.pos && item.pos.startOffset !== undefined && item.pos.endOffset !== undefined &&
          (item.pos.startOffset < start || item.pos.endOffset > end)) delete item.pos
      }
    }
    visitInlineChildren(node, children => stripPositionsOutsideRow(children, start, end), undefined)
  }
  return nodes
}

export interface ColonFenceBodyLine {
  text: string
  lineIndex: number
}

export interface ColonFenceOpener {
  kind: UnclosedContainer['kind']
  lineIndex: number
  fenceWidth: number
}

export function unclosedContainerFromOpener(lexer: Lexer, opener: ColonFenceOpener): UnclosedContainer {
  const startOffset = lexer.lineOffset(opener.lineIndex)
  return {
    kind: opener.kind,
    line: lexer.lineNumber(opener.lineIndex),
    column: lexer.lineStartColumn(opener.lineIndex),
    startOffset,
    endOffset: startOffset + opener.fenceWidth,
    fenceWidth: opener.fenceWidth,
  }
}

export function colonFenceKind(line: string): UnclosedContainer['kind'] {
  if (RE_LINE_BLOCK_OPEN.test(line)) return 'line block'
  if (RE_HARDBREAKS_OPEN.test(line)) return 'hard-break block'
  if (RE_QUOTE_BLOCK_OPEN.test(line)) return 'block quote'
  const named = RE_ADMONITION_OPEN.exec(line)
  if (named) return GENERATED_CONTENT_KINDS.has(named[2]!) ? 'directive' : 'admonition'
  return 'div'
}

export function consumeOpaqueColonFenceBodySpan(
  lexer: Lexer,
  lines: ColonFenceBodyLine[],
  lineIndex: number,
  text: string,
  literalOwnerLine?: number,
  canOpenUnclosed = false,
  hostCloserAt?: (lineIndex: number) => boolean,
): boolean {
  const fenceText = literalOwnerLine === undefined ? text : text.replace(/^[ \t]+/, '')
  const rawOpen = RE_RAW_FENCE.exec(fenceText)
  const codeOpen = rawOpen === null ? RE_FENCE.exec(fenceText) : null
  const marker = rawOpen?.[1] ?? codeOpen?.[2]
  if (marker !== undefined) {
    // A fence that interrupts a paragraph needs a closer. After a closed child
    // leaves no paragraph, an unclosed fence opens and runs to this host's edge.
    const closes = fenceHasCloser(lexer, marker, literalOwnerLine !== undefined)
    if (lexer.quoteLazyLines.has(lexer.lineNumber(lineIndex)) || (!closes && !canOpenUnclosed)) return false
    const closeRe = fenceCloseRe(marker)
    const openerColumn = indentColumns(text)
    const authoredRunColumn = (at: number, line: string): number => {
      const prefix = lexer.lineStartColumn(at) - 1
      const source = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(at) - 1]
      let column = 0
      if (source !== undefined && prefix <= source.length) {
        for (let i = 0; i < prefix; i++) column += source[i] === '\t' ? 4 - column % 4 : 1
      } else column = prefix
      for (const char of line) {
        if (char === '\t') column += 4 - column % 4
        else if (char === ' ') column++
        else break
      }
      return column
    }
    const authoredColumn = authoredRunColumn(lineIndex, text)
    const isCodeFence = codeOpen !== null
    lexer.consume()
    lines.push({ text, lineIndex })
    while (!lexer.eof()) {
      const innerLineIndex = lexer.pos
      const innerText = lexer.peek()!
      const content = innerText.replace(/^[ \t]+/, '')
      const bandPayload = literalOwnerLine === undefined &&
        authoredRunColumn(innerLineIndex, innerText) <= authoredColumn
      const bandCloser = bandPayload && closeRe.test(content)
      if (!closes && hostCloserAt?.(innerLineIndex)) break
      if (!closes && !bandCloser && !isBlankLine(innerText) && indentColumns(innerText) < openerColumn) break
      lexer.consume()
      lines.push({ text: bandPayload ? content : innerText, lineIndex: innerLineIndex })
      if (bandCloser) break
      if (literalOwnerLine !== undefined ? closeRe.test(innerText.replace(/^[ \t]+/, '')) :
        closeRe.test(innerText) && (!isCodeFence || leadingWhitespace(innerText) <= 3)) break
    }
    return true
  }

  const commentOpen = RE_COMMENT_BLOCK_ANY.exec(text)
  if (commentOpen !== null &&
      !(literalOwnerLine !== undefined && lexer.literalCommentLineOpeners.has(`${literalOwnerLine}:${lexer.lineNumber(lineIndex)}`)) &&
      commentBlockHasCloser(lexer, commentOpen[1]!.length)) {
    const fence = commentOpen[1]!.length
    lexer.consume()
    lines.push({ text, lineIndex })
    while (!lexer.eof()) {
      const innerLineIndex = lexer.pos
      const innerText = lexer.peek()!
      const commentClose = RE_COMMENT_BLOCK_ANY.exec(innerText)
      lexer.consume()
      lines.push({ text: innerText, lineIndex: innerLineIndex })
      if (commentClose !== null && commentClose[1]!.length === fence) break
    }
    return true
  }

  return false
}

export interface ColonFenceBodyView {
  lexer: Lexer
  start: number
  length: number
  closed: boolean
}

export type ColonFenceBody = ColonFenceBodyLine[] | ColonFenceBodyView

export function nestedColonLexer(parent: Lexer, body: ColonFenceBody, start: number): Lexer {
  if (Array.isArray(body)) {
    if (layoutWork.on) layoutWork.bodyEntries += body.length * 2
    const unchanged = body.every((line) => line.text === parent.lineAt(line.lineIndex))
    return nestedSubLexer(parent, body.map((line) => line.text), start, undefined, undefined, unchanged)
  }
  const sub = nestedSubLexer(parent, [], start, undefined, undefined, true)
  sub.useLineView(body.lexer, body.start, body.length)
  return sub
}

export function collectColonFenceBody(lexer: Lexer, opener: ColonFenceOpener): ColonFenceBody {
  const origin = lexer.contiguousOrigin
  const index = (origin?.lexer ?? lexer).colonFenceEnds
  const base = origin?.start ?? 0
  const knownEnd = layoutWork.reuseColonViews ? index.get(base + opener.lineIndex) : undefined
  if (knownEnd !== undefined && knownEnd - base <= lexer.lineCount) {
    const end = knownEnd - base
    const start = lexer.pos
    const closed = end < lexer.lineCount
    lexer.pos = end + Number(closed)
    return { lexer: origin?.lexer ?? lexer, start: base + start, length: end - start, closed }
  }
  const lines: ColonFenceBodyLine[] = []
  const stack: ColonFenceOpener[] = [opener]
  let paragraphOpen: boolean = false
  let paragraphPrefix: string | false = false
  let markerLineLiteral: { width: number; column: number } | undefined
  const authoredColonColumn = (at: number, width: number): number | undefined => {
    const source = lexer.rootLines?.[lexer.lineNumber(at) - 1]
    const markerAt = source?.indexOf(':'.repeat(width)) ?? -1
    if (source === undefined || markerAt < 0) return undefined
    let column = 0
    for (const char of source.slice(0, markerAt)) column += char === '\t' ? 4 - (column % 4) : 1
    return column
  }
  // Only the innermost container's own closer ends an unclosed fence. An
  // ancestor's width closes nothing there, so stopping on it ran the body to EOF.
  const hostCloserAt = (at: number): boolean => {
    const candidate = lexer.lineAt(at) ?? ''
    const width = RE_ADMONITION_CLOSE.exec(candidate)?.[1]?.length
    const owner = stack[stack.length - 1]
    if (width === undefined || owner === undefined || owner.fenceWidth !== width) return false
    const ownerColumn = authoredColonColumn(owner.lineIndex, width)
    const column = authoredColonColumn(at, width)
    return ownerColumn === undefined || column === undefined
      ? indentColumns(candidate) === indentColumns(lexer.lineAt(owner.lineIndex) ?? '')
      : column === ownerColumn
  }

  while (!lexer.eof()) {
    if (layoutWork.on) layoutWork.colonLines++
    const lineIndex = lexer.pos
    const text = lexer.peek()!
    const interruptsParagraph: boolean = paragraphOpen && startsInterruptingBlock(lexer)
    if (consumeOpaqueColonFenceBodySpan(lexer, lines, lineIndex, text, undefined, !paragraphOpen && markerLineLiteral === undefined, hostCloserAt)) {
      paragraphOpen = false
      paragraphPrefix = false
      continue
    }
    const close = RE_ADMONITION_CLOSE.exec(text)

    if (close && close[1]!.length === stack[stack.length - 1]?.fenceWidth) {
      lexer.consume()
      const closed = stack.pop()!
      index.set(base + closed.lineIndex, base + lineIndex)
      if (stack.length === 0) break
      lines.push({ text, lineIndex })
      paragraphOpen = false
      paragraphPrefix = false
      continue
    }

    lexer.consume()
    lines.push({ text, lineIndex })
    const markerColumn = text.includes('|') ? markerContentColumn(text) : -1
    const markerBody = markerColumn >= 0 ? markerFreeContent(text) : ''
    if (markerColumn >= 0 && RE_LINE_BLOCK_OPEN.test(markerBody)) {
      markerLineLiteral = { width: colonFenceOpenerLen(markerBody)!, column: markerColumn }
    } else if (markerLineLiteral && indentColumns(text) === markerLineLiteral.column &&
        RE_ADMONITION_CLOSE.exec(text.trimStart())?.[1]?.length === markerLineLiteral.width) {
      markerLineLiteral = undefined
      paragraphOpen = false
      paragraphPrefix = false
      continue
    }
    if (stack.at(-1)!.kind === 'line block') continue
    const openerLen = colonFenceOpenerLen(text)
    if (openerLen !== null) {
      stack.push({
        kind: colonFenceKind(text),
        lineIndex,
        fenceWidth: openerLen,
      })
      paragraphOpen = false
      paragraphPrefix = false
      continue
    }
    // A quote or item line that carries paragraph text leaves a paragraph open
    // even where it interrupts the one above (`> para` then `> more`). An item
    // prefix is `-<content column>;`: a line reaching that column is read
    // there, so a block at it closes the item's paragraph (CARVE-P0-011).
    const leavesParagraphOpen = (line: string, wasOpen: string | false, interrupted: boolean, inItem = false): string | false => {
      const block = inItem ? line.trimStart() : line
      if (isBlankLine(line) || leavesNoParagraph(block) || RE_HEADING.test(block) || RE_HR.test(block) ||
        (block === line.trimStart() && isLinkDefLine(block)) || isTableRow(block)) return false
      const quote = RE_BLOCKQUOTE.exec(block)
      if (quote) {
        const inner = quote[1] !== undefined &&
          leavesParagraphOpen(quote[1], wasOpen && wasOpen[0] === '>' ? wasOpen.slice(1) : false, false)
        return inner && `>${inner}`
      }
      const open = wasOpen ? RE_ITEM_PREFIX.exec(wasOpen) : null
      if (open && /^ */.exec(line)![0].length >= Number(open[1])) {
        const inner = leavesParagraphOpen(line.slice(Number(open[1])), wasOpen && wasOpen.slice(open[0].length), interrupted, true)
        return inner && open[0] + inner
      }
      const marked = extractItemAttr(line)?.stripped ?? line
      const item = RE_TASK.exec(marked)?.[3] ?? RE_UNORDERED.exec(marked)?.[2] ?? RE_ORDERED.exec(marked)?.[4]
      if (wasOpen && !interrupted && (item === undefined || !(open || inItem))) return wasOpen
      if (item !== undefined) {
        const inner = leavesParagraphOpen(item, false, false)
        return inner && `-${markerContentColumn(line)};${inner}`
      }
      return ((!interrupted && (wasOpen || !lineOpensBlock(line))) || opensParagraphInBlock(line)) ? 'p' : false
    }
    paragraphPrefix = leavesParagraphOpen(text, paragraphPrefix, interruptsParagraph)
    paragraphOpen = paragraphPrefix !== false
  }

  for (const unclosed of stack) index.set(base + unclosed.lineIndex, base + lexer.pos)
  for (const unclosed of stack.slice(0, Math.max(0, MAX_NESTING_DEPTH - lexer.depth))) {
    lexer.reportUnclosedContainer(unclosedContainerFromOpener(lexer, unclosed))
  }
  return lines
}

// An item's prefix in the colon-body scan's paragraph state: `-<content column>;`.
export const RE_ITEM_PREFIX = /^-(\d+);/

// A comment line and a block-attribute line are not paragraph text.
export function leavesNoParagraph(text: string): boolean {
  return RE_COMMENT_LINE.test(text) || isBlockAttributeLine(text.trimEnd())
}

// A quote or list line whose content is paragraph text leaves that paragraph
// open, so an unclosed fence on the next line cannot interrupt it (§10 I4).
export function opensParagraphInBlock(text: string): boolean {
  const quote = RE_BLOCKQUOTE.exec(text)
  if (quote) {
    const content = quote[1]
    return content !== undefined && !isBlankLine(content) && !leavesNoParagraph(content) &&
      (!lineOpensBlock(content) || opensParagraphInBlock(content))
  }
  const content = (RE_TASK.exec(text)?.[3] ?? RE_UNORDERED.exec(text)?.[2] ?? RE_ORDERED.exec(text)?.[4])
  return content !== undefined && !leavesNoParagraph(content) &&
    (!lineOpensBlock(content) || opensParagraphInBlock(content))
}

export function collectLiteralColonFenceBody(lexer: Lexer, opener: ColonFenceOpener): ColonFenceBodyLine[] {
  const literalOwnerLine = lexer.lineNumber(opener.lineIndex)
  const lines: ColonFenceBodyLine[] = []
  let closed = false

  while (!lexer.eof()) {
    const lineIndex = lexer.pos
    const text = lexer.peek()!
    if (consumeOpaqueColonFenceBodySpan(lexer, lines, lineIndex, text, literalOwnerLine)) continue
    const close = RE_ADMONITION_CLOSE.exec(text)
    lexer.consume()
    if (close && close[1]!.length === opener.fenceWidth) {
      closed = true
      break
    }
    lines.push({ text, lineIndex })
  }

  if (!closed) {
    lexer.reportUnclosedContainer(unclosedContainerFromOpener(lexer, opener))
  }
  return lines
}


export function parseAbbrDef(lexer: Lexer): AbbreviationDef {
  const line = lexer.consume()
  const m = RE_ABBR_DEF.exec(line)!
  // PART 2's NO TRAILING WHITESPACE rule applies to every non-verbatim
  // content line. The expansion is otherwise raw, but an ASCII space or tab
  // at the physical end of its line is not part of that raw value.
  return { type: 'abbreviation_def', abbr: m[1]!, expansion: dropTrailingWhitespace(m[2]!) }
}

/** The unordered/task bullet character (`-`, `*`, or `+`) of a line. */
export function unorderedMarkerChar(line: string): string {
  return line.replace(/^\s*/, '').charAt(0)
}

/** Preserve capture indices while matching only the marker on terminator-free lines. */
export function unorderedMatch(line: string, terminatorFree = false): RegExpExecArray | null {
  if (!terminatorFree) return RE_UNORDERED.exec(line)
  const match = RE_UNORDERED_HEAD.exec(line)
  if (!match) return null
  const content = line.slice(match[0].length)
  match[0] = line
  match.push(content)
  return match
}

export const RE_UNORDERED_HEAD = /^(?=([ \t]*))\1[-*] +[ \t]*(?=[^ \t])/
export const RE_ORDERED_HEAD = /^(?=([ \t]*))\1([0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))([.)]) +[ \t]*(?=[^ \t])/
export const RE_TASK_HEAD = /^(?=([ \t]*))\1[-*] +\[([ xX\-_>?])\] +[ \t]*(?=[^ \t])/

export function markerMatch(line: string, full: RegExp, head: RegExp, terminatorFree: boolean): RegExpExecArray | null {
  if (!terminatorFree) return full.exec(line)
  const match = head.exec(line)
  if (!match) return null
  const content = line.slice(match[0].length)
  match[0] = line
  match.push(content)
  return match
}

export function orderedMatch(line: string, terminatorFree = false): RegExpExecArray | null {
  return markerMatch(line, RE_ORDERED, RE_ORDERED_HEAD, terminatorFree)
}

export function taskMatch(line: string, terminatorFree = false): RegExpExecArray | null {
  return markerMatch(line, RE_TASK, RE_TASK_HEAD, terminatorFree)
}

export function matchListMarker(
  line: string,
  isTask: boolean,
  isOrdered: boolean,
  terminatorFree = false,
): RegExpExecArray | null {
  if (isTask) return taskMatch(line, terminatorFree)
  if (isOrdered) {
    // An ordered list is not continued by a task or unordered marker.
    if (taskMatch(line, terminatorFree) !== null) return null
    return orderedMatch(line, terminatorFree)
  }
  // Unordered: not continued by task or ordered markers.
  if (taskMatch(line, terminatorFree) !== null || orderedMatch(line, terminatorFree) !== null) return null
  return unorderedMatch(line, terminatorFree)
}

// The visual content column of a list-marker line (`- x` -> 2, `1. x` -> 3,
// `- [ ] x` -> 6), or -1 if the line is not a list marker. Each marker regex
// captures the item content as its LAST group, so the content column is the
// column width of everything before that content. Used to decide, in the
// looseness scan, whether a line belongs to an item's sub-list (carve#322).
export function markerContentColumn(line: string, terminatorFree = false, knownColumn?: number): number {
  // Mirror parseList's own content-column computation so the looseness scan
  // uses the SAME threshold the recursive sub-list parse uses -- including the
  // task convention (content column is base + 2, the bullet width, NOT the
  // `- [ ] ` checkbox width) and an abutting `{...}` attribute (stripped first).
  // A marker-attached block contributes zero (§24 C3), so the width is read
  // off the stripped line.
  const la = extractItemAttr(line, terminatorFree)
  const mline = la ? (la.markerLine ?? la.stripped) : line
  const base = knownColumn ?? indentColumns(line)
  if (taskMatch(mline, terminatorFree) !== null) return base + 2
  const m = orderedMatch(mline, terminatorFree) ?? unorderedMatch(mline, terminatorFree)
  if (!m) return -1
  const content = m[m.length - 1]!
  return base + (mline.length - leadingWhitespace(mline) - content.length)
}

// Ordered-list dialect, fixed by the first item's marker.
export type OlKind = 'dec' | 'alo' | 'aup' | 'rlo' | 'rup'

export function romanToInt(s: string): number {
  const map: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }
  const t = s.toLowerCase()
  let total = 0
  for (let k = 0; k < t.length; k++) {
    const cur = map[t[k]!]!
    const nxt = map[t[k + 1]!] ?? 0
    total += cur < nxt ? -cur : cur
  }
  return total
}

// Does `marker` belong to dialect `kind`? Used to continue a list (a
// marker outside the dialect ends it, §11).
export function olKindMatches(marker: string, kind: OlKind): boolean {
  switch (kind) {
    case 'dec':
      // `*` not `+`: the bare-dot marker (empty value, carve#315) is decimal
      // too, so it continues an explicit decimal-dot list and vice versa.
      return /^[0-9]*$/.test(marker)
    case 'alo':
      return /^[a-z]$/.test(marker)
    case 'aup':
      return /^[A-Z]$/.test(marker)
    case 'rlo':
      return /^[ivxlcdm]+$/.test(marker)
    case 'rup':
      return /^[IVXLCDM]+$/.test(marker)
  }
}

// Classify the FIRST marker, which fixes the list dialect. A single
// ambiguous roman letter (i/v/x/l/c/d/m) is roman when the next sibling
// marker is roman of the same case, or when it is `i`/`I` (the common
// roman start); any other single letter is alphabetic.
export function olKindOf(marker: string, nextMarker: string | null): OlKind {
  // The bare dot has no value to classify: it is decimal by definition.
  if (marker === '') return 'dec'
  if (/^[0-9]+$/.test(marker)) return 'dec'
  const upper = marker === marker.toUpperCase()
  const romanChars = /^[ivxlcdm]+$/i.test(marker)
  if (romanChars && marker.length > 1) return upper ? 'rup' : 'rlo'
  if (romanChars) {
    // Single ambiguous letter (i/v/x/l/c/d/m): tie-break on the next
    // sibling. `c. d.` is alpha (consecutive letters) while `iv. v.` /
    // `i. ii.` is roman (consecutive roman). A lone `i`/`I` defaults to
    // roman (the canonical roman start); other lone letters are alpha.
    if (nextMarker !== null && (nextMarker === nextMarker.toUpperCase()) === upper) {
      if (
        /^[ivxlcdm]+$/i.test(nextMarker) &&
        romanToInt(nextMarker) === romanToInt(marker) + 1
      ) {
        return upper ? 'rup' : 'rlo'
      }
      if (
        /^[a-z]$/i.test(nextMarker) &&
        nextMarker.toLowerCase().charCodeAt(0) === marker.toLowerCase().charCodeAt(0) + 1
      ) {
        return upper ? 'aup' : 'alo'
      }
    }
    if (marker.toLowerCase() === 'i') return upper ? 'rup' : 'rlo'
  }
  return upper ? 'aup' : 'alo'
}

export function olStartOf(marker: string, kind: OlKind): number {
  if (kind === 'dec') {
    // The bare dot carries no number, so it starts at 1 and the `<ol>` omits
    // `start`. Setting a start is exactly what the explicit `1.` form is for.
    const n = parseInt(marker, 10)
    return Number.isNaN(n) ? 1 : n
  }
  if (kind === 'rlo' || kind === 'rup') return romanToInt(marker)
  return marker.toLowerCase().charCodeAt(0) - 96 // a=1
}

export function olTypeOf(kind: OlKind): '' | 'a' | 'A' | 'i' | 'I' {
  return kind === 'dec'
    ? ''
    : kind === 'alo'
      ? 'a'
      : kind === 'aup'
        ? 'A'
        : kind === 'rlo'
          ? 'i'
          : 'I'
}

// A line continues an ordered list of `kind`/`delim` (same dialect + same
// `.`/`)` delimiter).
export function orderedContinues(line: string, kind: OlKind, delim: string, terminatorFree = false): boolean {
  const o = orderedMatch(line, terminatorFree)
  return o !== null && o[3]! === delim && olKindMatches(o[2]!, kind)
}

/**
 * A non-indented line following a list item is lazy continuation (folds into the
 * item's paragraph) UNLESS it starts a block, in which case the list ends - the
 * djot/CommonMark lazy-continuation rule. Mirrors the block dispatch in
 * `parseBlock`, minus the `%%` inline comment (which is paragraph text, not a
 * block) and the paragraph fallthrough.
 */
/**
 * Does this line OPEN a block (vs being plain prose)? Used by the compact-list
 * rule: a blank line inside a list item loosens the list only when the content
 * after it is a plain paragraph; a blank followed by a block opener keeps the
 * item tight. Lexer-free (no `:::` closer lookahead — for the loose decision a
 * `:::`-shaped opener counts as a block regardless).
 */
/**
 * A ONE-LINE construct that renders nothing: a line comment or a reference /
 * footnote definition (§17 L1's "not a paragraph" set, carve#621).
 *
 * Used for looseness only, and deliberately single-line. A comment BLOCK is
 * invisible too, but `lineOpensBlock` already claims its `%%%` opener, and
 * skipping past that opener would land the scan on the block's BODY - ordinary
 * text - and loosen the item on content the reader never sees.
 *
 * `RE_ABBR_DEF` is not in the set: a definition inside a container is no longer
 * recognized as one, so the line renders as text and is genuinely visible.
 */
export function isInvisibleLine(line: string, whitespace?: number): boolean {
  const l = whitespace === undefined ? line.replace(/^[ \t]+/, '') : line.slice(whitespace)
  // `RE_COMMENT_LINE` matches a `%%%` opener too, so exclude the block form
  // explicitly - skipping it lands the scan on the block's BODY.
  if (RE_COMMENT_BLOCK.test(l)) return false
  if (RE_COMMENT_LINE.test(l)) return true
  if (indentColumns(line, 1) === 0 && (isLinkDefLine(l) || RE_FOOTNOTE_DEF.test(l))) return true

  // A bare attribute line renders nothing either, but unlike the others it is
  // COLUMN-STRICT (§15): it opens only AT its container's content column, and
  // one column further in it is literal paragraph text that really does render
  // `<p>{.c}</p>`. These lines arrive dedented to that column, so the test is
  // column 0 - without it the exemption would swallow a visible paragraph.
  //
  // `extractItemAttr` would not do here: it needs a MARKER before the braces,
  // so it never matches a standalone `{.c}` - a check that could not fire.
  return indentColumns(line, 1) === 0 && isBlockAttributeLine(l)
}

/**
 * Which lines a closed `%%%` comment block hides, opener and closer included.
 *
 * `isInvisibleLine` answers per line and therefore cannot see the block form at
 * all. An opener with no run of its exact width ahead opens nothing (PART 9
 * §28) and hides nothing, and a run inside VERBATIM payload is that block's
 * content rather than an opener - which is why the caller passes the item's
 * marker line too, since the fence may be authored on it.
 *
 * A verbatim opener is taken at face value here, without §10's closer lookahead,
 * and only a closer at column 0 ends its run. Both readings err toward STAYING
 * in the payload, and the cost of that is an unmarked comment block, which lands
 * the caller back on the reading it had before this pass existed.
 */
export function commentBlockSpans(lines: string[]): boolean[] {
  const hidden = new Array<boolean>(lines.length).fill(false)
  // The last line carrying each run width, so an opener that cannot close is
  // refuted in O(1). Scanning to the end instead costs one suffix read per
  // unterminated opener, which is the ladder carve#2542 measured.
  const lastAt = new Map<number, number>()
  let canClose = false
  for (let k = 0; k < lines.length; k++) {
    const run = commentFenceRun(lines[k]!)
    if (run !== undefined) {
      if (lastAt.has(run)) canClose = true
      lastAt.set(run, k)
    }
  }
  if (!canClose) return hidden
  let verbatimClose: RegExp | null = null
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]!
    if (verbatimClose !== null) {
      if (verbatimClose.test(line)) verbatimClose = null
      continue
    }
    const run = commentFenceRun(line)
    if (run !== undefined) {
      if ((lastAt.get(run) ?? -1) <= k) continue
      // EXACT length closes; a shorter run inside a wider block is payload.
      let close = k + 1
      while (commentFenceRun(lines[close]!) !== run) close++
      for (let j = k; j <= close; j++) hidden[j] = true
      k = close
      continue
    }
    const opener = verbatimOpener(line)
    if (opener !== null) verbatimClose = fenceCloseRe(opener)
  }

  return hidden
}

/**
 * The fence run of a verbatim opener on `line`, reached through indentation and
 * through any number of list markers, else null.
 *
 * `commentFenceRun` is indent-tolerant (carve#624), so reading the opener at
 * column 0 alone leaves the two asymmetric: a `%%%` pair inside a DESCENDANT
 * item's code payload then reads as a comment block.
 */
export function verbatimOpener(line: string): string | null {
  // Each marker consumes at least two characters, so `rest` strictly shrinks.
  let rest = line.replace(/^[ \t]+/, '')
  while (rest.length > 0) {
    const fence = RE_FENCE.exec(rest)
    if (fence) return fence[2]!
    const raw = RE_RAW_FENCE.exec(rest)
    if (raw) return raw[1]!
    const task = RE_TASK.exec(rest)
    const unordered = task ? null : RE_UNORDERED.exec(rest)
    const ordered = task ?? unordered ? null : RE_ORDERED.exec(rest)
    const content = task ? task[3] : unordered ? unordered[2] : ordered ? ordered[4] : undefined
    if (content === undefined) return null
    rest = content
  }

  return null
}

export function lazyContinuationEndsList(line: string, lexer: Lexer): boolean {
  // A MARKER THE QUOTE ABOVE ALREADY TOOK AS LAZY TEXT OPENS NOTHING HERE.
  // PART 0 lazy continuation folds an unmarked line into the innermost open
  // paragraph and names a list marker as NOT an exclusion, so `> - a` / `- m`
  // is one quote whose item paragraph is `a\n- m`. The quote collects the line
  // and hands it to this sub-parse, which read the marker a second time and
  // started a sibling item inside the quote (markup-carve/carve#1904).
  if (lexer.quoteLazyMarkerLines.has(lexer.lineNumber(lexer.pos))) return false
  // A VERBATIM fence ends the fold only WITH a closer ahead (§10 I4): an
  // unterminated ``` is not a code block, it is an inline verbatim run that
  // belongs to the item's paragraph. Without this the item was closed and the
  // fence became a top-level code block, which the top-level path already got
  // right (corpus 81-paragraph-interruption-18) and carve-rs got right
  // everywhere (carve-js#540).
  //
  // The `:::` arms below stay lexer-free deliberately - I4 does not guard a
  // colon fence (markup-carve/carve#514), and the comment there gives the
  // separate reason.
  if (RE_RAW_FENCE.test(line)) return fenceHasCloser(lexer, RE_RAW_FENCE.exec(line)![1]!)
  if (RE_FENCE.test(line)) return fenceHasCloser(lexer, RE_FENCE.exec(line)![2]!)
  // A DEGRADED COMMENT FENCE ENDS NOTHING (§28, markup-carve/carve#1903, ported
  // at carve-js#1607). With no exact-width closer ahead the opener is one
  // `comment_line` for every question the layout asks, container OWNERSHIP
  // included - and a `%%` line leaves the item open in every reader, so this
  // must too. The lookahead is the one §10 I4 already makes for a verbatim
  // fence, two lines up.
  //
  // A TERMINATED `%%%` here is untouched: a comment BLOCK written at the
  // document's own opener column still ends the item (corpus 214). The closer
  // is looked for AHEAD rather than on the next line, which is corpus 445 row 9.
  if (RE_COMMENT_BLOCK.test(line)) {
    return commentBlockHasCloser(lexer, RE_COMMENT_BLOCK.exec(line)![1]!.length)
  }
  return (
    // A flush-left colon-fence shaped line ends list lazy continuation
    // regardless of outer-stream closer lookahead. If the line belongs to the
    // item, it must be indented and parsed by the item sub-lexer; otherwise a
    // later flush-left `:::` can be incorrectly pulled in as the item's closer.
    (RE_ADMONITION_OPEN.test(line) && !RE_ADMONITION_CLOSE.test(line)) ||
    RE_DIV_OPEN.test(line) ||
    RE_LINE_BLOCK_OPEN.test(line) ||
    RE_HARDBREAKS_OPEN.test(line) ||
    RE_QUOTE_BLOCK_OPEN.test(line) ||
    (leadingWhitespace(line) === 0 && (RE_FOOTNOTE_DEF.test(line) || isLinkDefLine(line))) ||
    RE_HR.test(line) ||
    RE_HEADING.test(line) ||
    peekBlockAttributes(lexer) ||
    RE_DEFLIST_TERM.test(line) ||
    RE_BLOCKQUOTE.test(line) ||
    RE_TASK.test(line) ||
    RE_UNORDERED.test(line) ||
    RE_ORDERED.test(line) ||
    extractItemAttr(line) !== null ||
    isTableRow(line)
  )
}

export function isLiteralColonFenceLine(line: string): boolean {
  line = line.replace(/^[ \t]+/, '')
  return (
    /^:{3,}/.test(line) &&
    !RE_ADMONITION_CLOSE.test(line) &&
    !(RE_ADMONITION_OPEN.test(line) && !RE_ADMONITION_CLOSE.test(line)) &&
    !RE_DIV_OPEN.test(line) &&
    !RE_LINE_BLOCK_OPEN.test(line) &&
    !RE_HARDBREAKS_OPEN.test(line) &&
    !RE_QUOTE_BLOCK_OPEN.test(line)
  )
}

/**
 * Which half of a definition-list entry the item's tracker last saw open: the
 * TERM (a `::` line), its DESCRIPTION body (a `:` line), or neither.
 */
export type DefListOpening = false | 'term' | 'description'

export type ItemOpaqueState =
  | { kind: 'code'; close: RegExp; column?: number }
  | { kind: 'comment'; length: number; paragraphBefore: boolean; atColumn: boolean; term?: boolean }

/**
 * A verbatim fence a DESCENDANT of a list item holds open, with its base.
 *
 * No comment arm: `commentFenceRun` accepts an INDENTED delimiter
 * (markup-carve/carve-js#816), so the item's own tracker already opens on a
 * descendant's `%%%` and a fence-shaped line in that payload is already body.
 * Tracking it here as well moved nothing over 1968 corpus documents and 13776
 * generated shapes.
 */
export interface DescendantOpaque { close: RegExp; base: number; markerLine?: boolean; holder?: number }

export interface ItemLazyState {
  retainedMarker?: boolean
  opaque: ItemOpaqueState | null
  termAfterComment?: boolean
  // Whether the item's collected content currently ends in an OPEN paragraph
  // that a dedented (below content-column) non-blank line lazily continues
  // (CommonMark family-D rule). True after plain prose, a blockquote line, or
  // plain text inside an open div/admonition; false after a code fence, table,
  // heading, thematic break, a just-opened div, or a blank line.
  lazyFoldable: boolean
  /**
   * Did the line before this one leave a table open?
   *
   * A CONTINUATION ROW IS MORE TABLE, and only where a table is above it
   * (markup-carve/carve#1349). It carries no leading pipe, so `isTableRow` does
   * not see it, and an item whose table ended on one reported an open paragraph
   * its table did not have. With no row above, `- a` / `  + b |` is a paragraph
   * and its `+ b |` is prose, so a dedented line still folds in.
   */
  inTable: boolean
  /**
   * Did the item's last block render nothing, written AT the content column?
   *
   * An invisible line at the column ends the PARAGRAPH, not the container
   * (markup-carve/carve#1364). Those are two answers and this tracker gave one
   * flag for both, so closing the paragraph also ended the item and a
   * below-column line that belongs to it came out at the top level (corpus 197,
   * 277-3, 358). The container still ends at document column 0, which is what
   * the ruling says and what separates 358 from 357-2.
   */
  invisibleAtColumn: boolean
  /** A consumed below-column comment retains a noninterrupting follower. */
  commentAtColumn: boolean
  /**
   * Is the tracker inside a footnote definition's body?
   *
   * A FOOTNOTE DEFINITION'S BLOCK RUNS TO THE END OF ITS BODY, blank lines and
   * all (markup-carve/carve#1363, PART 1 S4). Its continuation lines are the
   * definition's, not the container's, so none of them reopens a paragraph for a
   * column-0 line to continue. A LINK reference definition has no body and must
   * not open a run - it is the control the ruling names, and the one an
   * over-wide fix breaks.
   */
  inFootnoteBody: boolean
  footnoteBodyColumn?: number
  /**
   * The tracker for the quote this item currently ends on, or null.
   *
   * PART 1 S4 is about the open STACK, so what the ITEM ends on may be several
   * quotes down: `:  > | a |` / `   > + b |` ends on a table, not on a quoted
   * paragraph. Carried across the item's lines for the same reason the quote's
   * own nested tracker is - a quoted table spanning two of them is one table.
   */
  quoteInner: BlockQuoteLazyState | null
  // Whether the item currently has an OPEN definition list (a `:: term` or
  // `:  def` marker was the last structural line, possibly across a separator
  // blank). Used so an UNDER-indented (below content-column) def/term marker
  // line re-aligns to the term instead of folding as lazy prose: rs/php attach
  // an under-indented `:  def` as a `<dd>`, and carve-js must match (decision
  // D, "lenient - still a definition"). An OVER-indented marker still folds
  // (it reaches the item via sliceColumns, not this lazy path).
  //
  // WHICH HALF OF THE ENTRY IS OPEN, not just whether one is: with a
  // description body already open, a lazy `:` line folds into that body instead
  // of registering a second one, and the quoted-item arm below has to tell the
  // two apart (markup-carve/carve-js#1606).
  inDefList: DefListOpening
  // Whether the item's open paragraph has absorbed a MALFORMED colon fence and
  // is therefore taking the next fence-shaped line as text too (PART 9 §12,
  // "a colon-fence line that fails the opener test leaves the paragraph
  // expecting a closer"). The block layer has implemented that rule at top
  // level for a long time; this tracker did not, so it read the trailing `:::`
  // of `- item` / `  :::note` / `  body` / `  :::` as a div opener and closed
  // the item, where PART 1 S4 folds the following flush-left line into the
  // paragraph that was never interrupted (carve#891).
  absorbingFence: boolean
  inlineFenceParagraph?: boolean
  /** Reads a literal line block's marker-shaped payload, which opens no block. */
  literalLayout?: boolean
  // Fed by a definition body's collector rather than a list item's.
  definitionBody?: boolean
  descriptionColumn?: number
  /** Whether the stored description column came from a term. */
  descriptionHasTerm?: boolean
  closedBelowComment?: boolean
  // The column of the first fence run with no closer. Its rebase group runs to
  // the end of the item, so only a line at this exact column is authored again.
  unclosedFenceBase?: number
  // The collector's paragraph carry can contain a real code block in a colon body.
  inlineFenceBlock?: boolean
  unrebasedColonBody?: { width: number }
  // Only a marker-line container admits a named opener past its body column.
  markerColonBody?: boolean
  closedColonBody?: boolean
  closedLiteralComment?: boolean
  // How many colon-fence containers the item's own content currently holds
  // open. A bare `:::` with one open is that container's CLOSER, not an opener
  // and not absorbable text - which is why a malformed fence INSIDE an open
  // container arms nothing: the closer below it still has a container to close.
  divDepth: number
  literalColon?: { width: number; column: number; sourceLine?: number; awaitingBody?: boolean; rejectedComment?: boolean; opaque?: OpaqueGroup; absorbing?: boolean; belowComment?: number }
  authoredColon?: { width: number; column: number; depth: number; belowComment?: number }
  // The lines so far of a `{…}` block-attribute block that has not closed yet,
  // newline-joined, or null when the tracker is not inside one. §15 A5 lets the
  // block WRAP, so the tracker has to hold it open the way it holds a fence
  // open - otherwise `{.k` / `#x}` reads as two lines of prose and the container
  // keeps a paragraph nothing opened (markup-carve/carve#1281).
  attrRun: string | null
  /**
   * The leading run a container INSIDE the item currently owns, or -1.
   *
   * The same distinction `rebaseOverindentedBlocks` carries as `ownedColumn`. A
   * run the column owns is a NESTING LEVEL; any other run is an AUTHORED
   * over-indent. Without it the tracker held only the paragraph answer
   * `markerLineState` gave it, so the arm below could not tell the two apart and
   * reading a nested item's own column flush erased a level.
   *
   * In the CHARACTER unit `ItemLineFacts.whitespace` reports, which the lexer
   * has already measured for the line, so none of this re-scans a leading run.
   */
  ownedColumn: number
  /** Marker column for a descendant item, in this frame's coordinates. */
  ownedMarker?: number
  /**
   * Is `ownedColumn` an AUTHORED base rather than a nested marker's column?
   *
   * The two own different lines. A nested marker owns everything at or past its
   * content column; an authored base owns only what is PAST it, because a line
   * AT the base is more of the same block.
   */
  ownedAuthored: boolean
  /**
   * Q1 FOR THE DESCENDANT `ownedColumn` NAMES, while that frame is open.
   *
   * A below-column line continues a paragraph if and only if one is open at the
   * DEEPEST frame (`CARVE-P0-009`, markup-carve/carve#2884), and the arms below
   * answer for THIS item's column. A line at or past a nested marker's content
   * column is the deeper item's, so it is classified there - by this same
   * tracker, one frame in, which is what makes a fence span, a `:::` container
   * and a quote answer as well as the three one-line blocks do.
   *
   * Null until a nested marker opens a frame, and dropped again when a line
   * lands back at this item's own content. An AUTHORED over-indent keeps the
   * narrower arm below instead: a line AT an authored base is more of the same
   * block, so a fence written there is the one its paragraph ABSORBED.
   */
  deepest?: ItemLazyState | null
}

/**
 * A BOUNDARY LINE INSIDE AN OPEN FENCE DOES NOT END THE CONTAINER
 * (markup-carve/carve#983, corpus category 279), for the INDENTED body of a
 * list item, whose model is the running tracker rather than a block extent.
 *
 * The three fence kinds - code/raw, colon (`:::`), comment (`%%%`) - all make
 * their body opaque, so a line that would otherwise be read as structure is
 * body text instead. Which lines those are is the container's question; whether
 * a fence is open is NOT, and is answered here.
 *
 * Two of the three were spelled out at the one site that consulted any fence
 * state at all, and the colon depth the tracker already keeps was not, so a
 * `:::` body severed on a marker where a code fence's body did not.
 */
export function insideOpenFence(state: ItemLazyState): boolean {
  return state.opaque !== null || state.divDepth > 0
}

export function isRetainableLineComment(lexer: Lexer, content: string): boolean {
  if (!RE_COMMENT_LINE.test(content.trimStart())) return false
  const run = commentFenceRun(content.trimStart())
  return run === undefined || !commentBlockHasCloser(lexer, run)
}

export function retainCommentBoundary(state: ItemLazyState): void {
  state.lazyFoldable = false
  state.commentAtColumn = true
  state.ownedColumn = -1
  state.deepest = null
}

/**
 * The index past the closer of a matched `%%%` fence opening at `at`, or
 * undefined. The first bare run of the same width closes it at any column.
 * CARVE-P9-053: such a fence answers exactly as one `%%` line at the opener's column.
 */
export function matchedCommentFenceEnd(
  lexer: Lexer,
  at: number = lexer.pos,
  endsContainer: (line: string) => boolean = () => false,
): number | undefined {
  const opener = lexer.lineAt(at)
  if (opener === undefined) return undefined
  const run = commentFenceRun(opener.replace(/^[ \t]+/, ''))
  if (run === undefined) return undefined
  for (let j = at + 1; ; j++) {
    const line = lexer.lineAt(j)
    if (line === undefined) return undefined
    if (commentFenceRun(line.replace(/^[ \t]+/, '')) === run) return j + 1
    if (endsContainer(line)) return undefined
  }
}

export function retainBelowColumnComment(content: string, state: ItemLazyState, atColumn: boolean): boolean {
  if (atColumn || state.opaque !== null || state.literalColon !== undefined ||
      !RE_COMMENT_LINE.test(content.trimStart())) return false
  retainCommentBoundary(state)
  return true
}

/** An `ItemLazyState` that has seen nothing, for a collector that only reads fences. */
export function verbatimOnlyLazyState(): ItemLazyState {
  return {
    opaque: null,
    invisibleAtColumn: false,
    commentAtColumn: false,
    inFootnoteBody: false,
    absorbingFence: false,
    divDepth: 0,
    lazyFoldable: false,
    inTable: false,
    quoteInner: null,
    inDefList: false,
    attrRun: null,
    ownedColumn: -1,
    ownedAuthored: false,
  }
}

/**
 * Give back what a buffered blank leaves inside an open verbatim region.
 *
 * A collector buffers a blank as `''`, which is right for a separator and wrong
 * for a line of spaces inside a fence: CARVE-P11-016 keeps that content.
 *
 * The pass runs AFTER the rebase, and it has to. `trackItemLazyState` reads a
 * fence FLUSH, and the rebase is what brings an authored base flush - asked
 * during collection, a body written past its minimum column never showed the
 * tracker a fence at all. The residue is measured past the OPENER's own source
 * column, because that is the column the code block's content is measured past.
 */
export function restoreVerbatimBlanks(
  lines: string[],
  sourceLines: readonly (string | undefined)[],
  buffered: ReadonlySet<number>,
  openerColumn: (index: number) => number,
  factsAt?: (index: number) => ItemLineFacts | undefined,
): void {
  if (buffered.size === 0) return
  const state = verbatimOnlyLazyState()
  let column = -1
  for (let i = 0; i < lines.length; i++) {
    if (buffered.has(i)) {
      const source = sourceLines[i]
      if (source !== undefined && column >= 0 && insideOpenFence(state)) {
        lines[i] = sliceColumns(source, column, true)
      }
      trackItemLazyState(lines[i]!, state, undefined, true, undefined, factsAt?.(i))
      continue
    }
    const wasOpen = insideOpenFence(state)
    trackItemLazyState(lines[i]!, state, undefined, true, undefined, factsAt?.(i))
    if (!wasOpen && insideOpenFence(state)) column = openerColumn(i)
  }
}

/**
 * Does the item currently end on a BLOCK QUOTE WITH AN OPEN PARAGRAPH?
 */
export function insideOpenQuoteParagraph(state: ItemLazyState): boolean {
  return state.quoteInner !== null && blockQuoteParagraphOpen(state.quoteInner)
}

export interface AttachedViewScan {
  colon?: Map<number, number>
  colonMisses?: Map<number, FailedScanRanges>
}

/**
 * A lookahead over the lines an attached block may hold, already in the form
 * the block will be parsed in.
 *
 * `at(offset)` is relative to the lexer's current position; `base` is the line
 * index that offset 0 sits at, so a refutation from `index` (which is keyed by
 * line index) can be asked about an offset.
 */
export interface AttachedScan {
  at: (offset: number) => string | undefined
  index: CloserIndex
  base: number
  cache: AttachedViewScan
  preciseClosers: () => AttachmentFenceClosers
  end: number
  contentColumn: number
  indexBase: number
}

/**
 * The offset of the CLOSER of a code, raw or comment fence opened at `i`, or
 * -1 when that line opens no such fence or the fence never closes.
 *
 * A code/raw fence and a comment fence are OPAQUE: everything between opener
 * and closer is content, so a colon fence written inside one closes nothing
 * and opens nothing (the reason `findColonCloser` skips these spans whole).
 */
export function opaqueSpanEnd(scan: AttachedScan, i: number): number {
  const line = scan.at(i)
  if (line === undefined) return -1
  const fence = RE_FENCE.exec(line)
  const rawFence = fence ? null : RE_RAW_FENCE.exec(line)
  const marker = fence ? fence[2]! : rawFence ? rawFence[1]! : null
  const run = marker === null ? commentFenceRun(line) : undefined
  if (marker !== null ? !codeCloserPossible(scan.index, marker, scan.base + i)
    : run === undefined || !exactCloserPossible(scan.index.comment, run, scan.base + i)) return -1
  const index = scan.preciseClosers()
  const end = marker !== null
    ? index.nextCode(marker, scan.indexBase + scan.base + i + 1, scan.indexBase + scan.end, scan.contentColumn)
    : index.nextComment(run!, scan.indexBase + scan.base + i + 1, scan.indexBase + scan.end)
  return end === undefined ? -1 : end - scan.indexBase - scan.base
}

/**
 * The offset of the closer of a colon fence of width `len` opened at `openIdx`,
 * or -1 when it never closes. Colon fences close on an EXACT length match
 * (carve#455), so the widths in flight are a stack rather than a depth count.
 */
export function findColonCloser(scan: AttachedScan, openIdx: number, len: number): number {
  // The OUTERMOST width has to reappear for the stack to empty, so nothing
  // ahead carrying it refutes the whole scan before it starts.
  const memo = scan.cache.colon ??= new Map()
  const opener = scan.base + openIdx
  const cached = memo.get(opener)
  if (cached !== undefined) return cached < 0 ? -1 : cached - scan.base
  if (!exactCloserPossible(scan.index.colon, len, opener)) {
    memo.set(opener, -1)
    return -1
  }
  const misses = scan.cache.colonMisses ??= new Map()
  const fail = (stack: { opener: number; width?: number; ranges?: { start: number; end: number }[] }[]): number => {
    for (const frame of stack) memo.set(frame.opener, -1)
    for (const frame of stack) {
      if (frame.width === undefined || frame.ranges === undefined) continue
      let retained = misses.get(frame.width)
      if (retained === undefined) {
        retained = new FailedScanRanges()
        misses.set(frame.width, retained)
      }
      for (const range of frame.ranges) retained.add(range.start, range.end)
    }
    return -1
  }
  const lastClose = (width: number, from: number): number => {
    const last = scan.preciseClosers().lastColon(width, scan.indexBase + from, scan.indexBase + scan.end, scan.contentColumn)
    return last === undefined ? -1 : last - scan.indexBase
  }
  const rootLastClose = lastClose(len, opener + 1)
  if (rootLastClose < 0) return fail([{ opener }])
  const stack = [{ width: len, opener, lastClose: rootLastClose, ranges: [] as { start: number; end: number }[] }]
  for (let j = openIdx + 1; ; j++) {
    const frame = stack[stack.length - 1]!
    const position = scan.base + j
    if (misses.get(frame.width)?.has(position)) return fail(stack)
    const event = scan.preciseClosers().nextEvent(scan.indexBase + position, scan.indexBase + scan.end, scan.contentColumn)
    const next = event === undefined ? scan.end : event - scan.indexBase
    const previous = frame.ranges[frame.ranges.length - 1]
    if (previous?.end === position) previous.end = next + 1
    else frame.ranges.push({ start: position, end: next + 1 })
    if (event === undefined || next > frame.lastClose) return fail(stack)
    j = next - scan.base
    const line = scan.at(j)!
    if (layoutWork.on) layoutWork.attachmentColonLines++
    // Skipped from the line AFTER its opener: an opener with no info string is
    // closer-shaped itself and would otherwise end the span where it began.
    const span = opaqueSpanEnd(scan, j)
    if (span !== -1) {
      j = span
      continue
    }
    const close = RE_ADMONITION_CLOSE.exec(line)
    const closeLen = close?.[1]?.length
    if (closeLen === stack[stack.length - 1]!.width) {
      const frame = stack.pop()!
      memo.set(frame.opener, scan.base + j)
      if (stack.length === 0) return j
      continue
    }
    const open = closeLen ?? colonBlockOpenerRun(line)
    if (open === null) continue
    const known = memo.get(scan.base + j)
    if (known !== undefined) {
      if (known < 0) return fail(stack)
      j = known - scan.base
    } else stack.push({ width: open, opener: scan.base + j, lastClose: lastClose(open, scan.base + j + 1), ranges: [] })
  }
}

/**
 * The offset of the last line of the fenced block a `+` attaches, or -1 when
 * the attached block does not open with a fence that closes.
 *
 * ONE HELPER, THREE FENCE KINDS. Code/raw, comment and colon all make their
 * body opaque, and which lines could otherwise end the block is the CONTAINER's
 * question, layered on by `collectAttachedBlock` as `isBoundary`.
 */
export function fencedBlockEnd(scan: AttachedScan): number {
  const opaque = opaqueSpanEnd(scan, 0)
  if (opaque !== -1) return opaque
  const first = scan.at(0)
  if (first === undefined) return -1
  const run = colonBlockOpenerRun(first)
  if (run !== null) {
    const close = findColonCloser(scan, 0, run)
    if (close !== -1) return close
  }

  return -1
}

/**
 * §17 L3: does the marker's candidate block begin at DOCUMENT column 0?
 *
 * "Flush-left" is the reach, not a description of the usual case: a line at any
 * other column is not attached at all, and falls through to the ordinary column
 * rules that give it to whichever container its own column names
 * (markup-carve/carve#1436).
 *
 * Asked of the ORIGINAL line, because the view is dedented - see `rootLines`.
 * A quote prefix is stripped first: inside a quote the marker's column 0 is the
 * quote's content column, which is what the executable spec measures there too.
 *
 * Returns TRUE when the answer cannot be recovered, so a synthetic or
 * reassembled line keeps the behavior it had rather than silently losing its
 * attachment.
 */
/** The column a source line's content starts at, past any quote markers. */
export function sourceQuotePrefixEnd(line: string, start: number): number {
  let end = start
  while (line[end] === ' ' || line[end] === '\t') end++
  if (line[end] !== '>') return -1
  end++
  if (line[end] === ' ' || line[end] === '\t') end++
  return end
}

export function quotePrefixDepth(line: string): number {
  let depth = 0
  for (let offset = 0, end = sourceQuotePrefixEnd(line, offset); end >= 0; end = sourceQuotePrefixEnd(line, offset)) {
    depth++
    offset = end
  }
  return depth
}

export function sourceQuoteBody(line: string): string {
  let offset = 0
  for (let end = sourceQuotePrefixEnd(line, offset); end >= 0; end = sourceQuotePrefixEnd(line, offset)) offset = end
  const body = line.slice(offset)
  return body.slice(leadingWhitespace(body))
}

export function sourceColumn(line: string, quoteLevels = Infinity): number {
  let column = 0
  let offset = 0
  for (let level = 0; level < quoteLevels; level++) {
    const end = sourceQuotePrefixEnd(line, offset)
    if (end < 0) {
      if (quoteLevels !== Infinity) return Infinity
      break
    }
    for (; offset < end; offset++) column += line[offset] === '\t' ? 4 - column % 4 : 1
  }
  while (line[offset] === ' ' || line[offset] === '\t') {
    column += line[offset] === '\t' ? 4 - column % 4 : 1
    offset++
  }
  return column
}

export function sourceQuoteLocalColumn(line: string, levels: number): number {
  let offset = 0
  for (let level = 0; level < levels; level++) {
    const end = sourceQuotePrefixEnd(line, offset)
    if (end < 0) return Infinity
    offset = end
  }
  return indentColumns(line.slice(offset))
}

export function quoteIndentHasTab(line: string, levels: number): boolean {
  let offset = 0
  for (let level = 0; level < levels; level++) {
    const end = sourceQuotePrefixEnd(line, offset)
    if (end < 0) return false
    offset = end
  }
  const body = line.slice(offset)
  return body.slice(0, leadingWhitespace(body)).includes('\t')
}

export function quoteBodyColumn(line: string, levels: number): number {
  let column = 0
  let offset = 0
  for (let level = 0; level < levels; level++) {
    const end = sourceQuotePrefixEnd(line, offset)
    if (end < 0) return Infinity
    for (; offset < end; offset++) column += line[offset] === '\t' ? 4 - column % 4 : 1
  }
  return column
}

export function sourceColumnAt(line: string, offset: number): number {
  let column = 0
  for (let index = 0; index < offset; index++)
    column += line[index] === '\t' ? 4 - column % 4 : 1
  return column
}

export type OpenMarker = { kind: 'list' | 'footnote' | 'description' | 'quote'; column: number; localColumn: number; quoteDepth: number; contentColumn: number; firstBlock: boolean }
export type MarkerDecision = { owner?: OpenMarker; reason?: RefusedContinuationMarker['reason']; blockedByInnerList?: boolean; unprefixedQuoteFollower?: boolean }

export class OpenMarkerClassifier {
  private stack: OpenMarker[] = []
  private decisions = new Map<number, MarkerDecision>()
  private scanned = 0

  constructor(private readonly lines: readonly string[]) {}

  get(index: number): MarkerDecision {
    while (this.scanned <= index && this.scanned < this.lines.length) this.step(this.scanned++)
    return this.decisions.get(index) ?? {}
  }

  private step(index: number): void {
    const line = this.lines[index]!
    const depth = quotePrefixDepth(line)
    const column = sourceColumn(line)
    const localColumn = depth > 0 ? sourceQuoteLocalColumn(line, depth) : column
    // `>+` and `> +` name the same quote level despite different physical
    // columns for the +. At the quote body's start, compare local columns.
    const useLocalColumn = depth > 0 && (quoteIndentHasTab(line, depth) || localColumn === 0)
    const markerColumn = useLocalColumn ? localColumn : column
    const body = sourceQuoteBody(line)
    if (isContinuationMarker(body)) {
      layoutWork.markerLinesClassified += Number(layoutWork.on)
      let owner: OpenMarker | undefined
      const deepestQuote = this.stack.reduce((deepest, entry) => entry.kind === 'quote'
        ? Math.max(deepest, entry.quoteDepth) : deepest, 0)
      const blockedByInnerList = depth > 0 && this.stack.some(entry => entry.kind === 'list' && entry.quoteDepth >= depth)
      for (let at = this.stack.length - 1; at >= 0; at--) {
        layoutWork.markerStackEntriesExamined += Number(layoutWork.on)
        const entry = this.stack[at]!
        if ((useLocalColumn ? entry.localColumn : entry.column) === markerColumn &&
            entry.quoteDepth === depth && (depth === 0 || depth >= deepestQuote)) { owner = entry; break }
      }
      const follower = this.lines[index + 1]
      if (follower !== undefined) layoutWork.markerFollowerProbes += Number(layoutWork.on)
      const followerColumn = follower === undefined ? Infinity : useLocalColumn
        ? sourceQuoteLocalColumn(follower, depth) : sourceColumn(follower, depth)
      const followerBody = follower === undefined ? '' : sourceQuoteBody(follower)
      const sibling = follower !== undefined && followerColumn === markerColumn &&
        (unorderedMatch(followerBody) !== null || orderedMatch(followerBody) !== null)
      const unprefixedQuoteFollower = depth === 0 && owner?.kind === 'description' && sibling &&
        this.stack.some(entry => entry.kind === 'quote' && entry.quoteDepth > 0)
      const reason: MarkerDecision['reason'] = owner === undefined ? 'wrong-column'
        : follower === undefined ? 'document'
          : isBlankLine(followerBody) ? 'blank'
            : followerColumn < markerColumn ? 'left'
              : followerColumn > markerColumn ? 'right'
                : sibling && owner.kind === 'list' ? 'sibling' : undefined
      this.decisions.set(index, { ...(owner ? { owner } : {}), ...(reason ? { reason } : {}),
        ...(blockedByInnerList ? { blockedByInnerList } : {}), ...(unprefixedQuoteFollower ? { unprefixedQuoteFollower } : {}) })
      return
    }
    if (isBlankLine(line)) return
    this.stack = this.stack.filter(entry => entry.kind !== 'quote')
    while (this.stack.length && (this.stack.at(-1)!.quoteDepth > depth ||
      this.stack.at(-1)!.quoteDepth === depth && this.stack.at(-1)!.column >= column)) this.stack.pop()
    for (let level = 1; level <= depth; level++) {
      const quoteColumn = quoteBodyColumn(line, level)
      this.stack.push({ kind: 'quote', column: quoteColumn, localColumn: 0, quoteDepth: level,
        contentColumn: quoteColumn, firstBlock: false })
    }
    let inner = body
    let innerColumn = column
    let innerLocalColumn = localColumn
    let innerDepth = depth
    for (let level = 0; level < 32; level++) {
      const marker = taskMatch(inner) ?? unorderedMatch(inner) ?? orderedMatch(inner)
      if (marker !== null) {
        const content = marker.at(-1) ?? ''
        const width = inner.length - content.length
        this.stack.push({ kind: 'list', column: innerColumn, localColumn: innerLocalColumn, quoteDepth: innerDepth,
          contentColumn: innerColumn + width, firstBlock: isContinuationMarker(content) })
        innerColumn += width
        innerLocalColumn += width
        inner = content.trimStart()
        continue
      }
      const quoted = quotedLineText(inner, false)
      if (quoted !== null) {
        innerDepth++
        innerColumn += inner.length - quoted.length
        innerLocalColumn = indentColumns(quoted)
        this.stack.push({ kind: 'quote', column: innerColumn, localColumn: innerLocalColumn, quoteDepth: innerDepth,
          contentColumn: innerColumn, firstBlock: isContinuationMarker(quoted) })
        inner = quoted.trimStart()
        continue
      }
      if (inner.startsWith('[^') && inner.includes(']:'))
        this.stack.push({ kind: 'footnote', column: innerColumn, localColumn: innerLocalColumn, quoteDepth: innerDepth, contentColumn: innerColumn + 2, firstBlock: false })
      else if (inner.startsWith(': '))
        this.stack.push({ kind: 'description', column: innerColumn, localColumn: innerLocalColumn, quoteDepth: innerDepth, contentColumn: innerColumn + 2, firstBlock: false })
      break
    }
  }
}

export const markerClassifiers = new WeakMap<readonly string[], OpenMarkerClassifier>()

export function markerDecision(lexer: Lexer, lineIndex: number): MarkerDecision {
  const root = lexer.rootLines ?? lexer.lines
  let classifier = markerClassifiers.get(root)
  if (classifier === undefined) markerClassifiers.set(root, classifier = new OpenMarkerClassifier(root))
  return classifier.get(lexer.lineNumber(lineIndex) - 1)
}

export function attachesAtDocumentColumnZero(lexer: Lexer, markerColumn = 0, quoteLevels = Infinity, firstBlock = false): boolean {
  if (lexer.pos > 0) {
    const marker = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos - 1) - 1]
    if (marker !== undefined && isContinuationMarker(sourceQuoteBody(marker)) && !firstBlock) {
      const decision = markerDecision(lexer, lexer.pos - 1)
      if (decision.reason !== undefined && decision.reason !== 'wrong-column') return false
    }
  }
  // THE DOCUMENT'S OWN LINES, OR THIS LEXER'S IF IT IS THE DOCUMENT. Only a
  // SUB-lexer carries `rootLines`; the root lexer's `lines` ARE the document,
  // and reading the absence as "cannot answer" made the gate return true for
  // every container parsed at top level - which is every one of them
  // (markup-carve/carve#1814). The distinction that matters is source column
  // versus FRAME column, and at the root those are the same number.
  const root = lexer.rootLines ?? lexer.lines
  const line = root[lexer.lineNumber(lexer.pos) - 1]
  if (line === undefined) return true
  if (firstBlock && sourceColumn(line, 0) === 0 && !isListMarkerLine(line)) return true
  if (quoteLevels === Infinity) {
    let offset = 0
    for (let end = sourceQuotePrefixEnd(line, offset); end >= 0; end = sourceQuotePrefixEnd(line, offset)) offset = end
    return indentColumns(line.slice(offset)) === markerColumn
  }
  const column = sourceColumn(line, quoteLevels)
  return column === markerColumn
}

/**
 * The one character any of the three invisible blocks can open with.
 *
 * CHEAP FIRST, because this runs on every line an item collects. `isLinkDefLine`
 * splits a trailing attribute block off the line before it tests, which makes it
 * the most expensive predicate in the tracker - putting it on the path of every
 * ordinary prose line makes each one pay for that predicate.
 *
 * A strict superset, so it decides nothing: both definition forms open with `[`
 * after optional indentation and a comment with `%`, and `splitTrailingAttrBlock`
 * only removes a TRAILING block, so it cannot change the leading character.
 */
export const RE_INVISIBLE_BLOCK_LEAD = /^[ \t]*[%[]/

/**
 * Is the first LIST in this marker line's run nested INSIDE a quote?
 *
 * Prefix order matters: the list in `> - ` is the quote's and
 * dies with it, where the list in `- > ` is the outer container and outlives the
 * quote it holds (markup-carve/carve-js#2540). Asking only "both kinds present"
 * moved all 30 of the `- > ` shapes off the oracle.
 */
export function markerRunListIsQuoteHeld(content: string): boolean {
  const bound = prefixWalkBound(content)
  let at = 0
  let quoted = false
  for (;;) {
    const quote = quotePrefixLength(content, at, bound)
    if (quote > 0) {
      quoted = true
      at += quote
      continue
    }
    const marker = markerPrefixLength(content, at, bound)
    if (marker === 0) return false

    return quoted
  }
}

/**
 * Track the first closer of the description body's nested lead, reading only
 * lines appended since the previous query. A closed nested fence leaves no
 * paragraph until a following block opens one.
 */
export function descriptionLeadFenceScans(lead: string): {
  code: AppendOnlyCloser
  paragraphOpen: (lines: readonly string[], fallback: boolean, hasCloser: (marker: string, extraColumns?: number) => boolean, atContentColumn: boolean) => boolean
} {
  const bottom = markerLineBottomBlock(lead)
  const nested = bottom !== lead
  const fence = nested ? RE_FENCE.exec(bottom) ?? RE_RAW_FENCE.exec(bottom) : null
  const close = fence ? fenceCloseRe(RE_FENCE.test(bottom) ? fence[2]! : fence[1]!) : undefined
  const bound = prefixWalkBound(lead)
  let at = 0
  let column = 0
  for (;;) {
    const prefix = markerPrefixLength(lead, at, bound)
    if (prefix === 0) break
    column += markerContentColumn(lead.slice(at, at + prefix) + 'x')
    at += prefix
  }
  const ownFence = at > 0 ? RE_FENCE.exec(lead.slice(at)) ?? RE_RAW_FENCE.exec(lead.slice(at)) : null
  const ownClose = ownFence ? fenceCloseRe(RE_FENCE.test(lead.slice(at)) ? ownFence[2]! : ownFence[1]!) : undefined
  let next = 1
  let closed = false
  let ownsBody = true
  const trailing = verbatimOnlyLazyState()

  return {
    code: new AppendOnlyCloser(close ? line => close.test(line.replace(/^[ \t]+/, '')) : undefined),
    paragraphOpen: (lines, fallback, hasCloser, atContentColumn) => {
      if (ownClose === undefined) return fallback
      if (!ownsBody) return false
      for (; next < lines.length; next++) {
        const line = lines[next]!
        if (!closed) {
          const indent = indentColumns(line)
          if (atContentColumn && !isBlankLine(line) && indent < column) {
            ownsBody = false
            return false
          }
          if (indent === column && ownClose.test(line.trimStart())) closed = true
          continue
        }
        trackItemLazyState(sliceColumns(line, column), trailing, hasCloser)
      }

      return closed ? trailing.lazyFoldable : false
    },
  }
}

/**
 * Does a nested marker line leave the ITEM'S OWN PARAGRAPH open, for the lines
 * the description body takes below that item's content column?
 *
 * `markerLineState`'s `leavesParagraphOpen` answers one question short of this
 * one: a code or raw FENCE leaves the flag set, which is the accident
 * markup-carve/carve-js#2531 named, and a fence is a BLOCK - the oracle reads a
 * line below a fenced item as the body's own, where it folds the same line into
 * an item ending in prose, a quote with an open paragraph or a
 * nested item. Measured over the lead kinds rather than assumed
 * (markup-carve/carve-js#2535).
 *
 * The one spelling both call sites ask in - the body's lead and every later line
 * the body takes AT its own column.
 */
export function nestedItemHoldsOpenParagraph(content: string, memo?: Map<number, number>): boolean {
  if (!markerLineState(content, memo).leavesParagraphOpen) return false
  const bottom = markerLineBottomBlock(content, memo)

  return !RE_FENCE.test(bottom) && !RE_RAW_FENCE.test(bottom) &&
    !colonFenceShapeEndsLazyContinuation(bottom)
}

/**
 * Is `content` more text of a paragraph that holds an unclosed fence run?
 *
 * A line that opens a block ends that paragraph instead (section 10), and the
 * block may be a closed one that leaves nothing for a below-column line to
 * continue (CARVE-P0-009). `base` is the column the unclosed run was authored
 * at: a line at exactly that column was rebased with it and is read flush.
 */
export function continuesInlineFenceParagraph(content: string, base: number | undefined, terminatorFree: boolean): boolean {
  if (!bottomBlockLeavesParagraphOpen(content)) return false
  const text = content.trimStart()
  if (opensCodeFence(text)) return false
  if (markerPrefixLength(text, 0, prefixWalkBound(text)) > 0 || quotedLineText(text, terminatorFree) !== null) return false
  const atBase = base !== undefined && base > 0 && text !== content && indentColumns(content, base + 1) === base
  return !atBase || bottomBlockLeavesParagraphOpen(text)
}

export interface ItemLineFacts {
  quoteFenceCloser?: (marker: string, depth?: number, column?: number) => boolean
  terminatorFree: boolean
  whitespace?: number | undefined
  prefixMemo?: Map<number, number> | undefined
  rebasedFrame?: boolean | undefined
  /**
   * May a line at or past a nested marker's content column be classified in
   * that DESCENDANT's frame (`CARVE-P0-009`, markup-carve/carve#2884)?
   *
   * The LIST ITEM host opts in. A description body does not: a flush-left fence
   * line below a closed nested fence is clamped to one column there and stays
   * the outer item's text, which is its own ruling (carve-js#2515, carve#1958)
   * and is what the executable spec still writes.
   */
  descendantFrames?: boolean | undefined
}

/**
 * Parse a table cell's leading markers from its raw between-pipe text.
 *
 * Disambiguation follows the spec's writing convention: markers are
 * written *tight* against the pipe (`|=`, `|=>`, `|>`, `|<`, `|~`) with
 * no separating space, so they are only recognized at index 0 of the
 * raw cell text. A normal cell always has a space after the pipe
 * (`| Alice`, `| <https://x>`, `| >10`), so content that merely begins
 * with `<`/`>`/`~`/`=` is preserved verbatim.
 *
 * A cell whose trimmed content is exactly `^` or `<` (always written
 * spaced, e.g. `| ^ |`, `| < |`) is a rowspan/colspan marker. The tight
 * prefix is an optional `=` (header) followed by an optional alignment
 * marker (`>` right, `<` left, `~` center).
 */
/**
 * The characters a table cell reads as an ALIGNMENT MARKER, glued to `|` or `|=`.
 *
 * Exported so the Carve writer can read the set off the parser instead of
 * carrying a second copy of it. The writer must not emit a header marker
 * immediately followed by one of these, because the next parse eats it as
 * alignment and keeps the rest of the cell as text (markup-carve/carve-js#903).
 * A guard built from a hand-listed set would be a second spelling of this rule,
 * and this repository has repeatedly found one rule spelled N times where N was
 * larger than anyone claimed.
 */
export const TABLE_ALIGNMENT_MARKERS: ReadonlyMap<string, 'left' | 'right' | 'center'> = new Map([
  ['>', 'right'],
  ['<', 'left'],
  ['~', 'center'],
])

/**
 * Read a table cell's attribute block at `from`, if there is one there.
 *
 * Uses the quote-aware inline-attribute matcher so a quoted `}` inside a value
 * (`{key="{y}"}`) is handled rather than truncated at the first brace. The WHOLE
 * payload must then be valid attribute syntax (same as inline and block
 * attribute blocks); a partially-invalid payload like `{.x 1bad}` is not an
 * attribute block, so the `{` stays ordinary content.
 *
 * Exported so the linter asks this question the same way the parser answers it.
 * A rule spelled twice drifts, and the rule this one serves - the block binds
 * after the markers - already had four spellings across the engines to unify.
 */
export function readCellAttributeBlock(
  src: string,
  from = 0,
): { attrs: Attrs; length: number } | undefined {
  if (src[from] !== '{') return undefined
  const m = RE_INLINE_ATTR.exec(src.slice(from))
  if (!m || !isValidInlineAttrPayload(m[1]!)) return undefined
  const attrs = parseAttrs(m[1]!)
  if (isEmptyAttrs(attrs)) return undefined

  return { attrs, length: m[0].length }
}

export function parseCellMarkers(src: string): {
  header: boolean
  span?: 'rowspan' | 'colspan'
  align?: 'left' | 'right' | 'center'
  valign?: 'top' | 'middle' | 'bottom'
  attrs?: Attrs
  content: string
} {
  // `|<|` and the padded `| < |` are colspan markers. A glued `<` followed
  // by a space (`|< |`) is an alignment run on an empty cell.
  if (trimCellPadding(src) === '<' && (src === '<' || (src.startsWith(' ') && src.endsWith(' ')))) return { header: false, span: 'colspan', content: '' }

  // Tight prefix only: the marker must sit at index 0 of the raw text.
  let i = 0
  let header = false
  if (src[i] === '=') {
    header = true
    i++
  }
  // A one- or two-axis run is consumed as a unit. A duplicate axis other than
  // `~~` invalidates the whole run, so `|=<< Note|` keeps both `<` bytes as
  // visible content instead of silently consuming a valid-looking prefix.
  const markerStart = i
  let align: 'left' | 'right' | 'center' | undefined
  let valign: 'top' | 'middle' | 'bottom' | undefined
  let inheritedHorizontal = false
  let invalidAxis = src[i] === '^' || src[i] === 'v' ||
    (src[i] === '~' && (src[i + 1] === '<' || src[i + 1] === '>'))
  if (src[i] === '?' && src[i + 1] !== undefined && '^~v'.includes(src[i + 1]!)) {
    inheritedHorizontal = true
    valign = src[i + 1] === '^' ? 'top' : src[i + 1] === '~' ? 'middle' : 'bottom'
    i += 2
  }
  while (!inheritedHorizontal && src[i] !== undefined && '<>~^v?'.includes(src[i]!)) {
    const marker = src[i]!
    if (marker === '?') {
      invalidAxis = true
      break
    } else if (marker === '<' || marker === '>' || marker === '~') {
      if (align === undefined) {
        align = marker === '<' ? 'left' : marker === '>' ? 'right' : 'center'
      } else if (marker === '~' && valign === undefined) {
        valign = 'middle'
      } else {
        invalidAxis = true
        break
      }
    } else {
      if (valign !== undefined) { invalidAxis = true; break }
      valign = marker === '^' ? 'top' : 'bottom'
    }
    i++
  }
  const validRun = i > markerStart &&
    !invalidAxis &&
    (align !== undefined || inheritedHorizontal) &&
    (src[i] === ' ' || src[i] === '{' ||
      (!inheritedHorizontal && src[i] !== undefined && '<>~^v?'.includes(src[i]!)))
  if (!validRun) {
    i = markerStart
    align = undefined
    valign = undefined
    inheritedHorizontal = false
  }

  // A `{...}` attribute block supplies the cell's attributes. It binds LAST -
  // after the kind marker and after the alignment marker, in every cell - and
  // is GLUED to whatever precedes it: to the marker run where the cell has one
  // (`|=<{.x} …`), to the opening `|` where it has none (`|{.x} …`). The rest,
  // after optional whitespace, is the cell content. A SPACE before the brace
  // (`| {.x}`) is ordinary content, not attributes. A cell that carries an
  // attribute block is never a bare span marker, so its content is literal
  // even if it is just `<`/`^`. An invalid payload leaves the `{` as content.
  //
  // The order is what makes an attributed HEADER cell expressible at all. With
  // the block bound ahead of the `=`, the only available shape is `|{#x}=R|`,
  // and that is ambiguous by construction: an attributed header cell, or a data
  // cell whose content starts with `=`. This grammar reads it the second way,
  // so the shape the writer produced for an attributed header cell came back as
  // `<td id="x">=R</td>` and the round-trip invariant failed on it. Once `=`
  // has committed the cell to header, everything after it is unambiguous
  // (spec §5 T10, corpus 319).
  const block = readCellAttributeBlock(src, i)
  let attrs = block?.attrs
  if (block) i += block.length

  // Spec §5 T11: THE MARKER RUN ENDS AT A SPACE. The kind marker, the alignment
  // run and the attribute block are ONE run, and a cell carrying any of them
  // must follow it with one literal space. Without that space there is no run
  // and every character of it is content, so `|=hot= |` is the highlight its
  // author wrote rather than a header cell holding `hot=`. The closing pipe is
  // not a terminator (`|= |` is the empty header cell) and neither is a tab,
  // which PART 7 gives no padding role inline. The run is ATOMIC: a rejected
  // alignment run takes the `=` with it, which is why the reset below clears
  // `header` as well.
  if (i > 0 && src[i] !== ' ') {
    i = 0
    header = false
    align = undefined
    valign = undefined
    inheritedHorizontal = false
    attrs = undefined
  }

  if (i > 0) {
    // A tight prefix was consumed; the rest is content.
    const content = trimCellPadding(src.slice(i))
    if ((align !== undefined || valign !== undefined) && attrs !== undefined) return { header, ...(align ? { align } : {}), ...(valign ? { valign } : {}), attrs, content }
    if (align !== undefined || valign !== undefined) return { header, ...(align ? { align } : {}), ...(valign ? { valign } : {}), content }
    if (attrs !== undefined) return { header, attrs, content }
    return { header, content }
  }

  // No tight prefix: a lone `^`/`<` (always spaced) is a span marker;
  // otherwise the whole trimmed text is content.
  const trimmed = trimCellPadding(src)
  if (trimmed === '^') return { header: false, span: 'rowspan', content: '' }
  return { header: false, content: trimmed }
}

/**
 * Would a cell holding exactly this payload be read as a SPAN MARKER?
 *
 * Exported so the Carve writer can read the rule off the parser instead of
 * carrying a second copy of it, the same way `TABLE_ALIGNMENT_MARKERS` is.
 * Naming `^` and `<` in the writer would be an enumeration that goes stale the
 * next time a cell-level marker is added, and the alignment sigil's history is
 * what that costs: each writer answered that class with its own slightly
 * different set of characters.
 *
 * PADDING IS NOT AN ESCAPE WHERE THE PRODUCTION ADMITS PADDING (PART 11
 * section 6f). Section 6e's one space in front of a cell's content puts it out
 * of reach of the three slots that are read GLUED to the opening pipe, and that
 * argument holds only where the construct forbids the padding. The span cell is
 * written WITH the padding inside it -
 *
 *     rowspan_marker = {space}, '^', {space} ;
 *     colspan_marker = {space}, '<', {space} ;
 *
 * so a cell whose whole payload is `^` or `<` needs an escape when written
 * with span padding. A glued `<` followed by a space reads as alignment, but
 * the writer cannot rely on that spelling for every cell shape.
 *
 * The predicate is over the PAYLOAD, so it answers the question the writer can
 * ask before it has decided which prefix the cell takes. Both of the parser's
 * span decisions above are reached with `i === 0`. A leading `^` sets
 * `invalidAxis`; a padded `<` is caught before the alignment run scan.
 */
export function cellPayloadIsSpanMarker(payload: string): boolean {
  const trimmed = trimCellPadding(payload)
  return trimmed === '^' || trimmed === '<'
}

export interface RawCell {
  header: boolean
  span?: 'rowspan' | 'colspan'
  align?: 'left' | 'right' | 'center'
  valign?: 'top' | 'middle' | 'bottom'
  attrs?: Attrs
  raw: string
  /**
   * The backtick run this cell's collected source ends INSIDE, 0 when it ends
   * outside one. Carried forward per continuation row rather than recomputed
   * from `raw`, which would be quadratic in the number of rows.
   */
  openRun: number
  /**
   * Where this cell sits in the document, when that is answerable.
   *
   * Cleared once a `+` continuation row merges into the cell: its content then
   * comes from two non-adjacent regions, so no single span covers it and PART 12
   * section 4 forbids inventing one.
   */
  pos?: Position
  /**
   * Where each FRAGMENT of `raw` came from, one range per source region, set
   * only for a fragment VERIFIED to appear verbatim at that point in its line -
   * a fragment whose source cannot be confirmed contributes no range, so the
   * nodes over it go unplaced rather than landing on a wrong offset.
   *
   * A cell with no `+` continuation has exactly one range covering all of `raw`,
   * which maps the same way a single base offset did. A CONTINUED cell has one
   * per row, with the joining space between them mapping to nothing: the
   * fragments each sit verbatim in the document even though their concatenation
   * does not, so the inlines inside one fragment are placeable and only the ones
   * reaching across a row boundary are not (markup-carve/carve-js#1153).
   */
  anchors?: AnchorRange[]
  /** Continuation text on a span marker, joined to its origin after the span walk. */
  joins?: Array<{ frag: string; at: FragmentPlace | null; marker: FragmentPlace | null; sep: FragmentPlace | null; line: number; rowIndex: number }>
  /** The `+` of the continuation line the last fragment came from. */
  lastMarker?: number
  wraps?: Array<{ offset: number; line: number; row?: number; col?: number; pos?: Position }>
}

export interface FragmentPlace {
  offset: number
  line: number
  column: number
}

/** Appends one `+` continuation fragment to a cell's collected source. */
export function joinFragment(target: RawCell, frag: string, at: FragmentPlace | null, line?: number, row?: number, marker?: FragmentPlace | null, sep?: FragmentPlace | null, col?: number): void {
  const fragStart = target.raw ? target.raw.length + 1 : 0
  // A second fragment from the same `+` line joins across that line's own pipe,
  // so its marker is the pipe and not the `+` the first join already covers.
  const sameLine = marker && target.lastMarker === marker.offset
  if (marker) target.lastMarker = marker.offset
  else delete target.lastMarker
  if (sameLine) marker = sep ?? null
  if (target.raw && line !== undefined) (target.wraps ??= []).push({
    offset: fragStart - 1, line, ...(row ? { row } : {}), ...(col !== undefined ? { col } : {}),
    ...(marker ? { pos: {
      startLine: marker.line, endLine: marker.line,
      startColumn: marker.column, endColumn: marker.column + 1,
      startOffset: marker.offset, endOffset: marker.offset + 1,
    } } : {}),
  })
  target.raw = target.raw ? `${target.raw} ${frag}` : frag
  // Only the NEW fragment is read; the joining space is not a run
  // character, so resuming from the cell's own state is exact.
  target.openRun = openVerbatimRun(frag, target.openRun)
  // The CELL keeps no span. Its content sits in two column ranges on
  // non-adjacent lines, and one range covering both would swallow the
  // neighbouring column's content on the lines between - so cell 1 would
  // CONTAIN cell 0, and an offset would map to two sibling cells at once.
  // A construct that is not one contiguous range cannot honestly be one.
  delete target.pos
  if (at) {
    const range: AnchorRange = { from: fragStart, to: fragStart + frag.length, ...at }
    if (target.anchors) target.anchors.push(range)
    else target.anchors = [range]
  }
  // NO CLAMP ON THE RANGE BEFORE when this fragment is unplaceable. A
  // range's `to` is the length `raw` had when it was appended, and the
  // next fragment starts one past that, so the joining space is already
  // the only offset between them and an unplaced fragment simply leaves a
  // wider gap. `to` is inclusive so an exclusive span end may land on it;
  // the space itself belongs to no range, which is what makes a node
  // reaching across the boundary unplaceable.
}

export const isGfmDelimiterCell = (c: RawCell): boolean =>
  !c.span && !c.attrs && /^:?-+:?$/.test(trimCellPadding(c.raw))

export const isGfmDelimiterRow = (row: RawCell[]): boolean =>
  row.length > 0 && row.every(isGfmDelimiterCell)

/**
 * The length of the backtick run a cell's source ends INSIDE, or 0 when it ends
 * outside one, resumed from the state `from` the cell was already in.
 *
 * The state a `+` continuation row's matching column starts in: a run the base
 * row left open is still open when the continuation is cut, which is what keeps
 * that continuation's own pipes content (PART 9 §22,
 * markup-carve/carve#1293).
 *
 * RESUMED, never recomputed. A cell accumulates a fragment per continuation row,
 * so re-reading the whole accumulated text before every row is quadratic in the
 * number of rows - about a second on sixteen thousand short continuations,
 * against forty milliseconds. Each cell carries its own state forward instead,
 * and only the new fragment is read.
 *
 * ESCAPE-AWARE OUTSIDE A RUN, because this measures the state the INLINE parser
 * will be in for this text. Outside a run an escaped backtick opens nothing, and
 * a scan that counted it opened a run the inline pass does not have - which made
 * the continuation's real opener look like a closer and split a cell the run
 * owns, dropping the segment behind it. INSIDE a run the body is verbatim and
 * resolves no escapes, so the backslash is content and the backtick after it
 * still closes.
 */
export function openVerbatimRun(text: string, from = 0): number {
  let openRun = from
  for (let i = 0; i < text.length; i++) {
    if (openRun === 0 && text[i] === '\\') {
      // OUTSIDE a run only. An escape consumes the next character, so an
      // escaped backtick opens nothing. INSIDE one the body is verbatim and
      // resolves no escapes, so the backslash is content and the backtick
      // after it still closes - which is what the inline parser does with it.
      i++
      continue
    }
    if (text[i] !== '`') continue
    let run = 1
    while (text[i + run] === '`') run++
    if (openRun === 0) openRun = run
    else if (run === openRun) openRun = 0
    i += run - 1
  }

  return openRun
}

export function readCaptionText(
  lexer: Lexer,
  firstLine: string,
  anchors?: Array<{ offset: number; column: number; line: number }>,
): string {
  let text = firstLine
  while (!lexer.eof()) {
    const next = lexer.peek()!
    if (isBlankLine(next) || RE_CAPTION.test(next)) break
    if (startsInterruptingBlock(lexer)) break
    text += '\n' + stripLazyFrame(next)
    // Only the internal lazy frame is removed; the source line starts here.
    anchors?.push({
      offset: lexer.lineOffset(lexer.pos),
      column: lexer.lineStartColumn(lexer.pos),
      line: lexer.lineNumber(lexer.pos),
    })
    lexer.consume()
  }
  // NO TRAILING WHITESPACE (PART 2; carve#926). Every line, not only the last:
  // the run before a SOFT BREAK is dropped too, so `abc<SP>` + newline + `def`
  // and `abc` + newline + `def` are the same document.
  return dropTrailingWhitespace(text)
}

export function endsHeadingOrQuote(lexer: Lexer): boolean {
  const ln = lexer.peek()
  if (
    ln !== undefined &&
    (RE_UNORDERED.test(ln) ||
      RE_TASK.test(ln) ||
      RE_ORDERED.test(ln) ||
      extractItemAttr(ln) !== null)
  ) {
    return true
  }
  return startsInterruptingBlock(lexer)
}


/**
 * The next line after `index` holding a comment fence of exactly `width`, or
 * -1. Indexed once, so a closer is found without rescanning per opener.
 */
export function commentCloserLookup(lines: readonly string[], stripQuotes = true): (width: number, index: number) => number {
  let byWidth: Map<number, number[]> | undefined
  return (width, index) => {
    if (!byWidth) {
      byWidth = new Map()
      lines.forEach((line, at) => {
        const run = commentFenceRun((stripQuotes ? line.replace(/^(?:[ \t]*>(?: |$))+/, '') : line).replace(/^[ \t]+/, ''))
        if (run === undefined) return
        const list = byWidth!.get(run)
        if (list) list.push(at)
        else byWidth!.set(run, [at])
      })
    }
    const at = byWidth.get(width) ?? []
    let lo = 0
    let hi = at.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (at[mid]! <= index) lo = mid + 1
      else hi = mid
    }
    return lo < at.length ? at[lo]! : -1
  }
}

// CARVE-P0-004, CARVE-P0-011: in a list item's colon body a link definition or an
// attribute line past the box's column also opens on its authored base (carve#3087).
export function hostedColonBodyOpener(text: string): boolean {
  return hostedAuthoredBlockOpener(text) || (isLinkDefLine(text) && !RE_FOOTNOTE_DEF.test(text)) || isBlockAttributeLine(text.trimEnd())
}

/** Whether a line starts an authored block outside the body's first sublist. */
export function isParentAuthoredBlock(line: string, firstMarkerColumn: number, followsBlank = false): boolean {
  const column = indentColumns(line, firstMarkerColumn)
  if (column >= firstMarkerColumn) return false
  const opener = sliceColumns(line, column, true)
  return markerContentColumn(opener) < 0 && (column === 0 ? (hostedAuthoredBlockOpener(opener) && !opensCodeFence(opener)) || (followsBlank && !RE_COMMENT_LINE.test(opener)) : lineOpensItemBlock(opener))
}

/**
 * What a group's closer scan has already proved absent, so a RUN of unterminated
 * openers costs one walk rather than one each.
 *
 * `from` only grows inside a group, so a scan that found no closer from an
 * earlier line found none from a later one either. A verbatim closer matches on
 * AT LEAST its own length, so the longest same-character run seen refutes every
 * longer one; a comment closer matches on exactly its own, so that key is the
 * length itself. The same bound `fenceCloserMemoRefutes` carries one collector up.
 */
export interface GroupCloserMemo {
  verbatim: Map<string, { from: number; maxRun: number }>
  comment: Map<number, number>
}

/**
 * Read a line of a rebase group at the content its delimiters are measured from.
 * Indentation is part of neither a fence's opener nor its closer (PART 9 §28), so
 * a run written below the base still reads as one.
 */
export const groupLineContent = (line: string, base: number): string =>
  indentColumns(line, base) >= base ? sliceColumns(line, base, true) : line.replace(/^[ \t]+/, '')

/** Does an opaque group opened here find its closer further down? */
export function opaqueGroupCloses(
  group: OpaqueGroup,
  lines: readonly string[],
  from: number,
  base: number,
  folded: ReadonlySet<number> | undefined,
  memo: GroupCloserMemo,
  containerColumn = 0,
): boolean {
  const cached = group.belowBaseCloses ? memo.comment.get(group.run) : memo.verbatim.get(group.char)
  if (group.belowBaseCloses) {
    if (cached !== undefined && from >= (cached as number)) return false
  } else {
    const seen = cached as { from: number; maxRun: number } | undefined
    if (seen !== undefined && from >= seen.from && group.run > seen.maxRun) return false
  }
  let maxRun = 0
  for (let k = from; k < lines.length; k++) {
    const line = lines[k]!
    if (isBlankLine(line)) continue
    // CARVE-P0-014: a below-column run is searched past, never matched.
    if (indentColumns(line, containerColumn) < containerColumn) continue
    if (!group.belowBaseCloses && !closerReachesBase(k, folded)) continue
    const content = groupLineContent(line, base)
    if (group.closes(content)) return true
    if (!group.belowBaseCloses) {
      const run = RE_FENCE_CLOSER.exec(content)
      if (run !== null && run[1]![0] === group.char) maxRun = Math.max(maxRun, run[1]!.length)
    }
  }
  if (group.belowBaseCloses) memo.comment.set(group.run, from)
  else memo.verbatim.set(group.char, { from, maxRun })

  return false
}

/**
 * Does this line stand where a closer for the group can stand?
 *
 * A folded line belongs to the host's paragraph. Every other line has an
 * available prefix that is removed before measuring its closing run.
 */
export const closerReachesBase = (index: number, folded: ReadonlySet<number> | undefined): boolean =>
  folded?.has(index) !== true

// Skip a quote's marked lines and lazy paragraph continuation during rebasing.
export function rebasedQuoteEnd(lines: string[], start: number, quote: Lexer): number {
  const state = markerLineQuoteState(lines[start]!)!
  let fenceCloserMemo: QuotedFenceCloserMemo | undefined
  while (++quote.pos < lines.length) {
    const next = lines[quote.pos]!
    const marked = RE_BLOCKQUOTE.exec(next)
    if (marked) {
      trackBlockQuoteLazyState(
        marked[1] ?? '', state,
        (width) => quotedCommentHasCloser(quote, width, quote.pos),
        (marker, depth, column) => quotedFenceHasCloser(quote, marker, quote.pos, fenceCloserMemo ??= new Map(), depth, column),
      )
      continue
    }
    if (isBlankLine(next) || RE_CAPTION.test(next) ||
        (leadingWhitespace(next) > 0 && isLinkDefLine(next.trimStart())) ||
        colonFenceShapeEndsLazyContinuation(next) ||
        startsInterruptingBlock(quote, undefined, false) || !blockQuoteParagraphOpen(state)) break
    demoteQuotedColonCandidates(state)
  }
  return quote.pos - 1
}

export function sourceCodeFenceEnd(
  lines: string[], start: number, base: number, marker: string,
  heldFoldedLines: Set<number>, takenBelowColumn: ReadonlySet<number> | undefined,
  onFenceBodyLine: ((index: number) => void) | undefined,
  onUnclosedCodeFence: (() => void) | undefined,
  authoredBase: number, sourceLines: readonly (string | undefined)[],
): number {
  let end = start
  const close = fenceCloseRe(marker)
  let closed = false
  for (let j = start + 1; j < lines.length; j++) {
    const candidate = lines[j]!
    end = j
    onFenceBodyLine?.(j)
    if (isBlankLine(candidate)) continue
    const source = sourceLines[j]
    if (source === undefined) {
      const column = indentColumns(candidate, base)
      if (column < base) {
        continue
      }
      if (takenBelowColumn?.has(j)) { heldFoldedLines.add(j); continue }
      if (close.test(sliceColumns(candidate, base, true))) { closed = true; break }
      continue
    }
    const column = indentColumns(source)
    if (takenBelowColumn?.has(j)) heldFoldedLines.add(j)
    if (column >= base && column <= authoredBase && !heldFoldedLines.has(j) &&
        close.test(candidate.slice(leadingWhitespace(candidate)))) {
      lines[j] = candidate.slice(leadingWhitespace(candidate))
      closed = true
      break
    }
  }
  if (!closed) onUnclosedCodeFence?.()
  return end
}

// Keep a code fence's payload and closer in the same rebasing group.
export function rebasedCodeFenceEnd(
  lines: string[],
  start: number,
  base: number,
  marker: string,
  heldFoldedLines: Set<number>,
  takenBelowColumn?: ReadonlySet<number>,
  onFenceBodyLine?: (index: number) => void,
  onUnclosedCodeFence?: () => void,
  stopsParagraph?: (line: string, index: number) => boolean,
): number {
  let end = start
  const close = fenceCloseRe(marker)
  // Measure a run below the base after removing its available prefix.
  let closed = false
  for (let j = start + 1; j < lines.length; j++) {
    const candidate = lines[j]!
    if (stopsParagraph?.(candidate, j)) break
    end = j
    onFenceBodyLine?.(j)
    if (isBlankLine(candidate)) continue
    // A folded line belongs to the host paragraph, not this fence.
    if (takenBelowColumn?.has(j) === true) {
      heldFoldedLines.add(j)
      continue
    }
    const column = indentColumns(candidate, base)
    if (column < base) {
      continue
    }
    if (close.test(sliceColumns(candidate, base, true))) {
      closed = true
      break
    }
  }
  if (!closed) onUnclosedCodeFence?.()
  return end
}

// Find a colon group's extent while retaining folded-line ownership.
export function rebasedColonGroupEnd(
  lines: string[],
  start: number,
  base: number,
  width: number,
  heldFoldedLines: Set<number>,
  findCommentCloser: (width: number, index: number) => number,
  closerMemo: GroupCloserMemo,
  takenBelowColumn?: ReadonlySet<number>,
  onFenceBodyLine?: (index: number) => void,
  nestedBodyLines?: Set<number>,
  usesHostMinimum = false,
  emptyHostMinimum = false,
  preserveNestedNoteColumn = false,
): number {
  let end = start
  const stack = [{ width, literal: RE_LINE_BLOCK_OPEN.test(groupLineContent(lines[start]!, base)) }]
  const holdsFoldedLines = base > 0 && takenBelowColumn !== undefined && takenBelowColumn.size > 0
  // The opaque group open inside this container, if any. Only the hold below
  // consults it: a folded line inside a verbatim or comment payload is that
  // payload's, and its delimiter has to travel with the dedent.
  let opaque: OpaqueGroup | null = null
  // Colon bodies keep the indentation host's minimum even when their opener
  // has a deeper authored base. Child blocks use that minimum for ownership.
  // Rebase them during the existing scan before the outer body skips them.
  const authored = [{ column: usesHostMinimum ? 0 : base, paragraph: false }]
  let authoredInlineFence = false
  let authoredCodeClose: RegExp | undefined
  let authoredCodeAdjustment = 0
  let authoredBelowBaseRun = false
  let authoredChildColumn = -1
  let authoredChildBlank = false
  let authoredChildBlockBoundary = false
  // CARVE-P0-009: a child that leaves no paragraph open lets a fence below its column leave it.
  let authoredChildState: ItemLazyState | undefined
  const childFenceCloses = (j: number) => (marker: string, extraColumns = 0): boolean => {
    const group = opaqueGroupCloser(marker)
    if (group === null) return false
    const column = authoredChildColumn + extraColumns
    let memo = childCloserMemos.get(column)
    if (memo === undefined) childCloserMemos.set(column, memo = { verbatim: new Map(), comment: new Map() })
    return opaqueGroupCloses(group, lines, j + 1, column, takenBelowColumn, memo)
  }
  const childCloserMemos = new Map<number, GroupCloserMemo>()
  for (let j = start + 1; j < lines.length; j++) {
    let candidate = lines[j]!
    let authoredColumn: number | undefined
    const insideAuthoredCode = authoredCodeClose !== undefined
    if (nestedBodyLines && authoredChildColumn >= 0) {
      if (opaque === null && RE_COMMENT_LINE.test(candidate.trimStart()) &&
          (commentFenceRun(candidate.trimStart()) === undefined ||
            indentColumns(candidate, authoredChildColumn) >= authoredChildColumn)) authoredChildBlockBoundary = true
      if (isBlankLine(candidate)) authoredChildBlank = true
      else if (opaque === null && (authoredChildBlank || hostedAuthoredBlockOpener(candidate.trimStart()) || RE_ADMONITION_CLOSE.test(candidate.trimStart()))) {
        const column = authoredColumn = indentColumns(candidate, authoredChildColumn)
        const childClosed = authoredChildState !== undefined && !authoredChildState.lazyFoldable && !insideOpenFence(authoredChildState)
        if (column < authoredChildColumn && (authoredChildBlank ||
            ((column === authored.at(-1)!.column && lineOpensItemBlock(candidate.trimStart())) ||
              (column > authored.at(-1)!.column && (colonFenceOpenerLen(candidate.trimStart()) !== null ||
                ((authoredChildBlockBoundary || childClosed) && opensCodeFence(candidate.trimStart()))))))) authoredChildColumn = -1
        else if (column >= authoredChildColumn && authoredChildState !== undefined) {
          trackItemLazyState(sliceColumns(candidate, authoredChildColumn, true), authoredChildState, childFenceCloses(j))
          // The line block closer still closes its child when an unmatched code
          // run in that child was read as inline text.
          const closer = RE_ADMONITION_CLOSE.exec(candidate.trimStart())
          if (closer && column === authoredChildColumn &&
              closer[1]!.length === authoredChildState.literalColon?.width) {
            delete authoredChildState.literalColon
            authoredChildState.divDepth = Math.max(0, authoredChildState.divDepth - 1)
            authoredChildState.lazyFoldable = false
          }
        }
      }
    }
    if (authoredCodeClose) {
      if (authoredCodeAdjustment > 0 && indentColumns(candidate, authoredCodeAdjustment) < authoredCodeAdjustment &&
          opensCodeFence(candidate.trimStart())) authoredBelowBaseRun = true
      if (authoredCodeAdjustment !== 0 && !takenBelowColumn?.has(j) &&
          !(authoredBelowBaseRun && indentColumns(candidate, authoredCodeAdjustment) < authoredCodeAdjustment)) {
        candidate = authoredCodeAdjustment < 0
          ? ' '.repeat(-authoredCodeAdjustment) + candidate
          : sliceColumns(candidate, Math.min(authoredCodeAdjustment, indentColumns(candidate)), true)
        lines[j] = candidate
      }
      if (indentColumns(candidate, base + 1) === base && authoredCodeClose.test(groupLineContent(candidate, base))) {
        authoredCodeClose = undefined
        authoredBelowBaseRun = false
      }
    } else if (nestedBodyLines && opaque === null && !authoredCodeClose && stack.length === authored.length && authoredChildColumn < 0 &&
        !stack.at(-1)!.literal && !authoredInlineFence) {
      const column = authoredColumn ??= indentColumns(candidate, hostedColonBodyOpener(candidate.trimStart()) ? Infinity : authored.at(-1)!.column + 4)
      while (!isBlankLine(candidate) && authored.length > 1 && column < authored.at(-1)!.column) authored.pop()
      const owner = authored.at(-1)!
      const rebasesHere = !emptyHostMinimum || !owner.paragraph || column >= base
      const text = sliceColumns(candidate, column, true)
      const markerColumn = /^[*+\-0-9A-Za-z]/.test(text) ? markerContentColumn(text, false, 0) : -1
      const childColumn = markerColumn < 0 ? -1 : column + markerColumn
      if (childColumn >= 0) {
        authoredChildColumn = childColumn
        authoredChildBlank = false
        authoredChildBlockBoundary = false
        authoredChildState = verbatimOnlyLazyState()
        trackItemLazyState(text.slice(markerColumn), authoredChildState, childFenceCloses(j))
      }
      const code = RE_FENCE.exec(text) ?? RE_RAW_FENCE.exec(text)
      if (rebasesHere && code && column === owner.column && owner.paragraph &&
          !opaqueGroupCloses(opaqueGroupCloser(text)!, lines, j + 1, column, takenBelowColumn, closerMemo)) authoredInlineFence = true
      if (rebasesHere && code && column >= owner.column && (column > owner.column ||
          opaqueGroupCloses(opaqueGroupCloser(text)!, lines, j + 1, column, takenBelowColumn, closerMemo))) {
        authoredCodeClose = fenceCloseRe(RE_FENCE.test(text) ? code[2]! : code[1]!)
        authoredCodeAdjustment = column - base
        authoredBelowBaseRun = false
      }
      const closeRun = RE_ADMONITION_CLOSE.exec(text)
      const closesOwner = closeRun?.[1]?.length === stack.at(-1)!.width
      if (rebasesHere && authoredChildColumn < 0 && !closesOwner &&
          (column >= owner.column && (closeRun === null || column === owner.column) && colonBlockOpenerRun(text) !== null)) {
        authored.push({ column, paragraph: false })
      }
      const current = authored.at(-1)!
      const blockColumn = column > current.column && hostedColonBodyOpener(text) && childColumn < 0 ? column : current.column
      if (rebasesHere && blockColumn !== base && column >= blockColumn &&
          !(preserveNestedNoteColumn && RE_FOOTNOTE_DEF.test(text.trimStart())) &&
          (blockColumn > base || usesHostMinimum && hostedAuthoredBlockOpener(text))) {
        candidate = blockColumn < base
          ? ' '.repeat(base - blockColumn) + candidate
          : sliceColumns(candidate, blockColumn - base, true)
        lines[j] = candidate
        authoredColumn = undefined
      }
      if (closesOwner && column === current.column) {
        if (authored.length > 1) authored.pop()
        authored.at(-1)!.paragraph = false
      } else current.paragraph = !isBlankLine(candidate) &&
        !(column === current.column && lineOpensItemBlock(text))
    }
    if (nestedBodyLines && stack.at(-1)!.literal && authored.at(-1)!.column > base) {
      const current = authored.at(-1)!
      const column = indentColumns(candidate, current.column + 1)
      if (column >= current.column) {
        const text = sliceColumns(candidate, current.column, true)
        candidate = sliceColumns(candidate, current.column - base, true)
        lines[j] = candidate
        authoredColumn = undefined
        if (column === current.column && RE_ADMONITION_CLOSE.test(text)) authored.pop()
      }
    }
    if (stack.length > 1) nestedBodyLines?.add(j)
    end = j
    // The container parses its own list markers after paragraph folding.
    // They must not split the host item's collected stream (carve#2474).
    onFenceBodyLine?.(j)
    if (isBlankLine(candidate) || insideAuthoredCode) continue
    const column = authoredColumn === undefined ? indentColumns(candidate, base) : Math.min(authoredColumn, base)
    // THE OPAQUE GROUP IS TRACKED BEFORE THE COLUMN TEST, because its closing
    // run may be written below the base and this pass still has to know the
    // payload ended there.
    const insideOpaque = opaque !== null
    if (
      opaque !== null &&
      (opaque.belowBaseCloses || closerReachesBase(j, takenBelowColumn)) &&
      opaque.closes(groupLineContent(candidate, base))
    ) {
      opaque = null
    }
    // A below-base run is payload unless it closes at the container's own column.
    if (column < base) {
      const closesAtColumn =
        column === 0 &&
        RE_ADMONITION_CLOSE.exec(candidate)?.[1]?.length === stack.at(-1)!.width
      if (!closesAtColumn) continue
    }
    const local = column === 0 ? candidate : sliceColumns(candidate, base, true)
    if (insideOpaque) {
      continue
    } else if (holdsFoldedLines && takenBelowColumn?.has(j) === true) {
      // A FOLDED LINE IS NOT AT THIS GROUP'S BASE. Its leading run is
      // alignment under the host that folded it in from below that host's own
      // content column, not an authored column - and at an over-indent of ONE
      // the two spellings collide, because a line written in the band between
      // column zero and the host's content column keeps exactly the single
      // residual column the rebased opener carries. So a `:::` there closed a
      // group the host never placed it in, and a heading, rule or quote there
      // became a block (markup-carve/carve-js#2243).
      //
      // Held rather than skipped, because the dedent below must leave the line
      // alone too - moving it onto the base is what re-classified it.
      //
      // NOT INSIDE AN OPAQUE PAYLOAD, which is the arm above: a fence's own
      // closing run can be written in that band, and holding it there left the
      // payload open and the container's own closer nested inside it.
      heldFoldedLines.add(j)
      continue
    } else if (column >= base) {
      // ONLY A FENCE THAT CLOSES OPENS A PAYLOAD (§10 I4 for the verbatim
      // kinds, §28 for the comment one). Without the lookahead an
      // unterminated run made every line after it payload, which handed a
      // folded heading, rule or quote marker to the dedent again.
      //
      const group = opaqueGroupCloser(local)
      if (group !== null && (group.belowBaseCloses
        ? findCommentCloser(group.run, j) > j
        : opaqueGroupCloses(group, lines, j + 1, base, takenBelowColumn, closerMemo))) {
        opaque = group
      }
    }
    const run = RE_ADMONITION_CLOSE.exec(local)
    if (run && stack.at(-1)!.width === run[1]!.length) {
      stack.pop()
      if (stack.length === 0) break
    } else if (!stack.at(-1)!.literal) {
      const opener = colonBlockOpenerRun(local)
      if (opener !== null) stack.push({ width: opener, literal: RE_LINE_BLOCK_OPEN.test(local) })
    }
  }
  return end
}

export function markerNoteFenceReach(lines: readonly string[], absorbedMarkers: ReadonlySet<number>, comments: ReadonlySet<number>): 'closed' | 'unclosed' | 'boundary' | null {
  let closer: RegExp | null = null
  let openerColumn = -1
  let childColumn = -1
  let childCloser: RegExp | null = null
  let childOpenerColumn = -1
  let afterBlank = false
  for (const [index, line] of lines.entries()) {
    if (comments.has(index)) continue
    const column = indentColumns(line)
    if (column < FOOTNOTE_BODY_COLUMN && !isBlankLine(line)) {
      if (closer === null) return null
      const laterCloser = lines.slice(index + 1).some(candidate =>
        indentColumns(candidate) === openerColumn && closer!.test(candidate.trimStart()))
      return laterCloser ? 'boundary' : 'unclosed'
    }
    if (isBlankLine(line)) { afterBlank = true; continue }
    const text = line.trimStart()
    if (closer !== null) {
      if (column === openerColumn && closer.test(text)) return 'closed'
      continue
    }
    if (childCloser !== null) {
      if (column === childOpenerColumn && childCloser.test(text)) childCloser = null
      continue
    }
    if (childColumn >= 0 && column < childColumn && !isBlankLine(line)) childColumn = -1
    const fence = RE_FENCE.exec(text) ?? RE_RAW_FENCE.exec(text)
    if (childColumn >= 0 && column >= childColumn) {
      if (fence !== null) {
        childCloser = fenceCloseRe(RE_FENCE.test(text) ? fence[2]! : fence[1]!)
        childOpenerColumn = column
      }
      continue
    }
    if (isListMarkerLine(text)) {
      if (!absorbedMarkers.has(index)) childColumn = column + markerContentColumn(text)
      afterBlank = false
      continue
    }
    if (afterBlank && RE_COMMENT_LINE.test(text)) return null
    afterBlank = false
    if (RE_FOOTNOTE_DEF.test(text) || (lineOpensItemBlock(text) && fence === null && !RE_COMMENT_LINE.test(text))) return null
    if (fence !== null) {
      closer = fenceCloseRe(RE_FENCE.test(text) ? fence[2]! : fence[1]!)
      openerColumn = column
    }
  }
  return closer === null ? null : 'unclosed'
}

export function markerNoteCommentFenceOpeners(lines: readonly string[], absorbedMarkers: ReadonlySet<number>, comments: ReadonlySet<number>, outerTailOnly = false): number[] {
  const openers: number[] = []
  let closer: RegExp | null = null
  let openerColumn = -1
  let childColumn = -1
  let belowNoteBody = false
  let nestedMarkerSeen = false
  for (const [index, line] of lines.entries()) {
    if (isBlankLine(line) || comments.has(index)) continue
    const column = indentColumns(line)
    const text = line.trimStart()
    if (column < FOOTNOTE_BODY_COLUMN) belowNoteBody = true
    if (closer !== null) {
      if (column === openerColumn && closer.test(text)) closer = null
      continue
    }
    if (childColumn >= 0 && column < childColumn) childColumn = -1
    const fence = RE_FENCE.exec(text) ?? RE_RAW_FENCE.exec(text)
    if (fence !== null) {
      closer = fenceCloseRe(RE_FENCE.test(text) ? fence[2]! : fence[1]!)
      openerColumn = column
    }
    if (childColumn >= 0 && column >= childColumn) continue
    if (RE_FOOTNOTE_DEF.test(text) || (isListMarkerLine(text) && !absorbedMarkers.has(index))) {
      // A later comment and fence cannot grant the outer item a tail claim.
      // The rebase scan still needs that fence opener at its authored column.
      if (outerTailOnly) nestedMarkerSeen = true
      if (isListMarkerLine(text)) childColumn = column + markerContentColumn(text)
    }
    if (!nestedMarkerSeen && !belowNoteBody && column >= FOOTNOTE_BODY_COLUMN && RE_COMMENT_LINE.test(text) &&
        indentColumns(lines[index + 1] ?? '') >= FOOTNOTE_BODY_COLUMN &&
        opensCodeFence(lines[index + 1]?.trimStart() ?? '')) openers.push(index + 1)
  }
  return openers
}

/**
 * The last line of a comment at or past a marker-line note's body column that
 * starts at the lexer, or -1. A `%%%` span counts only with its closer inside
 * the note.
 */
export function coveredNoteComment(lexer: Lexer, line: string, floor: number): number {
  if (isBlankLine(line) || indentColumns(line, floor) < floor) return -1
  const text = line.trimStart()
  if (!RE_COMMENT_LINE.test(text)) return -1
  const run = commentFenceRun(text)
  if (run === undefined) return lexer.pos
  for (let at = lexer.pos + 1; at < lexer.lineCount; at++) {
    const candidate = lexer.lineAt(at)!
    if (isBlankLine(candidate)) continue
    if (indentColumns(candidate, floor) < floor) return -1
    if (commentFenceRun(candidate.trimStart()) === run) return at
  }
  return -1
}

// CARVE-P2-017's AT band: a non-list, non-fence block opener at or past a
// marker-line note's body column opens inside the note. 'open' means no line
// has dropped below that column since, so nothing may continue the note lazily.
export function markerNoteOpenerReach(lines: readonly string[], absorbedMarkers: ReadonlySet<number>, comments: ReadonlySet<number>): 'open' | 'closed' | null {
  let closer: RegExp | null = null
  let openerColumn = -1
  let childColumn = -1
  let found = false
  for (const [index, line] of lines.entries()) {
    if (isBlankLine(line) || comments.has(index)) continue
    const column = indentColumns(line)
    if (column < FOOTNOTE_BODY_COLUMN) return found ? 'closed' : null
    const text = line.trimStart()
    if (closer !== null) {
      if (column === openerColumn && closer.test(text)) closer = null
      continue
    }
    if (childColumn >= 0 && column >= childColumn) continue
    childColumn = -1
    if (RE_FOOTNOTE_DEF.test(text)) return found ? 'closed' : null
    const fence = RE_FENCE.exec(text) ?? RE_RAW_FENCE.exec(text)
    if (fence !== null) {
      closer = fenceCloseRe(RE_FENCE.test(text) ? fence[2]! : fence[1]!)
      openerColumn = column
      continue
    }
    if (isListMarkerLine(text)) {
      if (!absorbedMarkers.has(index)) childColumn = column + markerContentColumn(text)
      continue
    }
    if (RE_COMMENT_LINE.test(text) || commentFenceRun(text) !== undefined) continue
    if (lineOpensItemBlock(text)) found = true
  }
  return found ? 'open' : null
}

/**
 * Apply an over-indented list block opener's authored column as a temporary
 * local block base (PART 9 §24 C3, carve#1705).
 *
 * The item collector has already removed `content_column`, so a positive
 * leading indent here is exactly the authored over-indent.  Single-line block
 * openers are rebased independently.  Containers and definitions carry the
 * same base through their body/closer; treating every line independently would
 * let an accidentally dedented fence close or would corrupt opaque payload.
 *
 * This is one forward pass.  A line is stripped at most once and container
 * scans advance the outer cursor, keeping flat and deeply nested input linear.
 *
 * Every line this pass moves ends up spelled exactly as the same block would be
 * spelled AT the content column, which is what keeps an over-indented opener
 * and its exact-column twin parsing identically from here on.  Nothing
 * downstream needs to know a rebase happened.
 */
/**
 * Would a container body's rebase pass MOVE any line of `rendered`?
 *
 * The writer asks this, and it asks the rebase itself rather than a copy of its
 * rule. A definition description's payload sits at its separator's column, in
 * from its `::`, which is ABOVE the body minimum of a footnote body, a list
 * item or a
 * definition description - so at that minimum the container's rebase claims the
 * payload as a block of its own and the description loses it (carve-js#1509).
 * One column further in, the `::` line's own column becomes the entry's base and
 * the rebase hands the whole run back at the same relative columns.
 *
 * Any predicate written out again HERE would be a second spelling of the same
 * rule and would drift from the first one; running the pass over a copy cannot.
 */
export function aBodyRebaseWouldMoveALine(rendered: string): boolean {
  const lines = rendered.split('\n')
  const rebased = lines.slice()
  rebaseOverindentedBlocks(rebased, undefined, -1, true)

  return rebased.some((line, index) => line !== lines[index])
}

/**
 * The opener families an OVER-COLUMN line may spell (PART 9 §24 C3,
 * carve#1705).
 *
 * Wider than `lineOpensBlock` by the two shapes that still deserve to be moved
 * back to the item's base even though they are not block OPENERS there: a block
 * attribute line and a bare block image.  Both are PARAGRAPHS at the canonical
 * content column (PART 9 §17 L2) and stay paragraphs after the move - the point
 * of rebasing them is that `{.c}` reaches the heading below it, and that the
 * image is inside the item rather than an indented run beside it.
 *
 * ONLY the rebase asks this. Anything that classifies a line the collector
 * already placed at the content column asks `lineOpensBlock`, so an
 * over-indented spelling and its exact-column twin answer alike.
 */
export function lineOpensItemBlock(line: string): boolean {
  return lineOpensBlock(line) || isBlockAttributeLine(line) || isBlockImageLine(line)
}

// ============================================================================
// Inline parsing
// ============================================================================

// Footnote reference `[^label]`. A label is a physical-line identifier: it
// contains neither `]` nor a source newline. Letting this cross a soft break
// creates an id no definition marker (which is necessarily one line) can bind.
export const RE_FOOTNOTE_REF = /^\[\^([^\]\r\n]+)\]/
// extension_name = identifier = (letter|'_'){letter|digit|'_'|'-'}
// (grammar.ebnf:968-969,1122) -- a lone `_` is a valid extension name.
export const RE_EXTENSION = /^:([a-zA-Z_][\w-]*)\[([^\]]*)\]/
/**
 * The format a raw inline's `{=format}` tail can name.
 *
 * Exported because the HTML importer rebuilds a raw inline from PART 10 §13a's
 * `data-carve-raw` carrier: a value this does not match is not a format, and
 * the writer NORMALIZES what it is given, so `h t m l` would be written back
 * as `{=html}` - which is how a carrier smuggled markup past the mode gate.
 */
export const RE_RAW_INLINE_FORMAT = /^[a-zA-Z][\w-]*$/
// Symbol shortcode `:name:` (after extension, which needs `[`).
// The first name char is a letter, digit, `+` or `-` (so `:+1:` / `:-1:`
// parse), but never `_` — `:_x_:` would steal from underline. Scanning the
// symbol at the opening `:` also gives it precedence over smart typography,
// so `:+-:` is the symbol `+-`, not a `±` between colons (grammar PART 9 §7).
export const RE_SYMBOL = /^:([a-zA-Z0-9+-][\w+-]*):/

/**
 * Does a SYMBOL SHORTCODE open at this offset?
 *
 * Exported so the Carve writer can read the rule off the parser instead of
 * carrying a second copy of it. PART 11 section 2 escapes a character only
 * where omitting it would change the re-parse, so the writer has to ask the
 * exact question the parse asks - and this repository has repeatedly found one
 * rule spelled N times where N was larger than anyone claimed.
 *
 * A symbol opens on a `:` NOT preceded by `_` or an alphanumeric and followed
 * by a name that CLOSES on another `:`. Requiring the closer is what leaves
 * `a : b : c` alone, and the preceding-character guard is what leaves a URL's
 * `http://x` alone.
 */
export function symbolOpensAt(text: string, offset: number): boolean {
  if (text[offset] !== ':') return false
  if (offset > 0 && /[A-Za-z0-9_]/.test(text[offset - 1]!)) return false
  return RE_SYMBOL.test(text.slice(offset))
}
// `crossref_id` ends at a space, `>` or a line break; a tab inside the id is content.
export const RE_CROSSREF = /^<\/#([^> \n\r]+)>/
// Inline node types a trailing `{...}` must NOT attach to: their renderers emit
// no attributes, so an attached block would be silently dropped. `text` is
// literal by the §14 rule; `soft_break`/`hard_break` are whitespace; `mention`
// and `tag` are inert stable spans that do not take attributes. After any of
// these the `{...}` stays literal text (matches carve-rs / carve-php).
// `heading_ref` belongs here for the same reason as the rest: a cross-reference
// renders either as its literal source (unresolved) or as a link whose href is
// structural, and neither emits the attached attributes - so `</#h>{i}` dropped
// the `{i}` entirely. carve-rs and carve-php keep it literal in both cases
// (carve-js#537).
export const ATTR_INERT_PREV = new Set([
  'text',
  // `escaped_char` carries no attributes tail in the grammar, and neither does
  // the text run around it, so a block after one matches no production and is
  // literal. Attaching it to `escaped_text`, whose renderer emits nothing, made
  // the source characters vanish (carve-js#1766).
  'escaped_text',
  'non_breaking_space',
  'soft_break',
  'hard_break',
  'cell_wrap',
  'mention',
  'tag',
  'heading_ref',
  // Smart typography is a source-to-glyph substitution, not one of PART 9's
  // inline attribute carriers. Attaching a block here consumes source that no
  // renderer has an element on which to emit.
  'smart_punctuation',
  // Editorial substitution and comment have no attribute slot (carve#2138,
  // CARVE-P3-017 names only addition and deletion). Attaching here dropped the
  // block at render, the author's `{.k}` vanishing without trace.
  'substitution',
  'critic_comment',
  // Braced comments also end the attribute run (carve#2929).
  'comment',
])


/**
 * The whole tail of a link or image: `(destination)`, optionally with a title
 * and an attribute block. Returns the shape the regex it replaced returned --
 * full match, destination, the two title spellings, attribute payload -- so
 * the call sites read the same either way.
 */
export function execLinkTail(tail: string, canReadAttrs?: (offset: number) => boolean): [string, string, string | undefined, string | undefined, string | undefined] | null {
  const scanned = scanDestination(tail)
  if (scanned === null) return null
  const rest = (scanned.dest === '' ? RE_EMPTY_LINK_REST : RE_LINK_REST).exec(tail.slice(scanned.end))
  if (rest === null) return null
  const end = scanned.end + rest[0].length
  const attrs = tail[end] === '{' && (canReadAttrs === undefined || canReadAttrs(end))
    ? RE_INLINE_ATTR.exec(tail.slice(end)) : null
  return [tail.slice(0, end + (attrs?.[0].length ?? 0)), scanned.dest, rest[1], rest[2], attrs?.[1]]
}
export const RE_REF_TAIL = /^\[([^\]]*)\]/
export const RE_SPAN_TAIL = /^\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')*)\}/

/**
 * Map each `[` in `s` to the index of its balancing `]` (innermost pairing,
 * allowing nested `[...]`; a backslash-escaped bracket is skipped, not
 * counted), computed in a single O(n) stack pass. The link/image/span
 * branches look the close `]` up in O(1) rather than re-scanning to end of
 * input for every `[`, which would be O(n^2) on adversarial input like
 * `[[[[...` (with or without a trailing `]`). Unbalanced `[` are absent from
 * the map.
 */
// The closed-verbatim-span single-space strip: one leading and one trailing
// space are removed when the content BOTH begins and ends with a space — but
// NOT when it consists entirely of spaces. The all-space guard matches the
// executable spec's `codeText()` and the CommonMark rule it derives from
// ("...but does not consist entirely of space characters"). Without the guard
// `` `  ` `` stripped to the empty string, and an empty verbatim span has no
// representable Carve source (a bare `` `` `` reparses as a two-backtick
// opener), so `carve fmt` could not round-trip it. Shared by the code-span,
// math and inline-literal scanners so the three cannot drift apart.
export function stripVerbatimPadding(content: string): string {
  // ALL-SPACE IS MEASURED IN CARVE'S WHITESPACE, not the host language's
  // (carve#977, PART 7). A native `.trim()` called ` <VT> ` all-space, so the
  // padding stayed on and `` ` <VT> ` `` rendered `<code> <VT> </code>` where
  // `` ` x ` `` renders `<code>x</code>` - a vertical tab deciding, in the one
  // test that separates padding from content, that a space is not padding.
  if (trimStructural(content) === '') return content
  return content.replace(/^ ([\s\S]*) $/, '$1')
}

// A BRACED HYPHEN PAIR IS AN EN DASH (markup-carve/carve#1447). The bare run
// carries a flanking guard, so `x --verbose y` stays literal and an author who
// MEANT a dash in that position had no way to say so. This is that way, and it
// cost nothing: the string it took was an empty `<del>`.
export const RE_BRACED_EN_DASH = /^\{--\}/

export const PAIR_MARKERS = '/*_^,~=+-'

// Every braced opener needs a whole delimiter: the forced spans, the editorial
// frames and the comment `{%` (CARVE-P3-025).
export const BRACED_OPENER_MARKERS = '/*_^,~=+-#%'
export function splitBracedOpener(text: string, open: number): boolean {
  const marker = text[open + 1]
  return marker !== undefined && BRACED_OPENER_MARKERS.includes(marker) && extendsGrapheme(text, open + 2)
}

export interface InlinePairView {
  tables: Array<Int32Array | undefined>
  attributeTails: Map<number, number>
  barePairs: Map<number, { close: number; end: number }>
  offset: number
}
export const FORCED_TYPE: Record<string, Emphasis['type']> = {
  '/': 'emphasis',
  '*': 'strong',
  _: 'underline',
  '^': 'superscript',
  ',': 'subscript',
  '~': 'strike',
  '=': 'highlight',
}
// Names can include version-style dots between alnum runs (e.g. `#release-1.0`)
// but a trailing period is treated as sentence punctuation, not part of the name.
// Mention / tag name = name_word ('.' name_word)*, name_word = (letter | digit
// | '_' | '-')+ (grammar PART 9 §7). Interior dots only (a trailing dot stays
// punctuation — the non-greedy dotted-segment match leaves it); each segment
// allows digits, `_` and `-` in any position. Matches carve-php / carve-rs.
export const RE_MENTION = /^@([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)/
export const RE_TAG = /^#([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)/

export const SMART_TOKENS: Array<[string, string, string]> = [
  ['<-->', '↔', 'left_right_arrow'],
  ['<->', '↔', 'left_right_arrow'],
  ['-->', '→', 'rightwards_arrow'],
  ['<--', '←', 'leftwards_arrow'],
  ['<=>', '⇔', 'left_right_double_arrow'],
  ['==>', '⇒', 'rightwards_double_arrow'],
  ['<==', '⇐', 'leftwards_double_arrow'],
  ['(tm)', '™', 'trademark'],
  ['...', '…', 'ellipsis'],
  ['->', '→', 'rightwards_arrow'],
  ['<-', '←', 'leftwards_arrow'],
  ['<=', '≤', 'less_than_or_equal'],
  ['>=', '≥', 'greater_than_or_equal'],
  ['!=', '≠', 'not_equal'],
  ['+-', '±', 'plus_minus'],
  ['(c)', '©', 'copyright'],
  ['(r)', '®', 'registered'],
]

/**
 * Allocate a run of `n` hyphens (n >= 2) into em/en dashes, matching
 * djot + carve-php: all em when divisible by 3, all en when divisible by
 * 2, otherwise max em-dashes with the remainder as en-dashes (a
 * remainder of 1 trades one em for two en). 2->–, 3->—, 4->––, 5->—–.
 */
export function allocateDashes(n: number): string {
  if (n % 3 === 0) return '—'.repeat(n / 3)
  if (n % 2 === 0) return '–'.repeat(n / 2)
  let em = Math.floor(n / 3)
  let en: number
  if (n % 3 === 1) {
    em -= 1
    en = 2
  } else {
    en = 1
  }
  return '—'.repeat(em) + '–'.repeat(en)
}
/*
 * The space class the hyphen-run flanking test reads (PART 9 §8, carve#1443).
 *
 * PART 7's four whitespace characters plus the NO-BREAK SPACE - NOT `\s`. A
 * VERTICAL TAB and a FORM FEED are CONTENT in Carve, so `---<VT>` has to answer
 * the way `---!` answers, and `\s` takes both. The nbsp is in for the reason it
 * is in quote flanking below: the question asked is "does a space stand here",
 * and a nbsp is a space to the reader - in either of its spellings, so the
 * internal U+E000 placeholder for an escaped `\ ` counts too.
 */
export const isFlankSpace = (ch: string) => /[ \t\n\r\u00a0\0]/.test(ch)
export const isQuoteSpace = (ch: string) => /[ \t\n\r\u00a0]/.test(ch)
export const isQuoteAlnum = (ch: string) => /[\p{L}\p{N}]/u.test(ch)
export const QUOTE_LETTER_RUN = /\p{L}+/uy
export const ELISION_WORDS = new Set(['tis', 'tisn', 'twas', 'twasn', 'twere', 'twill', 'twould', 'em', 'cause', 'til', 'n', 'bout'])
export const closesAfterDash = (prev: string, next: string) =>
  '-–—'.includes(prev) && prev !== '' && (next === '' || isQuoteSpace(next) || `"'.,;:!?)]`.includes(next))
// Adjudicated smart-quote opening context (matches carve-rs on these inputs):
// a straight quote curls OPENING when preceded by start-of-content, Unicode
// whitespace (incl. NBSP, handled below via the U+E000 placeholder), or one of
// the operator/opening-punctuation chars `( [ { = : - /`. Sentence punctuation
// (`. , ; ! ?`), letters, digits and closing brackets stay CLOSING. The en/em
// dash also opens (a quote right after a `--` dash run opens), as does a quote
// directly after an opening curly quote (nested-quote context).
// Letters outside the BMP are two UTF-16 units; the quote rules judge whole code points.
export const codePointAfter = (text: string, i: number): string => {
  const cp = text.codePointAt(i + 1)
  return cp === undefined ? '' : String.fromCodePoint(cp)
}
export const isQuoteOpenContext = (prev: string) =>
  prev === '' ||
  /[ \t\n\r\u00a0([{\-–—/=:]/.test(prev) ||
  prev === '“' ||
  prev === '‘'

/**
 * Recognize one smart-typography construct at `text[i]`.
 * `prev` is the character immediately before (for contextual quotes).
 * Returns the replacement and consumed length, or null.
 */
/**
 * The previously emitted character, for the quote open/close decision.
 *
 * It used to be the tail of the text buffer, but a smart-typography node
 * flushes that buffer, so the glyph it produced would otherwise be invisible
 * here. An opening curly quote is one of the few characters that puts the NEXT
 * quote in opening context, so losing it flips `""` from opening to closing.
 * Nodes without a known trailing character are treated as word-adjacent.
 */
export function lastEmittedGlyph(previous: InlineNode): string {
  if (previous && previous.type === 'smart_punctuation') {
    const glyph = previous.glyph ?? SMART_PUNCTUATION_GLYPHS[previous.kind]
    if (glyph) return glyph
  }
  // An escaped character is its own node but still the character before the
  // quote, and quote flanking reads that character: `\{"quoted"` opens on the
  // brace exactly as an unescaped `{` would (corpus 163).
  if (previous && previous.type === 'non_breaking_space') return '\u00a0'
  if (previous && previous.type === 'escaped_text') return previous.value
  if (previous.type === 'text') return previous.value.slice(-1)
  // A line break is whitespace to quote flanking, so a quote starting a line opens (carve#2822).
  if (previous && (previous.type === 'soft_break' || previous.type === 'hard_break' || previous.type === 'cell_wrap')) return '\n'
  return 'x'
}



export interface InlineSource {
  baseOffset: number
  startLine: number
  startColumn: number
  /**
   * Document offset and column of each LINE START inside the inline text.
   *
   * The scanner walks the container's STRIPPED text, so after the first newline
   * a linear `baseOffset + localOffset` drifts by whatever prefix the container
   * removed from each following line (`> `, the list content indent). Anchors
   * give each line its own origin, which is the only way a continuation line
   * lands on the right source (#444).
   *
   * Absent for text that was reconstructed rather than stripped - a line block's
   * expanded whitespace, a table's reassembled cells - where no exact mapping
   * exists and inventing one is what PART 12 section 4 forbids.
   *
   * EACH ANCHOR CARRIES ITS SOURCE LINE NUMBER, not only its offset and column.
   * Counting newlines in the stripped text names the right line only while the
   * text has one newline per source line, and a container that REMOVES a line -
   * a `+` continuation marker, whose own line the block layer consumes - breaks
   * that. The offsets stayed right and the line number ran one short per removed
   * line, so a node reported a line whose start its own offset was nowhere near
   * (markup-carve/carve-js#1305).
   */
  lineAnchors?: Array<{ offset: number; column: number; line: number }>
  /**
   * How many lines into `lineAnchors` this text starts.
   *
   * A nested scan (an emphasis body, a link label) re-bases its text on its own
   * offset 0, and the anchors belong to the WHOLE stanza. Carrying a delta
   * rather than re-basing the array is what keeps this linear, exactly as
   * `rangeShift` does for `anchoredRanges`.
   */
  anchorShift?: number
  /**
   * False when this text cannot be located in the document at all, so no `pos`
   * is emitted for anything scanned from it.
   *
   * A nested sub-lexer whose lines could not be mapped back (a blockquote with a
   * `+` continuation marker, a definition list that re-indents its body) has
   * offsets that are only meaningful inside its own text. Emitting those as
   * document positions is the invented value PART 12 section 4 forbids, and it
   * is what produced spans like "> quot" for the text "quoted".
   */
  anchored?: boolean
  /**
   * The local ranges of this text that DO map to the document, for text
   * assembled from more than one source region.
   */
  anchoredRanges?: readonly AnchorRange[]
  /**
   * How far into `anchoredRanges`' own coordinates this text starts.
   *
   * A nested scan (a link label, an emphasis body) re-bases its text on its own
   * offset 0, and the ranges belong to the WHOLE cell. Carrying a delta rather
   * than re-basing the array is what keeps this linear: a cell accumulates one
   * range per continuation row and a nested scan per inline construct, so
   * copying the array on every `shiftSource` is quadratic in a tall cell that
   * also carries markup.
   */
  rangeShift?: number
  cellWraps?: ReadonlyMap<number, { line: number; row?: number; col?: number; pos?: Position }>
  wrapShift?: number
}

/**
 * One local range of an inline text that maps exactly to a document region.
 *
 * Local offset `o` with `from <= o <= to` sits at document offset
 * `offset + (o - from)`, on `line`, at column `column + (o - from)`. A range
 * never spans a newline, which is what lets `line` be a single number.
 */
export interface AnchorRange {
  from: number
  to: number
  offset: number
  line: number
  column: number
}

export function inlineSource(overrides: Partial<InlineSource> = {}): InlineSource {
  const source: InlineSource = {
    baseOffset: overrides.baseOffset ?? 0,
    startLine: overrides.startLine ?? 1,
    startColumn: overrides.startColumn ?? 1,
  }
  if (overrides.lineAnchors) source.lineAnchors = overrides.lineAnchors
  if (overrides.anchorShift) source.anchorShift = overrides.anchorShift
  if (overrides.anchoredRanges) source.anchoredRanges = overrides.anchoredRanges
  if (overrides.rangeShift) source.rangeShift = overrides.rangeShift
  if (overrides.cellWraps) source.cellWraps = overrides.cellWraps
  if (overrides.wrapShift) source.wrapShift = overrides.wrapShift
  if (overrides.anchored === false) source.anchored = false
  return source
}

/**
 * The range holding `offset`, or undefined when no range does.
 *
 * BINARY SEARCH, not a scan. A cell accumulates one range per continuation row
 * and the scanner asks per token, so a linear lookup is quadratic in a tall
 * multi-line cell - the same shape `openVerbatimRun` is resumed rather than
 * recomputed to avoid.
 */
export function anchorRangeAt(ranges: readonly AnchorRange[], offset: number): AnchorRange | undefined {
  let lo = 0
  let hi = ranges.length - 1
  let found: AnchorRange | undefined
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const r = ranges[mid]!
    if (r.from <= offset) {
      found = r
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found && offset <= found.to ? found : undefined
}

/**
 * The emphasis kinds held against bare openers in the current inline scope.
 *
 * A bare span inherits the enclosing kinds. A braced native span starts a
 * scope holding its own kind against bare openers; a further braced native
 * child can nest that kind (CARVE-P9-043). A link label or table cell starts
 * with no held kinds.
 */
export const NO_OPEN_KINDS: ReadonlySet<string> = new Set()

export interface EmphasisMatch {
  node: Emphasis
  end: number
}

export interface EmphasisMemo {
  // Per delimiter, scan positions known to reach no closer. Not a single bound:
  // an opener inside a skipped plain brace group does not scan a suffix.
  failed: Map<string, Uint8Array>
  lastBrace: number
  lastCritic?: number
  boldItalic?: number[]
  // Each link or image destination's `(` mapped to its closing `)`, built once.
  destinations?: Map<number, number>
  // Each `[` mapped to its balanced `]`, built once. Same map the inline pass
  // resolves a label with, so the scan hides exactly the run the parser builds.
  brackets?: BracketClose
  crossref?: CrossrefMemo
}

export function combinedSpanCloser(text: string, start: number, memo: EmphasisMemo): number | undefined {
  if (!memo.boldItalic) {
    memo.boldItalic = []
    let offset = 0
    for (;;) {
      const close = text.indexOf('*/', offset)
      if (close === -1) break
      // bare_closer('/'): the outer `/` does not close before a letter or digit
      // (carve#3217), so that `*/` is content and a later one may close.
      if (close > 0 && !isCarveWhitespace(text[close - 1]) && !extendsGrapheme(text, close + 2) && !/[A-Za-z0-9]/.test(text[close + 2] ?? '')) memo.boldItalic.push(close)
      offset = close + 1
    }
  }
  const closers = memo.boldItalic
  let low = 0
  let high = closers.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (closers[mid]! <= start) low = mid + 1
    else high = mid
  }
  return closers[low]
}

export function newEmphasisMemo(): EmphasisMemo {
  return { failed: new Map(), lastBrace: -2 }
}

/** `buildBracketMap` over one inline text, built at most once per scan. */
export function emphasisBrackets(text: string, memo: EmphasisMemo): BracketClose {
  memo.brackets ??= text.includes('[') ? buildBracketMap(text) : () => undefined

  return memo.brackets
}

// The braced inlines E2a names, as sticky copies of the matchers the main loop
// uses, so the scan hides exactly the region the parser builds a node from.

// Sticky copies of the raw-inline format and link-tail matchers used by the
// main loop, so the scan hides exactly the region it builds a node from.
export const RE_RAW_INLINE_STICKY = new RegExp(RE_RAW_INLINE.source.replace(/^\^/, ''), 'y')
export const RE_LINK_REST_STICKY = new RegExp(RE_LINK_REST.source.replace(/^\^/, ''), 'y')
export const RE_EMPTY_LINK_REST_STICKY = new RegExp(RE_EMPTY_LINK_REST.source.replace(/^\^/, ''), 'y')

// Autolinks and cross-references outside code spans, as [start, end) pairs.
// PART 8 resolves them before links, so a `[` inside one opens no run.
export function atomicLinkRegions(text: string): Array<[number, number]> {
  const regions: Array<[number, number]> = []
  if (!text.includes('<')) return regions
  const codeEnds = text.includes('`') ? backtickRunEnds(text) : undefined
  const crossrefs: CrossrefMemo = { lastCloser: text.lastIndexOf('>') }
  for (let at = 0; at < text.length; at++) {
    const ch = text[at]
    if (ch === '\\') { at++; continue }
    if (ch === '`') {
      const end = codeEnds?.[at] ?? -1
      if (end === -1) break
      at = end - 1
      continue
    }
    if (ch !== '<') continue
    if (text.startsWith('</#', at) && text[at + 3] !== '>' && crossrefBodyCanEnd(text, at + 3, crossrefs)) {
      const end = text.indexOf('>', at + 3) + 1
      regions.push([at, end])
      at = end - 1
      continue
    }
    RE_AUTOLINK_STICKY.lastIndex = at
    const autolink = RE_AUTOLINK_STICKY.exec(text)
    if (autolink) {
      regions.push([at, at + autolink[0].length])
      at += autolink[0].length - 1
    }
  }
  return regions
}

// Only a bracket pair the parser can build a link or image from has a
// destination: not a footnote reference `[^n]` nor an inline note `^[...]`. The
// attribute block after the `)` is not part of what E2a hides.
export function linkDestinations(text: string, memo: EmphasisMemo): Map<number, number> {
  if (memo.destinations) return memo.destinations
  const found = new Map<number, number>()
  memo.destinations = found
  if (!text.includes('](')) return found
  const brackets = buildBracketMap(text)
  // A destination inside a destination is already hidden by the one around it,
  // and scanning it again is what makes a nest of them quadratic. Brackets come
  // in ascending order, so the outermost of a nest is reached first.
  let covered = -1
  const destinationOpeners = completeDestinationOpeners(text)
  const atoms = atomicLinkRegions(text)
  let atom = 0
  for (let open = text.indexOf('['); open !== -1; open = text.indexOf('[', open + 1)) {
    while (atom < atoms.length && atoms[atom]![1] <= open) atom++
    if (atom < atoms.length && atoms[atom]![0] < open) continue
    const close = brackets(open)
    if (close === undefined) continue
    if (close + 1 <= covered) continue
    if (text[close + 1] !== '(' || text[open + 1] === '^' || text[open - 1] === '^') continue
    if (!destinationOpeners.has(close + 1)) continue
    const scanned = scanDestination(text, close + 1)
    if (scanned === null) continue
    const restPattern = scanned.dest === '' ? RE_EMPTY_LINK_REST_STICKY : RE_LINK_REST_STICKY
    restPattern.lastIndex = scanned.end
    const rest = restPattern.exec(text)
    if (rest === null) continue
    const end = scanned.end + rest[0].length - 1
    found.set(close + 1, end)
    covered = end
  }
  return found
}

export const listStateHelpers = {
  FOOTNOTE_BODY_COLUMN,
  RE_ADMONITION_CLOSE,
  RE_ADMONITION_OPEN,
  RE_BLOCKQUOTE,
  RE_COMMENT_LINE,
  RE_DEFLIST_DEF,
  RE_DEFLIST_TERM,
  RE_DIV_OPEN,
  RE_FENCE,
  RE_FOOTNOTE_DEF,
  RE_HARDBREAKS_OPEN,
  RE_HEADING,
  RE_HR,
  RE_INVISIBLE_BLOCK_LEAD,
  RE_LINE_BLOCK_OPEN,
  RE_QUOTE_BLOCK_OPEN,
  RE_RAW_FENCE,
  RE_TABLE_CONT,
  blockQuoteParagraphOpen,
  bottomBlockLeavesParagraphOpen,
  colonBlockOpenerRun,
  colonFenceOpenerLen,
  commentFenceRun,
  continuesInlineFenceParagraph,
  extractItemAttr,
  fenceCloseRe,
  hostedAuthoredBlockOpener,
  isBlockAttributeLine,
  isLinkDefLine,
  isTableRow,
  leadingWhitespace,
  lineOpensBlock,
  markerLineState,
  markerPrefixLength,
  opaqueGroupCloser,
  opensCodeFence,
  opensWrappedAttributeBlock,
  orderedMatch,
  prefixWalkBound,
  quotedLineText,
  taskMatch,
  trackBlockQuoteLazyState,
  trackWrappedAttributeRun,
  unorderedMatch,
  verbatimOnlyLazyState,
}
export const trackItemLazyState = createListStateTracker(listStateHelpers)

export const rebaseHelpers = {
  FOOTNOTE_BODY_COLUMN,
  LAZY_FRAME,
  RE_ADMONITION_CLOSE,
  RE_ADMONITION_OPEN,
  RE_BLOCKQUOTE,
  RE_CAPTION,
  RE_COMMENT_LINE,
  RE_DEFLIST_DEF,
  RE_DEFLIST_TERM,
  RE_FENCE,
  RE_FOOTNOTE_DEF,
  RE_HEADING,
  RE_HR,
  RE_LINE_BLOCK_OPEN,
  RE_LINK_DEF,
  RE_ORDERED,
  RE_RAW_FENCE,
  RE_TASK,
  RE_UNORDERED,
  blockQuoteParagraphOpen,
  bottomBlockLeavesParagraphOpen,
  collectLiteralColonFenceBody,
  colonBlockOpenerRun,
  colonFenceOpenerLen,
  commentCloserLookup,
  commentFenceRun,
  extractItemAttr,
  fenceCloseRe,
  hostedAuthoredBlockOpener,
  isBlockAttributeLine,
  isContinuationMarker,
  isLinkDefLine,
  isListMarkerLine,
  isParentAuthoredBlock,
  isTableRow,
  leadingWhitespace,
  lineOpensBlock,
  lineOpensItemBlock,
  markerContentColumn,
  markerFreeContent,
  markerLineQuoteState,
  opaqueGroupCloser,
  opaqueGroupCloses,
  opensCodeFence,
  opensWrappedAttributeBlock,
  peekBlockAttributes,
  quotePrefixDepth,
  rebasedCodeFenceEnd,
  rebasedColonGroupEnd,
  rebasedQuoteEnd,
  sourceCodeFenceEnd,
  sourceColumn,
  stripLazyFrame,
  trackBlockQuoteLazyState,
  trackItemLazyState,
  verbatimOnlyLazyState,
}
export const rebaseOverindentedBlocks = createRebasePass(rebaseHelpers)

export const listHelpers = {
  FOOTNOTE_BODY_COLUMN,
  LAZY_FRAME,
  RE_ADMONITION_CLOSE,
  RE_ADMONITION_OPEN,
  RE_BLOCKQUOTE,
  RE_CAPTION,
  RE_COLON_RUN,
  RE_COMMENT_LINE,
  RE_DEFLIST_DEF,
  RE_DEFLIST_TERM,
  RE_DIV_OPEN,
  RE_FENCE,
  RE_FENCE_CLOSER,
  RE_FIRST_BLOCK_MARKER,
  RE_FOOTNOTE_DEF,
  RE_HARDBREAKS_OPEN,
  RE_HR,
  RE_LINE_BLOCK_OPEN,
  RE_ORDERED,
  RE_QUOTE_BLOCK_OPEN,
  RE_RAW_FENCE,
  RE_TASK,
  RE_UNORDERED,
  attachBlockPos,
  attachesAtDocumentColumnZero,
  authoredTaskState,
  blockQuoteParagraphOpen,
  bodyHoldsOpenCommentSpan,
  bottomBlockLeavesParagraphOpen,
  buildCloserIndex,
  codeCloserPossible,
  colonBlockOpenerRun,
  colonFenceOpenerLen,
  colonFenceShapeEndsLazyContinuation,
  commentBlockHasCloser,
  commentBlockSpans,
  commentFenceRun,
  coveredNoteComment,
  deflistContentCol,
  deflistMarkerLine,
  endsInPlus,
  exactCloserPossible,
  extractItemAttr,
  fenceCloseRe,
  firstBlockOpenerContent,
  insideOpenFence,
  insideOpenQuoteParagraph,
  isBlockAttributeLine,
  isColonFenceOpener,
  isContinuationMarker,
  isInvisibleLine,
  isLinkDefLine,
  isListMarkerLine,
  isParentAuthoredBlock,
  isPhysicalContinuationMarker,
  isRetainableLineComment,
  isStackedFirstBlockQuoteMarker,
  itemFenceHasCloser,
  lazyContinuationEndsList,
  leadingWhitespace,
  lineOpensBlock,
  lineOpensItemBlock,
  literalCommentHasCloser,
  markerContentColumn,
  markerDecision,
  markerFreeContent,
  markerLineBottomBlock,
  markerLineQuoteState,
  markerLineState,
  markerNoteCommentFenceOpeners,
  markerNoteFenceReach,
  markerNoteOpenerReach,
  markerPrefixLength,
  matchListMarker,
  matchedCommentFenceEnd,
  nestedSubLexer,
  newCommentSpanScan,
  olKindOf,
  olStartOf,
  olTypeOf,
  opensCodeFence,
  orderedContinues,
  orderedMatch,
  prefixWalkBound,
  quoteBodyColumn,
  quoteIndentHasTab,
  quotePrefixDepth,
  quotePrefixLength,
  quotedLineText,
  restoreVerbatimBlanks,
  retainCommentBoundary,
  sourceColumn,
  sourceQuoteBody,
  sourceQuoteLocalColumn,
  startsInterruptingBlock,
  stripLazyFrame,
  subLexer,
  taskMatch,
  trackBlockQuoteLazyState,
  unorderedMarkerChar,
  unorderedMatch,
  verbatimOnlyLazyState,
  walkContainerPrefix
}

export const definitionListHelpers = { ...listHelpers,
  trackItemLazyState,
  rebaseOverindentedBlocks,
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
  retainBelowColumnComment,
  sourceColumnAt,
  trimEndSpaceTab,
}
export const parseDefinitionListWithHelpers = createDefinitionListParser(definitionListHelpers)

export const linkDefinitionHelpers = { ...listHelpers,
  RE_ABBR_DEF,
  RE_AFTER_TERM,
  RE_COMMENT_BLOCK_ANY,
  RE_DEFLIST_SEPARATOR,
  RE_PREPASS_ANY_FENCE_CLOSER,
  buildCodeCloserIndex,
  codeCloserPossibleIn,
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
  RE_EXTENSION,
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
  get inlineDepth() { return inlineDepthState.value },
}
export const scanInlineInnerWithHelpers = createInlineScanner(inlineScannerHelpers)

export const parseListWithHelpers = createListParser(listHelpers, trackItemLazyState, rebaseOverindentedBlocks)

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

export { AttachmentFenceClosers,GENERATED_CONTENT_KINDS,Lexer,RE_AUTOLINK_STICKY,SubstitutionScanner,accumulateAttrs,applyAbbreviations,applyLinkDefs,backtickRunEnds,codeContent,crossrefBodyCanEnd,delimitedTable,dropPositions,extendsGrapheme,indentColumns,inlineOpaqueEnds,isCarveWhitespace,linkDestinationValue,markAboveContentColumn,markSecondLineLazy,normalizeNewlines,replaceLoneSurrogates,setDelimitedPayloadLines,sliceColumns,toCodepointPositions,trimEndNonNbsp,trimEndSpaceTab,unescapeAttrValue,utf8ByteLength,verbatimSpanEnd }
export type { Admonition,Attrs,BlockNode,BlockQuote,CarveExtension,CitationGroup,CodeBlock,DefinitionList,Directive,Div,Document,Emphasis,Figure,FigureGroup,Heading,HeadingLevel,Image,InlineMatch,InlineNode,InlineScannerSession,LineBlock,LineBlockHost,List,MatcherContext,Math,Paragraph,Position,SmartPunctuation,Table,TableBlockHost,Text,ThematicBreak,VerbatimCellWrap }

import type { PrepassScope } from './parse-prepass-core.js'
import {
  FENCE_TRAILING_WS,
  LAZY_FRAME,
  RE_ABBR_DEF,
  RE_ADMONITION_CLOSE,
  RE_ADMONITION_OPEN,
  RE_BLOCKQUOTE,
  RE_COMMENT_BLOCK,
  RE_COMMENT_LINE,
  RE_CONTAINER_PREFIX,
  RE_DEFLIST_TERM,
  RE_DIV_OPEN,
  RE_FENCE,
  RE_FOOTNOTE_DEF,
  RE_HARDBREAKS_OPEN,
  RE_HEADING,
  RE_HR,
  RE_LINE_BLOCK_OPEN,
  RE_LINK_DEF,
  RE_ORDERED,
  RE_QUOTE_BLOCK_OPEN,
  RE_RAW_FENCE,
  RE_TABLE_CONT,
  RE_TASK,
  RE_UNORDERED,
  RE_VALID_ADMONITION_OPEN,
  attachBlockPos,
  composeContainerPrefix,
  containerQuoteDepth,
  extractItemAttr,
  isBlockAttributeLine,
  isColonFenceOpener,
  isContinuationMarker,
  isLinkDefLine,
  isListMarkerLine,
  isTableRow,
  leadingWhitespace,
  lineOpensBlock,
  peekBlockAttributes,
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

import {
  RE_CAPTION,
  RE_COMMENT_BLOCK_ANY,
  RE_DEFLIST_DEF,
  RE_FENCE_CLOSER,
  blockQuoteParagraphOpen,
  bottomBlockLeavesParagraphOpen,
  colonBlockOpenerRun,
  colonFenceOpenerLen,
  colonFenceShapeEndsLazyContinuation,
  commentFenceRun,
  demoteQuotedColonCandidates,
  endsInPlus,
  fenceCloseRe,
  fenceCloserMemoRefutes,
  fenceHasCloser,
  hostedAuthoredBlockOpener,
  isBlockImageLine,
  markerLineBottomBlock,
  markerLineQuoteState,
  markerLineState,
  markerPrefixLength,
  opaqueGroupCloser,
  opensCodeFence,
  opensWrappedAttributeBlock,
  prefixWalkBound,
  quotePrefixLength,
  quotedLineText,
  startsInterruptingBlock,
  trackBlockQuoteLazyState,
  trackWrappedAttributeRun,
  walkContainerPrefix,
} from './parse-quote-core.js'
import type { BlockQuoteLazyState, OpaqueGroup, QuotedFenceCloserMemo } from './parse-quote-core.js'
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
  fenceHasCloser,
  hostedAuthoredBlockOpener,
  imageIsBlock,
  isBlockImageLine,
  markerLineBottomBlock,
  markerLineQuoteState,
  markerLineState,
  markerPrefixLength,
  opaqueGroupCloser,
  openQuoteDepth,
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
} from './parse-quote-core.js'
export type {
  BlockQuoteLazyMode,
  BlockQuoteLazyState,
  FenceCloserMemoEntry,
  OpaqueGroup,
  QuoteDescent,
  QuoteFenceHosts,
  QuoteLazyHint,
  QuotedFenceCloserMemo,
} from './parse-quote-core.js'
