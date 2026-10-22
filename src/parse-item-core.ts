import { AppendOnlyCloser } from './append-only-closer.js'
import { type AbbreviationDef, type TaskState } from './ast.js'
import { AttachmentFenceClosers, FailedScanRanges } from './attachment-fence-closers.js'
import {
  coveredNoteComment,
  dropTrailingWhitespace,
  FOOTNOTE_BODY_COLUMN,
  insideOpenFence,
  isParentAuthoredBlock,
  type ItemLazyState,
  lineOpensItemBlock,
  markerNoteCommentFenceOpeners,
  markerNoteFenceReach,
  markerNoteOpenerReach,
  quotePrefixDepth,
  sourceColumn,
  sourceQuotePrefixEnd,
  trackItemLazyState,
  verbatimOnlyLazyState,
} from './parse-block-boundaries.js'
import {
  bodyHoldsOpenCommentSpan,
  buildCloserIndex,
  type CloserIndex,
  codeCloserPossible,
  commentBlockHasCloser,
  exactCloserPossible,
  itemFenceHasCloser,
  literalCommentHasCloser,
  markerContentColumn,
  markerFreeContent,
  nestedSubLexer,
  newCommentSpanScan,
  orderedMatch,
  type RefusedContinuationMarker,
  subLexer,
  taskMatch,
  unorderedMatch,
} from './parse-block-scan-core.js'
import { indentColumns, isBlankLine, layoutWork, Lexer, sliceColumns, TRAILING_WS } from './parse-lexer.js'
import {
  attachBlockPos,
  extractItemAttr,
  isBlockAttributeLine,
  isColonFenceOpener,
  isContinuationMarker,
  isLinkDefLine,
  isListMarkerLine,
  isTableRow,
  LAZY_FRAME,
  leadingWhitespace,
  lineOpensBlock,
  peekBlockAttributes,
  RE_ABBR_DEF,
  RE_ADMONITION_CLOSE,
  RE_ADMONITION_OPEN,
  RE_BLOCKQUOTE,
  RE_COMMENT_BLOCK,
  RE_COMMENT_LINE,
  RE_DEFLIST_TERM,
  RE_DIV_OPEN,
  RE_FENCE,
  RE_FOOTNOTE_DEF,
  RE_HARDBREAKS_OPEN,
  RE_HEADING,
  RE_HR,
  RE_LINE_BLOCK_OPEN,
  RE_ORDERED,
  RE_QUOTE_BLOCK_OPEN,
  RE_RAW_FENCE,
  RE_TASK,
  RE_UNORDERED,
  stripLazyFrame,
} from './parse-prepass-core.js'
import {
  blockQuoteParagraphOpen,
  bottomBlockLeavesParagraphOpen,
  colonBlockOpenerRun,
  colonFenceOpenerLen,
  colonFenceShapeEndsLazyContinuation,
  commentFenceRun,
  endsInPlus,
  fenceCloseRe,
  fenceHasCloser,
  markerLineBottomBlock,
  markerLineQuoteState,
  markerLineState,
  markerPrefixLength,
  opensCodeFence,
  prefixWalkBound,
  quotedLineText,
  quotePrefixLength,
  RE_CAPTION,
  RE_DEFLIST_DEF,
  RE_FENCE_CLOSER,
  startsInterruptingBlock,
  trackBlockQuoteLazyState,
  walkContainerPrefix,
} from './parse-quote-core.js'

/** A colon run, whichever of the colon-fence blocks it goes on to open. */
export const RE_COLON_RUN = /^:{3,}/

/** PART 11 §6g. A checked box records nothing: `[X]` and `[x]` are one state. */
export function authoredTaskState(state: string, checked: boolean): TaskState | undefined {
  if (checked || state === ' ') return undefined
  return state as TaskState
}

export const RE_FIRST_BLOCK_MARKER = new RegExp('^[ \\t]*\\+' + TRAILING_WS)

export function isPhysicalContinuationMarker(line: string): boolean {
  return /^(?:> )*\+[ \t]*$/.test(line)
}

export function isStackedFirstBlockQuoteMarker(line: string): boolean {
  return /^[ \t]*(?:(?:[-*] (?:\[[ xX]\] )?|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z])[.)] )+|: +|\[\^[^\]]+\]: +)(?:> )+\+[ \t]*$/.test(line.replace(/^(?:> )+/, ''))
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
 * A verbatim fence a DESCENDANT of a list item holds open, with its base.
 *
 * No comment arm: `commentFenceRun` accepts an INDENTED delimiter
 * (markup-carve/carve-js#816), so the item's own tracker already opens on a
 * descendant's `%%%` and a fence-shaped line in that payload is already body.
 * Tracking it here as well moved nothing over 1968 corpus documents and 13776
 * generated shapes.
 */
export interface DescendantOpaque { close: RegExp; base: number; markerLine?: boolean; holder?: number }

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

export function sourceQuoteBody(line: string): string {
  let offset = 0
  for (let end = sourceQuotePrefixEnd(line, offset); end >= 0; end = sourceQuotePrefixEnd(line, offset)) offset = end
  const body = line.slice(offset)
  return body.slice(leadingWhitespace(body))
}

/** The text after `levels` source quote prefixes, which may sit behind a host's indentation, or null. */
export function sourceQuoteRest(line: string, levels: number): string | null {
  let offset = 0
  for (let level = 0; level < levels; level++) {
    const end = sourceQuotePrefixEnd(line, offset)
    if (end < 0) return null
    offset = end
  }
  return line.slice(offset)
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

/**
 * The columns a stacked marker line's first-block `+` takes a follower at, after `levels` host
 * quote prefixes: the line's own column, and the column of a quote its first marker opens
 * (CARVE-P9-067, carve#3421 item 5). A deeper opener's column is refused.
 */
export function stackedOpenerColumns(line: string, levels: number): number[] {
  let offset = 0
  for (let level = 0; level < levels; level++) {
    const end = sourceQuotePrefixEnd(line, offset)
    if (end < 0) return []
    offset = end
  }
  while (line[offset] === ' ' || line[offset] === '\t') offset++
  const columns: number[] = []
  const opener = /^(?:[-*] (?:\[[ xX]\] )?|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z])[.)] |> )/
  for (let match = opener.exec(line.slice(offset)); match !== null; match = opener.exec(line.slice(offset))) {
    if (columns.length === 1 && match[0] !== '> ') break
    columns.push(sourceColumnAt(line, offset))
    if (columns.length === 2) break
    offset += match[0].length
    while (line[offset] === ' ') offset++
  }
  return columns
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
      const sibling = follower !== undefined && quotePrefixDepth(follower) === depth &&
        followerColumn === markerColumn &&
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
  if (firstBlock && sourceColumn(line, 0) === 0) return !isListMarkerLine(line)
  if (quoteLevels === Infinity) {
    let offset = 0
    for (let end = sourceQuotePrefixEnd(line, offset); end >= 0; end = sourceQuotePrefixEnd(line, offset)) offset = end
    return indentColumns(line.slice(offset)) === markerColumn
  }
  const column = sourceColumn(line, quoteLevels)
  return column === markerColumn
}

/** Is the next line the column-0 list a first-block marker refuses (CARVE-P9-067)? */
export function firstBlockRefusesList(lexer: Lexer): boolean {
  const line = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1]
  return line !== undefined && sourceColumn(line, 0) === 0 && isListMarkerLine(line)
}

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
  firstBlockRefusesList,
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
  stackedOpenerColumns,
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
