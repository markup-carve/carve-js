import { Lexer, indentColumns, isBlankLine } from './parse-lexer.js'
import type { LinkDef } from './inline/inline-resolution.js'
import type {
  CloserIndex,
  CommentScopeMemo,
  OpenContainer,
  PrepassScope,
  LinkDefMatch,
} from '../parse.js'
import type { CarveExtension } from '../extension.js'
import type { linkDefinitionHelpers } from '../parse.js'

type LinkDefinitionSession = {
  definitionRegionLines: Set<number> | null
  activeMatchers: CarveExtension[]
  probingLazyParagraph: boolean
  verseOwnedLines(lexer: Lexer): boolean[] | undefined
  isLinkDefLine(line: string): boolean
  matchLinkDef(line: string): LinkDefMatch | null
  lineFoldsIntoOpenParagraph(
    lexer: Lexer,
    candidate: number,
    budget: number,
  ): boolean | 'unknown'
}

type Composed = ReturnType<typeof linkDefinitionHelpers.composeContainerPrefix>

type PrepassFence = {
  ch: string
  len: number
  contentCol: number
  quoted: boolean
  scope: PrepassScope
  divWidth: number | null
  hasCloser: boolean
}

type PrepassDiv = {
  width: number
  opens: boolean
  scope: PrepassScope
  host: 'list' | 'description' | 'footnote' | null
}

type ListColumn = { col: number; inQuote: boolean; kind: 'list' | 'description' }

// The pass's state carried from one line to the next.
type LinkDefScan = {
  session: LinkDefinitionSession
  lexer: Lexer
  fence: PrepassFence | null
  verseLines: boolean[] | undefined
  commentFence: number | null
  commentScopeMemo: CommentScopeMemo
  divs: PrepassDiv[]
  listCols: ListColumn[]
  sawDeflistTerm: boolean
  deflistQuoteDepth: number | null
  openCols: OpenContainer[]
  prevBlank: boolean
  afterPreviousTerm: boolean
  inFootnoteBody: boolean
  noteColumns: Array<{ column: number; quotes: number; termText: boolean; openedAt: number; quotedLeadParagraph: boolean }>
  inlineBodyList: boolean
  plusColumn: number | null
  paraState: 'no' | 'yes' | 'ask'
  paraLine: string
  paraLinePlusOpens: boolean
  paraDepth: number
  paragraphFoldedAbove: boolean
  attributeState: { attrRun: string | null }
  hasBlockMatchers: boolean
  lazyProbeBudget: number
  prepassClosers: CloserIndex['code'] | null
  term: { col: number; quotes: number } | null
}

// One line as the pass reads it, before any container is decided.
type LineRead = {
  idx: number
  raw: string
  afterTerm: boolean
  kept: string
  line: string
  unquoted: string
  wasPrevBlank: boolean
  rawQuoteDepth: number
  rawIsQuoted: boolean
  rawTrimmed: string
}

type ListRead = {
  containerOpenAbove: boolean
  listColsBeforeMarker: ListColumn[] | null
  startsBlock: boolean
}

type ParagraphVerdict = { paraWasOpen: boolean; collectsNothing: boolean }

type OpenerView = { openerCol: number; scopeCol: number; deIndented: string }

