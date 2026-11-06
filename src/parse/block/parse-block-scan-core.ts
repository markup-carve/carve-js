import { type Comment, GENERATED_CONTENT_KINDS, type InlineNode } from '../../ast.js'
import { type CarveExtension } from '../../extension.js'
import { type AsciiHeadingIdMode } from '../../heading/heading-ids.js'
import { visitInlineChildren } from '../inline/inline-children.js'
import { indentColumns, isBlankLine, layoutWork, Lexer } from '../parse-lexer.js'
import {
  containerQuoteDepth,
  extractItemAttr,
  FENCE_TRAILING_WS,
  isListMarkerLine,
  leadingWhitespace,
  type PrepassScope,
  RE_ADMONITION_CLOSE,
  RE_ADMONITION_OPEN,
  RE_FENCE,
  RE_COMMENT_LINE,
  RE_HARDBREAKS_OPEN,
  RE_LINE_BLOCK_OPEN,
  RE_ORDERED,
  RE_QUOTE_BLOCK_OPEN,
  RE_RAW_FENCE,
  RE_TASK,
  RE_UNORDERED,
  stripLazyFrame,
} from '../parse-prepass-core.js'
import {
  colonFenceOpenerLen,
  commentFenceRun,
  fenceCloseRe,
  markerPrefixLength,
  payloadFenceHasCloser,
  prefixWalkBound,
  RE_COMMENT_BLOCK_ANY,
  RE_FENCE_CLOSER,
} from './parse-quote-core.js'
import { ScopedFenceClosers } from './scoped-fence-closers.js'
import { FOOTNOTE_BODY_COLUMN } from './parse-block-boundaries.js'
import { trimEndSpaceTab, trimNonNbsp } from '../../trim-non-nbsp.js'

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
  /** An inline comment in a paragraph dropped for holding only comments; the tree keeps no node for it. */
  onDroppedComment?: (comment: Comment) => void
  /** Reports a block opener PART 0 S3 opened past its owner's content column. */
  onOverindentedOpener?: (opener: OverindentedOpenerReport) => void
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

export interface OverindentedOpenerReport {
  line: number
  column: number
  kind: string
  owner: string
  contentColumn: number
  authoredColumn: number
}

export interface RefusedContinuationMarker {
  line: number
  column: number
  host: 'document' | 'list item' | 'definition description' | 'footnote' | 'block quote'
  reason: 'blank' | 'document' | 'sibling' | 'left' | 'right' | 'wrong-column' | 'list' | 'unclaimed' | 'claimed'
  firstBlock?: boolean
}

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
  sub.nested = true
  sub.documentLineCount = parent.documentLineCount
  sub.documentRoot = parent.documentRoot ?? parent
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
  sub.hostTaskMarker = parent.hostTaskMarker
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

export const RE_AFTER_TERM = /^[ \t]*(?:::(?!:)|:)[ \t]/

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
export function commentBlockHasCloser(_lexer: Lexer, _fence: number, _after?: number): boolean {
  return true
}

/** PART 0 S1 asks for a closer ahead in the DOCUMENT, so a body also sees those past its hosts (carve#4770). */
export function commentCloserAhead(_lexer: Lexer, _fence: number, _after?: number): boolean {
  return true
}

/** Remember each container boundary across its comment openers. */
export type CommentScopeMemo = Map<string, { from: number; end: number }>

/**
 * The first line after `from` that leaves the opener's container, which ends an
 * open comment span under PART 0 S1 (a nonblank line that misses the owner, or
 * the end of a quote at a blank). Memoized per container, so a run of spans in
 * one container stays linear.
 */
