import type { GroupCloserMemo, ItemLazyState } from '../parse.js'
import { Lexer, indentColumns, isBlankLine, sliceColumns } from './parse-lexer.js'
import type { rebaseHelpers } from '../parse.js'

export function createRebasePass(helpers: typeof rebaseHelpers) {
  const {
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
  } = helpers
function paragraphTextLine(line: string): boolean {
  const text = line.trimStart()
  return bottomBlockLeavesParagraphOpen(text) && !lineOpensBlock(text)
}

type QuoteState = NonNullable<ReturnType<typeof markerLineQuoteState>>

const BREAK = -1

// One rebase pass: the host's options plus the scan state carried across lines.
interface RebaseRun {
  lines: string[]
  eligible?: ReadonlySet<number> | undefined
  includeSublists: boolean
  hostIsFootnoteBody: boolean
  onFenceBodyLine?: ((index: number) => void) | undefined
  onUnclosedCodeFence?: (() => void) | undefined
  takenBelowColumn?: ReadonlySet<number> | undefined
  markerColonOwnsExtent: boolean
  sourceLines?: readonly (string | undefined)[] | undefined
  tabFenceColumns?: ReadonlyMap<number, number> | undefined
  noteParagraph?: { markers?: ReadonlySet<number>, markerBody?: boolean } | undefined
  itemParagraphFences?: ReadonlySet<number> | undefined
  lazyParagraphFences?: ReadonlySet<number> | undefined
  descriptionItem: boolean
  stripLeftCodePrefix: boolean
  foldsMarkers: boolean
  authoredOpeners?: ReadonlySet<number> | undefined
  hostOwnedBlockStarts?: ReadonlySet<number> | undefined
  termSourceLines?: readonly (string | undefined)[] | undefined
  termHostContentColumn: number
  ownedBlanks: Set<number>
  groupCloserMemos: Map<number, GroupCloserMemo>
  closeComment: (width: number, index: number) => number
  closeColonComment: (width: number, index: number) => number
  probe: () => Lexer
  ownedColumn: number
  ownedMarkerBase: number
  ownedParagraphOpen: boolean
  markerColonEnd: number
  inlineLeadPayload: boolean
  childColonWidth: number | null
  leadCommentBase: number
  markerColonNestedBody: Set<number>
  absorbingColonParagraph: boolean
  footnoteParagraphOpen: boolean
  foldedMarkers: Set<number>
  paragraphOwnedNotes: Map<number, number>
}

// The run of lines one authored opener takes, and the lines it leaves where the host put them.
interface RebaseGroup {
  end: number
  held: Set<number>
  noteReturnsToParagraphOwner: boolean
}

interface DefinitionRun {
  base: number
  authoredBase: number
  sourceTermHostColumn: number
  end: number
  descriptionColumn: number | null
  descriptionState?: ItemLazyState | undefined
  descriptionFenceClaimsBelow: boolean
  closerMemos: Map<string, GroupCloserMemo>
  termOpen: boolean
  termFloorText: boolean
  foldedSeparator: boolean
  returnedSeparator: boolean
}

interface NoteRun {
  base: number
  quoteOpener: boolean
  runColumn: number
  authoredBodyColumn?: number | undefined
  ownerBase?: number | undefined
  quoted: QuoteState | null
  returnedToHost: boolean
}

function extend(target: { end: number }, j: number): number {
  target.end = j
  return j
}

function memoAt(run: RebaseRun, column: number): GroupCloserMemo {
  let memo = run.groupCloserMemos.get(column)
  if (memo === undefined) run.groupCloserMemos.set(column, memo = { verbatim: new Map(), comment: new Map() })
  return memo
}

// A comment fence keeps its body and closer, whatever they look like.
function skipCommentBody(run: RebaseRun, text: string, j: number): number {
  const width = commentFenceRun(text)
  if (width === undefined) return j
  const close = run.closeComment(width, j)
  return close > j ? close : j
}

function mayRebase(lines: string[], eligible: ReadonlySet<number> | undefined): boolean {
  const firstVisible = lines.find((line) => !isBlankLine(line))
  const firstMarkerColumn = firstVisible === undefined ? -1 : markerContentColumn(firstVisible)
  if (firstMarkerColumn < 0) return true
  return lines.some((line, index) => {
    if (isBlankLine(line) || (eligible && !eligible.has(index))) return false
    return isParentAuthoredBlock(line, firstMarkerColumn, index > 0 && isBlankLine(lines[index - 1]!))
  })
}

function markerColonLeadTakes(run: RebaseRun, i: number, line: string, base: number): boolean {
  const text = line.trimStart()
  if (!(run.ownedColumn >= 0 && base >= run.ownedColumn)) {
    const childColumn = markerContentColumn(line)
    if (childColumn >= 0) run.ownedColumn = childColumn
  }
  if (RE_COMMENT_LINE.test(text) && base > 0) run.leadCommentBase = base
  if (run.leadCommentBase >= 0 && base >= run.leadCommentBase && RE_FOOTNOTE_DEF.test(text)) return true
  if (run.ownedColumn >= 0 && base >= run.ownedColumn) {
    run.ownedParagraphOpen = false
    return true
  }
  return RE_ADMONITION_CLOSE.test(text) ||
    (base > 0 && (run.markerColonNestedBody.has(i) || (!RE_FOOTNOTE_DEF.test(text) && !RE_LINK_DEF.test(text))))
}

// A deeper item owns this line. Its own collector will see the line after
// the intervening marker/content columns have been removed and will apply
// the authored-base rule in that coordinate system.
function deeperOwnerTakes(run: RebaseRun, i: number, line: string, base: number): boolean {
  if (run.ownedColumn < 0) return false
  const text = line.trimStart()
  if (base >= run.ownedColumn) {
    if (lineOpensItemBlock(text) || RE_COMMENT_LINE.test(text) || isBlockAttributeLine(text)) {
      const group = opensCodeFence(text) ? opaqueGroupCloser(text) : null
      if (group === null ||
          opaqueGroupCloses(group, run.lines, i + 1, base, run.takenBelowColumn, memoAt(run, base), run.ownedColumn))
        run.ownedParagraphOpen = false
    }
    return true
  }
  if (RE_COMMENT_LINE.test(line) && commentFenceRun(line) === undefined) {
    run.ownedParagraphOpen = false
    return true
  }
  if (run.childColonWidth !== null) {
    const close = RE_ADMONITION_CLOSE.exec(text)
    if (!(close?.[1]?.length === run.childColonWidth ||
        (lineOpensItemBlock(text) && !opensCodeFence(text) && !RE_COMMENT_LINE.test(text)))) return true
    run.childColonWidth = null
  }
  // A term on a descendant marker line can take an under-column continuation.
  // That continuation does not release the containing item: a later line at
  // its content column still belongs to it.
  if (base > 0 && run.ownedParagraphOpen &&
      (!lineOpensItemBlock(text) || RE_DEFLIST_DEF.test(text))) return true
  // An unmatched fence below a child's column continues its paragraph. Keep
  // the child column so a later line at that column is still the child's.
  return run.ownedParagraphOpen && opensCodeFence(text) &&
    !opaqueGroupCloses(opaqueGroupCloser(text)!, run.lines, i + 1, base, run.takenBelowColumn, memoAt(run, base))
}

// Null when an open owner (child item, marker-colon lead, folded note) takes
// the line; otherwise the line's base column, with every owner released.
function releasedLine(run: RebaseRun, i: number, line: string): { base: number, belowOwnedChild: boolean } | null {
  if (run.noteParagraph?.markerBody) {
    const text = line.trimStart()
    if (run.footnoteParagraphOpen && isListMarkerLine(text)) return null
    run.footnoteParagraphOpen = !lineOpensItemBlock(text) && !RE_COMMENT_LINE.test(text)
  }
  const inLead = i <= run.markerColonEnd
  if (inLead && run.takenBelowColumn?.has(i) && opensCodeFence(line.trimStart())) run.inlineLeadPayload = true
  if (run.inlineLeadPayload && inLead) return null
  if (run.eligible && !run.eligible.has(i)) return null
  if (run.authoredOpeners?.has(i)) run.ownedColumn = -1
  const cap = run.ownedColumn >= 0 ? run.ownedColumn + 1 : Infinity
  const base = indentColumns(line, cap)
  if (inLead && markerColonLeadTakes(run, i, line, base)) return null
  if (deeperOwnerTakes(run, i, line, base)) return null
  const belowOwnedChild = run.ownedColumn >= 0
  if (belowOwnedChild && run.ownedParagraphOpen && RE_FOOTNOTE_DEF.test(line.trimStart()))
    run.paragraphOwnedNotes.set(i, run.ownedMarkerBase)
  run.ownedColumn = -1
  run.ownedMarkerBase = -1
  run.ownedParagraphOpen = false
  // Folded note text owns deeper lines without opening a child list.
  if (run.noteParagraph?.markers?.has(i)) {
    run.ownedColumn = base + 1
    return null
  }
  return { base, belowOwnedChild }
}

function takeMarkerLine(run: RebaseRun, i: number, line: string, base: number, markerColumn: number, belowOwnedChild: boolean): void {
  if (run.foldsMarkers && !belowOwnedChild && i > 0 &&
      (run.foldedMarkers.has(i - 1) || paragraphTextLine(run.lines[i - 1]!))) {
    // Folded text opens no item, so a deeper line is read in the body itself.
    run.foldedMarkers.add(i)
    return
  }
  run.ownedColumn = markerColumn
  run.ownedMarkerBase = base
  const childContent = markerFreeContent(line.trimStart())
  run.ownedParagraphOpen = bottomBlockLeavesParagraphOpen(childContent) &&
    colonFenceOpenerLen(childContent) === null && !opensCodeFence(childContent) ||
    RE_DEFLIST_TERM.test(childContent)
  run.childColonWidth = colonFenceOpenerLen(childContent)
}

function skipBaseQuoteOrLineBlock(run: RebaseRun, i: number, line: string, base: number): number | undefined {
  if (base !== 0) return undefined
  const { lines } = run
  if (!run.includeSublists && RE_BLOCKQUOTE.test(line) && blockQuoteParagraphOpen(markerLineQuoteState(line)!)) {
    const quote = run.probe()
    quote.lines = lines
    quote.pos = i
    return rebasedQuoteEnd(lines, i, quote)
  }
  if (RE_LINE_BLOCK_OPEN.test(line)) {
    const payload = run.probe()
    payload.lines = lines
    payload.pos = i + 1
    collectLiteralColonFenceBody(payload, { kind: 'line block', lineIndex: i, fenceWidth: colonFenceOpenerLen(line.replace(/^[ \t]+/, ''))! })
    return payload.pos - 1
  }
  return undefined
}

// CARVE-P2-017 and section 10 I4: unmatched runs remain paragraph text.
// Inline code cannot hide later visible block openers in the description.
function isDescriptionParagraphFence(run: RebaseRun, i: number, line: string, base: number): boolean {
  if (!run.includeSublists || !run.itemParagraphFences?.has(i) || !opensCodeFence(line.trimStart())) return false
  const group = opaqueGroupCloser(line.trimStart())!
  const closesAt = (column: number): boolean =>
    opaqueGroupCloses(group, run.lines, i + 1, column, run.takenBelowColumn, memoAt(run, column))
  return !closesAt(base) && !closesAt(0)
}

// Opaque groups already at the container's minimum column still own
// their payload. Without advancing past them, a payload line that looks
// like a block opener is reconsidered as an authored base of its own.
// `~~~~ / one-space ``` / ~~~~` then loses that content space and the
// writer is not a fixed point.
function skipBaseOpaqueGroup(run: RebaseRun, i: number, line: string): number | undefined {
  const { lines } = run
  const code = RE_FENCE.exec(line) ?? RE_RAW_FENCE.exec(line)
  if (code) {
    const marker = RE_FENCE.test(line) ? code[2]! : code[1]!
    const close = fenceCloseRe(marker)
    let end = i
    for (let j = i + 1; j < lines.length; j++) {
      end = j
      if (close.test(lines[j]!)) break
    }
    return end
  }
  const comment = commentFenceRun(line)
  if (comment === undefined) return undefined
  // An unmatched fence is one comment line and owns no successor (§28).
  const close = run.closeComment(comment, i)
  return close < 0 ? i : close
}

function opensSublistItem(opener: string): boolean {
  return RE_ORDERED.test(opener) || RE_UNORDERED.test(opener) || RE_TASK.test(opener) || extractItemAttr(opener) !== null
}

function rebaseLine(run: RebaseRun, i: number): number {
  const line = run.lines[i]!
  if (isBlankLine(line)) {
    run.absorbingColonParagraph = false
    run.footnoteParagraphOpen = false
    run.ownedParagraphOpen = false
    return i
  }
  const released = releasedLine(run, i, line)
  if (released === null) return i
  const { base } = released
  const markerColumn = markerContentColumn(line)
  if (markerColumn >= 0) {
    takeMarkerLine(run, i, line, base, markerColumn, released.belowOwnedChild)
    return i
  }
  const skipped = skipBaseQuoteOrLineBlock(run, i, line, base)
  if (skipped !== undefined) return skipped
  const descriptionParagraphFence = isDescriptionParagraphFence(run, i, line, base)
  if (base === 0 && !descriptionParagraphFence) {
    const end = skipBaseOpaqueGroup(run, i, line)
    if (end !== undefined) return end
  }
  const opener = sliceColumns(line, base, true)
  if (base === 0 && /^:{3,}/.test(opener) && colonBlockOpenerRun(opener) === null) run.absorbingColonParagraph = true
  else if (base === 0 && hostedAuthoredBlockOpener(opener)) run.absorbingColonParagraph = false
  if (!lineOpensItemBlock(opener)) return i
  // Sublists already use the containment rule in the item collector. Their
  // residual indentation expresses another nesting level, not an authored
  // base to erase here.
  if (!run.includeSublists && opensSublistItem(opener)) return i
  return rebaseGroup(run, i, base, opener, descriptionParagraphFence)
}

// A definition list is one complete block, including every description
// body that reaches that description's own content column.  Measuring
// only to the separating blank made an ancestor claim the next opener as
// its sibling; measuring every line at the list's base made the opposite
// mistake and swallowed below-description content.  Ownership belongs to
// the innermost open body, so keep its exact column band here.
function definitionRunEnd(run: RebaseRun, i: number, base: number, opener: string, end: number): number {
  const { lines, sourceLines, termSourceLines } = run
  const authoredBase = sourceLines?.[i] === undefined ? base : sourceColumn(sourceLines[i]!)
  const def: DefinitionRun = {
    base,
    authoredBase,
    sourceTermHostColumn: termSourceLines?.[i] === undefined ? authoredBase : sourceColumn(termSourceLines[i]!),
    end,
    descriptionColumn: null,
    descriptionFenceClaimsBelow: false,
    closerMemos: new Map(),
    // A term has no content column of its own, so a line past the list's
    // base folds into an open term and is never an authored block
    // (carve#2411). Only a list marker still interrupts it (§24 C4).
    termOpen: RE_DEFLIST_TERM.test(opener),
    termFloorText: false,
    foldedSeparator: false,
    returnedSeparator: false,
  }
  for (let j = i + 1; j < lines.length; j++) {
    const next = definitionStep(run, def, j)
    if (next === BREAK) break
    j = next
  }
  return def.end
}

function definitionStep(run: RebaseRun, def: DefinitionRun, j: number): number {
  if (definitionSeparatorEnds(run, def, j)) return BREAK
  const candidate = run.lines[j]!
  if (isBlankLine(candidate)) return definitionBlank(run, def, j)
  const column = indentColumns(candidate)
  // A separator admitted below a marker-line term's host column is term
  // text. Keep that state when measuring the following authored block.
  if (def.termOpen && run.descriptionItem && !run.includeSublists &&
      RE_DEFLIST_DEF.test(candidate.trimStart()) && run.sourceLines?.[j] !== undefined &&
      sourceColumn(run.sourceLines[j]!) < run.termHostContentColumn) return extend(def, j)
  const belowDescription = definitionBelowDescription(run, def, j, column)
  if (belowDescription !== undefined) return belowDescription
  return column < def.base ? definitionBelowBase(run, def, j, column) : definitionAtOrPastBase(run, def, j, column)
}

function definitionSeparatorEnds(run: RebaseRun, def: DefinitionRun, j: number): boolean {
  const candidate = run.lines[j]!
  const { sourceLines, termSourceLines } = run
  if (def.foldedSeparator && RE_DEFLIST_TERM.test(candidate.trimStart()) &&
      (sourceLines?.[j] === undefined || sourceColumn(sourceLines[j]!) >= run.termHostContentColumn)) return true
  if (candidate.startsWith(LAZY_FRAME) && RE_DEFLIST_DEF.test(stripLazyFrame(candidate).trimStart())) {
    def.returnedSeparator = true
    if (sourceLines?.[j] !== undefined && sourceColumn(sourceLines[j]!) === run.termHostContentColumn)
      def.foldedSeparator = true
  }
  return def.termOpen && def.returnedSeparator && run.authoredOpeners?.has(j) === true &&
    termSourceLines?.[j] !== undefined && sourceColumn(termSourceLines[j]!) > def.sourceTermHostColumn &&
    lineOpensItemBlock(candidate.trimStart())
}

function definitionBlank(run: RebaseRun, def: DefinitionRun, j: number): number {
  const { lines } = run
  def.descriptionFenceClaimsBelow = false
  if (def.termFloorText) return BREAK
  def.termOpen = false
  let k = j + 1
  while (k < lines.length && isBlankLine(lines[k]!)) k++
  if (k >= lines.length || k - j > 1) return BREAK
  const nextColumn = indentColumns(lines[k]!)
  const nextLocal = nextColumn < def.base ? '' : sliceColumns(lines[k]!, def.base, true)
  const continues =
    (def.descriptionColumn !== null && nextColumn >= def.descriptionColumn) ||
    (nextColumn === def.base && (RE_DEFLIST_TERM.test(nextLocal) || RE_DEFLIST_DEF.test(nextLocal)))
  if (!continues) return BREAK
  run.ownedBlanks.add(j)
  return extend(def, j)
}

function definitionBelowDescription(run: RebaseRun, def: DefinitionRun, j: number, column: number): number | undefined {
  const { descriptionColumn, descriptionState } = def
  if (descriptionColumn === null) return undefined
  const candidate = run.lines[j]!
  if (def.descriptionFenceClaimsBelow && descriptionState?.opaque?.kind === 'code' &&
      column < descriptionColumn && (opensCodeFence(candidate) || !lineOpensItemBlock(candidate))) return extend(def, j)
  if (descriptionState?.lazyFoldable) {
    const lazy = definitionLazyLine(run, def, j, column, descriptionColumn, descriptionState)
    if (lazy !== undefined) return lazy
  }
  if (column < descriptionColumn && colonFenceOpenerLen(candidate.trimStart()) !== null) return BREAK
  return undefined
}

function definitionLazyLine(
  run: RebaseRun, def: DefinitionRun, j: number, column: number, descriptionColumn: number, state: ItemLazyState,
): number | undefined {
  const candidate = run.lines[j]!
  const text = candidate.trimStart()
  // PART 0: a line that opens nothing continues the open description
  // paragraph lazily, whether the host took it from below its column or
  // it sits between the list's base and the description column.
  if ((run.takenBelowColumn?.has(j) ||
      (!def.termOpen && column >= def.base && column < descriptionColumn && !isContinuationMarker(candidate))) &&
      !lineOpensItemBlock(text) && !RE_COMMENT_LINE.test(text)) return extend(def, j)
  if (column >= descriptionColumn) return undefined
  if (!state.inlineFenceParagraph && opensCodeFence(text) &&
      !opaqueGroupCloses(opaqueGroupCloser(text)!, run.lines, j + 1, column, run.takenBelowColumn, memoAt(run, column)))
    return extend(def, j)
  if (RE_COMMENT_LINE.test(text)) {
    // X1 admits a below-column comment without ending its description.
    // The next line still chooses its owner by the description column.
    state.lazyFoldable = false
    return extend(def, skipCommentBody(run, text, j))
  }
  return undefined
}

function definitionBelowBase(run: RebaseRun, def: DefinitionRun, j: number, column: number): number {
  const candidate = run.lines[j]!
  const text = candidate.trimStart()
  const authoredColumn = run.sourceLines?.[j] === undefined ? column : sourceColumn(run.sourceLines[j]!)
  if (def.termOpen && !isListMarkerLine(text) &&
      (authoredColumn > def.authoredBase || (!lineOpensItemBlock(text) && !opensCodeFence(text))))
    return extend(def, skipCommentBody(run, text, j))
  return BREAK
}

function definitionAtOrPastBase(run: RebaseRun, def: DefinitionRun, j: number, column: number): number {
  const candidate = run.lines[j]!
  const local = sliceColumns(candidate, def.base, true)
  const atBase = column === def.base
  const description = atBase ? RE_DEFLIST_DEF.exec(local) : null
  if (atBase && (RE_DEFLIST_TERM.test(local) || description !== null)) return definitionEntryLine(def, j, description)
  if (def.termOpen && atBase && opensWrappedAttributeBlock(local)) {
    const attributes = run.probe()
    attributes.lines = run.lines
    attributes.pos = j
    if (peekBlockAttributes(attributes, local)) return BREAK
  }
  if (def.termOpen &&
      (column > def.base
        ? !isListMarkerLine(local.trimStart())
        : markerContentColumn(local) < 0 && !lineOpensItemBlock(local) && !RE_COMMENT_LINE.test(local))) {
    if (atBase) def.termFloorText = true
    return extend(def, skipCommentBody(run, sliceColumns(candidate, column, true), j))
  }
  def.termOpen = false
  if (def.descriptionColumn !== null && column >= def.descriptionColumn)
    return definitionBodyLine(run, def, j, column, def.descriptionColumn)
  return BREAK
}

// A description still belongs to the term after ordinary term text.
// A following term starts a separate authored block.
function definitionEntryLine(def: DefinitionRun, j: number, description: RegExpExecArray | null): number {
  if (def.termFloorText && description === null) return BREAK
  def.end = j
  def.termOpen = description === null
  if (description) {
    def.descriptionColumn = def.base + 1 + description[1]!.length
    def.descriptionState = verbatimOnlyLazyState()
    def.descriptionFenceClaimsBelow = false
    trackItemLazyState(description[2]!, def.descriptionState)
  }
  return j
}

function definitionBodyLine(run: RebaseRun, def: DefinitionRun, j: number, column: number, descriptionColumn: number): number {
  const { lines, takenBelowColumn } = run
  const text = lines[j]!.trimStart()
  const state = def.descriptionState
  run.onFenceBodyLine?.(j)
  const wasCodeFence = state?.opaque?.kind === 'code'
  const hadOpenParagraph = state?.lazyFoldable === true
  if (state) trackItemLazyState(text, state, () => {
    const group = opaqueGroupCloser(text)
    if (group === null) return false
    const closesAt = (atColumn: number): boolean => {
      const key = `${descriptionColumn}:${atColumn}`
      let memo = def.closerMemos.get(key)
      if (memo === undefined) {
        memo = { verbatim: new Map(), comment: new Map() }
        def.closerMemos.set(key, memo)
      }
      return opaqueGroupCloses(group, lines, j + 1, atColumn, takenBelowColumn, memo, descriptionColumn)
    }
    return closesAt(column) || closesAt(descriptionColumn)
  }, true, width => run.closeComment(width, j) > j)
  if (!wasCodeFence && state?.opaque?.kind === 'code')
    def.descriptionFenceClaimsBelow = hadOpenParagraph && column > descriptionColumn
  else if (state?.opaque?.kind !== 'code') def.descriptionFenceClaimsBelow = false
  return extend(def, j)
}

function paragraphFenceInterrupted(
  run: RebaseRun, i: number, base: number, opener: string, descriptionParagraphFence: boolean, line: string, index: number,
): boolean {
  const text = line.trimStart()
  if (RE_FENCE.test(opener) && indentColumns(line, base) < base && RE_COMMENT_LINE.test(text)) return true
  return (descriptionParagraphFence || run.lazyParagraphFences?.has(i) === true) && run.eligible?.has(index) === true &&
    (RE_HEADING.test(text) || RE_BLOCKQUOTE.test(text) || RE_HR.test(text) || isTableRow(text) ||
      colonFenceOpenerLen(text) !== null || (descriptionParagraphFence &&
        (RE_DEFLIST_TERM.test(text) || RE_DEFLIST_DEF.test(text) || isBlockAttributeLine(text))))
}

function codeGroupEnd(
  run: RebaseRun, i: number, base: number, opener: string, code: RegExpExecArray,
  sourceCodeBase: number | undefined, group: RebaseGroup, descriptionParagraphFence: boolean,
): void {
  const { lines, takenBelowColumn } = run
  // Only the item's own paragraph releases a differently indented list marker.
  const marker = RE_FENCE.test(opener) ? code[2]! : code[1]!
  if (!run.includeSublists && run.itemParagraphFences?.has(i) && sourceCodeBase === undefined) {
    run.onUnclosedCodeFence?.()
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j]!
      const column = indentColumns(candidate)
      if (column > 0 && column !== base && isListMarkerLine(candidate.trimStart())) break
      group.end = j
      run.onFenceBodyLine?.(j)
      if (takenBelowColumn?.has(j)) group.held.add(j)
    }
    return
  }
  if (sourceCodeBase !== undefined) {
    group.end = sourceCodeFenceEnd(lines, i, base, marker, group.held, takenBelowColumn,
      run.onFenceBodyLine, run.onUnclosedCodeFence, sourceCodeBase, run.sourceLines!)
    return
  }
  const interrupted = run.includeSublists && run.itemParagraphFences?.has(i)
    ? (line: string, index: number) => paragraphFenceInterrupted(run, i, base, opener, descriptionParagraphFence, line, index)
    : undefined
  group.end = rebasedCodeFenceEnd(lines, i, base, marker, group.held, takenBelowColumn,
    run.onFenceBodyLine, run.onUnclosedCodeFence, interrupted)
}