export function createLinkDefinitionCollector(
  helpers: typeof linkDefinitionHelpers,
) {
  const {
    FOOTNOTE_BODY_COLUMN,
    RE_ABBR_DEF,
    RE_ADMONITION_CLOSE,
    RE_AFTER_TERM,
    RE_BLOCKQUOTE,
    RE_COMMENT_BLOCK_ANY,
    RE_DEFLIST_DEF,
    RE_DEFLIST_SEPARATOR,
    RE_DEFLIST_TERM,
    RE_FENCE,
    RE_FENCE_CLOSER,
    RE_FOOTNOTE_DEF,
    RE_PREPASS_ANY_FENCE_CLOSER,
    RE_RAW_FENCE,
    RE_TASK,
    buildCodeCloserIndex,
    codeCloserPossibleIn,
    commentBlockHasCloser,
    commentCloserInScope,
    commentFenceRun,
    composeContainerPrefix,
    containerQuoteDepth,
    deflistContentCol,
    dropTrailingWhitespace,
    isBlockAttributeLine,
    isColonFenceOpener,
    isContinuationMarker,
    leadingWhitespace,
    markerContentColumn,
    markerFreeContent,
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
  } = helpers

  // `codeCloserPossible` over the prepass's own view of a closer, built once per
  // document and only when a paragraph is actually open under a fence-shaped
  // line. A scan per opener is the quadratic shape this index exists to close.
  function closers(s: LinkDefScan): CloserIndex['code'] {
    return s.prepassClosers ??= buildCodeCloserIndex(s.lexer.lines, RE_PREPASS_ANY_FENCE_CLOSER)
  }

  function readLine(s: LinkDefScan, idx: number): LineRead {
    const raw = s.lexer.lineAt(idx)!
    // A description continues an entry opened by a `::` term or by a previous
    // description, and only then does its marker open content here.
    // Tested on the PREFIX-STRIPPED previous line, the way the current line is
    // read one line down. Asking the raw line meant `> :: term` did not read as
    // a term, so the `:  ` marker below it was never stripped and the
    // definition on it was neither collected nor hoisted - the `dd` was still
    // emptied, so the author's line vanished and a reference to it stayed
    // literal (carve#840). A div was the one container that worked, because it
    // adds no per-line prefix for this to hide behind.
    // THE PREVIOUS NON-BLANK LINE, because a blank between description entries
    // does not end the list - it only makes it loose, and the parser reads
    // `:  a` over a blank over `:  b` exactly as it reads them adjacent. Asking
    // the line directly above meant a description marker after a blank went
    // unstripped, so the `dd` was emptied while the definition on it was
    // collected by nobody: the author's line vanished and the reference to it
    // stayed literal, the same outcome carve#840 named one blank line further
    // up (carve-js#1586). A blank that really ends the list still refuses, its
    // previous non-blank line being the prose that ended it.
    const afterTerm = s.afterPreviousTerm
    const kept = stripContainerPrefixesKeepIndent(raw, afterTerm)
    const line = kept.replace(/^[ \t]+/, '')
    if (!isBlankLine(raw)) {
      s.afterPreviousTerm = RE_AFTER_TERM.test(afterTerm ? stripContainerPrefixes(raw) : line)
    }
    // Content columns are measured INSIDE the block quote. `> - a` puts the
    // item's content column at 2 of the quoted content, not of the raw line -
    // which carries the `> ` and matches no marker, so the column stayed 0 and
    // a definition at it was rejected as "indented at top level". The item
    // consumed the line anyway, so it rendered nothing AND defined nothing
    // (carve#658). The footnote prepass already reads the quoted line.
    // Only a COLUMN-0 marker is stripped. An indented one is inside something -
    // `- a` / `  > [r]: /u` puts the quote at the item's content column - and
    // eating that indentation here loses the very column the definition has to
    // reach, which is what emptied the stack and dropped that definition
    // (carve-js#649).
    const unquoted = raw.replace(/^(?:>(?: |$))+/, '')
    const descriptionLead = s.sawDeflistTerm ? RE_DEFLIST_DEF.exec(unquoted)?.[2] : undefined
    const noteLead = RE_FOOTNOTE_DEF.exec(line)?.[2]
    if (descriptionLead !== undefined || noteLead !== undefined) {
      s.inlineBodyList = markerContentColumn(descriptionLead ?? noteLead!) >= 0
    }
    const wasPrevBlank = s.prevBlank
    // `isBlankLine`, not `raw.trim() === ''`: this prepass decides the same
    // `blank_line` the block lexer does, and the native trim carries the wider
    // legacy set (see `RE_NOT_BLANK`). Spelling one rule twice is what let the
    // two answers drift.
    s.prevBlank = isBlankLine(raw)
    // A fence is quoted if a blockquote marker stands anywhere in the line's
    // container prefix, however many list markers lead it (`- > ``` `,
    // `- - > ``` `), so its closer is blockquote-stripped.
    //
    // THE DEPTH AND THE BOOLEAN COME FROM ONE WALK. A fence opened at two quote
    // levels is not held by a line carrying one: `> :::` under `> > ``` ` has
    // left the inner quote and closes the div outside it, and a boolean cannot
    // tell the two apart - it reports "still quoted" and the closer loses its
    // pop. Reading the raw line and the line behind ONE marker answered both
    // questions for a single marker only (carve-js#1181).
    const rawQuoteDepth = containerQuoteDepth(raw)
    return {
      idx, raw, afterTerm, kept, line, unquoted, wasPrevBlank,
      rawQuoteDepth, rawIsQuoted: rawQuoteDepth > 0, rawTrimmed: raw.trim(),
    }
  }

  // True when an open fence keeps the line as its verbatim content.
  function fenceHoldsLine(s: LinkDefScan, v: LineRead): boolean {
    const { fence } = s
    if (!fence) return false
    // A line under an open fence is VERBATIM CONTENT, not prose, so no
    // paragraph is open on the line below it - including the closer's own.
    s.paraState = 'no'
    // CLOSER: strip a blockquote prefix only when the fence is quoted, and
    // NEVER a list marker -- a fence delimiter is a continuation line of pure
    // indentation, so a literal `- ``` / `> ``` inside a doc-level code sample
    // is not a closer. Re-base to the column the fence opened at.
    const k = fence.quoted ? v.raw.replace(/^(?:[^\S ]*>(?: |$))+/, '') : v.raw
    const ki = k.length - k.replace(/^[ \t]+/, '').length
    const d = ki >= fence.contentCol ? k.slice(fence.contentCol) : k
    // `TRAILING_WS`, not `\s`: this prepass decides the same `code_fence_close`
    // the block lexer does, and a definition written after a fence that only
    // ONE of the two reads as closed is collected by one and rendered by the
    // other.
    const close = d.match(RE_FENCE_CLOSER)
    if (close && close[1]![0] === fence.ch && close[1]!.length >= fence.len) {
      s.fence = null
      return true
    }
    // THE FENCE ENDS WITH ITS CONTAINER. A fence opened inside a quote, a
    // list item or a div does not hold a line that no longer reaches that
    // container: the block parser has left the container and reads the line
    // afresh, so the fence is over. This pass used to leave it open forever,
    // and an unterminated fence has no closer - so every definition after the
    // container was read as fence body and skipped (carve-js#1135).
    //
    // Asked AFTER the closer, never before: a closer written at column 0 for
    // a fence opened at an item's content column is dedented out of its
    // container by construction, and testing the container first would read
    // that very line as a new opener.
    //
    // EVERY container the fence sits in has to hold the line, not whichever
    // one is easiest to ask about. A quoted fence can also sit at a list
    // item's content column (`> - ``` `), and a following `> :::` keeps the
    // quote while leaving the item.
    //
    // The column is measured on `k`, the same quote-stripped view the closer
    // above reads, because a content column inside a quote is measured
    // inside the quote (carve#658). Reading the raw indent there would
    // compare a column against a line that still carries its `> ` prefix.
    //
    // THE DIV IS THE CONTAINER `scope` CANNOT SEE, because a div adds no
    // per-line prefix and no column - so a fence inside one is held by every
    // test above and outlived the div too. Its closer is the enclosing div's
    // own: a BARE colon run of exactly the width that was open when the fence
    // opened (carve#455's exact-length rule, which is what the depth stack
    // records). A different width, or a run with trailing text, is fence
    // content, and the block parser reads all three the same way.
    //
    // AND ONLY FOR A FENCE THAT NEVER CLOSES. A fence with a closer ahead is
    // opaque all the way to it, so a same-width `:::` written inside such a
    // sample is CODE and the block parser renders it - only an unterminated
    // fence degrades at its container's boundary. Ending the fence there
    // anyway collected the definitions below it out of a visible `<pre>`,
    // which is the worst outcome this pass has.
    //
    // Matched with the block parser's OWN colon closer, on `d` - the same
    // re-based view the fence's closer above reads. That settles three things
    // at once that a hand-rolled test got wrong: the pattern is anchored, so
    // an INDENTED `:::` inside the body is content rather than the div's
    // closer; it carries the structural trailing-whitespace class, where
    // `trim()` also ate a no-break space the parser keeps as content; and it
    // compares RUN LENGTHS rather than building a `:::` string per body line,
    // which was quadratic in the div's width times the sample's length.
    const divCloser =
      fence.divWidth !== null && !fence.hasCloser ? RE_ADMONITION_CLOSE.exec(d) : null
    const enclosingDivCloses = divCloser !== null && divCloser[1]!.length === fence.divWidth
    // THE INDENT IS MEASURED ON `unquoted`, NOT ON `k`, because the recorded
    // column was. The quote-prefix pattern `k` uses admits a LEADING
    // INDENTATION RUN before the marker, so `k` loses the item's indentation
    // along with the `> ` - and a fence opened behind both (`- > ``` `)
    // records the ITEM's column while its body lines score zero against it.
    // Every body line then looked out of the item, the fence ended on its
    // own first one, and the code sample's definitions went live. `unquoted` strips only a COLUMN-0 quote marker, so it
    // keeps exactly the indentation the column was measured against - and it
    // is never the SHALLOWER of the two, since `k` removes a superset of what
    // `unquoted` does wherever the fence is quoted at all.
    if (
      scopeHoldsLine(fence.scope, v.raw, v.rawQuoteDepth, v.unquoted) &&
      !enclosingDivCloses
    ) {
      return true // definitions inside fenced code are literal samples
    }
    // Out of its container. The fence is over and this line is read fresh -
    // it may be a boundary the trackers below have to see, a new opener, or a
    // definition site.
    s.fence = null
    return false
  }

  // Every marker on the line, not just the first: `- - see` opens TWO
  // items and its content column is 4, not 2. Tracking only the first
  // understated the column, and a definition written at the real one
  // then read as "past the column" (carve-js#613's guard) or as a fence
  // at the wrong base. Each marker pops the stack against its own indent
  // and pushes its cumulative content column.
  function pushMarkerColumns(listCols: ListColumn[], marker: RegExpMatchArray, unquoted: string, raw: string): void {
    let rest = unquoted
    let base = 0
    for (let m2: RegExpMatchArray | null = marker; m2 && /\S/.test(rest.slice(m2[0].length)); ) {
      while (listCols.length && listCols[listCols.length - 1]!.col > base + m2[1]!.length) {
        listCols.pop()
      }
      base += m2[0].length
      listCols.push({ col: base, inQuote: unquoted !== raw, kind: 'list' })
      rest = rest.slice(m2[0].length)
      m2 = prepassMarker(rest)
    }
  }

  function trackListColumns(s: LinkDefScan, v: LineRead): ListRead {
    const { listCols } = s
    const { raw, unquoted, rawTrimmed } = v
    // WHAT WAS OPEN WHEN THIS LINE ARRIVED, for the `+` verdict at the bottom of
    // the body. Both stacks are popped below on a line that follows a blank, and
    // a `+` still attaches to the item those pops just dropped - a list item is
    // transparent across a blank, so the container is there whether or not its
    // column survived the read.
    const containerOpenAbove = s.openCols.length > 0 || listCols.length > 0
    const marker = prepassMarker(unquoted)
    if (s.deflistQuoteDepth !== null && v.rawQuoteDepth !== s.deflistQuoteDepth) {
      s.sawDeflistTerm = false
      s.deflistQuoteDepth = null
    }
    if (RE_DEFLIST_TERM.test(unquoted)) {
      s.sawDeflistTerm = true
      s.deflistQuoteDepth = v.rawQuoteDepth
    }
    const indent = unquoted.length - unquoted.replace(/^[ \t]+/, '').length
    let deflistDef: RegExpExecArray | null = null
    // Test the RAW line for a block starter: a blockquote `>` is stripped by
    // stripContainerPrefixes, so check `raw` (trimmed) for it, else a quote
    // interrupting a list item would not pop the stack.
    const codeOpener = RE_FENCE.exec(rawTrimmed)
    const rawCodeOpener = codeOpener ? null : RE_RAW_FENCE.exec(rawTrimmed)
    const codeRun = codeOpener?.[2] ?? rawCodeOpener?.[1]
    const inlineFence = codeRun !== undefined && leadingWhitespace(raw) === 0 && listCols.length > 0 &&
      s.paraState !== 'no' && (s.paragraphFoldedAbove || !prepassOpensBlock(s.paraLine, s.paraLinePlusOpens)) &&
      !codeCloserPossibleIn(closers(s), codeRun, v.idx)
    const startsBlock =
      /^#{1,6}([ \t]|$)/.test(rawTrimmed) ||
      RE_BLOCKQUOTE.test(rawTrimmed) ||
      (codeRun !== undefined && !inlineFence) ||
      // A COLON FENCE ENDS THE ITEM TOO, and was the one block opener missing
      // from this list. A flush `:::` under an unblanked item opens a SIBLING
      // container - the parser renders the div next to the list, not inside it
      // - so the item's content column is gone. Left here, the column stayed
      // live and the div recorded it as the container it was opened in, which
      // then released at the next blank line and let an abbreviation written
      // INSIDE a visibly rendered div register.
      //
      // Only a fence the parser REALLY opens: `:::note` is prose, and the
      // parser folds it into the item lazily, so popping the column there
      // rejected the definition below it as top-level indentation.
      isColonFenceOpener(rawTrimmed) ||
      isBlockAttributeLine(rawTrimmed) ||
      /^(-{3,}|\*{3,}|_{3,})$/.test(rawTrimmed)
    // SNAPSHOT FOR THE RETRACTION at the end of this loop body. This branch
    // cannot ask whether the marker folds into an open paragraph: that answer
    // is `paragraphReallyOpen`, and it is not computed until both column
    // stacks have already moved. Taken only on a marker line, so an ordinary
    // line allocates nothing.
    const markerOpensItems = marker !== null && /\S/.test(raw.slice(marker[0].length))
    const listColsBeforeMarker = markerOpensItems ? listCols.slice() : null
    if (markerOpensItems) {
      pushMarkerColumns(listCols, marker, unquoted, raw)
    } else if (s.sawDeflistTerm && (deflistDef = RE_DEFLIST_DEF.exec(unquoted))) {
      while (listCols.length && listCols[listCols.length - 1]!.col > indent) listCols.pop()
      listCols.push({
        col: indent + deflistContentCol(deflistDef[1]!),
        inQuote: unquoted !== raw,
        kind: 'description',
      })
    } else if (
      // BLANK BEHIND ITS OWN MARKER IS STILL BLANK. `raw` carries the container
      // prefix, so a quote-marked empty line (`>`) failed this test, matched
      // `startsBlock` through RE_BLOCKQUOTE, and popped the list column its own
      // quote still holds open - the definition below it then read as top-level
      // indentation and never registered (carve-js#1584). A list item is
      // transparent across a blank whatever marks it.
      !isBlankLine(unquoted) &&
      (v.wasPrevBlank || startsBlock || s.session.isLinkDefLine(rawTrimmed))
    ) {
      while (listCols.length && listCols[listCols.length - 1]!.col > indent) listCols.pop()
    }
    // A BLANK ENDS EVERY OPEN QUOTE, so every column opened inside one goes
    // with it. Without this the item column survived its own quote, a later
    // `>   [r]: /u` reached it, and a definition the page printed as ordinary
    // text registered document-wide as well - both halves at once, which I5
    // permits under neither reading (carve#1892).
    if (isBlankLine(raw)) {
      const firstQuoted = listCols.findIndex((entry) => entry.inQuote)
      if (firstQuoted >= 0) listCols.length = firstQuoted
    }
    return { containerOpenAbove, listColsBeforeMarker, startsBlock }
  }

  function trackNoteColumns(s: LinkDefScan, raw: string, rawQuoteDepth: number, composed: Composed): void {
    const { noteColumns } = s
    while (noteColumns.length &&
      (!isBlankLine(raw) && composed.column < noteColumns[noteColumns.length - 1]!.column ||
        rawQuoteDepth < noteColumns[noteColumns.length - 1]!.quotes)) noteColumns.pop()
    s.inFootnoteBody = noteColumns.length > 0
    if (isBlankLine(raw) && s.inFootnoteBody) noteColumns[noteColumns.length - 1]!.termText = false
    if (s.inFootnoteBody && /^[ \t]*:[ \t]+/.test(raw) &&
        indentColumns(raw) > noteColumns[noteColumns.length - 1]!.column)
      noteColumns[noteColumns.length - 1]!.termText = true
  }

  function trackComposedColumns(s: LinkDefScan, v: LineRead, startsBlock: boolean): Composed {
    const { raw } = v
    const { openCols } = s
    // THE COMPOSED STACK IS MAINTAINED ON THE SAME THREE BRANCHES, over the
    // whole container prefix rather than over list markers alone.
    const composed = composeContainerPrefix(raw, v.afterTerm, openCols)
    trackNoteColumns(s, raw, v.rawQuoteDepth, composed)
    if (isBlankLine(raw)) {
      // A BLANK LINE ENDS EVERY OPEN BLOCK QUOTE, and everything written inside
      // one goes with it. A list item is transparent across a blank, which is
      // why `listCols` treats every blank that way and this stack cannot.
      //
      // NOT LOAD-BEARING, and said so rather than left to be discovered: a
      // mutation that removes this drop changes no output across the suite or
      // 1652 swept prefix shapes, because the walk's own `depth` already refuses
      // to enter a quote the line does not re-mark, and a line that DOES re-mark
      // it peels into the same entry whether or not the blank dropped it. It
      // stays because it states the rule where the state is kept.
      const firstQuote = openCols.findIndex((e) => e.quote)
      if (firstQuote >= 0) openCols.length = firstQuote
    } else if (composed.peeled.length) {
      // A FOLDED MARKER OPENS NOTHING, so the stack the window is measured
      // against must not move under it. The first folding marker is the item's
      // lead text and so is everything after it on the line; recording it as a
      // container replaced the real owner with the folded marker's own columns,
      // and the next line was then measured against a window that never
      // existed (markup-carve/carve-js#1598).
      const foldAt = composed.peeled.findIndex((one) => one.folds)
      if (foldAt !== 0) {
        // The walk confirmed `depth` of the open containers. Anything past that
        // is gone: a sibling list marker at an open item's own column closes
        // that item, and everything written inside it goes with it.
        openCols.length = composed.depth
        for (const one of foldAt < 0 ? composed.peeled : composed.peeled.slice(0, foldAt)) {
          if (!one.matched) openCols.push({ col: one.content, quote: one.quote, base: one.marker })
        }
      }
    } else if (v.wasPrevBlank || startsBlock || s.session.isLinkDefLine(v.rawTrimmed)) {
      while (openCols.length && openCols[openCols.length - 1]!.col > composed.column) {
        openCols.pop()
      }
    }
    return composed
  }

  function openTerm(s: LinkDefScan, raw: string, view: string, composed: Composed, quotes: number): void {
    const lastMarker = composed.peeled.at(-1)
    const task = lastMarker && !lastMarker.quote ? RE_TASK.exec(raw.slice(lastMarker.marker)) : null
    const termLead = task?.[3] ?? view
    if (!RE_DEFLIST_TERM.test(termLead) || !composed.peeled.every((entry) => !entry.folds && !entry.behindQuote)) return
    let termColumn = composed.column
    for (const entry of composed.peeled) {
      if (entry.quote) continue
      const width = markerContentColumn(raw.slice(entry.marker))
      if (width >= 0) termColumn -= entry.content - entry.marker - width
    }
    s.term = { col: termColumn, quotes: quotes }
  }

  // A line past an open term's column is term text (carve#2411): it
  // registers nothing and opens no fence. A comment fence there still hides
  // its body, so it falls through to the comment branch below.
  function termTakesLine(s: LinkDefScan, v: LineRead, composed: Composed): boolean {
    const { raw } = v
    const quotes = composed.peeled.filter((entry) => entry.quote).length
    const view = raw.slice(composed.column)
    const marker = composed.peeled.find((entry) => !entry.quote)
    const col = marker?.marker ?? composed.column
    const rest = marker ? raw.slice(marker.marker) : view
    let { term } = s
    const listMarker = prepassMarker(rest)
    if (term && quotes === term.quotes && listMarker !== null &&
        /\S/.test(rest.slice(listMarker[0].length))) term = s.term = null
    if (isBlankLine(view)) {
      s.term = null
      return false
    }
    if (term && quotes === term.quotes && RE_ABBR_DEF.test(rest)) {
      // A term keeps this spelling as text, so it registers no abbreviation.
      s.paraState = 'yes'
      return true
    }
    if (term && quotes === term.quotes && col > term.col) {
      if (commentFenceRun(rest) !== undefined) return false
      if (s.session.matchLinkDef(rest) !== null || RE_FOOTNOTE_DEF.test(rest.trimStart()))
        s.lexer.declinedLinkDefLines.add(s.lexer.lineNumber(v.idx))
      s.paraState = 'yes'
      return true
    }
    if (
      term &&
      (quotes !== term.quotes ||
        prepassOpensBlock(rest) ||
        RE_DEFLIST_DEF.test(rest) ||
        s.session.isLinkDefLine(rest) ||
        RE_FOOTNOTE_DEF.test(rest))
    ) {
      s.term = null
    }
    openTerm(s, raw, view, composed, quotes)
    return false
  }

  function commentFenceTakesLine(s: LinkDefScan, v: LineRead, contentCol: number): boolean {
    // A comment fence's closer is a leading `%` run of the SAME length;
    // trailing text is allowed, so `%%% end` closes a `%%%` fence.
    if (s.commentFence !== null) {
      const close = RE_COMMENT_BLOCK_ANY.exec(v.line)
      if (close && close[1]!.length === s.commentFence) s.commentFence = null
      s.paraState = 'no'
      return true
    }
    const open = RE_COMMENT_BLOCK_ANY.exec(v.line)
    if (open === null) return false
    // Under §5, an opener hides definitions only when its closer is in the same
    // container. Document-level fences use the raw line index; nested fences
    // use the stripped container view. Attached blocks start at the `+`
    // marker column, which can differ from the item content column.
    const commentScope: PrepassScope = {
      quoteDepth: v.rawQuoteDepth,
      contentCol: s.plusColumn ?? contentCol,
    }
    const atDocumentLevel = commentScope.quoteDepth === 0 && commentScope.contentCol === 0
    const opensRegion = atDocumentLevel
      ? commentBlockHasCloser(s.lexer, open[1]!.length, v.idx)
      : commentCloserInScope(s.lexer, open[1]!.length, v.idx, commentScope, s.commentScopeMemo)
    if (!opensRegion) return false
    s.commentFence = open[1]!.length
    s.paraState = 'no'
    return true
  }

  function trackDivs(s: LinkDefScan, v: LineRead, contentCol: number): void {
    const { divs, listCols } = s
    while (
      divs.length &&
      !scopeHoldsLine(divs[divs.length - 1]!.scope, v.raw, v.rawQuoteDepth, v.unquoted)
    ) {
      divs.pop()
    }
    // Track `:::` nesting so the abbreviation branch can require document
    // level. Only the depth matters here, not what kind of div it is.
    const colon = v.line.trim().match(/^(:{3,})[ \t]*(.*)$/)
    if (!colon) return
    const width = colon[1]!.length
    if (colon[2] === '' && divs.length && divs[divs.length - 1]!.width === width) divs.pop()
    else {
      divs.push({
        width,
        opens: isColonFenceOpener(v.line),
        scope: { quoteDepth: v.rawQuoteDepth, contentCol },
        host: s.inFootnoteBody ? 'footnote' : (listCols[listCols.length - 1]?.kind ?? null),
      })
    }
  }

  // Lists do not interrupt an open paragraph AT DOCUMENT LEVEL. Inside an
  // item they do: §24 C3 folds a marker only where it is below the item's
  // content column and past its base, and everywhere else - at the base
  // column, or at/past the content column - the marker opens a real item
  // whose definition line is metadata. A newly opened quote interrupts only
  // when every marker before it continues the open paragraph's containers:
  // `para` / `> - [d]: u` does, but `para` / `- > [d]: u` does not because
  // the lazy list marker owns the quote too.
  //
  // THE TEST USED TO BE `one.matched`, which is column EQUALITY with the open
  // item rather than the window, so it was wrong in both directions: a
  // sibling of a different marker width (`- lead` / `1. [d]: u`) collected
  // nothing though the block parser opened a real `ol` for it, and a marker
  // inside the window that happened to land on the open column (`-   lead` /
  // `  - [d]: u`) collected though the item's lead text is where it belongs.
  // Measured against the executable spec on 42 column shapes
  // (markup-carve/carve-js#1598).
  function markerInterruptsParagraph(composed: Composed, paraDepthAbove: number): boolean {
    let interrupts = false
    let prefixOwnedByParagraph = true
    for (let depth = 0; depth < composed.peeled.length; depth++) {
      const one = composed.peeled[depth]!
      if (one.quote && !one.matched && prefixOwnedByParagraph) interrupts = true
      if (!one.quote && !one.folds && !one.behindQuote && depth < paraDepthAbove)
        interrupts = true
      if (!one.matched) prefixOwnedByParagraph = false
    }
    return interrupts
  }

  function paragraphVerdict(
    s: LinkDefScan, v: LineRead, composed: Composed, lists: ListRead, inFootnoteBodyAbove: boolean,
  ): ParagraphVerdict {
    const { raw, line, idx } = v
    // WHETHER A PARAGRAPH IS OPEN ON THE NEXT LINE, decided here because every
    // line that carries verbatim or opaque content has already been consumed
    // above with the flag cleared.
    //
    // The rule reads only the line itself, which is the SAFE simplification of
    // §10's two halves. A paragraph stays open across a line that starts no
    // block, and a line that starts one ends it; the cases where the two halves
    // differ - a list marker opens a block but does NOT interrupt an open
    // paragraph - cannot separate them here, because `line` has the marker
    // stripped already and reads as the item's content either way. That is also
    // the answer §10 wants: `text` / `- a` folds the bullet into the paragraph,
    // and `- a` after a blank opens an item whose paragraph a flush-left line
    // lazily continues. Both leave a paragraph open.
    // A FOOTNOTE BODY TAKES NO LAZY CONTINUATION FROM COLUMN 0. Its content
    // column is §16's own and a flush line has left the body, so the block
    // parser opens a top-level fence there even with a paragraph open inside the
    // note - unlike a list item, whose paragraph a flush line really does
    // continue. `line` has the body's indentation stripped, so without this the
    // two are indistinguishable here.
    // A FOOTNOTE BODY TAKES NO LAZY CONTINUATION FROM COLUMN 0 - see the note on
    // `paraState`. Read here, where `inFootnoteBody` still describes the line
    // above; the expensive half is deferred to the opener below.
    // DID THE LINE ABOVE FOLD INTO THIS PARAGRAPH? `prepassOpensBlock` answers
    // whether it LOOKS like an opener, and a definition-shaped line looks like
    // one whether or not it was collected - so asking it about the line above
    // assumes the answer to the question being asked. A line the pass already
    // decided was lazy opened nothing, and the paragraph is still open below it
    // (markup-carve/carve-js#1580).
    const foldedAbove: boolean = s.paragraphFoldedAbove
    const paraWasOpen =
      s.paraState !== 'no' && !(inFootnoteBodyAbove && !isBlankLine(raw) && leadingWhitespace(raw) === 0)
    const paraAsk = s.paraState === 'ask'
    const paraLineAbove = s.paraLine
    const paraLineAbovePlusOpens = s.paraLinePlusOpens
    const paraDepthAbove = s.paraDepth
    const markerInterrupts = markerInterruptsParagraph(composed, paraDepthAbove)
    // Only a definition behind a list marker and a fence-shaped line consume
    // this answer. Scoping the probe to those questions avoids observable
    // matcher calls on unrelated lines and keeps the byte allowance useful.
    const matcherProbeCandidate =
      s.hasBlockMatchers &&
      !s.session.probingLazyParagraph &&
      ((composed.peeled.some((one) => !one.quote) &&
        s.session.isLinkDefLine(line)) ||
        RE_FENCE.test(line) ||
        RE_RAW_FENCE.test(line))
    const probed: boolean | 'unknown' = matcherProbeCandidate
      ? s.session.lineFoldsIntoOpenParagraph(s.lexer, idx, s.lazyProbeBudget)
      : 'unknown'
    // AN EXHAUSTED BUDGET IS NOT AN ANSWER (PART 9R R1a, markup-carve/carve#1895).
    // Bounding the probe stays sound; what the clause forbids is declining the
    // line because the bound ran out, which made an unrelated extension drop a
    // definition a matcher-free parse of the same document collects. So a probe
    // that did not run falls back to the static reading - the same one every
    // matcher-free document uses.
    //
    // THE STATIC READING IS BLIND IN EXACTLY ONE DIRECTION, and it is the safe
    // one. Core block constructs are dispatched before `matchBlock`, so a line
    // `prepassOpensBlock` claims is one no matcher can have consumed, and
    // `false` here is sound. Where it says `true` a matcher may have eaten the
    // line above unseen - and `true` collects nothing, which is the outcome the
    // clause still licenses there.
    const folds: boolean =
      probed === 'unknown'
        ? !paraAsk ||
          foldedAbove ||
          !prepassOpensBlock(paraLineAbove, paraLineAbovePlusOpens)
        : probed
    // ONE `folds` FEEDS EVERY CONSUMER (R1a), the collection gates and
    // `paraDepth` alike. Giving the depth a narrower answer than the gate leaked
    // the bug back at scale: a line the two disagreed on changed the recorded
    // depth, which made the next marker read as interrupting, which collected
    // it. carve-rs holds the same line for the same reason.
    const paragraphReallyOpen: boolean =
      paraWasOpen && !markerInterrupts && folds
    const collectsNothing = paragraphReallyOpen
    // A MARKER THE BLOCK PARSER FOLDS OPENS NO ITEM, so the content column it
    // pushed above is a phantom. The definition on the next line then read as
    // that phantom item's lazy continuation and the collection gate, which asks
    // for an empty `listCols`, rejected it - so an abbreviation, a reference or
    // a footnote written under a folded marker registered nowhere
    // (carve-js#2236). `openCols` already applies this rule, but only inside an
    // open item's marker window (§24 C3); at document level every marker's
    // `folds` is false by construction, so the stack this gate reads needs the
    // verdict that exists only here.
    //
    // RETRACTED RATHER THAN NEVER PUSHED. Everything between the push and this
    // point still measures THIS line against its own column, which is what the
    // readings recorded on that branch depend on. Only the next line sees the
    // stack restored, and the next line is where the phantom did its damage.
    if (lists.listColsBeforeMarker !== null && paragraphReallyOpen) {
      s.listCols.length = 0
      for (const entry of lists.listColsBeforeMarker) s.listCols.push(entry)
    }
    if (matcherProbeCandidate && paraWasOpen && !markerInterrupts) {
      s.lazyProbeBudget = spendLazyProbeBudget(s.lexer, idx, s.lazyProbeBudget)
    }
    const closesAttributes = trackWrappedAttributeRun(s.attributeState, line)
    s.paraState = isBlankLine(raw) || closesAttributes ? 'no' : 'ask'
    s.paraDepth =
      s.paraState === 'no' ? 0 : paragraphReallyOpen ? paraDepthAbove : s.openCols.length
    // WHAT CARRIES IS "THIS LINE FOLDED", NOT "A PARAGRAPH WAS OPEN ABOVE IT".
    // The two differ on exactly the openers PART 9 §10 calls invisible: a
    // top-level `[q]: /q` has a paragraph open above it and interrupts it all
    // the same. Only a line the pass decided was lazy - marker-carried, inside a
    // list, in an open paragraph - opened nothing and leaves it open below.
    s.paragraphFoldedAbove =
      paragraphReallyOpen && composed.peeled.some((one) => !one.quote)
    s.paraLine = line
    s.paraLinePlusOpens = lists.containerOpenAbove || s.divs.length > 0 || s.inFootnoteBody
    return { paraWasOpen, collectsNothing }
  }

  function quoteAtWrongColumn(s: LinkDefScan, raw: string): boolean {
    const quoteIndent = leadingWhitespace(raw)
    return !s.inFootnoteBody &&
      quoteIndent > 0 &&
      raw.slice(quoteIndent).startsWith('>') &&
      (s.listCols.length === 0 || quoteIndent < Math.max(...s.listCols.map((entry) => entry.col)))
  }

  function openerView(s: LinkDefScan, v: LineRead, contentCol: number): OpenerView {
    const { raw, kept } = v
    const keptIndent = kept.length - v.line.length
    // A FOOTNOTE BODY has a content column too, and it is not a list column.
    // `contentCol` tracks only list items, so inside a note body it is 0 and an
    // INDENTED fence opener matched nothing - the fence went untracked and the
    // definition-shaped line inside it was collected as a real definition, so a
    // reference below the note resolved against a code sample (carve-js#667).
    // The opener's own indent is the column to re-base on; the closer check below
    // already re-bases to whatever `fence.contentCol` says.
    // Behind a QUOTE prefix the note body's leniency does not reach: see the
    // block-quote sub-lexer. `kept` has the `>` stripped, so its residual indent
    // is the definition's own, not a rebase remainder to absorb. Read off the
    // RAW line - `composed.peeled` is empty for a quoted line here, so asking it
    // silently answered "not quoted" for every one of them.
    const behindQuotePrefix = raw.slice(leadingWhitespace(raw)).startsWith('>')
    const openerCol =
      s.inFootnoteBody && contentCol === 0 && !behindQuotePrefix
        ? keptIndent
        : contentCol > 0 && keptIndent >= contentCol
          ? keptIndent
          : contentCol
    const descSeparator = v.afterTerm ? RE_DEFLIST_SEPARATOR.exec(v.unquoted) : null
    const scopeCol = Math.max(openerCol, descSeparator ? deflistContentCol(descSeparator[1]!) : 0)
    const deIndented = keptIndent >= openerCol ? kept.slice(openerCol) : kept
    return { openerCol, scopeCol, deIndented }
  }

  // A fence-shaped marker line folded into an open footnote or description
  // paragraph is that paragraph's text, not a fence opener.
  function markerFenceIsParagraphText(s: LinkDefScan, v: LineRead, lists: ListRead, para: ParagraphVerdict): boolean {
    const { rawTrimmed } = v
    const before = lists.listColsBeforeMarker
    return markerContentColumn(rawTrimmed) >= 0 && /^(?:`{3,}|~{3,})/.test(markerFreeContent(rawTrimmed)) &&
      para.paraWasOpen &&
      (s.inFootnoteBody || before?.at(-1)?.kind === 'description') &&
      !s.inlineBodyList && !before?.some((entry) => entry.kind === 'list')
  }

  // The innermost depth entry the block parser really opened - a phantom
  // one from a malformed `:::note` decides nothing here. Written as a loop
  // rather than `findLast`, which the compile target does not carry.
  function innermostOpenDiv(divs: PrepassDiv[]): PrepassDiv | undefined {
    for (let i = divs.length - 1; i >= 0; i--) {
      if (divs[i]!.opens) return divs[i]
    }
    return undefined
  }

  function fenceOpenerTakesLine(
    s: LinkDefScan, v: LineRead, view: OpenerView, lists: ListRead, para: ParagraphVerdict,
  ): boolean {
    // BOTH fence spellings, not just the code one. `RE_FENCE`'s language slot
    // excludes `=`, so a raw block's ```` ```=FORMAT ```` opener matched nothing
    // here and the fence went untracked - and then the CLOSER read as an opener,
    // which put the whole rest of the document inside a fence that never closes.
    // A definition after a raw block was therefore never collected (it did not
    // reach the AST at all), while a definition written INSIDE the raw block was
    // collected and went live in the link table, so a reference below it resolved
    // against opaque passthrough content. That is carve-js#634's failure with a
    // different opener. The two lazy-continuation sites already read both
    // patterns; this prepass was the one place that read only one.
    const open = RE_FENCE.exec(view.deIndented)
    const rawOpen = open ? null : RE_RAW_FENCE.exec(view.deIndented)
    const run = open ? open[2]! : rawOpen?.[1]
    if (!run || markerFenceIsParagraphText(s, v, lists, para)) return false
    const enclosingDiv = innermostOpenDiv(s.divs)
    if (para.collectsNothing && !codeCloserPossibleIn(closers(s), run, v.idx)) {
      // Not a fence: the line is the paragraph's own text and the paragraph is
      // still open below it. Known outright, so the line below never has to ask.
      s.paraState = 'yes'
      return false
    }
    s.fence = {
      ch: run[0]!,
      len: run.length,
      contentCol: view.openerCol,
      quoted: v.rawIsQuoted,
      scope: { quoteDepth: v.rawQuoteDepth, contentCol: view.scopeCol },
      divWidth: enclosingDiv ? enclosingDiv.width : null,
      // Asked only for a fence INSIDE a div, which is the one place the
      // answer is read - so an ordinary document never builds the index.
      //
      // THE INDEX IS PERMISSIVE, and that is deliberate here. A merely
      // closer-SHAPED line - indented, or inside another container - counts
      // as "a closer may be ahead", so the div boundary declines to end the
      // fence and a definition after it stays uncollected. That direction
      // is a definition this pass does not reach, which is what it did
      // before this change; the other direction ends a live fence early and
      // publishes a definition out of a visible code sample. An exact
      // answer wants a container-bounded scan per opener, which is the
      // quadratic shape this index exists to avoid.
      hasCloser:
        enclosingDiv !== undefined &&
        codeCloserPossibleIn(closers(s), run, v.idx),
    }
    s.paraState = 'no'
    return true
  }

  // A definition folded into visible paragraph text opens no note body. One
  // at its context's content column, behind no folded list marker, ends the
  // paragraph instead (CARVE-P0-010).
  function trackNoteBody(s: LinkDefScan, v: LineRead, composed: Composed, collectsNothing: boolean): void {
    const { line, raw } = v
    if (RE_FOOTNOTE_DEF.test(line) &&
        (!collectsNothing || (!composed.peeled.some((one) => !one.quote) &&
          leadingWhitespace(raw.slice(composed.column)) === 0)) &&
        !s.lexer.declinedLinkDefLines.has(s.lexer.lineNumber(v.idx))) {
      // A term on the marker line has no content column (CARVE-P2-028).
      const lead = RE_FOOTNOTE_DEF.exec(line)![2]!
      const quotedLead = /^>[ \t]+(.+)$/.exec(lead)?.[1]
      s.noteColumns.push({ column: composed.column + FOOTNOTE_BODY_COLUMN, quotes: v.rawQuoteDepth,
        termText: RE_DEFLIST_TERM.test(lead), openedAt: v.idx,
        quotedLeadParagraph: quotedLead !== undefined && !prepassOpensBlock(quotedLead, false) })
      s.inFootnoteBody = true
    }
  }

  // An abbreviation def (`*[ABBR]: ...`) is not a link def - it is collected
  // HERE rather than by a scan of its own, because a scan of its own knew
  // nothing about what is opaque: it registered a definition written inside a
  // fenced code SAMPLE, so documenting the syntax changed the prose around it
  // (carve#573).
  // PART 12 §7: an abbreviation definition is recognized ONLY at document
  // level. Tested against `raw`, NOT the container-stripped `line`: stripping
  // is what made `> *[X]: y` register a document-wide expansion, which is the
  // one definition kind with no marker at the use site to point back at it.
  // The anchored pattern rules out an indented (list-item continuation) line
  // on its own; `divs` covers the one container that adds no line prefix.
  // `listCols` covers the remaining container: a flush-left definition line
  // that directly follows an open list item is that item's lazy continuation
  // (text), not a document-level definition. A blank line first pops the
  // stack, and then it is one.
  function collectAbbreviation(s: LinkDefScan, raw: string): boolean {
    const abbr =
      s.divs.length === 0 && s.listCols.length === 0 && !s.inFootnoteBody
        ? RE_ABBR_DEF.exec(raw)
        : null
    if (!abbr) return false
    s.lexer.abbrDefs.set(abbr[1]!, dropTrailingWhitespace(abbr[2]!))
    return true
  }

  // The deepest list column the line is measured against, and the deepest one
  // it reached outside its innermost reached quote.
  function listColumnsReached(s: LinkDefScan, composed: Composed): { deepest: number | null; reachedOuter: number | null } {
    const { openCols } = s
    // THE COLUMN IS THE COMPOSED ONE, and it is compared against the columns the
    // line REACHED plus the ones it opened itself. `rawIndent` measures a line
    // behind a COLUMN-0 quote run only, so `  >    [r]: /url` scored 2 - the
    // indent before a marker the block parser strips - and the exemption below
    // let it through on top of that.
    let deepestTrackedListColumn: number | null = null
    let reachedOuterListColumn: number | null = null
    // A reached quote does not rebase (CARVE-P0-004): an item outside it lends no column.
    let innermostReachedQuote = -1
    for (let i = 0; i < composed.depth && i < openCols.length; i++) {
      if (openCols[i]!.quote) innermostReachedQuote = i
    }
    for (let i = 0; i < openCols.length; i++) {
      const entry = openCols[i]!
      if (entry.quote) continue
      if (i < innermostReachedQuote) {
        if (i < composed.depth && (reachedOuterListColumn === null || entry.col > reachedOuterListColumn)) {
          reachedOuterListColumn = entry.col
        }
        continue
      }
      if (deepestTrackedListColumn === null || entry.col > deepestTrackedListColumn) {
        deepestTrackedListColumn = entry.col
      }
      if (i < composed.depth && (reachedOuterListColumn === null || entry.col > reachedOuterListColumn)) {
        reachedOuterListColumn = entry.col
      }
    }
    // `listCols` stops at the first quote, so behind an item's quote it holds only outer columns.
    const quoteBehindItem = openCols.slice(0, Math.max(innermostReachedQuote, 0)).some((entry) => !entry.quote)
    for (const { col: column, inQuote } of quoteBehindItem ? [] : s.listCols) {
      if (innermostReachedQuote >= 0 && !inQuote) continue
      if (deepestTrackedListColumn === null || column > deepestTrackedListColumn) {
        deepestTrackedListColumn = column
      }
    }
    return { deepest: deepestTrackedListColumn, reachedOuter: reachedOuterListColumn }
  }

  function reachesContentColumn(s: LinkDefScan, v: LineRead, composed: Composed, openColumn: number): boolean {
    const { openCols } = s
    const { deepest, reachedOuter } = listColumnsReached(s, composed)
    // WITH A LIST COLUMN IN PLAY the test is "at or past the deepest one", not
    // "exactly at an open one": §24 C3 erases an authored base before the item
    // parses the line, so an over-indented definition is the item's definition
    // and registers document-wide (carve#1705). With NO list column open the
    // exact test stands unchanged - a quote's content column is reached, not
    // rebased.
    const anyReached = composed.peeled.length > 0 || composed.depth > 0
    // An unmarked line may lazily continue a quote's open paragraph, but it
    // does not reach a container inside that quote. Falling back to the outer
    // `contentCol` here made a definition-shaped lazy line both disappear from
    // the paragraph and become active document-wide.
    const stoppedAtQuote =
      !composed.peeled.some((one) => one.quote) &&
      composed.depth < openCols.length &&
      openCols[composed.depth]!.quote
    if (s.inFootnoteBody && !stoppedAtQuote && composed.column >= openColumn) return true
    if (stoppedAtQuote) return reachedOuter !== null && composed.column >= reachedOuter
    if (s.plusColumn !== null) return leadingWhitespace(v.unquoted) === s.plusColumn
    if (anyReached) {
      return deepest !== null
        ? composed.column >= deepest
        : composed.peeled.some((one) => one.content === composed.column) ||
          openCols.some((entry, i) => i < composed.depth && entry.col === composed.column)
    }
    return s.inFootnoteBody ? composed.column >= openColumn : composed.column === openColumn
  }

  function noteBodyDeclines(s: LinkDefScan, v: LineRead, composed: Composed, openColumn: number, collectsNothing: boolean): boolean {
    if (!s.inFootnoteBody) return false
    const note = s.noteColumns[s.noteColumns.length - 1]!
    // The quote marker may sit past the note's body floor. Its raw indent is
    // not the definition's indent; the composed column check above owns that.
    // A definition-shaped line folded into an open quote paragraph stays text.
    return (note.termText && composed.column > openColumn) ||
      (note.quotedLeadParagraph && v.idx === note.openedAt + 1 && v.rawQuoteDepth > note.quotes) ||
      (collectsNothing && v.rawQuoteDepth > note.quotes) ||
      (v.rawQuoteDepth > note.quotes && /^[ \t]/.test(v.kept) && !composed.peeled.some((one) => !one.quote))
  }

  function collectLinkDef(
    s: LinkDefScan, v: LineRead, composed: Composed, contentCol: number, deIndented: string, collectsNothing: boolean,
  ): void {
    const { raw, idx } = v
    const { lexer } = s
    // Strict column-0 rule: a definition is a block opener recognized ONLY at
    // its container's content column. At the true document top level
    // (contentCol 0, outside any footnote body) a def indented above column 0 is
    // literal paragraph text -- not collected here (and rendered literally by the
    // block parser, whose RE_LINK_DEF consumption is likewise flush-only), so the
    // flat pre-pass does not resolve a reference against an indented non-def line.
    // Nested defs (list items, footnote bodies, blockquotes) keep the lenient
    // collection: their real content column is >0 or the flat pass cannot model
    // it, and the oracle resolves them, so `deIndented` residual whitespace must
    // NOT reject them.
    const topLevelIndentedDef =
      contentCol === 0 && !s.inFootnoteBody && /^[ \t]/.test(deIndented)
    if (isContinuationMarker(raw)) s.plusColumn = leadingWhitespace(v.unquoted)
    else if (isBlankLine(raw)) s.plusColumn = null
    // Container ownership below matters only for a definition candidate.
    const matched = s.session.matchLinkDef(v.line)
    if (matched === null) return
    // An over-indented definition still reaches its note's written body column.
    const openColumn = s.inFootnoteBody ? s.noteColumns[s.noteColumns.length - 1]!.column : contentCol
    const atAnOpenContentColumn = reachesContentColumn(s, v, composed, openColumn)
    // NO EXEMPTION FOR A LINE THAT CARRIES ITS OWN PREFIX. The guard used to
    // apply only where `kept === unquoted`, which asked "does this line carry a
    // marker of its own?" - because `rawIndent` measured the wrong thing on the
    // lines that do, and `- [ref]: /url` had to survive it. It was widened once
    // already, from `kept === raw` to `kept === unquoted`, when a COLUMN-0 quote
    // marker turned out to open the same hole (carve-js#648); an indented quote
    // marker, and a quote behind another one, are the same hole again
    // (carve-js#1199). Composing the strips answers for all of them at once:
    // `composed.column` is where the definition really sits, and on a marker
    // line that is the column the marker just handed out.
    const notAtContentColumn = !atAnOpenContentColumn
    // NO OPEN PARAGRAPH, NO LAZY LINE (PART 0). Once the block parser would
    // fold this marker into the paragraph above, its definition-shaped content
    // is visible text and cannot also define a reference.
    const declines =
      topLevelIndentedDef ||
      notAtContentColumn ||
      noteBodyDeclines(s, v, composed, openColumn, collectsNothing) ||
      (collectsNothing && composed.peeled.some((one) => !one.quote))
    // A DECLINE IS RECORDED, not just acted on. Everything above is this pass
    // reading the line as something other than a definition; the block parser
    // reaches its own reading and, where that one says "definition", removes
    // the line on the strength of a collection that never happened. Recording
    // the decline is what lets the strip ask instead of assume.
    if (declines) {
      lexer.declinedLinkDefLines.add(lexer.lineNumber(idx))
      return
    }
    const def: LinkDef = { href: matched.href }
    if (matched.title !== undefined) def.title = unescapeAttrValue(matched.title)
    if (matched.attrText !== null) def.attrs = parseAttrs(matched.attrText)
    // Link definitions use the shared, case-sensitive ASCII-whitespace key.
    // The raw spelling stays on the winning definition for the canonical
    // writer. Implicit heading references remain a separate, looser path.
    def.line = idx
    def.rawLabel = matched.label
    lexer.linkDefs.set(normalizeRefLabel(matched.label), def)
  }

  function scanLine(s: LinkDefScan, idx: number): void {
    const v = readLine(s, idx)
    if (fenceHoldsLine(s, v)) return
    const lists = trackListColumns(s, v)
    const inFootnoteBodyAbove = s.inFootnoteBody
    const composed = trackComposedColumns(s, v, lists.startsBlock)
    // strip the enclosing content column so a fence delimiter at that column
    // is recognized (kept-indent view keeps residual indent after markers)
    const contentCol = s.listCols.length ? s.listCols[s.listCols.length - 1]!.col : 0
    if (s.verseLines?.[idx]) {
      s.term = null
      s.paraState = 'no'
      return
    }
    if (s.commentFence === null && termTakesLine(s, v, composed)) return
    if (commentFenceTakesLine(s, v, contentCol)) return
    trackDivs(s, v, contentCol)
    const para = paragraphVerdict(s, v, composed, lists, inFootnoteBodyAbove)
    if (quoteAtWrongColumn(s, v.raw)) return
    const view = openerView(s, v, contentCol)
    if (fenceOpenerTakesLine(s, v, view, lists, para)) return
    trackNoteBody(s, v, composed, para.collectsNothing)
    if (collectAbbreviation(s, v.raw)) return
    // A footnote def (`[^label]: body`) is parsed as a block in
    // parseFootnoteDef; skip here so RE_LINK_DEF can't capture `^label`.
    if (RE_FOOTNOTE_DEF.test(v.line)) return
    collectLinkDef(s, v, composed, contentCol, view.deIndented, para.collectsNothing)
  }

  return function collectLinkDefs(session: LinkDefinitionSession, lexer: Lexer) {
    if (session.definitionRegionLines) return
    // Ownership before a candidate still matters; lines after the last one
    // cannot add definitions. Lookahead keeps access to the complete lexer.
    let lastDefinitionLine = -1
    for (let index = lexer.pos; index < lexer.lineCount; index++) {
      if (lexer.lineAt(index)!.includes(']:')) lastDefinitionLine = index
    }
    if (lastDefinitionLine === -1) return
    const s: LinkDefScan = {
      session,
      lexer,
      // `divWidth` is the width of the innermost `:::` that was OPEN when the fence
      // opened, or null when there was none. A fence inside a div ends at that div's
      // closer, exactly as it ends at the end of a quote or a list item - and the
      // block parser agrees: `:::` / ``` ``` `` / `x` / `:::` renders the code and
      // then leaves the div, while a run of a different width, or one with trailing
      // text, is ordinary fence content.
      fence: null,
      // A LINE BLOCK is verse: a definition written inside one is text the author
      // laid out, not a definition (PART 9 §23). Ownership is supplied by the
      // same block walk that decides container boundaries.
      verseLines: session.verseOwnedLines(lexer),
      // A comment's body is OPAQUE. This pass did not know it, so a `[r]: /u`
      // written inside `%%%` registered and a reference elsewhere resolved against
      // text the author commented out - invisible in the output AND active in the
      // link table (carve-js#634). The footnote path already treats a comment as
      // opaque; this one did not.
      commentFence: null,
      // The boundary scan `commentCloserInScope` shares between the openers of one
      // container. See `CommentScopeMemo`.
      commentScopeMemo: new Map(),
      // Div nesting depth, for the abbreviation branch below. A div is the one
      // container that adds NO per-line prefix, so `raw` alone cannot tell a
      // document-level definition from one written inside `:::`. Colon fences close
      // on an exact length match (carve#455), which is what the stack records.
      //
      // EACH ENTRY CARRIES THE CONTAINER IT WAS OPENED IN. The stack was
      // document-wide, so a quoted `> :::` pushed onto it and nothing popped when
      // the quote ended - leaving it non-empty for the rest of the document, and
      // the abbreviation branch requires document level, so every abbreviation
      // below a one-line quoted div stopped registering (carve-js#1139).
      divs: [],
      // Track the enclosing list item's content column so a fenced-code delimiter
      // is tested at its container's content column (PART 2), not blindly at
      // column 0. Without this the prepass cannot tell a real fence nested at a
      // list item's content column from a merely indented run, and a definition
      // written inside such a fence is spuriously collected. Same content-column
      // stack the Markdown migrator uses. (Blockquote prefixes are handled by
      // stripContainerPrefixes; a list nested inside a blockquote is not tracked
      // here — a rarer residual case.)
      // Each entry remembers whether its item was opened BEHIND A QUOTE MARKER.
      // A blank line ends every open quote, so a column opened inside one dies
      // with it, and a later line that writes the marker again opens a NEW quote
      // that inherits nothing (PART 0, A NEW MARKER DOES NOT REACH A DEAD
      // CONTAINER'S COLUMN; carve#1892). A column opened at document level is not
      // affected: a list item is transparent across a blank.
      listCols: [],
      // A definition list STARTS only on a `::` term (PART 2; the parser enters
      // parseDefinitionList from RE_DEFLIST_TERM alone), so a single-colon `: body`
      // line is a description marker only once one has been seen. Ungated, `: term`
      // in ordinary prose pushed a content column the parser never opens.
      sawDeflistTerm: false,
      deflistQuoteDepth: null,
      // THE COMPOSED CONTENT-COLUMN STACK, absolute, outermost first - `listCols`
      // read through every container rather than through list markers alone.
      //
      // `listCols` walks a line's list markers on `unquoted`, which strips a
      // COLUMN-0 quote run and stops at the first quote it meets. So under
      // `- > - - x` it records 2 and loses 6 and 8, and the definition gate below
      // fell back to an exemption for any line carrying a prefix of its own - which
      // registered every quoted definition whatever column it was written at
      // (carve-js#1199). This stack is what that gate asks instead; the trackers
      // above keep `listCols`, whose answers they already agree with.
      openCols: [],
      prevBlank: true,
      // Carried rather than scanned backwards: a document of blank lines would make
      // a backward walk quadratic, and this pre-pass is on the parse hot path.
      afterPreviousTerm: false,
      // Track each note's written body column across nested and quoted definitions.
      inFootnoteBody: false,
      noteColumns: [],
      inlineBodyList: false,
      plusColumn: null,
      paraState: 'no',
      paraLine: '',
      // Whether a bare `+` on the line above named a block - see
      // `prepassOpensBlock`. Recorded there rather than re-derived from the string a
      // line later, because the container stack that decides it has moved by then.
      paraLinePlusOpens: true,
      // Number of composed quote/list containers that own the open paragraph.
      // This separates a real sibling marker after item prose from a marker that
      // merely looks like a new item while folding into document/quote prose.
      paraDepth: 0,
      paragraphFoldedAbove: false,
      // A wrapped attribute run closes the paragraph only once it validates.
      // An unfinished brace stays prose, including any folded marker below it.
      attributeState: { attrRun: null },
      hasBlockMatchers: session.activeMatchers.some((e) => e.matchBlock),
      // Parsing every growing blank-free prefix would be quadratic. Price the two
      // parses in UTF-8 bytes and fail toward collecting when the allowance is
      // exhausted (PART 9R R1a).
      lazyProbeBudget: utf8ByteLength(lexer.lines.join('\n')) * 4 + 4096,
      prepassClosers: null,
      // The definition term whose column later lines are measured against (carve#2411).
      term: null,
    }
    for (let idx = lexer.pos; idx <= lastDefinitionLine; idx++) scanLine(s, idx)
  }

}
