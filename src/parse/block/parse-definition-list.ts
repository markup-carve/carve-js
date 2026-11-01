import { bodyEndsInOpenCodeFence, verbatimOnlyLazyState } from './parse-block-boundaries.js'
import { LAZY_FRAME as LEAD_TAB_FRAME } from '../parse-prepass-core.js'
import type {
  BlockNode,
  DefinitionList,
  Comment,
  DefinitionItem,
  InlineNode,
  Position,
} from '../../ast.js'
import {
  Lexer,
  indentColumns,
  isBlankLine,
  sliceColumns,
} from '../parse-lexer.js'
import { nextContainerContent, runIndentationContainer } from './parse-indentation-container.js'
import { sourceQuotePrefixEnd } from './parse-block-boundaries.js'
import { firstBlockOpenerContent } from '../list/parse-item-core.js'
import {
  continueWrappedAttributeBlock,
  markerLineBottomBlock,
  markerPrefixLength,
  opensWrappedAttributeBlock,
  payloadFenceHasCloser,
  prefixWalkBound,
  RE_DEFLIST_DEF as DEFINITION_MARKER,
} from './parse-quote-core.js'
import { RE_DEFLIST_TERM as TERM_MARKER } from '../parse-prepass-core.js'
import type {
  definitionListHelpers,
  ItemLazyState,
  InlineSource,
  PendingAttrCarry,
} from '../../parse.js'
import type { LinkDef } from '../inline/inline-resolution.js'

// A phase's answer for one admitted line, or `undefined` to ask the next phase.
type DescriptionVerdict = 'continue' | 'stop' | undefined
type TermFenceState = {
  active: { marker: string; column: number } | null
  closesOnLine: boolean
}

function advanceToEntry(
  lexer: Lexer, entry: RegExp, helpers: typeof definitionListHelpers,
  session: DefinitionListSession, keepComment: (comment: Comment) => void,
): boolean {
  const { RE_ABBR_DEF, RE_COMMENT_LINE, RE_COMMENT_BLOCK_ANY, isLinkDefLine,
    commentBlockHasCloser, stripLazyFrame } = helpers
  let next = lexer.pos
  let blanks = 0
  const abbreviations: Array<[number, string, string]> = []
  while (next < lexer.lineCount) {
    const line = lexer.lineAt(next) ?? ''
    if (isBlankLine(line)) {
      blanks++
      next++
      continue
    }
    const abbr = lexer.atDocumentLevel ? RE_ABBR_DEF.exec(line) : null
    if (abbr) abbreviations.push([next, abbr[1]!, abbr[2]!])
    else if (!RE_COMMENT_LINE.test(line) && !isLinkDefLine(line)) break
    const fence = RE_COMMENT_BLOCK_ANY.exec(line)?.[1]
    if (fence && commentBlockHasCloser(lexer, fence.length, next)) {
      for (let at = next + 1; at < lexer.lineCount; at++) {
        if (RE_COMMENT_BLOCK_ANY.exec(lexer.lineAt(at) ?? '')?.[1] === fence) {
          next = at
          break
        }
      }
    }
    next++
  }
  if (blanks >= 3 || !entry.test(stripLazyFrame(lexer.lineAt(next) ?? ''))) return false
  for (const [line, abbr, expansion] of abbreviations) {
    lexer.skippedAbbreviations?.set(line, [abbr, expansion])
    lexer.abbrDefs.set(abbr, expansion)
  }
  for (const node of session.parseInvisibleRun(lexer, next))
    if (node.type === 'comment') keepComment(node)
  return true
}

function abbreviationBridgesDescription(lexer: Lexer, helpers: typeof definitionListHelpers): boolean {
  if (!lexer.atDocumentLevel) return false
  const { RE_COMMENT_LINE, RE_DEFLIST_DEF, isLinkDefLine } = helpers
  let blanks = 0
  for (let at = lexer.pos + 1; at < lexer.lineCount; at++) {
    const line = lexer.lineAt(at) ?? ''
    if (isBlankLine(line)) {
      if (++blanks >= 3) return false
      continue
    }
    if (RE_DEFLIST_DEF.test(line)) return true
    if (indentColumns(line) !== 0 || (!RE_COMMENT_LINE.test(line) && !isLinkDefLine(line))) return false
  }
  return false
}

function primeSiblingAbbreviations(lexer: Lexer, helpers: typeof definitionListHelpers): void {
  if (!lexer.atDocumentLevel) return
  const { RE_DEFLIST_TERM, RE_DEFLIST_DEF, RE_ABBR_DEF, RE_COMMENT_LINE, isLinkDefLine } = helpers
  const abbreviations: Array<[string, string]> = []
  let blanks = 0
  for (let at = lexer.pos; at < lexer.lineCount; at++) {
    const line = lexer.lineAt(at) ?? ''
    if (isBlankLine(line)) {
      blanks++
      if (blanks >= 3) break
      continue
    }
    if (RE_DEFLIST_TERM.test(line)) continue
    if (RE_DEFLIST_DEF.test(line)) {
      for (const [abbr, expansion] of abbreviations) lexer.abbrDefs.set(abbr, expansion)
      break
    }
    const abbr = RE_ABBR_DEF.exec(line)
    if (abbr) abbreviations.push([abbr[1]!, abbr[2]!])
    else if (!RE_COMMENT_LINE.test(line) && !isLinkDefLine(line)) break
  }
}

// CARVE-P2-010: a tab after the separator's spaces is content, so the body is paragraph text.
const descriptionLead = (body: string): string => body.startsWith('\t') ? LEAD_TAB_FRAME + body : body

function descriptionTermOwnerReached(
  openTerm: boolean, opener: string, sourceColumn: number, ownerColumn: number,
  opensBlock: (line: string) => boolean,
): boolean {
  return openTerm && !DEFINITION_MARKER.test(opener) && !TERM_MARKER.test(opener) &&
    opensBlock(opener) && sourceColumn <= Math.max(0, ownerColumn)
}

function nestedTermOwnerReached(
  hostBody: string | null, opener: string, sourceColumn: number, termColumn: number,
  listColumn: number, opensBlock: (line: string) => boolean,
): boolean {
  return hostBody === 'description' && !DEFINITION_MARKER.test(opener) && !TERM_MARKER.test(opener) &&
    sourceColumn <= termColumn - listColumn && opensBlock(opener)
}

function termBoundaryReached(
  leavesTerm: boolean, hostBody: string | null, opener: string, sourceColumn: number,
  termColumn: number, listColumn: number, hostContentColumn: number,
  opensBlock: (line: string) => boolean,
): boolean {
  return leavesTerm ||
    (hostBody === 'description' && sourceColumn <= hostContentColumn &&
      (DEFINITION_MARKER.test(opener.trimStart()) || TERM_MARKER.test(opener.trimStart()))) ||
    nestedTermOwnerReached(hostBody, opener, sourceColumn, termColumn, listColumn, opensBlock)
}

function hasAttachedBlockOrMarker(
  attached: readonly string[], next: string | undefined, isMarker: (line: string) => boolean,
): boolean {
  return attached.length > 0 || isMarker(next ?? '')
}

function sourceLineAt(lexer: Lexer, index: number, fallback: string): string {
  return (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(index) - 1] ?? fallback
}

function isItemLazyLine(lexer: Lexer): boolean {
  return lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos))
}

function isMarkerLineTermText(lexer: Lexer, line: string, column: number, termColumn: number): boolean {
  return lexer.definitionLeadFromItemMarker && !lexer.hostTaskMarker && lexer.hostMarkerColumn !== undefined &&
    DEFINITION_MARKER.test(line) && column >= lexer.hostMarkerColumn && column < termColumn
}

function isBelowColumnListAfterTerm(state: ItemLazyState, atDocumentColumn: boolean, line: string,
  isListMarker: (line: string) => boolean): boolean {
  return state.inDefList === 'term' && state.opaque === null && !atDocumentColumn && isListMarker(line)
}

function isPastTermEntry(lexer: Lexer, source: string, entry: string, termColumn: number,
  markerTermText: boolean, entryLeadColumn: (line: string) => number): boolean {
  return !lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos)) &&
    (TERM_MARKER.test(entry) || DEFINITION_MARKER.test(entry)) &&
    (entryLeadColumn(source) > termColumn || markerTermText)
}

function restoresDescriptionTermIndent(lexer: Lexer, sourceColumn: number): boolean {
  return lexer.hostBody === 'description' && sourceColumn > (lexer.hostSourceContentColumn ?? 0)
}

function dropsTermIndent(lexer: Lexer, sourceColumn: number, termColumn: number, retains: boolean): boolean {
  return !retains && (lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos)) ||
    lexer.hostBody === 'list' && sourceColumn === termColumn)
}

type DefinitionListSession = {
  parseInvisibleRun(lexer: Lexer, end: number): BlockNode[]
  collectAttachedBlock(
    lexer: Lexer,
    isBoundary: (line: string) => boolean,
    contentColumn?: number,
    endAtFoldedDefinition?: boolean,
    acceptFirstNonList?: boolean,
  ): { lines: string[]; lineNumbers: number[]; startLineIndex: number }
  markerPrefixMemo(
    lexer: Lexer,
    index: number,
  ): Map<number, number> | undefined
  parseBlocks(
    lexer: Lexer,
    baseIndent: number,
    carry?: PendingAttrCarry,
  ): BlockNode[]
  parseInline(
    text: string,
    abbrDefs: Map<string, string>,
    linkDefs?: Map<string, LinkDef>,
    source?: InlineSource,
    captionContext?: boolean,
  ): InlineNode[]
}