function commentGroupEnd(run: RebaseRun, i: number, base: number, comment: number, group: RebaseGroup): void {
  const { lines } = run
  const closeAt = run.closeComment(comment, i)
  for (let j = i + 1; j < lines.length; j++) {
    const candidate = lines[j]!
    if (!isBlankLine(candidate) && indentColumns(candidate, base) < base) break
    group.end = j
    if (!isBlankLine(candidate) && commentFenceRun(sliceColumns(candidate, base, true)) === comment) break
    if (j < closeAt) group.held.add(j)
  }
}

function colonGroupEnd(
  run: RebaseRun, i: number, base: number, opener: string, colon: NonNullable<ReturnType<typeof colonBlockOpenerRun>>, group: RebaseGroup,
): void {
  const { lines, includeSublists } = run
  const typedContainer = RE_ADMONITION_OPEN.test(opener) && !RE_ADMONITION_CLOSE.test(opener)
  group.end = rebasedColonGroupEnd(
    lines, i, base, colon, group.held,
    run.closeColonComment,
    memoAt(run, base),
    run.takenBelowColumn, run.onFenceBodyLine,
    !run.absorbingColonParagraph && (!includeSublists || typedContainer) ? run.markerColonNestedBody : undefined,
    (!includeSublists && run.descriptionItem && !RE_LINE_BLOCK_OPEN.test(opener)) || (includeSublists && typedContainer),
    !includeSublists,
    run.hostIsFootnoteBody,
  )
  if (run.markerColonOwnsExtent && i === 0 && base === 0 && !RE_LINE_BLOCK_OPEN.test(opener)) {
    run.markerColonEnd = group.end
    for (let j = i + 1; j <= group.end; j++) if (isBlankLine(lines[j]!)) run.ownedBlanks.add(j)
    group.end = i
  }
}