export function commentSpanScopeEnd(
  lexer: Lexer,
  from: number,
  scope: PrepassScope,
  memo: CommentScopeMemo,
): number {
  // The ownership pass may have moved the opener's own line below the column; it reads at its own.
  const strip = (raw: string) => raw.replace(/^(?:>(?: |$))+/, '')
  const opener = strip(lexer.lineAt(from) ?? '')
  const column = Math.min(scope.contentCol, Math.max(opener.indexOf('%'), 0))
  const key = `${scope.quoteDepth}|${column}`
  const e = memo.get(key)
  if (e !== undefined && from >= e.from && from < e.end) return e.end
  let end = lexer.lineCount
  for (let i = from + 1; i < lexer.lineCount; i++) {
    const raw = lexer.lineAt(i)!
    if (isBlankLine(raw)) {
      if (scope.quoteDepth > 0) {
        end = i
        break
      }
      continue
    }
    if (containerQuoteDepth(raw) < scope.quoteDepth ||
      (column > 0 && indentColumns(strip(raw), column) < column)) {
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
export function quotedCommentHasCloser(_lexer: Lexer, _fence: number, _fromIndex: number): boolean {
  return true
}

export function literalCommentHasCloser(_lexer: Lexer, _width: number, _from: number, _depth: number, _floor: number): boolean {
  return true
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
  /** `owner`: the body column of a span opened on a description or note lead (or a list marker, with `markerOwners`); a line below it ends the span (PART 0 S1). */
  opaque: { comment: boolean; char: string; run: number; owner?: number; start?: number } | null
  atBlockStart: boolean
  /** The last body line of each delimiter width, for `bodyHoldsClosableCommentSpan`. */
  runs?: { indexed: number; last: Map<number, number> }
  /** Columns of the lines read so far, nearest last, each with whether it is a `::`/`:` entry line. */
  entries?: Array<[number, boolean]>
  /** Whether a span opened behind list markers is owned by the bottom item, so a line below its column ends it. */
  markerOwners?: boolean
}

const RE_NOTE_LEAD = /^\[\^[^\]]+\]: +(?=[^ \t])/
const RE_DESCRIPTION_LEAD = /^: +(?=[^ \t])/

// A `: ` lead opens a description only under an entry at its column (`::` or `:` above).
function descriptionLeadOpens(entries: Array<[number, boolean]>, column: number): boolean {
  for (let k = entries.length - 1; k >= 0; k--) if (entries[k]![0] <= column) return entries[k]![0] === column && entries[k]![1]
  return false
}

export const newCommentSpanScan = (): CommentSpanScan => ({ index: 0, opaque: null, atBlockStart: true })

export function bodyHoldsOpenCommentSpan(
  lines: readonly string[],
  scan: CommentSpanScan,
  // Openers with no closer anywhere: each is one line comment (§28) and opens no span.
  degraded?: ReadonlySet<number> | ((index: number, run: number) => boolean),
): boolean {
  const isDegraded = typeof degraded === 'function' ? degraded : (index: number) => degraded?.has(index) === true
  const entries = scan.entries ??= []
  for (; scan.index < lines.length; scan.index++) {
    const raw = stripLazyFrame(lines[scan.index]!)
    const line = raw.replace(/^[ \t]+/, '')
    const column = line === '' ? 0 : indentColumns(raw)
    const owner = scan.opaque?.owner
    if (owner !== undefined && line !== '' && !line.startsWith('%%') && (column < owner || raw !== lines[scan.index])) {
      scan.opaque = null
      scan.atBlockStart = true
    }
    // A description or note marker line opens a body, so a span on it is that body's (carve#4996).
    const lead = scan.opaque === null && line !== ''
      ? RE_NOTE_LEAD.exec(line) ?? (descriptionLeadOpens(entries, column) ? RE_DESCRIPTION_LEAD.exec(line) : null)
      : null
    if (line !== '') {
      while (entries.length > 0 && entries.at(-1)![0] >= column) entries.pop()
      entries.push([column, /^::? /.test(line)])
    }
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
    // A marker line opens an item even after paragraph text, so its first block is read behind the marker (carve#5028).
    const opensItem = scan.atBlockStart || (raw === lines[scan.index] && isListMarkerLine(line))
    const opener = lead !== null ? markerFreeContent(line.slice(lead[0].length)) : opensItem ? markerFreeContent(line) : line
    scan.atBlockStart = false
    const code = RE_FENCE.exec(opener) ?? RE_RAW_FENCE.exec(opener)
    if (code !== null) {
      const marker = RE_FENCE.test(opener) ? code[2]! : code[1]!
      scan.opaque = { comment: false, char: marker[0]!, run: marker.length }
      continue
    }
    const comment = commentFenceRun(opener)
    if (comment !== undefined && !isDegraded(scan.index, comment)) {
      scan.opaque = { comment: true, char: '%', run: comment, start: scan.index }
      if (lead !== null) scan.opaque.owner = column + (lead[0][0] === '[' ? FOOTNOTE_BODY_COLUMN : lead[0].length)
      // Behind list markers the span is the bottom item's (PART 0 S1).
      else if (scan.markerOwners === true && opener !== line) scan.opaque.owner = stackedItemContentColumn(raw)
    }
  }

  return scan.opaque?.comment === true
}

/** As `bodyHoldsOpenCommentSpan`, but an opener with no exact-width closer ahead is one line comment (CARVE-P9-053). */
export function bodyHoldsClosableCommentSpan(
  lines: readonly string[],
  scan: CommentSpanScan,
  hasCloser: (run: number) => boolean,
): boolean {
  const runs = scan.runs ??= { indexed: 0, last: new Map() }
  for (; runs.indexed < lines.length; runs.indexed++) {
    const run = commentFenceRun(stripLazyFrame(lines[runs.indexed]!).replace(/^[ \t]+/, ''))
    if (run !== undefined) runs.last.set(run, runs.indexed)
  }
  const last = runs.last
  return bodyHoldsOpenCommentSpan(lines, scan, (index, run) => (last.get(run) ?? -1) <= index && !hasCloser(run))
}

// Block comment: a `%%%`+ opener, closed by a line whose delimiter run has the
// SAME length (more `%` nest). Not rendered.
export function commentLineContent(line: string): string {
  return trimEndSpaceTab(line.replace(/^[ \t]*%%/, '').replace(/^ /, ''))
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
): boolean {
  const fenceText = literalOwnerLine === undefined ? text : text.replace(/^[ \t]+/, '')
  const rawOpen = RE_RAW_FENCE.exec(fenceText)
  const codeOpen = rawOpen === null ? RE_FENCE.exec(fenceText) : null
  const marker = rawOpen?.[1] ?? codeOpen?.[2]
  if (marker !== undefined) {
    // A code opener opens whether or not it closes; its payload is opaque, so
    // no host closer ends it. A line-block payload run pairs only with a closer.
    if (lexer.quoteLazyLines.has(lexer.lineNumber(lineIndex))) return false
    if (literalOwnerLine !== undefined && !payloadFenceHasCloser(lexer, marker)) return false
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
      if (literalOwnerLine === undefined && !bandCloser && !isBlankLine(innerText) && indentColumns(innerText) < openerColumn) break
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
      const closes = commentClose !== null && commentClose[1]!.length === fence
      // A visible line short of this span's owner ends the span under S1.
      // The colon container then classifies that same line as its own closer.
      if (!closes && literalOwnerLine === undefined && !isBlankLine(innerText) &&
          !innerText.trimStart().startsWith('%%') && indentColumns(innerText) < indentColumns(text)) break
      // Any other lazy line misses the span's owner and ends the span (PART 0 S1); an
      // item's comment-shaped lazy line stays payload (carve#4994).
      const number = lexer.lineNumber(innerLineIndex)
      if (!closes && literalOwnerLine !== undefined && (lexer.quoteLazyLines.has(number) ||
          (lexer.itemLazyLines.has(number) && !RE_COMMENT_LINE.test(innerText)))) break
      lexer.consume()
      lines.push({ text: innerText, lineIndex: innerLineIndex })
      if (closes) break
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
  while (!lexer.eof()) {
    if (layoutWork.on) layoutWork.colonLines++
    const lineIndex = lexer.pos
    const text = lexer.peek()!
    if (consumeOpaqueColonFenceBodySpan(lexer, lines, lineIndex, text)) continue
    const close = RE_ADMONITION_CLOSE.exec(text)

    if (close && close[1]!.length === stack[stack.length - 1]?.fenceWidth) {
      lexer.consume()
      const closed = stack.pop()!
      index.set(base + closed.lineIndex, base + lineIndex)
      if (stack.length === 0) break
      lines.push({ text, lineIndex })
      continue
    }

    lexer.consume()
    lines.push({ text, lineIndex })
    if (stack.at(-1)!.kind === 'line block') continue
    const openerLen = colonFenceOpenerLen(text)
    if (openerLen !== null) {
      stack.push({
        kind: colonFenceKind(text),
        lineIndex,
        fenceWidth: openerLen,
      })
    }
  }

  for (const unclosed of stack) index.set(base + unclosed.lineIndex, base + lexer.pos)
  for (const unclosed of stack.slice(0, Math.max(0, MAX_NESTING_DEPTH - lexer.depth))) {
    lexer.reportUnclosedContainer(unclosedContainerFromOpener(lexer, unclosed))
  }
  return lines
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

export const RE_UNORDERED_HEAD = /^(?=([ \t]*))\1[-*] +(?! )(?=[ \t]*[^ \t])/

export const RE_ORDERED_HEAD = /^(?=([ \t]*))\1(?![A-Za-z]+\. (?! ))([0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))([.)]) +(?! )(?=[ \t]*[^ \t])/

export const RE_TASK_HEAD = /^(?=([ \t]*))\1[-*] +\[([ xX\-_>/!?])\] +[ \t]*(?=[^ \t])/

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

// The visual content column of a list-marker line (`- x` -> 2, `1. x` -> 3,
// `- [ ] x` -> 6), or -1 if the line is not a list marker. Each marker regex
// captures the item content as its LAST group, so the content column is the
// column width of everything before that content. Used to relate a parsed
// child list to the authored paragraph column (carve#322).
/** The content column of the bottom item of a line's marker stack, or -1 when the line has no marker. */
export function stackedItemContentColumn(line: string): number {
  const bound = prefixWalkBound(line)
  let bottom = -1
  let at = 0
  for (let width = markerPrefixLength(line, at, bound); width > 0; width = markerPrefixLength(line, at, bound)) {
    bottom = at
    at += width
  }
  if (bottom < 0) return -1
  const segment = line.slice(bottom, at)
  const lead = segment.length - segment.replace(/^[ \t]+/, '').length
  return indentColumns(line.slice(0, bottom + lead).replace(/[^ \t]/g, ' ') + 'x') +
    markerContentColumn(segment.slice(lead) + 'x')
}

export function markerContentColumn(line: string, terminatorFree = false, knownColumn?: number): number {
  // Mirror parseList's own content-column computation so the parsed-child check
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