export function createDefinitionListParser(
  helpers: typeof definitionListHelpers,
) {
  const {
    FOOTNOTE_BODY_COLUMN,
    LAZY_FRAME,
    RE_ABBR_DEF,
    RE_BLOCKQUOTE,
    RE_CAPTION,
    RE_COMMENT_BLOCK_ANY,
    RE_COMMENT_LINE,
    RE_DEFLIST_DEF,
    RE_DEFLIST_TERM,
    RE_FENCE,
    RE_FOOTNOTE_DEF,
    RE_HEADING,
    RE_HR,
    RE_LINE_BLOCK_OPEN,
    RE_RAW_FENCE,
    bodyHoldsClosableCommentSpan,
    colonFenceOpenerLen,
    colonFenceShapeEndsLazyContinuation,
    commentBlockHasCloser,
    commentFenceRun,
    commentLineContent,
    deflistContentCol,
    descriptionLeadFenceScans,
    dropTrailingWhitespace,
    endsHeadingOrQuote,
    fenceCloseRe,
    insideOpenFence,
    insideOpenQuoteParagraph,
    isBlockAttributeLine,
    isContinuationMarker,
    openFenceScanner,
    isLinkDefLine,
    isListMarkerLine,
    isRetainableLineComment,
    isTableRow,
    leadingWhitespace,
    lineOpensBlock,
    lineOpensItemBlock,
    markerContentColumn,
    markerDecision,
    markerLineState,
    markerRunListIsQuoteHeld,
    nestedItemHoldsOpenParagraph,
    nestedSubLexer,
    newCommentSpanScan,
    opensCodeFence,
    parseCommentBlock,
    quotePrefixDepth,
    restoreVerbatimBlanks,
    sourceColumn,
    sourceColumnAt,
    startsInterruptingBlock,
    stripLazyFrame,
    trackItemLazyState,
    trimEndSpaceTab,
  } = helpers
  // A tab counts from its container's column (§24 C5). Within two columns of a
  // quote's content column no nested container can have begun, so that tab
  // counts from the quote; further in, the container is unknown here.
  const entryColumnAt = (line: string, offset: number): number => {
    let body = -1
    for (let end = sourceQuotePrefixEnd(line, 0); end >= 0 && end <= offset; end = sourceQuotePrefixEnd(line, end)) body = end
    if (body < 0) return sourceColumnAt(line, offset)
    const quoteColumn = sourceColumnAt(line, body)
    let column = quoteColumn
    for (let index = body; index < offset; index++) {
      if (line[index] !== '\t') column++
      else column += column - quoteColumn < 2 ? 4 - (column - quoteColumn) % 4 : 4 - column % 4
    }
    return column
  }
  const entryLeadColumn = (line: string): number => {
    let body = 0
    for (let end = sourceQuotePrefixEnd(line, 0); end >= 0; end = sourceQuotePrefixEnd(line, end)) body = end
    return entryColumnAt(line, body + leadingWhitespace(line.slice(body)))
  }
  const inFoldedTermFence = (
    state: TermFenceState, line: string, entry: string,
    column: number, pastOwner: boolean,
  ): boolean => {
    if (state.closesOnLine) {
      state.active = null
      state.closesOnLine = false
    }
    if (state.active !== null) {
      state.closesOnLine = column === state.active.column &&
        fenceCloseRe(state.active.marker).test(entry.trimStart())
      return true
    }
    if (!pastOwner) return false
    const opener = RE_FENCE.exec(line) ?? RE_RAW_FENCE.exec(line)
    if (opener === null) return false
    const marker = RE_FENCE.test(line) ? opener[2] : opener[1]
    if (marker === undefined) return false
    state.active = { marker, column }
    return true
  }
  const termOwnerColumn = (lexer: Lexer, listColumn: number): number =>
    lexer.hostBody === 'description' ? lexer.hostSourceContentColumn ?? listColumn : Infinity
  const termContinuationSourceColumn = (source: string, entry: string): number =>
    sourceColumn(source, quotePrefixDepth(source) - Number(RE_BLOCKQUOTE.test(entry.trimStart())))
  const missingTermIndent = (source: number, term: number, host: number, retained: number): number =>
    Math.max(0, source - (source < term ? host : term) - retained)
  const commentLeavesTerm = (lexer: Lexer, next: string, termColumn: number): boolean => {
    const authored = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? next
    const visible = stripLazyFrame(next).trimStart()
    // A list retains its below-column comment with the item holding this term.
    return lexer.hostBody !== 'list' && RE_COMMENT_LINE.test(visible) && commentFenceRun(visible) === undefined &&
      sourceColumn(authored) < termColumn
  }
  const definitionEntryFloor = (lexer: Lexer, returned: boolean, termColumn: number): number => {
    if (lexer.definitionLeadFromItemMarker) return lexer.hostContentColumn
    return lexer.hostBody === 'description' || returned ? termColumn : -1
  }
  // Only a flush term continues the marker line's list. The block dispatch also
  // sends an indented one here, and reading that as the lead would consume nothing.
  const endMarkerLineLeadAtIndentedTerm = (lexer: Lexer): void => {
    if (!RE_DEFLIST_TERM.test(stripLazyFrame(lexer.peek() ?? ''))) lexer.definitionLeadFromItemMarker = false
  }
  return function parseDefinitionList(parseSession: DefinitionListSession, lexer: Lexer): DefinitionList {
    const items: DefinitionItem[] = []
    endMarkerLineLeadAtIndentedTerm(lexer)
    /**
     * Collect and parse one body.
     *
     * `contentCol` is THE BODY'S OWN COLUMN, passed in rather than read from a
     * constant: the §4 tracker and the three indent tests below all measure
     * against it, and two bodies of the same list may be written at different
     * widths (`: one` beside `:  two`). A run of bare `3`s is how a column rule
     * acquires several spellings, and a single parameter is how it keeps one.
     */
    const parseDefBody = (
      first: string,
      firstLineIndex: number,
      markerContentCol: number,
    ): BlockNode[] => {
      // The marker fixes the body's minimum column. Adjacency never lowers it:
      // ownership is selected by the same column band with or without a blank.
      const contentCol = markerContentCol
      const markerSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(firstLineIndex) - 1] ?? ''
      const bodySourceColumn = sourceColumn(markerSource, quotePrefixDepth(markerSource)) + contentCol
      const bodyLines: string[] = []
      const bodyFenceClosers = openFenceScanner()
      const bodyLineNumbers: number[] = []
      const bodySourceLines: (string | undefined)[] = []
      const bufferedBlanks = new Set<number>()
      const lazyState: ItemLazyState = {
        definitionBody: true,
        opaque: null,
        inTable: false,
        invisibleAtColumn: false,
        commentAtColumn: false,
        inFootnoteBody: false,
        quoteInner: null,
        absorbingFence: false,
        divDepth: 0,
        lazyFoldable: false,
        inDefList: false,
        attrRun: null,
        ownedColumn: -1,
        ownedAuthored: false,
      }
      let belowCommentSpan = false
      /**
       * The CONTENT COLUMN of the nested item this body currently has open, in
       * the body's own coordinates, or -1 for none.
       *
       * A line the body takes BELOW that column reaches the body but not the
       * item, so it is the item's LAZY CONTINUATION and opens nothing
       * (markup-carve/carve-js#2535). Only a line AT the body's column replaces
       * the container standing there.
       */
      let nestedItemColumn = -1
      let foldedMarkerContentColumn = -1
      /** Is the list the lead opened held by a QUOTE, and so the quote's to lose? */
      let leadListIsQuoteHeld = false
      /** Whether that nested item still holds an open paragraph to fold into. */
      let nestedItemParagraphOpen = false
      let nestedItemRefusedAttachment = false
      let nestedAttributeRun: string | null = null
      let nestedDescriptionOpened = false
      let nestedLeadScans: ReturnType<typeof descriptionLeadFenceScans> | undefined
      let commentPayloadState: ItemLazyState | null = null
      const paragraphFenceLines = new Set<number>()
      const lazyParagraphFenceLines = new Set<number>()
      const authoredOpeners = new Set<number>()
      let pendingMarkerLineBlock: { line: string; column: number } | null = null
      const quoteColumn = (line: string): { at: number; column: number } => {
        let at = 0
        let column = 0
        for (let end = sourceQuotePrefixEnd(line, at); end >= 0;
          end = sourceQuotePrefixEnd(line, at)) {
          column += end - at
          at = end
        }
        return { at, column }
      }
      const payloadColumn = (line: string): number => {
        const { at, column } = quoteColumn(line)
        return column + indentColumns(line.slice(at))
      }
      const seedMarkerLineBlock = (line: string): void => {
        if (lazyState.literalColon || lazyState.deepest?.literalColon) return
        const bottom = markerLineBottomBlock(line)
        if (bottom === line || !RE_LINE_BLOCK_OPEN.test(bottom)) return
        let { at, column } = quoteColumn(line)
        const bound = prefixWalkBound(line)
        for (let width = markerPrefixLength(line, at, bound); width > 0;
          width = markerPrefixLength(line, at, bound)) {
          column += markerContentColumn(line.slice(at, at + width) + 'x')
          at += width
        }
        const literal = { width: colonFenceOpenerLen(bottom)!, column: 0 }
        if (lazyState.ownedColumn > 0) {
          const frame = verbatimOnlyLazyState()
          frame.divDepth = 1
          frame.literalColon = literal
          frame.literalLayout = true
          lazyState.deepest = frame
        } else {
          lazyState.literalColon = { ...literal, column }
          lazyState.divDepth = 1
        }
        lazyState.literalLayout = true
        lazyState.lazyFoldable = false
      }
      /**
       * Feed one collected body line to the S4 tracker.
       *
       * `atContentColumn` is false only for a line the body took LAZILY, from
       * below its content column. An invisible line there adds no block, so the
       * paragraph it was folded into is still open behind it.
       */
      const track = (content: string, atContentColumn = true): void => {
        // Keep payload classification separate from the actual span state.
        // An unfinished prefix can leave a paragraph open for S4, but blocks
        // inside a completed comment must not change the surrounding state.
        if (lazyState.opaque === null && commentFenceRun(content) !== undefined) {
          commentPayloadState = { ...lazyState, quoteInner: null }
        }
        trackItemLazyState(content, lazyState, atContentColumn, () => true, {
          terminatorFree: true,
          payloadFenceCloser: marker => payloadFenceHasCloser(lexer, marker),
        })
        seedMarkerLineBlock(content)
        if (opensCodeFence(content.trimStart()) && lazyState.lazyFoldable && lazyState.opaque === null) {
          paragraphFenceLines.add(bodyLines.length - 1)
          const previous = bodyLines.length - 2
          if (previous >= 0 && !bodyBaseEligible.has(previous) &&
              !opensCodeFence(bodyLines[previous]!.trimStart()) && !RE_COMMENT_LINE.test(bodyLines[previous]!.trimStart())) {
            lazyParagraphFenceLines.add(bodyLines.length - 1)
          }
        }
        if (lazyState.opaque?.kind === 'comment' && commentPayloadState !== null) {
          trackItemLazyState(content, commentPayloadState, atContentColumn, () => false)
          lazyState.lazyFoldable = commentPayloadState.lazyFoldable
        } else {
          commentPayloadState = null
        }
        if (nestedLeadScans !== undefined) {
          lazyState.lazyFoldable = nestedLeadScans.paragraphOpen(bodyLines, lazyState.lazyFoldable, atContentColumn)
        }
      }
      // Lines admitted by REACHING the body's content column, mirroring the list
      // item's `authoredBaseEligible` one collector over. A below-column lazy line
      // keeps a positive residual indent on purpose, and that residue must never
      // be read as #1705 over-indentation and rebased away: rebasing it delivers
      // the line FLUSH inside the `dd`, where its shape is recognized again - a
      // definition registers, an attribute attaches - and the fold §10 I5 asks for
      // has not happened (markup-carve/carve-js#1550).
      const bodyBaseEligible = new Set<number>()
      const bodySpanScan = newCommentSpanScan()
      // Has any line of this body been a block QUOTE?
      //
      // Once one has, the body's paragraph is no longer necessarily the innermost
      // OPEN one - the quote's is - and SS10 I2 hands a line below to THAT
      // paragraph instead. markup-carve/carve#1911 carves exactly this out and
      // names the block quote for it; corpus section 444 row 11 is the case where
      // the quote IS the payload, and this flag is that row generalized to a
      // quote opened anywhere above it. Asked of the FLUSH spelling, because that
      // is the spelling the body reads - an over-indented `> q` is still a quote.
      //
      // The flag is only half of it: a quote opened on the DESCRIPTION MARKER
      // line (`: > q`) is already in `lazyState.quoteInner` before this loop
      // runs and never passes through the flag, so the gate below asks both.
      let bodyHoldsQuote = false
      const firstSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(firstLineIndex) - 1] ?? ''
      const quoteDepth = quotePrefixDepth(firstSource)
      const quoteHostColumn = quoteDepth > 0 ? sourceColumn(firstSource, quoteDepth - 1) : -1
      const descriptionSourceColumn = quoteDepth > 0 ? sourceColumn(firstSource, quoteDepth) : -1
      const quoteBandFold = (line: string): boolean => {
        if (quoteDepth === 0 || !lazyState.lazyFoldable || lazyState.opaque !== null || isBlankLine(line)) return false
        const source = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? line
        const opener = line.trimStart()
        if (quotePrefixDepth(source) >= quoteDepth &&
            sourceColumn(source, quoteDepth - 1) === quoteHostColumn)
          return indentColumns(line, contentCol) < contentCol &&
            sourceColumn(source, quoteDepth) > descriptionSourceColumn && RE_BLOCKQUOTE.test(opener)
        return sourceColumn(source) !== quoteHostColumn || isListMarkerLine(opener)
      }
      /**
       * The residual indent the currently open block's OPENER was written at, or
       * null while nothing is open.
       *
       * `normalizeAuthoredBodyBases` dedents a block by the one column its opener
       * established, so only lines written at that column are the block's own
       * structure and anything deeper is payload. The tracker reads the body one
       * line at a time and has to carry the same base to reach the same answer
       * (markup-carve/carve#1930).
       */
      let authoredBase: number | null = null
      // The boundary set for a `+`-attached block in a definition body: a blank,
      // a further `+`, or the next term / description marker. Whether a line in
      // that set actually ENDS the block is `insideOpenFence`'s answer, layered
      // on by `collectAttachedBlock`.
      const isDefBodyBoundary = (a: string): boolean =>
        isBlankLine(a) ||
        /^\+[ \t]*$/.test(a) ||
        RE_DEFLIST_TERM.test(a) ||
        RE_DEFLIST_DEF.test(a)
      // First-block form (`:  +`, mirroring the list `- +`): when the sole
      // content is a lone `+`, the definition body is the FOLLOWING flush-left
      // block, with no indentation. `:  \+` keeps a literal `+` instead.
      if (/^\+[ \t]*$/.test(first)) {
        const firstBlock = parseSession.collectAttachedBlock(lexer, isDefBodyBoundary, 0, true, true)
        for (let k = 0; k < firstBlock.lines.length; k++) bodyBaseEligible.add(bodyLines.length + k)
        bodyLines.push(...firstBlock.lines)
        bodySourceLines.push(...firstBlock.lines)
        bodyLineNumbers.push(...firstBlock.lineNumbers)
        for (const a of firstBlock.lines) track(a)
      } else {
        bodyBaseEligible.add(bodyLines.length)
        bodyLines.push(first)
        bodySourceLines.push(first)
        bodyLineNumbers.push(lexer.lineNumber(firstLineIndex))
        // The MARKER LINE never goes through the tracker in the list either, and
        // for the same reason it is seeded by hand here: nothing precedes it, so
        // no closer lookahead applies and a fence on it opens unconditionally
        // (markup-carve/carve#950). The lead opens a paragraph unless it is one of
        // the shapes that open nothing - PART 1 S4's question, asked here in the
        // ONE spelling the list item asks it in. THE CONTAINER KIND IS NOT A
        // PARAMETER (carve#920): a heading, a table or an attribute block written
        // on the `:  ` marker leaves no paragraph open for exactly the reason it
        // leaves none on a `- ` marker.
        const firstState = markerLineState(first, parseSession.markerPrefixMemo(lexer, firstLineIndex))
        const firstIsColonContainer = colonFenceShapeEndsLazyContinuation(first)
        lazyState.lazyFoldable = firstIsColonContainer ? false : firstState.leavesParagraphOpen
        nestedItemColumn = markerContentColumn(first)
        leadListIsQuoteHeld = markerRunListIsQuoteHeld(first)
        nestedItemParagraphOpen = nestedItemHoldsOpenParagraph(
          first,
          parseSession.markerPrefixMemo(lexer, firstLineIndex),
        )
        lazyState.inTable = firstState.endsOnTableRow
        lazyState.quoteInner = firstState.quote
        // A FOOTNOTE DEFINITION ON THE MARKER LINE OPENS A BODY RUN, exactly as
        // one on a continuation line does through the tracker (§16, the arm at
        // `RE_FOOTNOTE_DEF.test(content)` further down). The marker line never
        // passes through `track`, so without this the run went untracked: a note
        // continuation at the note's floor re-armed `lazyFoldable`, and a column-0
        // trailing line then folded into the `dd` instead of falling to the
        // document, where PART 0's owner selection places a line below the dd's
        // base column (markup-carve/carve#1974).
        lazyState.inFootnoteBody = false
        // The note's own frame answers the lazy question (carve#3885).
        if (RE_FOOTNOTE_DEF.test(first)) trackItemLazyState(first, lazyState)
        if (firstIsColonContainer) {
          lazyState.divDepth = 1
          // Its width decides which bare run closes it, as for one opened in the body.
          lazyState.divWidths = [colonFenceOpenerLen(first) ?? 3]
        }
        // A malformed fence on the marker line absorbs the bare run below it, as an item's lead does.
        lazyState.absorbingFence = /^:{3,}/.test(first) && !firstIsColonContainer
        if (RE_LINE_BLOCK_OPEN.test(first)) lazyState.literalColon = { width: colonFenceOpenerLen(first)!, column: 0 }
        if (RE_LINE_BLOCK_OPEN.test(markerLineBottomBlock(first))) {
          let { at, column } = quoteColumn(first)
          const bound = prefixWalkBound(first)
          for (let width = markerPrefixLength(first, at, bound); width > 0;
            width = markerPrefixLength(first, at, bound)) {
            column += markerContentColumn(first.slice(at, at + width) + 'x')
            at += width
          }
          pendingMarkerLineBlock = { line: first, column }
        }
        const leadFence = RE_FENCE.exec(first) ?? RE_RAW_FENCE.exec(first)
        if (leadFence) {
          lazyState.opaque = { kind: 'code', close: fenceCloseRe(RE_FENCE.test(first) ? leadFence[2]! : leadFence[1]!) }
          lazyState.lazyFoldable = false
        }
      }
      if (firstBlockOpenerContent(first) && !isContinuationMarker(first)) {
        const attached = parseSession.collectAttachedBlock(lexer, isDefBodyBoundary, 0, true, true)
        // An intervening line still reaches the description after this pull
        // fails, but cannot open a block in the nested item's column.
        nestedItemRefusedAttachment = nestedItemColumn > 0 && attached.lines.length === 0
        for (let k = 0; k < attached.lines.length; k++) bodyBaseEligible.add(bodyLines.length + k)
        bodyLines.push(...attached.lines)
        bodySourceLines.push(...attached.lines)
        bodyLineNumbers.push(...attached.lineNumbers)
        for (const line of attached.lines) track(line)
      }
      nestedLeadScans = descriptionLeadFenceScans(first)
      lazyState.lazyFoldable = nestedLeadScans.paragraphOpen(bodyLines, lazyState.lazyFoldable, true)
      // Form B: `+` pull-left continuation.
      const admitPlusContinuation = (ln: string): DescriptionVerdict => {
        const descriptionDecision = isContinuationMarker(ln) ? markerDecision(lexer, lexer.pos) : undefined
        if (isContinuationMarker(ln) && descriptionDecision?.owner?.kind === 'description') {
          const follower = lexer.peek(1)
          if (lazyState.opaque?.kind === 'code' &&
              (follower === undefined || isBlankLine(follower) || indentColumns(follower) !== 0)) {
            lexer.consume()
            return 'continue'
          }
          const plusLineIndex = lexer.pos
          lexer.consume()
          const { lines: attached, lineNumbers: attachedLineNumbers } = parseSession.collectAttachedBlock(
            lexer,
            isDefBodyBoundary,
            0,
            true,
          )
          if (hasAttachedBlockOrMarker(attached, lexer.peek(), isContinuationMarker)) {
            for (const closer of bodyFenceClosers(bodyLines)) {
              bodyLines.push(closer)
              bodySourceLines.push(undefined)
              bodyLineNumbers.push(lexer.lineNumber(plusLineIndex))
              track(closer)
            }
            bodyBaseEligible.add(bodyLines.length)
            bodyLines.push('')
            bodySourceLines.push(undefined)
            bodyLineNumbers.push(lexer.lineNumber(plusLineIndex))
            track('')
            for (const a of attached) {
              bodyBaseEligible.add(bodyLines.length)
              bodyLines.push(a)
              bodySourceLines.push(a)
              track(a)
            }
            bodyLineNumbers.push(...attachedLineNumbers)
          }
          return 'continue'
        }
        return undefined
      }
      const leavesBeforeSourceBody = (ln: string, sourceFollower: string, reachesSourceBody: boolean): DescriptionVerdict => {
        if (lazyState.opaque === null && (lexer.hostBody === 'list' || lexer.hostBody === 'description') &&
            !reachesSourceBody &&
            !(lazyState.lazyFoldable && opensCodeFence(ln.trimStart())) &&
            !isRetainableLineComment(lexer, ln.trimStart()) && commentFenceRun(ln.trimStart()) === undefined &&
            sourceColumn(sourceFollower, quotePrefixDepth(markerSource)) >= bodySourceColumn - contentCol &&
            // A quoted list marker still opens in a surviving description body.
            !(quotePrefixDepth(markerSource) > lexer.hostQuoteDepth && lazyState.lazyFoldable &&
              ((!startsInterruptingBlock(lexer, ln.trimStart()) && !isListMarkerLine(ln.trimStart())) ||
                RE_FOOTNOTE_DEF.test(ln.trimStart())) &&
              sourceColumn(sourceFollower, quotePrefixDepth(markerSource)) > bodySourceColumn - contentCol) &&
            !(quotePrefixDepth(markerSource) > lexer.hostQuoteDepth && quoteBandFold(ln)) &&
            !insideOpenQuoteParagraph(lazyState) &&
            (startsInterruptingBlock(lexer, ln.trimStart()) || isListMarkerLine(ln.trimStart()) ||
              RE_BLOCKQUOTE.test(ln.trimStart()) || RE_FOOTNOTE_DEF.test(ln.trimStart()))) return 'stop'
        return undefined
      }
      // Whether an over-indented content line is read at its own authored base.
      const contentReadsFlush = (
        dedented: string,
        flush: string,
        residual: number,
        lazyUnderNestedItem: boolean,
        reachesSourceBody: boolean,
      ): boolean => {
        let bodyReadsFlush = false
        // A QUOTE THAT COLLECTS NOTHING OWNS NOTHING. The question is whether
        // the open quote still takes this line, and only a quote with an OPEN
        // PARAGRAPH does: an unquoted line below one ending in a table, a
        // heading or a break is not the quote's, so it is the body's own block
        // and gets the body's own reading (markup-carve/carve-js#2536). Asking
        // merely whether a quote was TRACKED withheld the flush reading from
        // every such line, and an over-indented table row below `: > | a |`
        // came out as prose where the oracle starts a fresh table.
        if (
          !bodyHoldsQuote &&
          lazyState.deepest?.literalColon === undefined &&
          lazyState.literalColon === undefined &&
          !insideOpenQuoteParagraph(lazyState) &&
          (!lazyState.inFootnoteBody || residual < (lazyState.footnoteBodyColumn ?? FOOTNOTE_BODY_COLUMN)) &&
          !lazyUnderNestedItem &&
          flush !== dedented &&
          lineOpensItemBlock(flush)
        ) {
          // A COPY, and one that cannot write back. `quoteInner` is the state's
          // only mutable object and `trackBlockQuoteLazyState` advances it IN
          // PLACE, so a plain spread would let this probe move the real quote
          // tracker and `track` below would then move it a second time. The gate
          // above already means no quote is open here, so seeding it null is both
          // free and true - and it stays safe if that gate is ever relaxed.
          const probe: ItemLazyState = { ...lazyState, quoteInner: null }
          trackItemLazyState(flush, probe, true)
          if (!probe.lazyFoldable || (probe.quoteInner !== null && lazyState.quoteInner === null)) {
            if (insideOpenFence(lazyState)) {
              // Inside an open block: structure at the block's own base, payload
              // below it. This is what keeps a deeper `:::` from closing an
              // admonition its opener wrote one column shallower.
              //
              // AND NOT A DEEPER CONTAINER. `bodyClosesAFenceAt` scans the body
              // flat - it closes a colon fence on the first bare run of its own
              // width and steps over code-fence payload, with no stack - so a
              // nested opener is not structure to it. Reading one as an opener
              // here made the inner closer close the outer block and published a
              // follower the oracle keeps in the body, on 10 documents.
              bodyReadsFlush = residual === authoredBase && probe.divDepth <= lazyState.divDepth
            } else {
              // Nothing open. A LEAF block (a heading, a table, a definition)
              // needs no base - that arm is carve#1911's, unchanged. A line that
              // OPENS one fixes the base the rest of that block is read at.
              bodyReadsFlush = true
              if (insideOpenFence(probe)) authoredBase = residual
            }
          }
        }
        if (foldedMarkerContentColumn >= 0 && residual >= foldedMarkerContentColumn && reachesSourceBody && !lazyUnderNestedItem &&
            lineOpensItemBlock(flush) && !isListMarkerLine(flush)) bodyReadsFlush = true
        return bodyReadsFlush
      }
      // Form A: an indented continuation line (with no intervening blank).
      // The indent is a COLUMN claim, not a character count: `definition_
      // continuation` is a leading indentation run, so a tab is syntax there and
      // advances to the next multiple of 4 (markup-carve/carve#888's signoff,
      // reaffirmed by markup-carve/carve#901; the same family as #692, #796 and
      // #905). Counting characters made a lone tab - column 4, past the content
      // column - end the body, while three spaces continued it, and made the
      // answer depend on how the author spelled a run rather than where it
      // landed (markup-carve/carve-js#812).
      const admitContentLine = (ln: string, reachesSourceBody: boolean): 'continue' => {
        const lineIndex = lexer.pos
        const dedented = sliceColumns(ln, contentCol, true)
        if (quoteBandFold(ln)) {
          const folded = LAZY_FRAME + dedented.trimStart()
          bodyLines.push(folded)
          bodySourceLines.push(ln)
          bodyLineNumbers.push(lexer.lineNumber(lineIndex))
          track(folded, false)
          lexer.quoteLazyLines.add(lexer.lineNumber(lineIndex))
          lexer.consume()
          return 'continue'
        }
        if (lazyState.opaque === null && RE_FOOTNOTE_DEF.test(dedented.trimStart()))
          lexer.hostedFootnoteLines.add(lexer.lineNumber(lineIndex))
        // A LINE BELOW THE OPEN ITEM'S CONTENT COLUMN OPENS NOTHING
        // (markup-carve/carve-js#2535). It reaches the body but not the item,
        // which makes it the item's lazy continuation, and a lazy
        // continuation has no structure to read: the oracle folds it into the
        // item's open paragraph whatever it is spelled as. The authored-base
        // pass asked the line's SPELLING instead - whether it looks like an
        // opener - so a heading, a break, a table, a quote, a fence or a `:::`
        // run written one column short of the item became a block of the
        // body's own, where prose at the identical column folded. One rule
        // with two answers, decided by the spelling rather than by the column.
        // A DEFINITION REGISTERS WHEREVER IT STANDS. A reference and a footnote
        // definition render nothing and are recognized from a leading run, so
        // the oracle still takes one here and the interruption veto in front
        // of the fold gate already keeps it. The comment line, the `%%%` run,
        // a following term and a list marker need no exemption: they fold or
        // interrupt on the column alone.
        const localLine = dedented.replace(/^[ \t]+/, '')
        const lazyUnderNestedItem =
          nestedItemColumn > 0 &&
          (nestedItemParagraphOpen || nestedItemRefusedAttachment) &&
          indentColumns(ln) - contentCol < nestedItemColumn &&
          !isLinkDefLine(localLine) &&
          !RE_FOOTNOTE_DEF.test(localLine) &&
          !(reachesSourceBody && RE_DEFLIST_TERM.test(localLine))
        if (!lazyUnderNestedItem && lazyState.opaque === null) {
          if (RE_DEFLIST_DEF.test(localLine)) nestedDescriptionOpened = true
          else if (dedented === localLine && (RE_DEFLIST_TERM.test(localLine) || isListMarkerLine(localLine))) nestedDescriptionOpened = false
        }
        if (!lazyUnderNestedItem) bodyBaseEligible.add(bodyLines.length)
        bodyLines.push(dedented)
        bodySourceLines.push(ln)
        bodyLineNumbers.push(lexer.lineNumber(lineIndex))
        let closedNestedAttribute = false
        if (nestedAttributeRun !== null) {
          const result = continueWrappedAttributeBlock(nestedAttributeRun, dedented.trimStart())
          nestedAttributeRun = result.verdict === 'open' ? result.run : null
          closedNestedAttribute = result.verdict === 'attributes'
        } else if (!lazyState.literalLayout && nestedItemColumn > 0 && indentColumns(dedented) >= nestedItemColumn &&
            opensWrappedAttributeBlock(dedented.trimStart())) nestedAttributeRun = dedented.trimStart()
        // ASK THE FOLD OF THE BODY AS THE BODY WILL READ IT
        // (markup-carve/carve#1911). `sliceColumns` removes the body's content
        // column and KEEPS the rest, so an opener written one column past it
        // arrives here as ` # H` - and every VISIBLE-opener arm of the tracker is
        // column-0 strict, so it read prose and left the paragraph open. The line
        // is not prose: `rebaseOverindentedBlocks` below gives it ONE AUTHORED
        // BLOCK BASE and the body parses a heading. The paragraph was decided
        // from a spelling the body never reads, one pass before the pass that
        // normalizes it. The INVISIBLE arms are whitespace-tolerant and were
        // already right, which is exactly the split between the corpus rows that
        // passed and the ones that did not - and why row 7 contradicted itself,
        // ending the body at the column and keeping it open one past.
        //
        // SS10 I1 closes the paragraph for a visible opener at or past the column
        // and SS10 I5 closes it for a definition or an attribute block, so the two
        // columns answer alike - an answer that MOVES between the body's column
        // and one past it is reading indentation rather than the rule.
        //
        // AN OPENER THAT LEAVES A BLOCK OPEN IS READ IN THE SAME SPELLING, AT ONE
        // AUTHORED BASE (markup-carve/carve#1930). Refusing the flush reading for
        // those left the body's fence state untracked across this whole band:
        // `::: note` one column past never reached `divDepth`, its `:::` was never
        // a closer, and the body ended on prose - so a CLOSED fence held the
        // paragraph open and `tail` folded in, where the same body written AT the
        // column ends it.
        //
        // The base is the OPENER's residual indent, and only lines written at it
        // are that block's structure. `normalizeAuthoredBodyBases` dedents a block
        // by the one column its opener established and leaves anything deeper
        // alone, so `::: note` at the column with its `:::` one deeper closes
        // nothing - the run is payload and the container is still collecting.
        // Reading every over-indented line flush on its own closed those, and
        // moved 26 documents off the oracle while fixing 72.
        const flush = dedented.replace(/^[ \t]+/, '')
        const residual = indentColumns(ln) - contentCol
        if (pendingMarkerLineBlock !== null) {
          if (payloadColumn(dedented) >= pendingMarkerLineBlock.column) {
            lazyState.ownedColumn = pendingMarkerLineBlock.column
            seedMarkerLineBlock(pendingMarkerLineBlock.line)
          }
          pendingMarkerLineBlock = null
        }
        const bodyReadsFlush = contentReadsFlush(dedented, flush, residual, lazyUnderNestedItem, reachesSourceBody)
        if (RE_BLOCKQUOTE.test(flush)) bodyHoldsQuote = true
        // A line AT the body's column 0 is the body's own block, so it replaces
        // whatever container stood there: another list marker keeps a list
        // collecting, anything else ends one. Read before `track`, because a
        // fence opener is still structure at this column even though it leaves
        // a verbatim region open behind it; a line INSIDE one is payload and
        // decides nothing. A line past the column belongs to the open item.
        const wasVerbatim = lazyState.opaque !== null
        const foldedMarker = lazyState.lazyFoldable && nestedItemColumn < 0 &&
          markerContentColumn(dedented) >= 0 && !insideOpenFence(lazyState)
        if (bodyReadsFlush && residual > 0 && !foldedMarker) authoredOpeners.add(bodyLines.length - 1)
        if (foldedMarker) foldedMarkerContentColumn = markerContentColumn(dedented)
        else if (bodyReadsFlush || !lazyState.lazyFoldable) foldedMarkerContentColumn = -1
        if (!foldedMarker) track(bodyReadsFlush ? flush : dedented)
        if (closedNestedAttribute) lazyState.lazyFoldable = false
        if (!foldedMarker && !wasVerbatim && (flush === dedented || (bodyReadsFlush && leadListIsQuoteHeld))) {
          nestedItemColumn = markerContentColumn(flush)
          nestedItemParagraphOpen = nestedItemHoldsOpenParagraph(flush)
          nestedItemRefusedAttachment = false
        }
        // The base belongs to the block that established it and dies with it.
        if (!insideOpenFence(lazyState)) authoredBase = null
        lexer.consume()
        return 'continue'
      }
      // Blank line: absorb it as a paragraph separator ONLY when a later line
      // is still an indented continuation. Otherwise leave it in place so the
      // entry-separator rule (a single blank before the next `:: term`) and the
      // outer block stream see it unchanged.
      const admitBlankLine = (): 'continue' | 'stop' => {
        const { offset: look, line: after } = nextContainerContent(lexer)
        // The SECOND spelling of the same rule, and it has its own job: this one
        // decides whether the body survives the blank at all, the Form A branch
        // above decides whether a line folds. Both read columns, or a lone tab
        // after a blank ends the body while Form A would have kept it.
        if (
          after !== undefined &&
          !isBlankLine(after) &&
          indentColumns(after, contentCol) >= contentCol
        ) {
          for (let k = 0; k < look; k++) {
            const lineIndex = lexer.pos
            bodyBaseEligible.add(bodyLines.length)
            bufferedBlanks.add(bodyLines.length)
            bodyLines.push('')
            bodySourceLines.push(lexer.peek())
            bodyLineNumbers.push(lexer.lineNumber(lineIndex))
            track('')
            nestedItemParagraphOpen = false
            lexer.consume()
          }
          return 'continue'
        }
        // A blank reaches every frame, so it is the open fence's content (corpus 291, carve#4033).
        // The run stays in the stream as well: it still separates what follows.
        if (bodyEndsInOpenCodeFence(bodyLines)) {
          for (let k = 0; k < look; k++) {
            const lineIndex = lexer.pos + k
            bufferedBlanks.add(bodyLines.length)
            bodyLines.push('')
            bodySourceLines.push(lexer.peek(k))
            bodyLineNumbers.push(lexer.lineNumber(lineIndex))
          }
        }
        return 'stop'
      }
      const admitLazyBlockLine = (ln: string, below: string, atDocumentColumn: boolean): DescriptionVerdict => {
        const followerSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? ln
        const reachedQuotedDescription = quoteDepth > 0 &&
          quotePrefixDepth(followerSource) >= quoteDepth &&
          sourceColumn(followerSource, quoteDepth - 1) === quoteHostColumn &&
          sourceColumn(followerSource, quoteDepth) > descriptionSourceColumn
        if (lexer.hostBody === 'list' && lazyState.lazyFoldable && lazyState.opaque === null &&
            !reachedQuotedDescription && !insideOpenQuoteParagraph(lazyState) &&
            !isRetainableLineComment(lexer, below) && commentFenceRun(below) === undefined &&
            lineOpensBlock(below) && !opensCodeFence(below)) {
          return 'stop'
        }
        // carve#3295: below the body's column a heading, break, table row or
        // quote marker opens nothing, so it folds into the open paragraph. In
        // an item the line reaches the item's column and opens there, unless a
        // quote holds the band (X2); the item hands that line over flush, so
        // its column is read from the source.
        const quoteHoldsBand = (): boolean => {
          for (let k = bodyLines.length - 1; k >= 0; k--) {
            if (!bodyLines[k]!.startsWith(LAZY_FRAME)) return RE_BLOCKQUOTE.test(bodyLines[k]!.trimStart())
          }
          return false
        }
        if ((RE_HEADING.test(below) || RE_HR.test(below) || isTableRow(below) || RE_BLOCKQUOTE.test(below)) &&
            lazyState.opaque === null && lazyState.lazyFoldable &&
            (atDocumentColumn
              ? lexer.hostBody === 'list' && quoteHoldsBand() &&
                lexer.lineStartColumn(lexer.pos) - lexer.lineStartColumn(firstLineIndex) > 0 &&
                lexer.lineStartColumn(lexer.pos) - lexer.lineStartColumn(firstLineIndex) < contentCol
              : indentColumns(ln, contentCol) < contentCol && (lexer.hostBody !== 'list' || quoteHoldsBand()))) {
          lexer.itemLazyLines.add(lexer.lineNumber(lexer.pos))
          const folded = LAZY_FRAME + below
          bodyLines.push(folded)
          bodySourceLines.push(ln)
          bodyLineNumbers.push(lexer.lineNumber(lexer.pos))
          track(folded, false)
          lexer.consume()
          return 'continue'
        }
        return undefined
      }
      const admitBelowColumnComment = (ln: string, below: string, atDocumentColumn: boolean, belowLeadColon: boolean): DescriptionVerdict => {
        const priorLazyDefinition = bodySourceLines.length > 1 &&
          indentColumns(bodySourceLines.at(-1) ?? '', contentCol) < contentCol &&
          (isLinkDefLine(bodySourceLines.at(-1)?.trimStart() ?? '') ||
            RE_FOOTNOTE_DEF.test(bodySourceLines.at(-1)?.trimStart() ?? ''))
        if (belowLeadColon && !RE_COMMENT_LINE.test(below) &&
            (RE_HR.test(below) || isTableRow(below) ||
              // A list marker, and a fence with no closer, are paragraph text
              // here as anywhere (PART 9 §10 I2, I4).
              (atDocumentColumn && ((lineOpensBlock(below) && !isListMarkerLine(below) &&
                (!/^[`~]/.test(below) || startsInterruptingBlock(lexer, below))) || isBlockAttributeLine(below) ||
                /^:{3,}[ \t]*$/.test(below)) &&
                !(priorLazyDefinition && opensCodeFence(below))))) return 'stop'
        // A COMMENT INSIDE A SPAN THIS BODY ALREADY HOLDS IS NOT "A COMMENT BELOW
        // THE COLUMN" (markup-carve/carve-js#2255, markup-carve/carve#2488). The
        // body ends at one of those, which is right for an opener and for the `%%`
        // line form; the other half of a span the body opened belongs to it, and
        // ending here split the pair so the payload reached the page.
        if (commentFenceRun(below) !== undefined &&
            bodyHoldsClosableCommentSpan(bodyLines, bodySpanScan, run => commentBlockHasCloser(lexer, run, lexer.pos - 1))) {
          const lineIndex = lexer.pos
          // ONE COLUMN of the authored indentation is kept, as the list collector
          // keeps it, so the body's own parse cannot read a delimiter written below
          // the column back as an authored column-0 one. A delimiter already AT
          // column 0 keeps it (markup-carve/carve-js#1623).
          bodyLines.push(atDocumentColumn ? ln : ' ' + below)
          bodySourceLines.push(ln)
          bodyLineNumbers.push(lexer.lineNumber(lineIndex))
          track(below)
          belowCommentSpan = false
          lexer.consume()
          return 'continue'
        }
        // A comment below the body's column closes the body (carve#3885).
        if (lazyState.opaque === null && RE_COMMENT_LINE.test(below)) return 'stop'
        const lastBodyLine = bodyLines.at(-1)?.trimStart() ?? ''
        if (atDocumentColumn && lazyState.literalColon === undefined && lazyState.divDepth > 0 && lazyState.opaque === null &&
            !RE_COMMENT_LINE.test(below) &&
            ((colonFenceShapeEndsLazyContinuation(first) &&
              (RE_HEADING.test(lastBodyLine) || RE_HR.test(lastBodyLine) || isTableRow(lastBodyLine))) ||
              !lazyState.lazyFoldable)) return 'stop'
        return undefined
      }
      const belowBandInterrupts = (ln: string, below: string, atDocumentColumn: boolean): boolean => {
        const lineIndent = indentColumns(ln)
        const source = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? ln
        const markedQuoteLine = quoteDepth > 0 && quotePrefixDepth(source) >= quoteDepth
        const sourceInHost = sourceColumn(source, quotePrefixDepth(markerSource))
        if (lexer.atDocumentLevel && !markedQuoteLine && sourceInHost < bodySourceColumn && RE_ABBR_DEF.test(below)) return true
        if (!markedQuoteLine && lazyState.lazyFoldable && opensCodeFence(below) &&
            sourceInHost > bodySourceColumn - contentCol && sourceInHost < bodySourceColumn) return false
        if (!markedQuoteLine && lineIndent > 0 && lineIndent < contentCol && opensCodeFence(below)) return true
        return startsInterruptingBlock(lexer, below, true, false, atDocumentColumn)
      }
      const foldsLazyLine = (
        ln: string,
        below: string,
        atDocumentColumn: boolean,
        belowLeadColon: boolean,
        quoteFootnoteBelowBody: boolean,
      ): boolean => (
        (lazyState.lazyFoldable || quoteFootnoteBelowBody || belowCommentSpan ||
          (belowLeadColon && bodyLines.length > 1 && RE_COMMENT_LINE.test(below)) ||
          (RE_DEFLIST_TERM.test(bodyLines[0] ?? '') &&
            (bodyLines.at(-1)?.startsWith(LAZY_FRAME) === true ||
              (!nestedDescriptionOpened && indentColumns(bodySourceLines.at(-1) ?? '') > contentCol &&
                isBlockAttributeLine(bodyLines.at(-1)?.trimStart() ?? ''))))) &&
        !(RE_LINE_BLOCK_OPEN.test(first) && markerContentColumn(below) > 0) &&
        (quoteFootnoteBelowBody || belowCommentSpan || (lazyState.opaque === null &&
          ((RE_COMMENT_LINE.test(below) && !atDocumentColumn) || isRetainableLineComment(lexer, below))) ||
          (indentColumns(ln, contentCol) < contentCol &&
            (lazyState.divDepth > 0 || lazyState.inDefList === 'term') ||
            (insideOpenQuoteParagraph(lazyState) && !atDocumentColumn && RE_FOOTNOTE_DEF.test(below)) ||
            !belowBandInterrupts(ln, below, atDocumentColumn)))
      )
      const foldLazyLine = (ln: string, below: string, atDocumentColumn: boolean): 'continue' => {
        const lineIndex = lexer.pos
        if (indentColumns(ln, contentCol) < contentCol) {
          lexer.itemLazyLines.add(lexer.lineNumber(lineIndex))
        }
        // CLAMPED TO ONE COLUMN, as the list collector clamps it
        // (markup-carve/carve-js#540, #1623). A block-shaped line below the
        // content column opens nothing (§24 C3) and folds here for that
        // reason, but the body's own reparse reads columns from 0, so a fence
        // line left flush left opened a code block there instead of staying
        // the paragraph's inline verbatim run - one rule with two answers,
        // decided by whether a list or a description body sat above it
        // (markup-carve/carve-js#2515).
        //
        // THE CODE FENCE IS THE ONLY KIND THAT NEEDS IT here. This body's
        // lines are already dedented by its content margin, so the column is
        // not a clamp on indentation the author wrote but one added past the
        // body's own column 0 - and a list marker moved off that column opens
        // a second list where the fold continues the first. Every other kind
        // either ends the body above or reads the same at both columns.
        //
        const folded =
          RE_CAPTION.test(below) && lazyState.opaque === null
            ? LAZY_FRAME + below
            : indentColumns(ln, contentCol) < contentCol && !RE_COMMENT_LINE.test(below) &&
                (lazyState.divDepth > 0 || lazyState.inDefList === 'term')
              ? LAZY_FRAME + below
              : atDocumentColumn && opensCodeFence(below)
                ? ' ' + below
                : ln
        bodyLines.push(folded)
        bodySourceLines.push(ln)
        bodyLineNumbers.push(lexer.lineNumber(lineIndex))
        // Track the body's reading: retained openers stay flush, while a
        // clamped fence continues the paragraph.
        const paragraphOpen = lazyState.lazyFoldable
        track(folded, false)
        // A folded marker line is paragraph text, whatever its content would open in an item.
        if (paragraphOpen && folded === ln && markerContentColumn(below) >= 0) lazyState.lazyFoldable = true
        const commentRun = commentFenceRun(below)
        if (commentRun !== undefined && commentBlockHasCloser(lexer, commentRun)) belowCommentSpan = true
        lexer.consume()
        return 'continue'
      }
      const admitLazyLine = (ln: string): 'continue' | 'stop' => {
        // A new term/definition marker ends this definition (the outer loop
        // picks it up). An empty term marker is not one: `::` and `:: ` are the
        // same line, a term with no content, so it folds (#1891).
        if (RE_DEFLIST_TERM.test(ln) || RE_DEFLIST_DEF.test(ln)) return 'stop'
        if (ln.startsWith(LAZY_FRAME) && RE_DEFLIST_TERM.test(stripLazyFrame(ln)) &&
            entryColumn() > listColumn &&
            entryColumn() < bodySourceColumn) return 'stop'
        const below = ln.replace(/^[ \t]+/, '')
        if (lazyState.opaque === null && /^:{3,}[ \t]*$/.test(below) &&
            indentColumns(ln, contentCol) < contentCol) return 'stop'
        if (indentColumns(ln, contentCol) < contentCol && !RE_COMMENT_LINE.test(below) &&
            bodyHoldsClosableCommentSpan(bodyLines, bodySpanScan, run => commentBlockHasCloser(lexer, run, lexer.pos - 1))) return 'stop'
        const atDocumentColumn = below === ln
        const original = sourceLineAt(lexer, lexer.pos, ln)
        if (descriptionTermOwnerReached(lazyState.inDefList === 'term', below,
          sourceColumn(original, quotePrefixDepth(markerSource)), descriptionSourceColumn,
          lineOpensItemBlock)) return 'stop'
        if (isBelowColumnListAfterTerm(lazyState, atDocumentColumn, below, isListMarkerLine)) {
          const lineIndex = lexer.pos
          bodyBaseEligible.add(bodyLines.length)
          bodyLines.push(below)
          bodySourceLines.push(ln)
          bodyLineNumbers.push(lexer.lineNumber(lineIndex))
          track(below)
          lexer.consume()
          return 'continue'
        }
        if (nestedAttributeRun !== null) {
          const result = continueWrappedAttributeBlock(nestedAttributeRun, below)
          nestedAttributeRun = result.verdict === 'open' ? result.run : null
          if (result.verdict === 'attributes' || result.verdict === 'open') {
            const decision = foldLazyLine(ln, below, atDocumentColumn)
            if (result.verdict === 'attributes') lazyState.lazyFoldable = false
            return decision
          }
        }
        if (quoteBandFold(ln)) {
          const lineIndex = lexer.pos
          const folded = LAZY_FRAME + below
          bodyLines.push(folded)
          bodySourceLines.push(ln)
          bodyLineNumbers.push(lexer.lineNumber(lineIndex))
          track(folded, false)
          lexer.quoteLazyLines.add(lexer.lineNumber(lineIndex))
          lexer.consume()
          return 'continue'
        }
        const blockVerdict = admitLazyBlockLine(ln, below, atDocumentColumn)
        if (blockVerdict !== undefined) return blockVerdict
        const belowLeadColon = colonFenceShapeEndsLazyContinuation(first) &&
          indentColumns(ln, contentCol) < contentCol && lazyState.divDepth > 0 &&
          lazyState.opaque === null
        const commentVerdict = admitBelowColumnComment(ln, below, atDocumentColumn, belowLeadColon)
        if (commentVerdict !== undefined) return commentVerdict
        const quoteFootnoteBelowBody = RE_BLOCKQUOTE.test(first) && !atDocumentColumn &&
          RE_FOOTNOTE_DEF.test(below) && indentColumns(ln, contentCol) < contentCol
        if (foldsLazyLine(ln, below, atDocumentColumn, belowLeadColon, quoteFootnoteBelowBody)) return foldLazyLine(ln, below, atDocumentColumn)
        return 'stop'
      }
      // A definition continues like a list item (PART 9 \u00a717):
      //  - form A: a deeper-indented line (>= the content column) folds in, and a
      //    blank line is tolerated when a later line still continues the body, so
      //    a `<dd>` can hold multiple paragraphs;
      //  - form B: a lone `+` attaches the FOLLOWING flush-left block, so rich
      //    content can join the definition with no indentation (the un-prefixed
      //    analogue of the list-item and block-quote `+` forms; a leading `:  +`
      //    is the same marker opening the FIRST block);
      //  - lazy continuation: a flush-left line with no blank before it that does
      //    NOT start an interrupting block folds into the open paragraph (the same
      //    CommonMark lazy rule list items and block quotes use, matching djot).
      runIndentationContainer(lexer, 'description', 0, contentCol, quotePrefixDepth(markerSource), (admission) => {
        const ln = admission.line
        if (lexer.separatingAbbreviations?.has(lexer.pos)) return 'stop'
        const early = admitPlusContinuation(ln)
        if (early !== undefined) return early
        const sourceFollower = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? ln
        const reachesSourceBody = sourceColumn(sourceFollower, quotePrefixDepth(markerSource)) >= bodySourceColumn
        const left = leavesBeforeSourceBody(ln, sourceFollower, reachesSourceBody)
        if (left !== undefined) return left
        if (admission.kind === 'content') return admitContentLine(ln, reachesSourceBody)
        if (admission.kind === 'blank') return admitBlankLine()
        return admitLazyLine(ln)
      })
      // A refused first-block marker owns no list child. The description's
      // marker-line item starts at its authored source column, while its body
      // sublexer starts at column zero. Rebase equal-source-column list markers
      // to that same sublexer column so they remain siblings (§17 L4).
      if (firstBlockOpenerContent(first) && isListMarkerLine(first)) {
        const sourceOffset = markerSource.lastIndexOf(first)
        const leadColumn = sourceOffset < 0 ? -1 : sourceColumnAt(markerSource, sourceOffset)
        const rootLines = lexer.rootLines ?? lexer.lines
        for (let index = 1; index < bodyLines.length; index++) {
          const source = rootLines[bodyLineNumbers[index]! - 1]
          if (source !== undefined && sourceColumn(source, quotePrefixDepth(source)) === leadColumn &&
              isListMarkerLine(bodyLines[index]!.trimStart())) bodyLines[index] = bodyLines[index]!.trimStart()
        }
      }
      // The same authored-base rule list items use, now in the definition body's
      // coordinate system after its own content margin was removed - plus
      // Definition entries use the same exact block extent in every container.
      restoreVerbatimBlanks(bodyLines, bodySourceLines, bufferedBlanks, (index) =>
        index === 0 && !/^\+[ \t]*$/.test(first)
          ? contentCol
          : indentColumns(bodySourceLines[index] ?? ''),
      )
      if (RE_BLOCKQUOTE.test(bodyLines[0] ?? '')) {
        for (let index = 1; index < bodyLines.length; index++) {
          if (isBlankLine(bodyLines[index]!) || opensCodeFence(bodyLines[index]!.trimStart())) break
          if (isLinkDefLine(bodyLines[index]!.trimStart()) &&
              !RE_FOOTNOTE_DEF.test(bodyLines[index]!.trimStart()) &&
              !lexer.quoteLazyLines.has(bodyLineNumbers[index]!)) {
            bodyLines[index] = bodyLines[index]!.trimStart()
          }
        }
      }
      const sub = nestedSubLexer(lexer, bodyLines, firstLineIndex, bodyLineNumbers)
      sub.sublistsCarryAuthoredBase = true
      sub.hostBody = 'description'
      sub.hostBodyRoot = 'description'
      sub.hostSourceContentColumn = bodySourceColumn
      return bodyLines.length === 1 && trimEndSpaceTab(bodyLines[0] ?? '') === '{empty}' ? [] : parseSession.parseBlocks(sub, 0)
    }
    /**
     * The span covering document lines `first`..`last` inclusive, marker and all.
     *
     * `last` is never a blank line, and this does NOT trim one. `parseDefBody`
     * absorbs a blank only when it has already looked ahead and found a line that
     * still continues the body, so the next turn of its loop always consumes that
     * line - the last thing it takes is a content line by construction.
     *
     */
    function lineRange(lx: Lexer, first: number, last: number): Position | undefined {
      // Measure the final line after stripping its lazy frame.
      const lastLine = lx.lineAt(last) === undefined ? undefined : stripLazyFrame(lx.lineAt(last)!)
      if (lastLine === undefined) return undefined

      return {
        startLine: lx.lineNumber(first),
        endLine: lx.lineNumber(last),
        startColumn: lx.lineStartColumn(first),
        endColumn: lx.lineStartColumn(last) + lastLine.length,
        startOffset: lx.lineOffset(first),
        endOffset: lx.lineOffset(last) + lastLine.length,
      }
    }

    /** `lineRange` from the entry marker, past the indent a list-hosted `peekEntry` trims. */
    function markerRange(lx: Lexer, first: number, last: number): Position | undefined {
      const span = lineRange(lx, first, last)
      const lead = leadingWhitespace(stripLazyFrame(lx.lineAt(first) ?? ''))
      if (span && lead > 0) {
        span.startColumn = (span.startColumn ?? 1) + lead
        span.startOffset = (span.startOffset ?? 0) + lead
      }
      return span
    }

    // THE ENTRY MATCHER IS THE ONE PREDICATE THAT SEES THROUGH THE FRAME
    // (PART 9 SS24 C3's LENIENT def-list entry). A `::` or `:` line a quote
    // folded in reaches no column here, so it attaches to the open term from
    // wherever it landed - which is why this collector unframes before every
    // entry test while the block dispatch never does.
    const peekEntry = (n = 0) => {
      const line = stripLazyFrame(lexer.peek(n) ?? '')
      return lexer.hostBody === 'list' && !lexer.definitionLeadFromItemMarker ? line.trimStart() : line
    }
    primeSiblingAbbreviations(lexer, helpers)
    const entryColumn = (n = 0): number => {
      const index = lexer.pos + n
      const ownerColumn = lexer.returnedDescriptionOwnerColumns.get(lexer.lineNumber(index))
      if (ownerColumn !== undefined && ownerColumn > lexer.hostContentColumn) return ownerColumn
      const source = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(index) - 1] ?? lexer.peek(n) ?? ''
      const marker = RE_DEFLIST_TERM.test(peekEntry(n)) ? '::' : ':'
      const markerOffset = source.indexOf(marker)
      return markerOffset >= 0
        ? entryColumnAt(source, markerOffset)
        : entryLeadColumn(source)
    }
    const listColumn = entryColumn()
    const authoredList = (lexer.hostBody === 'list' || lexer.hostBody === 'description') && !lexer.definitionLeadFromItemMarker &&
      listColumn > lexer.hostContentColumn &&
      !lexer.nonAuthoredDefinitionStarts.has(lexer.lineNumber(lexer.pos))
    const entryReachesList = () => !authoredList || entryColumn() === listColumn
    while (!lexer.eof() && RE_DEFLIST_TERM.test(peekEntry()) && entryReachesList()) {
      const terms: InlineNode[][] = []
      const termSpans: (Position | undefined)[] = []
      const definitions: BlockNode[][] = []
      const definitionLines: number[] = []
      const definitionSpans: (Position | undefined)[] = []
      let currentTermSourceColumn = listColumn
      let currentTermReturned = false
      while (!lexer.eof()) {
        const t = RE_DEFLIST_TERM.exec(peekEntry())
        if (!t || !entryReachesList()) break
        const termLineIndex = lexer.pos
        const termSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(termLineIndex) - 1] ?? ''
        const termMarkerOffset = termSource.indexOf('::')
        const termColumn = termMarkerOffset >= 0
          ? entryColumnAt(termSource, termMarkerOffset)
          : entryLeadColumn(termSource)
        currentTermSourceColumn = termColumn
        currentTermReturned = lexer.returnedDescriptionOwnerColumns.has(lexer.lineNumber(termLineIndex))
        lexer.consume()
        // A term is multi-line like a heading: a following plain line folds into
        // it with a soft break, instead of ending the list and stranding the
        // definition. A blank line, a new marker (`::` / `:  `), or a block
        // opener ends the term.
        // Each line drops its own trailing layout below, once the fold is
        // complete. In particular, the separator on a content-less marker-shaped
        // continuation (`* `, `. `) is content here.
        // A comment past the container column stays a comment and does not end
        // the term (carve#2411). Like a paragraph, the term's inline content
        // never reaches across it, so each run of lines between comments is
        // scanned on its own. `lines` holds the source index of each line of a
        // run; the first run starts on the term's own line.
        type TermPart = { lines: number[]; text: string } | Comment
        const parts: TermPart[] = [{ lines: [termLineIndex], text: t[1]! }]
        const strippedIndent = new Map<number, number>()
        const termFence: TermFenceState = { active: null, closesOnLine: false }
        while (!lexer.eof()) {
          const next = lexer.peek()!
          if (commentLeavesTerm(lexer, next, termColumn) ||
              (lexer.atDocumentLevel && RE_ABBR_DEF.test(next) && entryLeadColumn(next) <= termColumn &&
                abbreviationBridgesDescription(lexer, helpers))) break
          if (/^[ \t]+%%/.test(next)) {
            const first = lexer.pos
            const fence = RE_COMMENT_BLOCK_ANY.exec(next)
            const comment: Comment =
              fence && commentBlockHasCloser(lexer, fence[1]!.length)
                ? parseCommentBlock(lexer)
                : { type: 'comment', block: false, content: commentLineContent(lexer.consume()) }
            const span = lexer.hasDocumentOffsets ? lineRange(lexer, first, lexer.pos - 1) : undefined
            if (span) {
              // A LEAF BEGINS AT ITS MARKUP (carve#1928). `lineRange` starts at the
              // line, and here that is the term's indent, which places nothing -
              // the shift `attachBlockPos` applies on the ordinary comment path.
              const lead = leadingWhitespace(next)
              span.startColumn = (span.startColumn ?? 1) + lead
              span.startOffset = (span.startOffset ?? 0) + lead
              comment.pos = span
            }
            parts.push(comment)
            continue
          }
          // The ENTRY tests unframe; `endsHeadingOrQuote` deliberately does not,
          // because a framed heading is the term's text rather than a block.
          const nextEntry = peekEntry()
          const belowList = lexer.hostBody === 'list' && !lexer.definitionLeadFromItemMarker &&
            !lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos)) &&
            (RE_DEFLIST_TERM.test(nextEntry) || RE_DEFLIST_DEF.test(nextEntry)) &&
            entryColumn() < listColumn &&
            (authoredList || entryColumn() < lexer.hostContentColumn)
          const nextSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? next
          const nextSourceColumn = termContinuationSourceColumn(nextSource, nextEntry)
          const pastTermOwner = nextSourceColumn > termOwnerColumn(lexer, listColumn)
          const foldedFenceLine = inFoldedTermFence(termFence, next, nextEntry,
            nextSourceColumn, pastTermOwner)
          // A separator between the item's content column and an over-indented term's column is term text.
          const separatorBelowTerm = lexer.hostBody === 'list' && !lexer.definitionLeadFromItemMarker &&
            !lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos)) && RE_DEFLIST_DEF.test(nextEntry) &&
            termColumn > lexer.hostContentColumn && nextSourceColumn < termColumn &&
            nextSourceColumn >= lexer.hostContentColumn
          const leavesTerm = authoredList && belowList && entryColumn() >= lexer.hostContentColumn && !separatorBelowTerm
          const markerTermText = isMarkerLineTermText(lexer, nextEntry, entryColumn(), termColumn)
          const nextPastTerm = isPastTermEntry(lexer, nextSource, nextEntry, termColumn,
            markerTermText, entryLeadColumn)
          // AN UNTERMINATED FENCE ENDS A TERM (markup-carve/carve-js#2500).
          // `endsHeadingOrQuote` inherits §10's closer lookahead, which withholds
          // interruption from a fence with no closer ahead so an OPEN PARAGRAPH
          // keeps it as text. A term is not a paragraph: the oracle ends the term
          // and hands the document the fence, as it already does under a heading.
          // The test is column-0 anchored, so an indented fence still folds in.
          if (!foldedFenceLine && (
            isBlankLine(next) ||
            RE_CAPTION.test(next) ||
            termBoundaryReached(leavesTerm, lexer.hostBody, nextEntry, nextSourceColumn,
              termColumn, listColumn, lexer.hostSourceContentColumn ?? 0, lineOpensItemBlock) ||
            (!belowList && !nextPastTerm && !separatorBelowTerm && !markerTermText &&
              !isItemLazyLine(lexer) &&
              !lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos)) &&
              (RE_DEFLIST_TERM.test(nextEntry) || RE_DEFLIST_DEF.test(nextEntry))) ||
            opensCodeFence(next) ||
            ((!pastTermOwner || isListMarkerLine(nextEntry)) &&
              endsHeadingOrQuote(lexer) && !RE_ABBR_DEF.test(next))
          ))
            break
          // The term is the other place a framed line becomes text. The frame
          // kept the opener tests above from claiming it; it comes off before
          // the fold, exactly as the oracle unframes here.
          let continuation = lexer.hostBodyRoot === 'description' &&
            isBlockAttributeLine(next.trimStart())
              ? stripLazyFrame(next).trimStart()
              : stripLazyFrame(next)
          if (separatorBelowTerm) {
            const stripped = continuation.replace(/^[ \t]+/, '')
            strippedIndent.set(lexer.pos, continuation.length - stripped.length)
            continuation = stripped
          }
          const retainsTermIndent = nextPastTerm || lexer.definitionLeadFromItemMarker &&
            !lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos)) && nextSourceColumn > termColumn
          if (retainsTermIndent && lexer.hostBody === 'list') {
            const sourceIndent = entryLeadColumn(nextSource) - termColumn
            const retainedIndent = indentColumns(continuation)
            if (sourceIndent > retainedIndent)
              continuation = ' '.repeat(sourceIndent - retainedIndent) + continuation
          }
          if (restoresDescriptionTermIndent(lexer, nextSourceColumn)) {
            continuation = ' '.repeat(missingTermIndent(nextSourceColumn, termColumn,
              lexer.hostSourceContentColumn ?? 0, indentColumns(continuation))) + continuation
          }
          // A line below the item's content column keeps none of its indent in the term.
          if (dropsTermIndent(lexer, nextSourceColumn, termColumn, retainsTermIndent)) {
            const stripped = continuation.replace(/^[ \t]+/, '')
            strippedIndent.set(lexer.pos, continuation.length - stripped.length)
            continuation = stripped
          }
          const last = parts[parts.length - 1]!
          if ('lines' in last) {
            last.text += '\n' + continuation
            last.lines.push(lexer.pos)
          } else {
            parts.push({ lines: [lexer.pos], text: continuation })
          }
          lexer.consume()
        }
        // `t` was matched against the UNFRAMED line, so the index comes from
        // that same string: the frame is not in the author's source and must
        // not be counted into the offset. This corrects arithmetic rather than
        // output - a framed line only ever reaches an item body sub-lexer, which
        // is unanchored and publishes no positions, so no document of the 13790
        // swept moves. It is here so the two halves read the same string.
        const termStart = stripLazyFrame(lexer.lineAt(termLineIndex)!).indexOf(t[1]!)
        // A continuation line folds in whole, indent included, and the scanner
        // strips that indent when it builds the text node - so a single base
        // offset drifts by the indent on every line after the first. Each line
        // gets its own origin instead (#441): the term's own line starts after its
        // `::` marker, a continuation line at its left edge.
        const anchorOf = (source: number) => {
          const shift = source === termLineIndex ? termStart : strippedIndent.get(source) ?? 0
          return {
            offset: lexer.lineOffset(source) + shift,
            column: lexer.lineStartColumn(source) + shift,
            line: lexer.lineNumber(source),
          }
        }
        const termInlines: InlineNode[] = []
        const partBoundaryBreaks: number[] = []
        parts.forEach((part, index) => {
          // Preserve each source line boundary, including either side of a comment.
          if (index > 0) {
            partBoundaryBreaks.push(termInlines.length)
            termInlines.push({ type: 'soft_break' })
          }
          if (!('lines' in part)) {
            termInlines.push(part)
            return
          }
          const origin = anchorOf(part.lines[0]!)
          termInlines.push(
            ...parseSession.parseInline(dropTrailingWhitespace(part.text), lexer.abbrDefs, lexer.linkDefs, {
              anchored: lexer.hasDocumentOffsets,
              baseOffset: origin.offset,
              startLine: origin.line,
              startColumn: origin.column,
              ...(part.lines.length > 1 ? { lineAnchors: part.lines.map(anchorOf) } : {}),
            }),
          )
        })
        // A part-boundary break is placed once both its neighbours exist: from the
        // preceding sibling's end to the following sibling's start, the span the
        // fold's own in-part breaks already publish (carve#2469).
        for (const i of partBoundaryBreaks) {
          const prev = termInlines[i - 1]?.pos
          const next = termInlines[i + 1]?.pos
          if (prev && next) {
            termInlines[i]!.pos = {
              startLine: prev.endLine,
              endLine: next.startLine,
              ...(prev.endOffset !== undefined ? { startOffset: prev.endOffset } : {}),
              ...(next.startOffset !== undefined ? { endOffset: next.startOffset } : {}),
              ...(prev.endColumn !== undefined ? { startColumn: prev.endColumn } : {}),
              ...(next.startColumn !== undefined ? { endColumn: next.startColumn } : {}),
            }
          }
        }
        terms.push(termInlines)
        termSpans.push(
          lexer.hasDocumentOffsets
            ? markerRange(lexer, termLineIndex, lexer.pos - 1)
            : undefined,
        )
      }
      while (!lexer.eof()) {
        // A blank line before a `:  ` definition is allowed: a definition may be
        // separated from its term (or a previous definition) by a blank line for
        // readability, matching djot. The blank is a separator only - it does not
        // end the entry when a `:  ` definition follows.
        if (!RE_DEFLIST_DEF.test(peekEntry()) && !advanceToEntry(lexer, RE_DEFLIST_DEF, helpers,
          parseSession, comment => { terms.at(-1)?.push(comment) })) break
        const defLineIndex = lexer.pos
        const defSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(defLineIndex) - 1] ?? ''
        const defMarkerOffset = defSource.indexOf(':')
        // A marker left of this term belongs to a surviving outer owner.
        if (defMarkerOffset >= 0 &&
            entryColumnAt(defSource, defMarkerOffset) <
              definitionEntryFloor(lexer, currentTermReturned, currentTermSourceColumn)) break
        const d = !entryReachesList() ? null : RE_DEFLIST_DEF.exec(peekEntry())
        if (!d) break
        lexer.consume()
        definitionLines.push(lexer.lineNumber(defLineIndex))
        definitions.push(parseDefBody(descriptionLead(d[2]!), defLineIndex, deflistContentCol(d[1]!)))
        // The description's own extent anchors to its MARKER LINE. The wire
        // derives the END from the placed children (definition-list-wire.ts), so
        // this only supplies the start and the fallback when the body produced no
        // placed child at all - a description whose only content hoists to the
        // root (carve-js#813). In that case the span is the marker line and stops
        // there: §4 ends a closerless container at its last placed child, and a
        // hoisted sibling is not a child (carve#1522), so the continuation lines
        // that carried the hoisted definitions are not part of the description
        // (carve#1963). It always takes at least the marker line, so the range is
        // never empty and never runs backwards.
        definitionSpans.push(
          lexer.hasDocumentOffsets ? markerRange(lexer, defLineIndex, defLineIndex) : undefined,
        )
      }
      items.push({ terms, definitions, termSpans, definitionLines, definitionSpans })
      if (!RE_DEFLIST_TERM.test(peekEntry()) && !advanceToEntry(lexer, RE_DEFLIST_TERM, helpers,
        parseSession, comment => definitions.at(-1)?.push(comment))) break
    }
    return { type: 'definition_list', items }
  }

}