function quoteOrNoteRunEnd(run: RebaseRun, i: number, base: number, opener: string, group: RebaseGroup): void {
  const { lines } = run
  const isNote = RE_FOOTNOTE_DEF.test(opener)
  const ownerBase = run.paragraphOwnedNotes.get(i)
  // A final line below the nested note's own column returns to its parent.
  const note: NoteRun = {
    base,
    quoteOpener: RE_BLOCKQUOTE.test(opener),
    runColumn: isNote ? Math.max(base, FOOTNOTE_BODY_COLUMN) : base,
    authoredBodyColumn: isNote
      ? (ownerBase !== undefined ? sourceColumn(run.sourceLines?.[i] ?? lines[i]!) : indentColumns(lines[i]!)) + FOOTNOTE_BODY_COLUMN
      : undefined,
    ownerBase,
    // A QUOTE IS REACHED BY ITS MARKER, so the run ends where the quote stops
    // reaching: a line that carries no marker is the quote's only as the lazy
    // continuation of an OPEN PARAGRAPH (markup-carve/carve-js#2536). The
    // column test below answers the footnote body's question, and asking it of
    // a quote let one that ended in a table, a heading or a break claim every
    // indented line under it - so an over-indented table row below
    // `: > | a |` was never reconsidered as a block of its own, kept the
    // residual indent, and reached the page as prose. `rebasedQuoteEnd` is the
    // same reach the `!includeSublists` arm above already measures.
    quoted: isNote ? null : markerLineQuoteState(opener),
    returnedToHost: false,
  }
  for (let j = i + 1; j < lines.length; j++) {
    if (run.hostOwnedBlockStarts?.has(j)) note.returnedToHost = true
    if (noteRunStops(run, note, group, j)) break
    group.end = j
  }
}

function noteRunStops(run: RebaseRun, note: NoteRun, group: RebaseGroup, j: number): boolean {
  const candidate = run.lines[j]!
  if (isBlankLine(candidate)) return noteBlankStops(run, note, j)
  if (indentColumns(candidate, note.runColumn) < note.runColumn) {
    group.noteReturnsToParagraphOwner = note.authoredBodyColumn !== undefined &&
      note.ownerBase !== undefined && indentColumns(candidate) > note.ownerBase &&
      !lineOpensItemBlock(candidate.trimStart())
    return true
  }
  if (note.authoredBodyColumn !== undefined && authoredNoteBodyStops(run, note, group, j, note.authoredBodyColumn)) return true
  return note.quoted !== null && quotedLineStops(note.quoted, note.base, candidate)
}

function noteBlankStops(run: RebaseRun, note: NoteRun, j: number): boolean {
  const { lines } = run
  // An unmarked blank ends a quote (CARVE-P2-008). The next block
  // gets its own footnote-body base (CARVE-P0-004, carve#2598).
  if (run.hostIsFootnoteBody && note.quoteOpener) return true
  let k = j + 1
  while (k < lines.length && isBlankLine(lines[k]!)) k++
  if (k >= lines.length || indentColumns(lines[k]!, note.runColumn) < note.runColumn) return true
  // Past an unmarked blank only a marked line or the quote's caption
  // is still the quote's.
  return note.quoted !== null && !RE_BLOCKQUOTE.test(lines[k]!.replace(/^[ \t]+/, '')) &&
    !RE_CAPTION.test(sliceColumns(lines[k]!, note.base, true))
}

function authoredNoteBodyStops(run: RebaseRun, note: NoteRun, group: RebaseGroup, j: number, bodyColumn: number): boolean {
  const candidate = run.lines[j]!
  const text = candidate.trimStart()
  const source = run.sourceLines?.[j]
  const { ownerBase } = note
  const ownedDeeper = ownerBase !== undefined && !note.returnedToHost && indentColumns(candidate) > ownerBase
  if (ownedDeeper && source !== undefined && sourceColumn(source) < bodyColumn &&
      opaqueGroupCloser(text) !== null) return true
  if (ownedDeeper && source !== undefined &&
      sourceColumn(source, quotePrefixDepth(source)) < bodyColumn &&
      !isContinuationMarker(text) && opaqueGroupCloser(text) === null) {
    group.noteReturnsToParagraphOwner = !lineOpensItemBlock(text)
    if (!group.noteReturnsToParagraphOwner)
      run.lines[j] = sliceColumns(candidate, Math.max(0, note.base - ownerBase), true)
    return true
  }
  return (ownerBase !== undefined && source !== undefined
    ? sourceColumn(source)
    : indentColumns(candidate, bodyColumn)) < bodyColumn &&
    lineOpensItemBlock(text) && !RE_FOOTNOTE_DEF.test(text) && !note.returnedToHost
}

function quotedLineStops(quoted: QuoteState, base: number, candidate: string): boolean {
  // AN OVER-INDENTED MARKER IS STILL THE MARKER, and `RE_BLOCKQUOTE` is
  // anchored - reading a line the author wrote one column in as
  // unmarked would end the run on a question about indentation rather
  // than about the quote's reach.
  const local = sliceColumns(candidate, base, true)
  const marked = RE_BLOCKQUOTE.exec(local.replace(/^[ \t]+/, ''))
  if (marked) {
    trackBlockQuoteLazyState(marked[1] ?? '', quoted, () => true, () => true)
    return false
  }
  if (!blockQuoteParagraphOpen(quoted)) return true
  // An unmarked opener at the run's own column interrupts the quote
  // and is a rebase group of its own, with its own payload and closer.
  if ((leadingWhitespace(local) === 0 && (lineOpensItemBlock(local) || RE_CAPTION.test(local))) ||
    (leadingWhitespace(local) > 0 && isLinkDefLine(local.trimStart()))) return true
  trackBlockQuoteLazyState(local, quoted, () => true, () => true, undefined, undefined, false)
  return false
}

// A caption is a structural continuation of the captionable block above
// it and shares that block's authored base. Leaving the caption behind at
// the residual indentation turns it into escaped prose.
function captionFollows(lines: string[], end: number, base: number): boolean {
  const caption = lines[end + 1]
  return caption !== undefined && !isBlankLine(caption) && indentColumns(caption, base) >= base &&
    RE_CAPTION.test(sliceColumns(caption, base, true))
}

// Preserve the written column when flattening would hand a sibling tail to this note.
function keepsAuthoredColumn(run: RebaseRun, i: number, base: number, opener: string, group: RebaseGroup): boolean {
  const { lines } = run
  if (!RE_FOOTNOTE_DEF.test(opener) || base <= 0) return false
  if (run.foldedMarkers.has(i - 1) || (i > 0 && /^\+[ \t]+\S/.test(lines[i - 1]!))) return false
  if (run.hostIsFootnoteBody || group.noteReturnsToParagraphOwner) return true
  const next = lines[i + 1]
  return i + 2 === lines.length && next !== undefined &&
    !RE_ADMONITION_CLOSE.test(next.trimStart()) && !RE_LINE_BLOCK_OPEN.test(next.trimStart()) &&
    indentColumns(next, base + FOOTNOTE_BODY_COLUMN) < base + FOOTNOTE_BODY_COLUMN
}

function dedentGroup(run: RebaseRun, i: number, base: number, group: RebaseGroup, isCode: boolean, sourceCodeBase: number | undefined): void {
  const { lines, sourceLines } = run
  if (sourceCodeBase !== undefined) {
    for (let j = i; j <= group.end; j++) {
      const sourceLine = sourceLines?.[j]
      if (sourceLine !== undefined) {
        if (!group.held.has(j)) lines[j] =
          indentColumns(sourceLine, sourceCodeBase) >= sourceCodeBase
            ? sliceColumns(sourceLine, sourceCodeBase, true)
            : sourceLine.slice(leadingWhitespace(sourceLine))
      } else if (!isBlankLine(lines[j]!) && indentColumns(lines[j]!, base) >= base && !group.held.has(j)) {
        lines[j] = sliceColumns(lines[j]!, base, true)
      }
    }
    return
  }
  const slicesCodePrefix = isCode &&
    (run.stripLeftCodePrefix || !run.itemParagraphFences?.has(i) && !run.lazyParagraphFences?.has(i))
  for (let j = i; j <= group.end; j++) {
    if (isBlankLine(lines[j]!) || group.held.has(j)) continue
    const column = indentColumns(lines[j]!)
    if (column >= base || slicesCodePrefix) lines[j] = sliceColumns(lines[j]!, Math.min(base, column), true)
  }
}

function rebaseGroup(run: RebaseRun, i: number, base: number, opener: string, descriptionParagraphFence: boolean): number {
  const { lines, sourceLines } = run
  const group: RebaseGroup = { end: i, held: new Set(), noteReturnsToParagraphOwner: false }
  const definitionEntry = RE_DEFLIST_TERM.test(opener) || RE_DEFLIST_DEF.test(opener)
  if (definitionEntry) group.end = definitionRunEnd(run, i, base, opener, group.end)
  const code = RE_FENCE.exec(opener) ?? RE_RAW_FENCE.exec(opener)
  const comment = code ? undefined : commentFenceRun(opener)
  const colon = code || comment !== undefined ? null : colonBlockOpenerRun(opener)
  const source = code && run.tabFenceColumns?.has(i) ? sourceLines?.[i] : undefined
  const sourceCodeBase = source !== undefined && source.slice(0, leadingWhitespace(source)).includes('\t')
    ? indentColumns(source) : undefined

  if (code) codeGroupEnd(run, i, base, opener, code, sourceCodeBase, group, descriptionParagraphFence)
  else if (comment !== undefined) commentGroupEnd(run, i, base, comment, group)
  else if (colon !== null) colonGroupEnd(run, i, base, opener, colon, group)
  else if (!definitionEntry && (
    RE_BLOCKQUOTE.test(opener) ||
    // A LINK REFERENCE DEFINITION HAS NO BODY, so it owns no run at all - it
    // is one line by construction, since a definition cannot take its
    // destination from the next line. Listing it here let it swallow the line
    // below, which is how a SECOND definition written between two open
    // content columns kept its residual indent and reached the page as
    // characters while still registering.
    RE_FOOTNOTE_DEF.test(opener)
  )) quoteOrNoteRunEnd(run, i, base, opener, group)

  if (captionFollows(lines, group.end, base)) group.end++
  if (!keepsAuthoredColumn(run, i, base, opener, group)) dedentGroup(run, i, base, group, code !== null, sourceCodeBase)
  return group.end
}

return function rebaseOverindentedBlocks(
  lines: string[],
  eligible?: ReadonlySet<number>,
  leadNestedColumn = -1,
  includeSublists = false,
  // Set only when rebasing a FOOTNOTE body, where a nested note keeps its
  // authored column - see the flatten note at the dedent below. Every other
  // host still rebases an over-indented note so it registers (corpus 447).
  hostIsFootnoteBody = false,
  onFenceBodyLine?: (index: number) => void,
  onUnclosedCodeFence?: () => void,
  // Lines the HOST took from below its own content column. Their leading run is
  // alignment under that host rather than an authored column, so a colon group
  // must not dedent one onto its base - see the dedent below.
  takenBelowColumn?: ReadonlySet<number>,
  markerColonOwnsExtent = false,
  sourceLines?: readonly (string | undefined)[],
  tabFenceColumns?: ReadonlyMap<number, number>,
  noteParagraph?: { markers?: ReadonlySet<number>, markerBody?: boolean },
  itemParagraphFences?: ReadonlySet<number>,
  lazyParagraphFences?: ReadonlySet<number>,
  descriptionItem = false,
  stripLeftCodePrefix = false,
  // A description or footnote body folds a marker into its open paragraph (PART 9 §10 I2).
  foldsMarkers = false,
  authoredOpeners?: ReadonlySet<number>,
  hostOwnedBlockStarts?: ReadonlySet<number>,
  termSourceLines?: readonly (string | undefined)[],
  termHostContentColumn = -1,
  leadNestedTerm = false,
): Set<number> {
  const ownedBlanks = new Set<number>()
  if (!mayRebase(lines, eligible)) return ownedBlanks
  // One index for the whole pass; a dedent only moves leading whitespace.
  let commentCloser: ((width: number, index: number) => number) | undefined
  let colonCommentCloser: ((width: number, index: number) => number) | undefined
  let quoteProbe: Lexer | undefined
  // A sub-list may open on the item's marker line, which is not part of
  // `lines`. Seed its ownership column so a following line at that child's
  // content column is left for the child's collector (for example
  // `- > - - x` / `  >     # h`).
  //
  // ONE column, not a stack. A line at or past the open child's content column
  // is handed to that child whatever it is, so a deeper marker inside the child
  // could only ever be popped again before it decided anything - the deeper
  // entries were unreachable. Keeping one column is also what makes the scan
  // linear: `cap` in `releasedLine` bounds every measurement by the child's
  // column instead of by the line's own indentation, so a ladder does not
  // re-read the same leading run once per level (carve#752's counted bound).
  const run: RebaseRun = {
    lines, eligible, includeSublists, hostIsFootnoteBody, onFenceBodyLine, onUnclosedCodeFence,
    takenBelowColumn, markerColonOwnsExtent, sourceLines, tabFenceColumns, noteParagraph,
    itemParagraphFences, lazyParagraphFences, descriptionItem, stripLeftCodePrefix, foldsMarkers,
    authoredOpeners, hostOwnedBlockStarts, termSourceLines, termHostContentColumn,
    ownedBlanks,
    groupCloserMemos: new Map(),
    closeComment: (width, index) => (commentCloser ??= commentCloserLookup(lines))(width, index),
    closeColonComment: (width, index) => (colonCommentCloser ??= commentCloserLookup(lines, false))(width, index),
    probe: () => quoteProbe ??= new Lexer([]),
    ownedColumn: leadNestedColumn,
    ownedMarkerBase: -1,
    ownedParagraphOpen: leadNestedTerm,
    markerColonEnd: -1,
    inlineLeadPayload: false,
    childColonWidth: null,
    leadCommentBase: -1,
    markerColonNestedBody: new Set(),
    absorbingColonParagraph: false,
    footnoteParagraphOpen: false,
    foldedMarkers: new Set(),
    paragraphOwnedNotes: new Map(),
  }
  for (let i = 0; i < lines.length; i++) i = rebaseLine(run, i)
  return ownedBlanks
}

}
