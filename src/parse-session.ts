import {
  AttachmentFenceClosers,
  ELISION_WORDS,
  FOOTNOTE_BODY_COLUMN,
  FORCED_TYPE,
  GENERATED_CONTENT_KINDS,
  LAZY_FRAME,
  Lexer,
  MAX_NESTING_DEPTH,
  NO_OPEN_KINDS,
  PAIR_MARKERS,
  QUOTE_LETTER_RUN,
  RE_ABBR_DEF,
  RE_ADMONITION_CLOSE,
  RE_ADMONITION_OPEN,
  RE_ANY_COLON_CLOSER,
  RE_ANY_FENCE_CLOSER,
  RE_AUTOLINK_STICKY,
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
  RE_RAW_INLINE_STICKY,
  RE_VALID_ADMONITION_OPEN,
  SMART_TOKENS,
  SubstitutionScanner,
  accumulateAttrs,
  allocateDashes,
  anchorRangeAt,
  appendLinkReferenceDefinitions,
  applyAbbreviations,
  applyLinkDefs,
  atomicLinkRegions,
  attachBlockPos,
  attachesAtDocumentColumnZero,
  backtickRunEnds,
  blockQuoteParagraphClaimOpen,
  bodyHoldsOpenCommentSpan,
  buildBracketMap,
  closeBlockQuoteParagraph,
  closerIndex,
  closesAfterDash,
  codeContent,
  codePointAfter,
  collectColonFenceBody,
  collectLinkDefsWithHelpers,
  colonBlockOpenerRun,
  colonFenceShapeEndsLazyContinuation,
  combinedSpanCloser,
  commentBlockHasCloser,
  commentCloserLookup,
  commentFenceRun,
  commentLineContent,
  consumeLooseKey,
  crossrefBodyCanEnd,
  deflistMarkerLine,
  delimitedTable,
  deriveTableMetadata,
  dropPositions,
  dropTrailingWhitespace,
  emphasisBrackets,
  endsInPlus,
  explicitlyClosedQuotes,
  extendsGrapheme,
  extractItemAttr,
  fenceCloseRe,
  fencedBlockEnd,
  imageIsBlock,
  indentColumns,
  inlineDepthState,
  inlineOpaqueEnds,
  inlineSource,
  isBlankLine,
  isBlockAttributeLine,
  isBlockImageLine,
  isCarveWhitespace,
  isColonFenceOpener,
  isContinuationMarker,
  isFigureGroupOpener,
  isFlankSpace,
  isLinkDefLine,
  isListMarkerLine,
  isLiteralColonFenceLine,
  isPhysicalContinuationMarker,
  isQuoteAlnum,
  isQuoteOpenContext,
  isQuoteSpace,
  isRetainableLineComment,
  isStackedFirstBlockQuoteMarker,
  isTableRow,
  itemFenceHasCloser,
  layoutWork,
  lazyProbeCost,
  lazyProbeFrame,
  leadingWhitespace,
  lineOpensBlock,
  linkDestinationValue,
  linkDestinations,
  literalCommentHasCloser,
  markAboveContentColumn,
  markSecondLineLazy,
  markerContentColumn,
  markerDecision,
  matchLinkDef,
  matchedCommentFenceEnd,
  mergeAttrs,
  nestedColonLexer,
  nestedSubLexer,
  newCommentSpanScan,
  newEmphasisMemo,
  normalizeNewlines,
  normalizeRefLabel,
  normalizedSourceLines,
  opaqueGroupCloser,
  openQuoteDepth,
  opensInlineComment,
  orderedMatch,
  parseAbbrDef,
  parseAttrs,
  parseCommentBlock,
  parseDefinitionListWithHelpers,
  parseLineBlockWithHelpers,
  parseListWithHelpers,
  parseRawBlock,
  parseTableBlock,
  quoteBodyColumn,
  quotePrefixDepth,
  quotedCommentHasCloser,
  quotedFenceHasCloser,
  quotedLineText,
  readCaptionText,
  rebaseOverindentedBlocks,
  replaceLoneSurrogates,
  restoreVerbatimBlanks,
  retainBelowColumnComment,
  scanInlineInnerWithHelpers,
  setDelimitedPayloadLines,
  sliceColumns,
  sourceColumn,
  sourceColumnAt,
  sourceQuoteBody,
  sourceQuoteLocalColumn,
  splitBracedOpener,
  startsInterruptingBlock,
  stripLazyFrame,
  stripPositions,
  subLexer,
  taskMatch,
  toCodepointPositions,
  trackBlockQuoteLazyState,
  trackItemLazyState,
  trimEndNonNbsp,
  trimEndSpaceTab,
  tryCollectBlockAttributes,
  unclosedContainerFromOpener,
  unescapeAttrValue,
  unorderedMatch,
  utf8ByteLength,
  verbatimOnlyLazyState,
  verbatimSpanEnd
} from './parse-core.js'
import type {
  Admonition,
  AnchorRange,
  Attrs,
  BlockNode,
  BlockQuote,
  BlockQuoteLazyState,
  CarveExtension,
  CitationGroup,
  CodeBlock,
  DefinitionList,
  Directive,
  Div,
  Document,
  Emphasis,
  EmphasisMatch,
  EmphasisMemo,
  Figure,
  FigureGroup,
  Heading,
  HeadingLevel,
  Image,
  InlineMatch,
  InlineNode,
  InlinePairView,
  InlineScannerSession,
  InlineSource,
  LazyProbeFrame,
  LineBlock,
  LineBlockHost,
  LinkDef,
  LinkDefMatch,
  List,
  MatcherContext,
  Math,
  OpaqueGroup,
  Paragraph,
  ParseOptions,
  PendingAttrCarry,
  Position,
  QuoteDescent,
  QuoteLazyHint,
  QuotedFenceCloserMemo,
  SmartPunctuation,
  StrippedLineOrigin,
  Table,
  TableBlockHost,
  Text,
  ThematicBreak,
  VerbatimCellWrap
} from './parse-core.js'

export class ParseSession {
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
    return start === undefined ? text : text.slice(0, start).replace(/ +$/, '')
  }

  private lineBlockHost: LineBlockHost | undefined
  private tableBlockHost: TableBlockHost | undefined
  captionLineScopes: Set<number>[] = []
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
    return this.matchLinkDef(line) !== null
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
  private linkLabelDepth = 0

  // Matchers belong to this parse; fragment parsing scopes its matcher context.
  activeMatchers: CarveExtension[] = []

  private activeMatcherCtx: MatcherContext | null = null

  /**
   * The document being parsed, for the one field that promises VERBATIM SOURCE.
   */
  private activeDocument: string | null = null
  recordPositions = true

  // A definition pre-pass probe parses a source fragment through the block layer.
  // Matchers remain active during that parse, but its own definition scan must not
  // start another probe (a matcher may recursively call ctx.parseBlocks too).
  private probingLazyParagraph = false
  private definitionRegionLines: Set<number> | null = null
  private inMatcherRequest = false
  // Set on the line-ownership probe only: a paragraph's inlines never decide
  // which lines a block consumes, so the probe leaves them unscanned.
  private skipParagraphInlines = false

  parse(source: string, opts: ParseOptions = {}): Document {
    const sourceByteLength = utf8ByteLength(source)
    this.recordPositions = opts.positions !== false
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
    const strippedBom = source.charCodeAt(0) === 0xfeff
    if (strippedBom) source = source.slice(1)
    // Replace any NUL (U+0000) with the U+FFFD replacement character so a control
    // byte never reaches output (decided cross-impl behavior; WHATWG-style).
    if (source.includes('\0')) source = source.replace(/\0/g, '�')
    // A lone surrogate becomes U+FFFD too, so output is always well-formed
    // (CARVE-P0-023).
    source = replaceLoneSurrogates(source)
    const lexer = new Lexer(
      source,
      opts,
      0,
      opts.onUnclosedContainer || opts.onDanglingBlockAttributes || opts.onInvalidContainerMetadata ? new Set<string>() : undefined,
    )
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
    if (strippedBom) {
      lexer.sourceOffsetMap = lexer.lineOffsets.map((offset) => offset + 1)
      lexer.linePrefixWidths = lexer.lineOffsets.map((_offset, index) => (index === 0 ? 1 : 0))
    }
    lexer.atDocumentLevel = true
    // Consume leading frontmatter first so `lexer.pos` marks the end of the
    // metadata region; the def passes and parseBlocks all start from there.
    lexer.consumeFrontmatter()
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
    const children = this.parseBlocks(lexer, 0)
    appendLinkReferenceDefinitions(children, lexer, strippedBom ? '\ufeff' + source : source)
    const doc: Document = { type: 'document', children }
    // Record the source byte length so renderers can size the
    // abbreviation-expansion budget (DoS guard); see render-html/markdown/ansi.
    doc.srcByteLength = sourceByteLength
    if (lexer.frontmatter) doc.frontmatter = lexer.frontmatter
    if (lexer.footnoteDefs.size) doc.footnoteDefs = Object.fromEntries(lexer.footnoteDefs)
    if (lexer.footnoteDefPos.size) doc.footnoteDefPos = Object.fromEntries(lexer.footnoteDefPos)
    if (opts.positions === false) return dropPositions(doc)
    else toCodepointPositions(doc, strippedBom ? '\ufeff' + source : source)
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
      sourceLines.every((line, i) => root.lineAt(anchor + i) === line)
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
    sub.footnoteDefPos = root.footnoteDefPos
    this.collectLinkDefs(sub)
    if (!this.activeMatchers.length) return this.parseBlocks(sub, 0)
    const prevCtx = this.activeMatcherCtx
    this.activeMatcherCtx = this.makeMatcherCtx(sub, opts)
    try {
      return this.parseBlocks(sub, 0)
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
      const res = ext.matchBlock(lexer.lines, lexer.pos, ctx)
      if (res && res.linesConsumed > 0) {
        for (let k = 0; k < res.linesConsumed && !lexer.eof(); k++) lexer.consume()
        return res.node
      }
    }
    return null
  }

  private scanLinkLabel(text: string, source: InlineSource, inFootnote: boolean): InlineNode[] {
    this.linkLabelDepth++
    try {
      // A LABEL IS A HOST, not a span inside one: its inline run starts here, so a
      // `%%` written first in it needs no separator (CARVE-P9-041, corpus 518).
      return this.scanInline(text, source, inFootnote, false, NO_OPEN_KINDS, true)
    } finally {
      this.linkLabelDepth--
    }
  }

  // Offer the active inline matchers the position `pos` in `text`, in
  // registration order. Returns the first match whose end advances past pos.
  private tryInlineMatchers(text: string, pos: number): InlineMatch | null {
    const ctx = this.activeMatcherCtx
    if (!ctx || (this.definitionRegionLines && !this.inMatcherRequest)) return null
    for (const ext of this.activeMatchers) {
      if (!ext.matchInline) continue
      const res = ext.matchInline(text, pos, ctx)
      if (res && res.end > pos && res.end <= text.length) return res
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

      const sibling = lexer.peek(1)
      if (out.at(-1)?.type === 'list' && isContinuationMarker(line) && sibling !== undefined &&
          isListMarkerLine(sibling) && indentColumns(line) === indentColumns(sibling) &&
          listMarkerColumns.has(indentColumns(line))) {
        lexer.interruptRefusedSiblingPlusLine = lexer.pos
      }
      let node = this.parseBlock(lexer)
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
          node.attrs = mergeAttrs(pending, node.attrs ?? {})
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
    if (carry) carry.attrs = pending
    // Nothing is emitted for a run that died here, so this is the only place the
    // fact exists. `carry` streams are excluded: there the run lives on in the
    // other half, and reporting it at the seam would name a loss that is not
    // happening (carve-js#2240).
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

  private parseBlock(lexer: Lexer): BlockNode | null {
    const startLine = lexer.pos
    const node = this.parseBlockInner(lexer)
    if (node) attachBlockPos(lexer, node, startLine, lexer.pos)
    return node
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
    if (lexer.depth >= MAX_NESTING_DEPTH) return this.parseParagraph(lexer, true)

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
      // ONE separator character, and it is `whitespace` - a space or a tab
      // (markup-carve/carve#977, PART 7). This read `/^\s/`, the host language's
      // class, so a `%%<VT>note` line had its vertical tab eaten as the
      // separator and `carve fmt` wrote a SPACE back in its place: a character
      // the clause calls content, replaced by one the author did not write.
      return { type: 'comment', block: false, content: commentLineContent(l) }
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
    if (RE_HR.test(line)) {
      lexer.consume()
      const node: ThematicBreak = { type: 'thematic_break' }
      if (line[0] === '*' || line[0] === '_') node.marker = line[0]
      return node
    }
    if (RE_HEADING.test(line)) return this.parseHeading(lexer)
    // Definition list starts on a `:: term` line (two colons, not three).
    if (RE_DEFLIST_TERM.test(line)) return this.parseDefinitionList(lexer)
    if (quotedLineText(line, lexer.lineTerminatorFree(lexer.pos)) !== null) return this.parseBlockQuote(lexer)
    if (
      taskMatch(line, lexer.lineTerminatorFree(lexer.pos)) !== null ||
      unorderedMatch(line, lexer.lineTerminatorFree(lexer.pos)) !== null ||
      orderedMatch(line, lexer.lineTerminatorFree(lexer.pos)) !== null ||
      extractItemAttr(line, lexer.lineTerminatorFree(lexer.pos)) !== null
    )
      return this.parseList(lexer)
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
    return this.parseParagraph(lexer)
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
    const defLineIndex = lexer.pos
    const defLineRaw = lexer.consume()
    // A note's body column is measured from its OWN marker: §16 asks for two
    // columns past the marker, not two past the frame's zero. A properly nested
    // note rebases to column zero, so `markerColumn` is 0 and `bodyColumn` is the
    // fixed minimum of two. A note that opens one column shy of its host's body
    // column keeps a residual marker indent here (the `i < m+2` nested-note
    // geometry of carve-js#1653 / markup-carve/carve#1946): its body column is
    // then `markerColumn + 2`, so a trailing line below the note's own content
    // column is NOT claimed by it and falls to the surviving ancestor note. Left
    // at the fixed 2 the innermost note over-reached, taking a line that belongs
    // to the outer note.
    const markerColumn = indentColumns(defLineRaw)
    const bodyColumn = markerColumn + FOOTNOTE_BODY_COLUMN
    const authoredLine = lexer.rootLines?.[lexer.lineNumber(defLineIndex) - 1]
    const authoredBodyColumn = authoredLine === undefined ? undefined
      : sourceColumn(authoredLine) + FOOTNOTE_BODY_COLUMN
    const m = RE_FOOTNOTE_DEF.exec(defLineRaw.replace(/^[ \t]+/, ''))!
    // Preserve the raw label as the AST/source-layout spelling. Resolution and
    // duplicate handling derive their shared ASCII-whitespace key separately.
    const label = m[1]!
    const bodyLines = [m[2]!]
    const bodyLineNumbers = [lexer.lineNumber(defLineIndex)]
    // The source line each collected line came from, and which of them were
    // buffered blanks. `restoreVerbatimBlanks` reads both after the rebase.
    const bodySourceLines: (string | undefined)[] = [defLineRaw]
    const bufferedBlanks = new Set<number>()
    // The def line's own content starts past its marker, which is ASCII, so the
    // prefix length is its column width.
    const defContentColumn =
      markerColumn + (defLineRaw.replace(/^[ \t]+/, '').length - m[2]!.length)
    let pendingBlanks = 0
    let pendingBlankLineNumbers: number[] = []
    let pendingBlankSources: string[] = []
    let nestedSourceBodyColumn: number | undefined
    const noteSpanScan = newCommentSpanScan()
    const lazyState = verbatimOnlyLazyState()
    // First-block form (`[^a]: +`, as `- +` and `:  +`): a lone `+` as the whole
    // marker-line content, with a non-blank line at document column 0 below it,
    // is a marker, and that line's block is the body. An invisible line (a
    // definition or a comment) is passed over as under `- +`, so a further
    // footnote definition is no boundary here. Otherwise the `+` stays text.
    let firstBlockAttached = false
    const below = lexer.peek()
    if (/^\+[ \t]*$/.test(m[2]!) && below !== undefined && !isBlankLine(below) &&
        attachesAtDocumentColumnZero(lexer, sourceColumn((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(defLineIndex) - 1] ?? defLineRaw), 0, true)) {
      const { lines: attached, lineNumbers: attachedLineNumbers } = this.collectAttachedBlock(
        lexer,
        (a) => isBlankLine(a) || /^\+[ \t]*$/.test(a),
        0, true, sourceColumn((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(defLineIndex) - 1] ?? defLineRaw), 0, true,
      )
      firstBlockAttached = true
      bodyLines[0] = ''
      bodySourceLines[0] = undefined
      for (const a of attached) {
        bodyLines.push(a)
        bodySourceLines.push(a)
      }
      bodyLineNumbers.push(...attachedLineNumbers)
    }
    if (!firstBlockAttached) trackItemLazyState(m[2]!, lazyState, () => false)
    let retainedBelowComment = false
    const nestedMarkerHasText = RE_FOOTNOTE_DEF.exec(m[2]!)?.[2]?.trim() !== '' && RE_FOOTNOTE_DEF.test(m[2]!)
    let termTextContinuation = false
    const belowColumnCommentFence = new Set<number>()
    let commentFenceUntil = 0
    while (!lexer.eof()) {
      const ln = lexer.peek()!
      const sourceLine = lexer.rootLines?.[lexer.lineNumber(lexer.pos) - 1]
      if (lexer.hostBody === 'description' && pendingBlanks > 0 &&
          authoredBodyColumn !== undefined && sourceLine !== undefined && !isBlankLine(sourceLine) &&
          sourceColumn(sourceLine) < authoredBodyColumn && indentColumns(ln, bodyColumn) >= bodyColumn) break
      if (lexer.hostBody === 'list' && defLineIndex === 0 && nestedSourceBodyColumn !== undefined &&
          sourceLine !== undefined && !isBlankLine(sourceLine) &&
          indentColumns(sourceLine, nestedSourceBodyColumn) < nestedSourceBodyColumn) break
      if (isBlankLine(ln)) {
        retainedBelowComment = false
        termTextContinuation = false
        trackItemLazyState('', lazyState)
        pendingBlanks++
        pendingBlankLineNumbers.push(lexer.lineNumber(lexer.pos))
        pendingBlankSources.push(ln)
        lexer.consume()
        continue
      }
      // Form B: a lone `+` attaches the FOLLOWING flush-left block to the note
      // with no indentation (the same continuation marker lists and block quotes
      // use); the attached block ends at a blank line, another `+`, or the next
      // footnote definition - unless a fence this block opened is still open, in
      // which case all three are body text (corpus category 279).
      const noteMarkerLine = isContinuationMarker(ln.slice(leadingWhitespace(ln)))
      const noteMarker = noteMarkerLine ? markerDecision(lexer, lexer.pos) : undefined
      if (pendingBlanks === 0 && lazyState.opaque === null &&
          noteMarker?.owner?.kind === 'footnote' && noteMarker.reason !== undefined) {
        // The note still owns this marker even when the next block misses its
        // marker column. The body collector leaves the + as text below.
        lexer.reportRefusedContinuationMarker(lexer.pos, markerColumn + 1,
          'footnote', noteMarker.reason)
      }
      if (pendingBlanks === 0 && noteMarkerLine &&
          (isPhysicalContinuationMarker(sourceLine ?? ln) || noteMarker?.owner?.kind === 'footnote' && noteMarker.reason === undefined) &&
          sourceColumn((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos)] ?? '', quotePrefixDepth(sourceLine ?? ln)) ===
            sourceColumn(sourceLine ?? ln) &&
          !(sourceLine !== undefined && quotePrefixDepth(sourceLine) > 0 &&
            sourceColumn(sourceLine) === quoteBodyColumn(sourceLine, quotePrefixDepth(sourceLine)) &&
            quotePrefixDepth((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos)] ?? '') > quotePrefixDepth(sourceLine)) &&
          !isBlankLine((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos)])) {
        const plusLineNumber = lexer.lineNumber(lexer.pos)
        lexer.consume()
        pendingBlanks = 0
        pendingBlankLineNumbers = []
        pendingBlankSources = []
        // ...AND THE NOTE ENDS WHERE A COMMENT ENDS IT. The gate below decides
        // whether this `+` is a marker at all; when it is not, the line is an
        // ordinary invisible line at document column 0, and a footnote body ends
        // at one of those exactly as it ends at a comment line there
        // (markup-carve/carve#1814). Asked one line early because this loop's
        // own continuation branch would otherwise claim the following line before
        // any extent is measured. The `+` is consumed either way, so the
        // enclosing parse resumes on the line the marker did not take.
        if (!attachesAtDocumentColumnZero(lexer, sourceColumn(sourceLine ?? ln), quotePrefixDepth(sourceLine ?? ln))) break
        const { lines: attached, lineNumbers: attachedLineNumbers } = this.collectAttachedBlock(
          lexer,
          (a) => isBlankLine(a) || /^\+[ \t]*$/.test(a) || RE_FOOTNOTE_DEF.test(a),
          0,
          true,
          sourceColumn(sourceLine ?? ln),
          quotePrefixDepth(sourceLine ?? ln),
        )
        if (attached.length > 0) {
          bodyLines.push('')
          bodyLineNumbers.push(plusLineNumber)
          bodySourceLines.push(undefined)
          for (const a of attached) {
            bodyLines.push(a)
            bodySourceLines.push(a)
          }
          bodyLineNumbers.push(...attachedLineNumbers)
        }
        continue
      }
      // §16 asks for COLUMNS, not characters, and §24 C1 gives a tab a column
      // value - so a bare tab reaches column 4 and continues the note exactly as
      // two spaces do. Matching characters here accepted `<SPACE><TAB>` and
      // refused a bare tab, while carve-php refused the mixture and took the bare
      // tab: three engines, three readings (carve#796, carve-js#725). A rejected
      // continuation does not indent differently, it LEAVES the note and lands in
      // the document body, so the split moved content between blocks.
      if (indentColumns(ln, bodyColumn) >= bodyColumn) {
        for (let k = 0; k < pendingBlanks; k++) {
          bufferedBlanks.add(bodyLines.length)
          bodyLines.push('')
          bodyLineNumbers.push(pendingBlankLineNumbers[k]!)
          bodySourceLines.push(pendingBlankSources[k])
        }
        pendingBlanks = 0
        pendingBlankLineNumbers = []
        pendingBlankSources = []
        const content: string = retainedBelowComment && !RE_COMMENT_LINE.test(ln.trimStart())
          ? ln.trimStart() : sliceColumns(ln, bodyColumn, true)
        const belowQuotedComment = lazyState.quoteInner !== null && RE_COMMENT_LINE.test(content.trimStart())
        // The line reaches this body's column, so a definition on it registers
        // here even where a nested item takes it as lazy text (CARVE-P0-020).
        if (lazyState.opaque === null && RE_FOOTNOTE_DEF.test(content.trimStart()))
          lexer.hostedFootnoteLines.add(lexer.lineNumber(lexer.pos))
        if (lexer.hostBody === 'list' && defLineIndex === 0 && RE_FOOTNOTE_DEF.test(ln.trimStart()) && sourceLine !== undefined) {
          nestedSourceBodyColumn = indentColumns(sourceLine) + FOOTNOTE_BODY_COLUMN
        }
        if (content !== content.trimStart() && lazyState.opaque === null && commentFenceUntil <= lexer.pos)
          commentFenceUntil = matchedCommentFenceEnd(lexer) ?? commentFenceUntil
        if (lexer.pos < commentFenceUntil) belowColumnCommentFence.add(bodyLines.length)
        // Past the body column a definition is term text; at it, it registers (CARVE-P0-010).
        bodyLines.push(termTextContinuation && RE_DEFLIST_TERM.test(bodyLines[0] ?? '') && content !== content.trimStart() &&
          (RE_FOOTNOTE_DEF.test(content.trimStart()) || isLinkDefLine(content.trimStart()))
          ? LAZY_FRAME + content.trimStart() : content)
        if (RE_DEFLIST_TERM.test(bodyLines[0] ?? '') && /^:[ \t]+/.test(content.trimStart()))
          termTextContinuation = true
        trackItemLazyState(content, lazyState, (marker) => itemFenceHasCloser(lexer, marker, lexer.pos, bodyColumn, new Map(), (line, blank) => blank && indentColumns(line, bodyColumn) < bodyColumn))
        retainedBelowComment = belowQuotedComment && /^[ \t]*>/.test(lexer.peek(1) ?? '')
        bodyLineNumbers.push(lexer.lineNumber(lexer.pos))
        bodySourceLines.push(ln)
        lexer.consume()
      } else if (
        // A COMMENT INSIDE A SPAN THIS BODY ALREADY HOLDS IS NOT ONE OF THE
        // COMMENTS THAT END IT (markup-carve/carve-js#2255,
        // markup-carve/carve#2488). The note ends at a comment below its column,
        // and the other half of a span the body opened is not that comment - see
        // `bodyHoldsOpenCommentSpan`. The reported host hides the payload at a
        // delimiter REACHING column two and did not at column zero or one, which is
        // the band this covers.
        pendingBlanks === 0 &&
        commentFenceRun(ln.replace(/^[ \t]+/, '')) !== undefined &&
        bodyHoldsOpenCommentSpan(bodyLines, noteSpanScan)
      ) {
        // ONE COLUMN of the authored indentation is kept, as the list collector
        // keeps it, so the body's own parse cannot read a delimiter written below
        // its column back as an authored column-0 one. A delimiter already AT
        // column 0 keeps it (markup-carve/carve-js#1623).
        const flush = ln.replace(/^[ \t]+/, '')
        bodyLines.push(flush === ln ? ln : ' ' + flush)
        bodyLineNumbers.push(lexer.lineNumber(lexer.pos))
        bodySourceLines.push(ln)
        lexer.consume()
      } else if (
        pendingBlanks === 0 && indentColumns(ln, bodyColumn) < bodyColumn && ln !== ln.trimStart() &&
        (retainedBelowComment || lazyState.lazyFoldable) && lazyState.opaque === null &&
        matchedCommentFenceEnd(lexer) !== undefined
      ) {
        // A matched fence below the column retains the note as a `%%` line does.
        const end = matchedCommentFenceEnd(lexer)!
        while (lexer.pos < end) {
          const line = lexer.peek()!
          belowColumnCommentFence.add(bodyLines.length)
          bodyLines.push(line)
          bodyLineNumbers.push(lexer.lineNumber(lexer.pos))
          bodySourceLines.push(line)
          lexer.itemLazyLines.add(lexer.lineNumber(lexer.pos))
          lexer.consume()
        }
        retainedBelowComment = retainBelowColumnComment('%%', lazyState, false)
      } else if (
        pendingBlanks === 0 && !RE_FOOTNOTE_DEF.test(ln) &&
        !(retainedBelowComment && isColonFenceOpener(ln.trimStart())) &&
        (retainedBelowComment || ((lazyState.lazyFoldable || (nestedMarkerHasText && bodyLines.length > 1)) && isRetainableLineComment(lexer, ln))) &&
        (isRetainableLineComment(lexer, ln) ||
          !startsInterruptingBlock(lexer, ln, false, false, ln === ln.trimStart()))
      ) {
        const content = retainedBelowComment && !RE_COMMENT_LINE.test(ln.trimStart())
          ? ln.trimStart()
          : ln
        bodyLines.push(content)
        bodyLineNumbers.push(lexer.lineNumber(lexer.pos))
        bodySourceLines.push(ln)
        lexer.itemLazyLines.add(lexer.lineNumber(lexer.pos))
        trackItemLazyState(content, lazyState, (marker) => itemFenceHasCloser(lexer, marker, lexer.pos, markerColumn, new Map(), (line, blank) => blank && indentColumns(line, bodyColumn) < bodyColumn), false,
          (run) => commentBlockHasCloser(lexer, run))
        retainedBelowComment = retainBelowColumnComment(content, lazyState, false)
        lexer.consume()
      } else {
        break
      }
    }
    if (!lexer.footnoteDefs.has(label)) {
      // A recognized opener at or beyond the note's minimum column establishes
      // its authored column as a local base (carve#1729). The collector has
      // already removed the fixed two-column body margin.
      // A fence taken below the column keeps that column, as a `%%` line does.
      const rebaseEligible = belowColumnCommentFence.size === 0 ? undefined
        : new Set(bodyLines.map((_, k) => k).filter((k) => !belowColumnCommentFence.has(k)))
      if (bodyLines.length !== 1 || !/^[A-Za-z][A-Za-z0-9 .]*$/.test(bodyLines[0]!)) {
        rebaseOverindentedBlocks(
          bodyLines, rebaseEligible, -1, true, true, undefined, undefined, undefined, false,
          undefined, undefined, { markerBody: lexer.hostBody === 'list' && defLineIndex === 0 },
          undefined, undefined, false, false, true,
        )
        restoreVerbatimBlanks(bodyLines, bodySourceLines, bufferedBlanks, (index) =>
          index === 0 ? defContentColumn : indentColumns(bodySourceLines[index] ?? ''),
        )
      }
      const sub = nestedSubLexer(lexer, bodyLines, defLineIndex, bodyLineNumbers)
      sub.sublistsCarryAuthoredBase = true
      sub.inFootnoteBody = true
      sub.hostBody = 'footnote'
      sub.hostBodyRoot = 'footnote'
      lexer.footnoteDefs.set(label, bodyLines.length === 1 && trimEndSpaceTab(bodyLines[0] ?? '') === '{empty}' ? [] : this.parseBlocks(sub, 0))
      // The definition runs from its `[^label]:` marker to the last line it
      // consumed. The body blocks cannot supply that: the marker is not part of
      // any of them, so a span derived from the body would start inside the
      // definition (carve-js#480).
      //
      // Only when this lexer can express a document offset - inside an unmapped
      // container the numbers mean something else, and §4 forbids inventing one.
      if (lexer.hasDocumentOffsets) {
        let lastIndex = Math.max(defLineIndex, lexer.pos - 1)
        while (lastIndex > defLineIndex && isBlankLine(lexer.lineAt(lastIndex) ?? '')) lastIndex--
        const lastLine = lexer.lineAt(lastIndex) ?? ''
        // A span begins at the `[^label]:` marker, not at the line start. When
        // this definition is nested one column shy of its parent's body margin,
        // the sub-lexer strips a fixed margin and leaves a residual space ahead
        // of the marker; the start must skip it (PART 12 §4, carve#1963).
        const defLine = lexer.lineAt(defLineIndex) ?? ''
        const defLead = defLine.length - defLine.replace(/^[ \t]+/, '').length
        const pos: Position = {
          startLine: lexer.lineNumber(defLineIndex),
          endLine: lexer.lineNumber(lastIndex),
          startColumn: lexer.lineStartColumn(defLineIndex) + defLead,
          endColumn: lexer.lineStartColumn(lastIndex) + lastLine.length,
          startOffset: lexer.lineOffset(defLineIndex) + defLead,
          endOffset: lexer.lineOffset(lastIndex) + lastLine.length,
        }
        const lastOwned = [...(lexer.footnoteDefs.get(label) ?? [])]
          .reverse()
          .find((child) => child.pos !== undefined)?.pos
        if (lastOwned !== undefined) {
          pos.endLine = lastOwned.endLine
          if (lastOwned.endColumn !== undefined) pos.endColumn = lastOwned.endColumn
          if (lastOwned.endOffset !== undefined) pos.endOffset = lastOwned.endOffset
        }
        lexer.footnoteDefPos.set(label, pos)
      }
    }
    return null
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
      markerPrefixMemo: this.markerPrefixMemo.bind(this),
      parseBlocks: this.parseBlocks.bind(this),
      parseInline: this.parseInline.bind(this),
    }, lexer)
  }

  private parseBlockQuote(lexer: Lexer): BlockQuote | Figure {
    const firstLineIndex = lexer.pos
    const inner: string[] = []
    const origins = new Map<number, StrippedLineOrigin>()
    const innerLineNumbers: number[] = []
    const state: BlockQuoteLazyState = {
      mode: { kind: 'closed' },
      inTable: false,
      colonWidths: [],
      attrRun: null,
    }
    let fenceCloserMemo: QuotedFenceCloserMemo | undefined
    // Quoted lines not yet fed to the tracker. `state` is read only when an
    // unmarked line asks whether the paragraph is still open (or a `+` closes
    // it), so tracking waits until then. The tracker descends every nested
    // quote on the line, and a quote that ends at EOF or a blank line would
    // otherwise pay that at every level - quadratic in the nesting depth.
    const untracked: Array<[content: string, lineIndex: number]> = []
    const given = firstLineIndex === 0 ? lexer.quoteLazyHint : null
    lexer.quoteLazyHint = null
    const descent: QuoteDescent = { levels: 0, askedBelowTop: false }
    // The state this quote hands its own nested quote; see `QuoteLazyHint`.
    let handDown = null as QuoteLazyHint | null
    let trackedBefore = false
    let paragraphOpen: boolean | undefined
    const trackLine = (content: string, lineIndex: number): void => {
      paragraphOpen = undefined
      trackBlockQuoteLazyState(
        content,
        state,
        (fence) => quotedCommentHasCloser(lexer, fence, lineIndex),
        (marker, depth, column) =>
          !lexer.quoteLazyLines.has(lexer.lineNumber(lineIndex)) &&
          quotedFenceHasCloser(lexer, marker, lineIndex, fenceCloserMemo ??= new Map(), depth, column),
        descent,
        this.markerPrefixMemo(lexer, lineIndex),
        !lexer.quoteLazyLines.has(lexer.lineNumber(lineIndex)),
        (fence, depth, floor) => literalCommentHasCloser(lexer, fence, lineIndex, depth, floor),
      )
      // Reuse the handed-down state only while lazy text leaves it unchanged.
      if (!descent.preserved && handDown && state.mode.kind === 'quote' && state.mode.inner === handDown.state) handDown = null
    }
    const trackUntracked = (): void => {
      if (trackedBefore) {
        for (const [content, lineIndex] of untracked) trackLine(content, lineIndex)
        untracked.length = 0
        return
      }
      trackedBefore = true
      const prefix = untracked.length
      let depth: number
      if (given !== null && given.lines === prefix) {
        Object.assign(state, given.state)
        paragraphOpen = given.paragraphOpen
        depth = given.depth - 1
      } else {
        // Each line continues the inner quotes the line before it opened, so
        // the chain is one set of states down to the shallowest line's depth.
        depth = Infinity
        for (const [content, lineIndex] of untracked) {
          trackLine(content, lineIndex)
          depth = Math.min(depth, descent.levels)
        }
        if (descent.askedBelowTop) depth = 0
      }
      untracked.length = 0
      if (depth >= 1 && state.mode.kind === 'quote') {
        handDown = { state: state.mode.inner, lines: prefix, depth }
      }
    }
    const quoteTermLead = /^\s*>[ \t]+::[ \t]+/.test(lexer.lineAt(firstLineIndex) ?? '')
    let quoteTermContinuation = quoteTermLead
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
    const localQuoteOffset = lexer.hasDocumentOffsets ? lexer.lineStartColumn(firstLineIndex) - 1 : -1
    const physicalQuoteColumn = localQuoteOffset >= 0
      ? sourceColumnAt(quoteRootLine, localQuoteOffset)
      : Math.max(quoteMarkerColumn,
        sourceColumn(quoteRootLine, Math.max(0, quotePrefixDepth(quoteRootLine) - localQuoteDepth)))
    let emptyFirstBlockMarker = false
    while (!lexer.eof()) {
      const ln = lexer.peek()!
      const quoted = quotedLineText(ln, lexer.lineTerminatorFree(lexer.pos))
      if (quoted !== null) {
        const lineIndex = lexer.pos
        lexer.consume()
        const content = quoted
        if (isBlankLine(content)) quoteTermContinuation = false
        const markerSourceLine = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lineIndex) - 1]
        const precedingSourceLine = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lineIndex) - 2]
        const quoteMarkerIsWrongColumn = isContinuationMarker(content.trimStart()) &&
          markerSourceLine !== undefined && precedingSourceLine !== undefined &&
          quotePrefixDepth(precedingSourceLine) >= quotePrefixDepth(markerSourceLine) &&
          markerDecision(lexer, lineIndex).reason === 'wrong-column'
        // First-block form (`> +`, as `- +` and `:  +`): a lone `+` as the whole
        // first line of a quote, at any depth, is a marker when a flush-left line
        // outside the quote follows, and that line's block is the innermost
        // quote's body. Before a blank, a quoted line or the end it stays text.
        if (endsInPlus(content) && !quoteMarkerIsWrongColumn &&
            (isPhysicalContinuationMarker(lexer.rootLines?.[lexer.lineNumber(lineIndex) - 1] ?? ln) ||
              lineIndex === firstLineIndex) &&
            this.opensFirstBlockQuote(lexer, lineIndex, content, lineIndex === firstLineIndex ? 0 : -1, () => {
          trackUntracked()
          return openQuoteDepth(state)
        })) {
          const stackedSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lineIndex) - 1] ?? ln
          const stackedDepth = quotePrefixDepth(stackedSource)
          const followerSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? ''
          const followerColumn = sourceColumn(followerSource, stackedDepth)
          const { lines: attached, lineNumbers: attachedLineNumbers } = this.collectAttachedBlock(
            lexer,
            (next) => isBlankLine(next) || /^\+[ \t]*$/.test(next),
            0,
            true,
            isStackedFirstBlockQuoteMarker(stackedSource) ? (followerColumn === Infinity ? 0 : followerColumn) : physicalQuoteColumn,
            isStackedFirstBlockQuoteMarker(stackedSource) ? stackedDepth : 0,
            true,
          )
          if (/^\+[ \t]*$/.test(content)) {
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
          for (const attachedLine of attached) inner.push(attachedLine)
          innerLineNumbers.push(...attachedLineNumbers)
          if (attached.length > 0) {
            inner.push('')
            innerLineNumbers.push(attachedLineNumbers[attachedLineNumbers.length - 1]!)
          }
          trackUntracked()
          closeBlockQuoteParagraph(state)
          handDown = null
          continue
        }
        if (lineIndex === firstLineIndex && endsInPlus(content) &&
            isStackedFirstBlockQuoteMarker(markerSourceLine ?? ln) &&
            lexer.peek() !== undefined && !isListMarkerLine(lexer.peek()!.trimStart()) &&
            quotedLineText(lexer.peek()!, lexer.lineTerminatorFree(lexer.pos)) === null) emptyFirstBlockMarker = true
        if (lineIndex !== firstLineIndex && markerSourceLine !== undefined &&
            isPhysicalContinuationMarker(markerSourceLine) &&
            quotePrefixDepth(markerSourceLine) > 0) {
          const follower = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lineIndex)]
          const depth = quotePrefixDepth(markerSourceLine)
          if (follower !== undefined && quotePrefixDepth(follower) === depth &&
              sourceColumn(follower, depth) === sourceColumn(markerSourceLine, depth) &&
              isListMarkerLine(sourceQuoteBody(follower))) {
            lexer.reportRefusedContinuationMarker(lineIndex,
              sourceColumnAt(markerSourceLine, markerSourceLine.lastIndexOf('+')) + 1,
              'block quote', 'sibling')
          }
        }
        if (lineIndex !== firstLineIndex && markerSourceLine !== undefined &&
            precedingSourceLine !== undefined && isPhysicalContinuationMarker(markerSourceLine) &&
            quotePrefixDepth(precedingSourceLine) > quotePrefixDepth(markerSourceLine)) {
          // A marker at a surviving outer quote level is still a marker when
          // it cannot take a block. The inner quote may retain it as text.
          const follower = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lineIndex)]
          const markerDepth = quotePrefixDepth(markerSourceLine)
          if (follower === undefined || isBlankLine(follower) ||
              quotePrefixDepth(follower) !== markerDepth || sourceQuoteLocalColumn(follower, markerDepth) !== 0) {
            lexer.reportRefusedContinuationMarker(lineIndex,
              sourceColumnAt(markerSourceLine, markerSourceLine.lastIndexOf('+')) + 1, 'block quote',
              follower === undefined ? 'document' : isBlankLine(follower) ? 'blank' : 'right')
          }
        }
        if (lexer.lineTerminatorFree(lineIndex)) origins.set(inner.length, { text: content, parentIndex: lineIndex, prefix: ln.length - content.length })
        inner.push(content)
        untracked.push([content, lineIndex])
        innerLineNumbers.push(lexer.lineNumber(lineIndex))
        continue
      }
      // Continuation marker (Carve, PART 9 §17): a lone `+` at column 0 after a
      // quoted line attaches the FOLLOWING flush-left block to the quote -- the
      // un-prefixed analogue of the list-item form, so a real block (list, fenced
      // code, table, ...) can join the quote without repeating `>`. Collect the
      // block's lines (up to a blank line or a further `+`) and
      // splice them into the quote body behind a blank-line separator, so they
      // parse as their own block instead of folding into the quoted paragraph.
      const physicalPlus = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? ln
      const quoteMarkerLine = isContinuationMarker(ln.slice(leadingWhitespace(ln)))
      const quotePlusDecision = quoteMarkerLine ? markerDecision(lexer, lexer.pos) : undefined
      const quotePlusDepth = quotePrefixDepth(physicalPlus)
      const quotePlusColumn = sourceColumn(physicalPlus)
      const quoteFollower = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos)]
      let quotePlusBody = physicalPlus
      let quoteFollowerBody = quoteFollower ?? ''
      for (let depth = 0; depth < quotePlusDepth; depth++) {
        quotePlusBody = quotedLineText(quotePlusBody, false) ?? ''
        quoteFollowerBody = quotedLineText(quoteFollowerBody, false) ?? quoteFollowerBody
      }
      if (quoteMarkerLine &&
          quotePlusDecision?.reason !== 'sibling' &&
          !(quotePlusDepth === 0 && quotePrefixDepth(quoteRootLine) > 1 &&
            quotePlusColumn > quoteMarkerColumn) &&
          !(quotePlusColumn > 0 && quotePlusDecision?.reason === 'wrong-column' &&
            isListMarkerLine((quoteFollower ?? '').trimStart())) &&
          !(quotePlusDepth > 0 && quotePlusDepth < quotePrefixDepth(quoteRootLine) &&
            quotePlusDecision?.reason === 'wrong-column' && quotePlusDecision.blockedByInnerList) &&
          isContinuationMarker(quotePlusBody.trimStart()) &&
          (quotePlusColumn === physicalQuoteColumn || quotePlusDecision?.owner?.kind === 'list' &&
            quotePlusDecision.owner.column === quotePlusColumn && quotePlusDecision.reason === undefined) &&
          quoteFollower !== undefined &&
          !isBlankLine(quoteFollowerBody) &&
          (quotePlusDepth === 0 || quotePrefixDepth(quoteFollower) === quotePlusDepth ||
            quotePlusColumn > quoteBodyColumn(physicalPlus, quotePlusDepth)) &&
          sourceColumn(quoteFollower, quotePlusDepth) === quotePlusColumn) {
        lexer.consume()
        const { lines: attached, lineNumbers: attachedLineNumbers } = this.collectAttachedBlock(
          lexer,
          (next) => isBlankLine(next) || /^\+[ \t]*$/.test(next),
          0,
          true,
          quotePlusColumn,
          quotePlusDepth,
        )
        if (attached.length > 0) {
          lexer.attachmentBoundaries.add(attachedLineNumbers[0]!)
          // `inner` always holds the quote's first content line, so a leading
          // blank separates the attached block from it.
          // The separators are SYNTHETIC - no such blank line exists in the
          // source - so each borrows the line it sits against rather than the
          // `+` marker's. Borrowing the marker's put them BEFORE the attached
          // block in document order, and a block spanning first-to-last line then
          // reported an end offset earlier than its start (#462).
          inner.push('')
          innerLineNumbers.push(attachedLineNumbers[0]!)
          for (const attachedLine of attached) inner.push(attachedLine)
          innerLineNumbers.push(...attachedLineNumbers)
          inner.push('')
          innerLineNumbers.push(attachedLineNumbers[attachedLineNumbers.length - 1]!)
          // The attached block closed any open paragraph: a following unmarked
          // line no longer lazily continues the quote.
          trackUntracked()
          closeBlockQuoteParagraph(state)
        }
        continue
      }
      const lazyFootnote = RE_FOOTNOTE_DEF.test(stripLazyFrame(ln).trimStart()) &&
        indentColumns(lexer.rootLines?.[lexer.lineNumber(lexer.pos) - 1] ?? ln) < quoteMarkerColumn
      if (
        isBlankLine(ln) ||
        (lexer.hostBody === 'list' && !lazyFootnote && leadingWhitespace(ln) >= FOOTNOTE_BODY_COLUMN && RE_FOOTNOTE_DEF.test(ln.trimStart())) ||
        (RE_CAPTION.test(ln) && !lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos))) ||
        colonFenceShapeEndsLazyContinuation(ln) ||
        (quoteTermContinuation && RE_HEADING.test(ln)) ||
        (quoteTermContinuation && (
          RE_HR.test(ln) || isTableRow(ln) ||
          (leadingWhitespace(ln) === 0 && (RE_FOOTNOTE_DEF.test(ln) || isLinkDefLine(ln) || isBlockAttributeLine(ln))) ||
          RE_COMMENT_LINE.test(ln)
        )) ||
        (lexer.hostBody !== null && RE_FOOTNOTE_DEF.test(ln.trimStart()) &&
          !lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos)) &&
          indentColumns(lexer.rootLines?.[lexer.lineNumber(lexer.pos) - 1] ?? ln) >= quoteMarkerColumn) ||
        (!quoteTermContinuation && !lazyFootnote && startsInterruptingBlock(lexer, undefined, false))
      ) {
        break
      }
      // A non-`>` line inside an open fence/comment, or after a block that left no
      // open paragraph (heading/table/fence/thematic/div), terminates the quote
      // instead of being swallowed. This is also what ends the quote on a lazy
      // list marker when no open paragraph precedes it.
      trackUntracked()
      paragraphOpen ??= blockQuoteParagraphClaimOpen(state)
      if (handDown && handDown.paragraphOpen === undefined) handDown.paragraphOpen = paragraphOpen
      if (!paragraphOpen && !lazyFootnote) break
      if (leadingWhitespace(ln) === 0 && (deflistMarkerLine(ln) || isListMarkerLine(ln)) &&
          !lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos))) {
        let leaf = state
        while (leaf.mode.kind === 'quote') leaf = leaf.mode.inner
        // A marker at the surviving document column ends the open term.
        if (leaf.mode.kind === 'paragraph' && (leaf.mode.term || leaf.hosts?.terms.at(-1))) break
      }
      const lineIndex = lexer.pos
      lexer.consume()
      const lazyLinkDef = this.isLinkDefLine(ln)
      if (lazyLinkDef && lexer.declinedLinkDefLines.has(lexer.lineNumber(lineIndex))) {
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
          indentColumns(lexer.rootLines?.[lexer.lineNumber(lineIndex) - 1] ?? ln) < quoteMarkerColumn)
      if (lazyDefinition) lexer.literalLazyLinkDefLines.add(lexer.lineNumber(lineIndex))
      inner.push(ln.startsWith(LAZY_FRAME) ? ln : isListMarkerLine(ln) || lazyDefinition || quoteTermContinuation
        ? LAZY_FRAME + ln.replace(/^[ \t]+/, '') : ln)
      innerLineNumbers.push(lexer.lineNumber(lineIndex))
      if (!lazyLinkDef) trackLine(ln, lineIndex)
    }
    const subLexer = nestedSubLexer(lexer, inner, firstLineIndex, innerLineNumbers, origins)
    subLexer.quoteLazyHint = handDown
    // A QUOTE'S CONTENT COLUMN COMES FROM ITS MARKER, so the note body's leniency
    // stops here. A footnote body absorbs residual indentation because its blocks
    // are REBASED to an authored base; a quote is not rebased, and an indented
    // definition after `>` is literal text there exactly as at top level
    // (markup-carve/carve-js#1628).
    subLexer.inFootnoteBody = false
    subLexer.consumesHostedLinkDefs = lexer.hostBody === null ? false : 'lazy'
    const children = this.parseBlocks(subLexer, 0)
    if (emptyFirstBlockMarker && children[0]?.type === 'paragraph') {
      const parts = children[0].children
      if (parts[0]?.type === 'text' && /^\+[ \t]*$/.test(parts[0].value)) {
        parts.splice(0, parts[1]?.type === 'soft_break' ? 2 : 1)
        if (parts.length === 0) children.shift()
      }
    }
    const bq: BlockQuote = { type: 'block_quote', children }
    const quoteEndIndex = lexer.pos
    // §4d: a quote built out of nothing but structural-only `>` lines is not a
    // captionable host. It holds nothing the caption could be about, and taking
    // one binds the caption across the container change that opened the quote -
    // which is how `| a |` / blank / `>` / blank / `^ cap` captioned an empty
    // quote nobody wrote the caption under (markup-carve/carve#2892).
    if (children.length === 0) return bq
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
  ): number {
    if (limit <= 1) return limit
    const lines: string[] = []
    for (let k = 0; k < limit; k++) {
      const line = lexer.peek(k)!
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
        const node = this.parseBlock(probe)
        const invisible =
          node === null || node.type === 'abbreviation_def' || node.type === 'comment'
        if (!invisible || probe.eof()) break
      }
      const end = Math.min(Math.max(probe.pos, 1), limit)
      return endAtFoldedDefinition ? Math.max(1, this.foldedAttachedDefinitionEnd(lines, end, probe)) : end
    } finally {
      this.activeMatchers = matchers
      this.measuringAttachedBlock = wasMeasuring
    }
  }

  /**
   * Whether the quote line at `lineIndex` (already consumed, quoted text
   * `content`) is the first-block form: its quote chain ends in a lone `+`, the
   * innermost quote opens on this line, and the next line is a non-blank,
   * unquoted line at document column 0. `openDepth` is how many quotes below
   * this one are already open (0 on the quote's first line), or -1 to ask
   * `readOpenDepth` lazily.
   */
  private opensFirstBlockQuote(
    lexer: Lexer,
    lineIndex: number,
    content: string,
    openDepth: number,
    readOpenDepth: () => number,
  ): boolean {
    const next = lexer.peek()
    const sourceLine = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lineIndex) - 1] ?? ''
    const nextQuoted = next === undefined ? null : quotedLineText(next, lexer.lineTerminatorFree(lexer.pos))
    if (next === undefined || isBlankLine(next) || isListMarkerLine(next.trimStart()) ||
        nextQuoted !== null && isBlankLine(nextQuoted) ||
        nextQuoted !== null &&
        !isStackedFirstBlockQuoteMarker(sourceLine)) return false
    const lineNumber = lexer.lineNumber(lineIndex)
    let chain = lexer.quoteChainEndsInPlus.get(lineNumber)
    if (chain !== undefined && chain.size === 0 && endsInPlus(content)) chain = undefined
    // A probe that parsed a nested quote first measured a shorter chain.
    if (chain !== undefined && chain.size > 0 && !chain.has(content.length) && content.length > Math.max(...chain.keys())) chain = undefined
    if (chain === undefined) {
      // Asked once per source line: every nested quote's text is a suffix of
      // this one, so its levels are looked up by length instead of rescanned.
      const suffixes = [content]
      for (let deeper = quotedLineText(content, false); deeper !== null; deeper = quotedLineText(deeper, false)) suffixes.push(deeper)
      chain = new Map()
      if (/^\+[ \t]*$/.test(suffixes[suffixes.length - 1]!)) {
        for (let k = 0; k < suffixes.length; k++) chain.set(suffixes[k]!.length, suffixes.length - 1 - k)
      }
      lexer.quoteChainEndsInPlus.set(lineNumber, chain)
    }
    const levels = chain.get(content.length)
    if (levels === undefined) return false
    if (levels === 0 ? openDepth !== 0 : (openDepth < 0 ? readOpenDepth() : openDepth) >= levels) return false
    return attachesAtDocumentColumnZero(lexer,
      isStackedFirstBlockQuoteMarker(sourceLine) ? sourceColumn(sourceLine) : sourceColumn(sourceLine, 0),
      isStackedFirstBlockQuoteMarker(sourceLine) ? quotePrefixDepth(sourceLine) : 0, true)
  }

  private collectAttachedBlock(
    lexer: Lexer,
    isBoundary: (line: string) => boolean,
    contentColumn = 0,
    endAtFoldedDefinition = true,
    markerColumn = 0,
    quoteLevels = Infinity,
    acceptFirstNonList = false,
  ): { lines: string[]; lineNumbers: number[]; startLineIndex: number } {
    const transform = contentColumn === 0 ? undefined : (line: string) => sliceColumns(line, contentColumn)
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
    if (!attachesAtDocumentColumnZero(lexer, markerColumn, quoteLevels, acceptFirstNonList)) {
      return { lines: [], lineNumbers: [], startLineIndex: lexer.pos }
    }
    const scans = lexer.attachmentScans ??= new Map()
    let cache = scans.get(contentColumn)
    if (cache === undefined) {
      cache = {}
      scans.set(contentColumn, cache)
    }
    const origin = lexer.contiguousOrigin?.lexer ?? lexer
    const indexBase = lexer.contiguousOrigin?.start ?? 0
    const fenced = fencedBlockEnd({
      at: (offset) => {
        const line = lexer.peek(offset)
        return line === undefined ? undefined : transform ? transform(line) : line
      },
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
      contentColumn,
      indexBase,
      base: lexer.pos,
    })
    let take = 0
    if (fenced !== -1) {
      take = fenced + 1
    } else {
      while (lexer.peek(take) !== undefined) {
        const candidate = lexer.peek(take)!
        // A first-block marker can attach a flush-left block even when its
        // list marker is indented. Dedent ends the block only after it starts.
        const firstFlushLeft = take === 0 && contentColumn > 0 &&
          indentColumns(candidate) === 0 && !isBlankLine(candidate) && !isContinuationMarker(candidate) &&
          !lineOpensBlock(candidate)
        const firstNonList = acceptFirstNonList && take === 0 && !isBlankLine(candidate) &&
          !isContinuationMarker(candidate) && !isListMarkerLine(candidate)
        if (isBoundary(candidate) && !firstFlushLeft && !firstNonList) break
        take++
      }
      const measured = this.attachedBlockExtent(lexer, take, transform, endAtFoldedDefinition)
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

    return { lines, lineNumbers, startLineIndex }
  }

  collectAttachedListBlock(
    lexer: Lexer,
    isBoundary: (line: string) => boolean,
    baseIndent: number,
    endAtFoldedDefinition = true,
    markerColumn = 0,
    quoteLevels = Infinity,
  ): { lines: string[]; lineNumbers: number[]; startLineIndex: number } {
    const attached = this.collectAttachedBlock(lexer, isBoundary, baseIndent, endAtFoldedDefinition, markerColumn, quoteLevels, true)
    const first = attached.lines[0]
    const last = attached.lines.at(-1)
    const code = first === undefined ? null : RE_FENCE.exec(first) ?? RE_RAW_FENCE.exec(first)
    const codeMarker = code === null ? null : RE_FENCE.test(first!) ? code[2]! : code[1]!
    const closedCode = codeMarker !== null && last !== undefined && fenceCloseRe(codeMarker).test(last)
    const colon = first === undefined ? null : colonBlockOpenerRun(first)
    const closedColon = colon !== null && isFigureGroupOpener(first!, lexer.inFigureGroup) &&
      last !== undefined && RE_ADMONITION_CLOSE.exec(last)?.[1]?.length === colon
    if (codeMarker !== null && !closedCode) {
      while (!lexer.eof() && !isBlankLine(lexer.peek()!)) {
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

  private parseList(lexer: Lexer): List {
    return parseListWithHelpers(lexer, this)
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
  private parseCaptionInline(lexer: Lexer, firstLine: string): InlineNode[] {
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
        this.parseInline(text, lexer.abbrDefs, lexer.linkDefs, undefined, true),
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
      true,
    )
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
    let holdsLiteralColonFence = false
    const startLineIndex = lexer.pos
    let secondLineLazy = false
    while (!lexer.eof()) {
      const ln = lexer.peek()!
      if (isBlankLine(ln)) break
      if (lines.length === 1 && startLineIndex === lexer.interruptRefusedSiblingPlusLine &&
          isListMarkerLine(ln)) break
      // Paragraph interruption (grammar PART 9 §10): a VISIBLE block (heading,
      // list, quote, table, fence, thematic break, admonition/div) interrupts
      // an open paragraph with no blank line before it, at the top level AND
      // nested — the Markdown-like rule. Invisible constructs (reference
      // definitions, comments) interrupt too. A bare image does not interrupt,
      // an ordered marker interrupts only as `1.`/`1)`, and a fence/`:::` only
      // when it has a matching closer ahead. See startsInterruptingBlock.
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
        lines.length > 0 &&
        !lexer.literalLazyLinkDefLines.has(lexer.lineNumber(lexer.pos)) &&
        ((((!ln.startsWith(LAZY_FRAME) || (lexer.hostBody === 'list' &&
          !RE_FOOTNOTE_DEF.test(stripLazyFrame(ln)))) && (lexer.consumesHostedLinkDefs === 'all' ||
          (lexer.consumesHostedLinkDefs === 'lazy' &&
            lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos))))) &&
          this.isLinkDefLine(stripLazyFrame(ln))) ||
          startsInterruptingBlock(lexer) ||
          (lexer.hostedFootnoteLines.has(lexer.lineNumber(lexer.pos)) &&
            !ln.startsWith(LAZY_FRAME) && RE_FOOTNOTE_DEF.test(ln.trimStart()))) &&
        !(RE_ADMONITION_CLOSE.test(ln) && holdsLiteralColonFence)
      )
        break
      if (lines.length === 1 && (ln.startsWith(LAZY_FRAME) || lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos))))
        secondLineLazy = true
      const physical = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? ln
      if (lexer.hostMarkerColumn !== undefined &&
          (sourceColumn(physical) === lexer.hostMarkerColumn ||
            lexer.hostBody === 'list' && markerDecision(lexer, lexer.pos).reason === 'wrong-column') &&
          isContinuationMarker(ln) &&
          (isPhysicalContinuationMarker(physical) || isContinuationMarker(physical.trimStart()))) {
        lexer.reportRefusedContinuationMarker(lexer.pos, lexer.lineStartColumn(lexer.pos) + ln.indexOf('+'),
          lexer.hostBody === 'list' ? 'list item' : 'document', 'wrong-column')
      }
      lexer.consume()
      // The frame did its work in the interruption test above; a paragraph is
      // where a framed line becomes text, so it comes off here.
      const received = stripLazyFrame(ln)
      lines.push(received)
      holdsLiteralColonFence ||= isLiteralColonFenceLine(received)
    }
    // Every paragraph line has its leading whitespace stripped (djot /
    // CommonMark): `a\n   b` renders as `a\nb`, and a leading-indented first
    // line (` c`, or a fresh paragraph after a list closes) renders as `c` —
    // Carve has no indented code blocks, so indentation never survives into a
    // paragraph. The first line's stripped width is folded into the inline
    // base position so source offsets/columns stay accurate.
    const firstLead = lines[0]!.match(/^[ \t]+/)?.[0].length ?? 0
    const text = dropTrailingWhitespace(lines.length === 1
      ? lines[0]!.slice(firstLead)
      : lines.map((ln) => ln.replace(/^[ \t]+/, '')).join('\n'))
    // Each line contributes its OWN leading whitespace on top of whatever prefix
    // the container stripped, so a continuation line needs its own origin rather
    // than a single base offset plus a local one (#444).
    const anchors =
      lines.length > 1
        ? lines.map((ln, i) => {
            const lead = ln.match(/^[ \t]+/)?.[0].length ?? 0
            return {
              offset: lexer.lineOffset(startLineIndex + i) + lead,
              column: lexer.lineStartColumn(startLineIndex + i) + lead,
              line: lexer.lineNumber(startLineIndex + i),
            }
          })
        : undefined
    const paragraphNode: Paragraph = {
      type: 'paragraph',
      children: this.skipParagraphInlines && !this.inMatcherRequest ? [] : this.parseInline(text, lexer.abbrDefs, lexer.linkDefs, {
        anchored: lexer.hasDocumentOffsets,
        baseOffset: lexer.lineOffset(startLineIndex) + firstLead,
        startLine: lexer.lineNumber(startLineIndex),
        startColumn: lexer.lineStartColumn(startLineIndex) + firstLead,
        ...(anchors ? { lineAnchors: anchors } : {}),
      }),
    }
    // The container prefix is already stripped by the lexer, so a first line with
    // leading whitespace LEFT sat above the container's content column. Recorded
    // here because this is the last place the answer exists: the indentation is
    // thrown away two lines up, and the block-image promotion phase has no way to
    // recover it from the tree (carve-js#1553).
    if (firstLead > 0) markAboveContentColumn(paragraphNode)
    // A caption line below the container's column reaches no host (§10 I7).
    if (secondLineLazy) markSecondLineLazy(paragraphNode)
    return paragraphNode
  }

  private substitutionScans: SubstitutionScanner | undefined

  /**
   * A substitution's pair end and top-level arrow, or null for a forced strike.
   * Escapes, code spans and closed comments hide their contents.
   */
  private substitutionAt(text: string, open: number): { end: number; arrow: number } | null {
    if (text[open + 1] !== '~' || splitBracedOpener(text, open)) return null
    const end = this.bracedPairEnd(text, open, '~}')
    if (end === -1) return null
    if (this.substitutionScans === undefined) {
      const hosts = new Map<number, number>()
      const brackets = text.includes('[') ? buildBracketMap(text, true) : undefined
      for (let at = 0; at < text.length; at++) {
        if (text[at] !== '[') continue
        const close = brackets?.(at)
        if (close !== undefined) hosts.set(at, close + 1)
      }
      for (const [at, close] of linkDestinations(text, newEmphasisMemo())) hosts.set(at, close + 1)
      // An autolink or a cross-reference is atomic (PART 9 E2a): a `~>` ending one is no arrow.
      for (const [at, end] of atomicLinkRegions(text)) if (!hosts.has(at)) hosts.set(at, end)
      for (let at = 0; at < text.length; at++) {
        const marker = text[at + 1]
        if (text[at] !== '{' || marker === undefined || FORCED_TYPE[marker] === undefined || splitBracedOpener(text, at)) continue
        const close = this.bracedPairEnd(text, at, `${marker}}`)
        if (close !== -1) hosts.set(at, close)
      }
      this.substitutionScans = new SubstitutionScanner(text, hosts)
    }
    const arrow = this.substitutionScans.findArrow(open + 2, end - 2)
    return arrow === -1 ? null : { end, arrow }
  }

  private commentCloserPositions: Map<string, number> | undefined

  private delimitedCommentClose(text: string, from: number): number {
    const positions = (this.commentCloserPositions ??= new Map())
    let last = positions.get(text)
    if (last === undefined) {
      last = text.lastIndexOf('%}')
      positions.set(text, last)
    }
    return last < from ? -1 : text.indexOf('%}', from)
  }

  private pairEndText: string | undefined

  private pairEndTable: Array<Int32Array | undefined> = []
  private pairEndOffset = 0

  private pairAttributeTails = new Map<number, number>()
  private bareAttributePairs = new Map<number, { close: number; end: number }>()

  private pairEndCache = new Map<string, { tables: Array<Int32Array | undefined>; bytes: number; attributeTails: Map<number, number>; barePairs: Map<number, { close: number; end: number }> }>()
  private pairEndCacheBytes = 0
  private pairEndCacheBudget = 0
  private inlinePairFrameDepth = 0

  private rememberPairTables(text: string, tables: Array<Int32Array | undefined>, attributeTails = new Map<number, number>(), barePairs = new Map<number, { close: number; end: number }>()): void {
    const bytes = 128 + text.length * 2 + attributeTails.size * 16 + barePairs.size * 24 + tables.reduce((sum, table) => sum + (table?.byteLength ?? 0), 0)
    while (this.pairEndCacheBytes + bytes > this.pairEndCacheBudget && this.pairEndCache.size > 0) {
      const oldest = this.pairEndCache.keys().next().value!
      this.pairEndCacheBytes -= this.pairEndCache.get(oldest)!.bytes
      this.pairEndCache.delete(oldest)
    }
    this.pairEndCache.set(text, { tables, bytes, attributeTails, barePairs })
    this.pairEndCacheBytes += bytes
    this.pairEndText = text
    this.pairEndOffset = 0
    this.pairEndTable = tables
    this.pairAttributeTails = attributeTails
    this.bareAttributePairs = barePairs
  }

  /**
   * For each marker the text opens a pair with, where a scan for its closer
   * starting at each position stops: the closer's index, or -1. Built right to
   * left in one pass, so the end of a nested pair is known before any scan that
   * has to skip it, and a document of nested pairs costs a pass per level rather
   * than a pass per pair.
   */
  private pairEndTables(text: string): Array<Int32Array | undefined> {
    if (text === this.pairEndText) return this.pairEndTable
    const cached = this.pairEndCache.get(text)
    if (cached !== undefined) {
      this.pairEndCache.delete(text)
      this.pairEndCache.set(text, cached)
      this.pairEndText = text
      this.pairEndOffset = 0
      this.pairEndTable = cached.tables
      this.pairAttributeTails = cached.attributeTails
      this.bareAttributePairs = cached.barePairs
      return cached.tables
    }
    const n = text.length
    const markers: number[] = []
    for (let m = 0; m < PAIR_MARKERS.length; m++) {
      if (text.includes(`{${PAIR_MARKERS[m]}`) && text.includes(`${PAIR_MARKERS[m]}}`)) markers.push(m)
    }
    const tables: Array<Int32Array | undefined> = new Array(PAIR_MARKERS.length)
    const raws: Int32Array[] = []
    for (const m of markers) {
      tables[m] = new Int32Array(n + 2).fill(-1)
      raws[m] = new Int32Array(n + 2).fill(-1)
    }
    if (markers.length === 0 && !text.includes('{#')) {
      this.rememberPairTables(text, tables)
      return tables
    }
    const ends = new Int32Array(n + 2).fill(-1)
    const codeEnds = backtickRunEnds(text)
    const brackets = text.includes('[') ? buildBracketMap(text, true) : undefined
    const destinations = linkDestinations(text, newEmphasisMemo())
    const lineComments = new Map<number, number>()
    const attributeTails = new Map<number, number>()
    const barePairs = new Map<number, { close: number; end: number }>()
    const attributes = inlineOpaqueEnds(text, codeEnds, destinations, lineComments, attributeTails, brackets)
    for (const [start, end] of [...attributeTails].reverse()) attributeTails.set(start, attributeTails.get(end) ?? end)
    const bareMarkers = new Set<number>()
    for (const start of attributeTails.keys()) {
      const marker = text[start - 1]
      if (marker !== undefined && '/*_~='.includes(marker)) bareMarkers.add(PAIR_MARKERS.indexOf(marker))
    }
    const bareTables: Array<Int32Array | undefined> = new Array(PAIR_MARKERS.length)
    for (const m of bareMarkers) bareTables[m] = new Int32Array(n + 2).fill(-1)
    const afterAttributes = attributeTails.size === 0 ? (end: number): number => end : (end: number): number => attributeTails.get(end) ?? end
    const bracketEnds = new Set<number>()
    const openerMarks = new Set<number>()
    for (let at = 0; at < n; at++) {
      if (text[at] === '\\') { at++; continue }
      if (text[at] === '[') {
        const close = brackets?.(at)
        if (close !== undefined) bracketEnds.add(close)
      }
      if (text[at] === '{' && PAIR_MARKERS.includes(text[at + 1] ?? '\0') && !splitBracedOpener(text, at)) openerMarks.add(++at)
    }
    for (let j = n - 1; j >= 0; j--) {
      const ch = text[j]!
      const next = text[j + 1]
      const nextId = next === undefined ? -1 : PAIR_MARKERS.indexOf(next)
      // Where the pair opening here ends, if it closes at all.
      if (ch === '{' && nextId !== -1 && tables[nextId] !== undefined && !splitBracedOpener(text, j)) {
        const stop = tables[nextId]![j + 2]!
        ends[j] = stop === -1 ? -1 : stop + 2
      }
      const codeEnd = ch === '`' ? codeEnds![j]! : undefined
      const bracketEnd = ch === '[' ? brackets?.(j) : undefined
      const destinationEnd = destinations.get(j)
      const attributeEnd = attributes.get(j)
      let bareId = -1
      let bareClose = -1
      let bareTail: number | undefined
      if (bareMarkers.size !== 0) {
        for (const m of bareMarkers) {
          const table = bareTables[m]!
          const marker = PAIR_MARKERS[m]!
          const before = text[j - 1]
          let stop: number
          if (ch === '\\') stop = table[j + 2]!
          else if (bracketEnds.has(j)) stop = -1
          else if (lineComments.has(j)) stop = table[lineComments.get(j)!]!
          else if (codeEnd !== undefined) stop = codeEnd === -1 ? -1 : table[afterAttributes(codeEnd)]!
          else if (attributeEnd !== undefined) stop = table[ch === '<' ? afterAttributes(attributeEnd) : attributeEnd]!
          else if (bracketEnd !== undefined) stop = table[afterAttributes((destinations.get(bracketEnd + 1) ?? bracketEnd) + 1)]!
          else if (destinationEnd !== undefined) stop = table[afterAttributes(destinationEnd + 1)]!
          else if (ch === '{' && nextId !== -1 && ends[j] !== -1) stop = table[afterAttributes(ends[j]!)]!
          else if (ch === marker && before !== undefined && !isCarveWhitespace(before) && (!next || !/[A-Za-z0-9]/.test(next)) && !extendsGrapheme(text, j + 1)) stop = j
          else stop = table[j + 1]!
          table[j] = stop
        }
        bareId = PAIR_MARKERS.indexOf(ch)
        const before = text[j - 1]
        const canOpenBare = bareTables[bareId] !== undefined && next !== undefined && !isCarveWhitespace(next)
          && next !== ch && before !== ch && (!before || !/[A-Za-z0-9_]/.test(before))
          && (ch !== '=' || next !== '>') && ((ch !== '/' && ch !== '_') || before !== '/')
          && !extendsGrapheme(text, j + 1)
        bareClose = canOpenBare ? bareTables[bareId]![j + 1]! : -1
        bareTail = bareClose === -1 ? undefined : attributeTails.get(bareClose + 1)
        if (bareTail !== undefined) barePairs.set(j, { close: bareClose, end: bareTail })
      }
      for (const m of markers) {
        const table = tables[m]!
        const raw = raws[m]!
        // AN ESCAPE HIDES THE CHARACTER AFTER IT, so a closer written there
        // closes nothing and the scan resumes past it. Only an escaped backtick
        // was skipped before, which left `{*a\*}` closing on its escaped
        // delimiter and publishing the backslash as a hard break
        // (markup-carve/carve-js#1897). `raw` is the closer an UNCLOSED verbatim
        // run ends at, and a backslash inside one is content rather than an
        // escape, so it keeps counting that closer.
        if (ch === '\\') {
          raw[j] = raw[j + 1]!
          table[j] = table[j + 2]!
          continue
        }
        const isCloser = next === '}' && ch === PAIR_MARKERS[m] && !openerMarks.has(j)
        raw[j] = next === '}' && ch === PAIR_MARKERS[m] ? j : raw[j + 1]!
        let stop: number
        const commentEnd = lineComments.get(j)
        if (bracketEnds.has(j)) stop = -1
        else if (commentEnd !== undefined) stop = raw[j] !== -1 && raw[j]! < commentEnd ? raw[j]! : table[commentEnd]!
        else if (codeEnd !== undefined) {
          // An unclosed run ends at the pair's closer instead of running to the
          // end of the block (markup-carve/carve#2056).
          stop = codeEnd !== -1 ? table[afterAttributes(codeEnd)]! : raw[j]!
        } else if (attributeEnd !== undefined) stop = table[ch === '<' ? afterAttributes(attributeEnd) : attributeEnd]!
        else if (bracketEnd !== undefined) stop = table[afterAttributes(bracketEnd + 1)]!
        else if (destinationEnd !== undefined) stop = table[afterAttributes(destinationEnd + 1)]!
        else if (isCloser) stop = j
        else if (ch === '{' && nextId !== -1 && (nextId !== m || FORCED_TYPE[next!] !== undefined) && ends[j] !== -1) {
          // A matched child owns its closer, including a child of this kind.
          // Unmatched openers leave the following closer visible.
          stop = table[afterAttributes(ends[j]!)]!
        } else {
          stop = table[j + 1]!
          if (bareTail !== undefined && bareId !== m && (stop === -1 || stop >= bareClose)) stop = table[bareTail]!
        }
        table[j] = stop
      }
    }
    this.rememberPairTables(text, tables, attributeTails, barePairs)

    return tables
  }

  private plainInlineWord(text: string, start: number, end: number, source: InlineSource): InlineNode[] | undefined {
    if (this.activeMatchers.length !== 0 || end <= start || end - start > 64) return undefined
    for (let at = start; at < end; at++) {
      const code = text.charCodeAt(at)
      if (!(code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122)) return undefined
    }
    return [this.withPos({ type: 'text', value: text.slice(start, end) } as Text, source, text, start, end)]
  }

  private plainBracedWordEnd(text: string, open: number, marker: string): number {
    if (this.activeMatchers.length !== 0) return -1
    let at = open + 2
    const limit = Math.min(text.length, at + 65)
    while (at < limit) {
      const code = text.charCodeAt(at)
      if (!(code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122)) break
      at++
    }
    return at > open + 2 && at - open - 2 <= 64 && text[at] === marker && text[at + 1] === '}' ? at + 2 : -1
  }

  /** Where a braced inline opened at `open` closes (exclusive), or -1. */
  private bracedPairEnd(text: string, open: number, closer: string): number {
    if (splitBracedOpener(text, open)) return -1
    const wordEnd = this.plainBracedWordEnd(text, open, closer[0]!)
    if (wordEnd !== -1) return wordEnd
    const stop = this.pairCloser(text, open + 2, closer[0]!)

    return stop === -1 || stop === open + 2 ? -1 : stop + closer.length
  }

  private pairCloser(text: string, at: number, marker: string): number {
    const table = this.pairEndTables(text)[PAIR_MARKERS.indexOf(marker)]
    const stop = table?.[at + this.pairEndOffset] ?? -1
    return stop < this.pairEndOffset || stop + 2 > this.pairEndOffset + text.length ? -1 : stop - this.pairEndOffset
  }

  private pairAttributeEnd(text: string, end: number): number {
    const tail = this.pairAttributeTails.get(end + this.pairEndOffset)
    return tail === undefined || tail > this.pairEndOffset + text.length ? end : tail - this.pairEndOffset
  }

  private pairBareAttributes(text: string, open: number): { close: number; end: number } | undefined {
    const pair = this.bareAttributePairs.get(open + this.pairEndOffset)
    return pair === undefined || pair.end > this.pairEndOffset + text.length ? undefined
      : { close: pair.close - this.pairEndOffset, end: pair.end - this.pairEndOffset }
  }

  private pairView(offset: number): InlinePairView {
    return { tables: this.pairEndTable, attributeTails: this.pairAttributeTails, barePairs: this.bareAttributePairs, offset: this.pairEndOffset + offset }
  }

  /**
   * Critic insertion/deletion pairs do not close on a delimiter escaped inside
   * an unclosed verbatim run. The forced-emphasis family deliberately does.
   */
  private criticPairEnd(text: string, open: number, closer: '+}' | '-}'): number {
    const end = this.bracedPairEnd(text, open, closer)
    if (end === -1) return -1
    const close = end - 2
    if (text[close - 1] !== '\\') return end

    for (let tick = text.indexOf('`', open + 2); tick !== -1 && tick < close; tick = text.indexOf('`', tick + 1)) {
      if (tick > open + 2 && text[tick - 1] === '\\') continue
      const span = verbatimSpanEnd(text.slice(0, close), tick)
      if (!span.closed) return -1
      tick = span.end - 1
    }
    return end
  }

  private singleQuoteSpan: { node?: SmartPunctuation; demote: boolean } | null = null
  private quoteScopeDepth = 0

  private activeQuoteCharacters: readonly [string, string, string, string] = ['“', '”', '‘', '’']
  private quoteGlyphHasNul = false

  private smartToken(
    text: string,
    i: number,
    prev: string,
  ): { out: string; len: number; kind: string } | null {
    for (const [tok, out, kind] of SMART_TOKENS) {
      if (text.startsWith(tok, i)) return { out, len: tok.length, kind }
    }
    // A run of 2+ hyphens collapses to em/en dashes (djot allocation). A
    // lone `-` stays literal.
    if (text[i] === '-' && text[i + 1] === '-') {
      let n = 0
      while (text[i + n] === '-') n++
      // PART 9 §8 (carve#1443): a run PRECEDED by whitespace (or the start of the
      // content) and FOLLOWED by a non-whitespace character is a long CLI flag,
      // not a dash, and stays literal. `git log --oneline` rendered `git log
      // –oneline` before this - silently, and in the output only.
      //
      // The run start is scanned back to, not assumed to be `i`: a literal run is
      // emitted one hyphen at a time, so the next character re-enters here with
      // hyphens already behind it. Reading only forward would convert the tail of
      // `---foo` into an en dash.
      let start = i
      while (start > 0 && text[start - 1] === '-') start--
      const before = start > 0 ? text[start - 1]! : ''
      const after = text[i + n] ?? ''
      //
      // The whole run is consumed as literal text rather than declined, so the
      // arrow token cannot pick up what the dash rule put down: declining left
      // `-->` as a stray `-` plus a live `->`, and the flag rendered `-→`.
      if ((before === '' || isFlankSpace(before)) && after !== '' && !isFlankSpace(after)) {
        return { out: text.slice(i, i + n), len: n, kind: 'literal_hyphen_run' }
      }
      return { out: allocateDashes(n), len: n, kind: 'dash_run' }
    }
    const c = text[i]!
    if (c === '"') {
      const open = isQuoteOpenContext(prev) && !closesAfterDash(prev, text[i + 1] ?? '')
      return { out: open ? this.activeQuoteCharacters[0] : this.activeQuoteCharacters[1], len: 1, kind: open ? 'left_double_quote' : 'right_double_quote' }
    }
    if (c === "'") {
      const next = codePointAfter(text, i)
      const open = isQuoteOpenContext(prev) && !closesAfterDash(prev, next)
      let apostrophe = /[0-9]/.test(next) || (!open && isQuoteAlnum(next))
      if (!apostrophe && !open && !isQuoteSpace(prev)) this.singleQuoteSpan = null
      if (open && !apostrophe) {
        if (isQuoteAlnum(next)) {
          QUOTE_LETTER_RUN.lastIndex = i + 1
          const word = QUOTE_LETTER_RUN.exec(text)?.[0] ?? ''
          const end = i + 1 + word.length
          const elision = ELISION_WORDS.has(word.toLowerCase())
            && !(text[end] === "'" && !isQuoteAlnum(codePointAfter(text, end)))
          apostrophe = elision || this.singleQuoteSpan !== null
        }
        if (!apostrophe && this.singleQuoteSpan === null) {
          this.singleQuoteSpan = {
            demote: isQuoteAlnum(next) && !(i === 0 && this.inlinePairFrameDepth === this.quoteScopeDepth) && prev !== '“',
          }
        }
      }
      return {
        out: apostrophe ? '’' : open ? this.activeQuoteCharacters[2] : this.activeQuoteCharacters[3],
        len: 1,
        kind: open && !apostrophe ? 'left_single_quote' : 'right_single_quote',
      }
    }
    return null
  }

  /**
   * The inline nodes of a REFERENCE LABEL, for PART 9R R1's heading-index lookup.
   *
   * R1 keys the heading index by each heading's RENDERED PLAIN TEXT, and says the
   * LABEL enters that same comparison as its rendered plain text - its inline
   * markup stripped exactly as the heading's was. So the label has to be PARSED
   * to be compared: a fixed-character-list strip gets `*bold* heading` right and
   * `` `code()` heading `` wrong, which is why the corpus pins both.
   *
   * Neither the abbreviation table nor `linkDefs` is applied. The label is being
   * read for its plain text, not published: a nested reference inside it must not
   * resolve, and an abbreviation renders as its own text under `inlineText`
   * anyway.
   */
  parseRefLabelInlines(label: string): InlineNode[] {
    return this.scanInline(label, inlineSource(), false)
  }

  private parseInline(
    text: string,
    abbrDefs: Map<string, string>,
    linkDefs: Map<string, LinkDef> = new Map(),
    source: InlineSource = inlineSource(),
    captionContext = false,
  ): InlineNode[] {
    const nodes = applyAbbreviations(this.scanInline(text, source, false, captionContext), abbrDefs)
    return applyLinkDefs(nodes, linkDefs)
  }

  private openKinds: ReadonlySet<string> = NO_OPEN_KINDS

  /** `openKinds` with `delim` added. */
  private withOpenKind(delim: string): ReadonlySet<string> {
    return new Set([...this.openKinds, delim])
  }

  /** Whether the inline text being scanned is a line block's stanza. */
  private inLineBlock = false

  /**
   * An unclosed run's content with the trailing whitespace its end drops. In a
   * line block a line break is content and is kept (markup-carve/carve#2089); a
   * stanza's own end leaves nothing there to keep.
   */
  /**
   * The `+` joins inside a verbatim payload that starts at `start` in `text`.
   * The scanner skips the payload, so its joins would otherwise vanish; a
   * join consumed as padding has no space left to point at and is dropped.
   */
  private verbatimCellWraps(text: string, source: InlineSource, start: number, payload: string, strippedPadding = false): VerbatimCellWrap[] | undefined {
    if (!source.cellWraps) return undefined
    const shift = source.wrapShift ?? 0
    let wraps: VerbatimCellWrap[] | undefined
    let codepoints = 0
    if (strippedPadding) {
      const wrap = source.cellWraps.get(start - 1 + shift)
      if (wrap) (wraps ??= []).push({ offset: 0, line: wrap.line, ...(wrap.row ? { row: wrap.row } : {}), ...(wrap.col ? { col: wrap.col } : {}) })
    }
    for (let j = start; j < start + payload.length; j++) {
      const code = text.charCodeAt(j)
      if (code === 32) {
        const wrap = source.cellWraps.get(j + shift)
        if (wrap) (wraps ??= []).push({ offset: codepoints, line: wrap.line, ...(wrap.row ? { row: wrap.row } : {}), ...(wrap.col ? { col: wrap.col } : {}) })
      }
      if (code < 0xdc00 || code > 0xdfff || j === start || (text.charCodeAt(j - 1) & 0xfc00) !== 0xd800) codepoints++
    }
    if (strippedPadding) {
      const wrap = source.cellWraps.get(start + payload.length + shift)
      if (wrap) (wraps ??= []).push({ offset: codepoints, line: wrap.line, ...(wrap.row ? { row: wrap.row } : {}), ...(wrap.col ? { col: wrap.col } : {}) })
    }
    return wraps
  }

  private trimUnclosedRun(content: string): string {
    return this.inLineBlock ? content : trimEndNonNbsp(content)
  }

  private scanInline(
    text: string,
    source: InlineSource = inlineSource(),
    inFootnote = false,
    captionContext = false,
    kinds: ReadonlySet<string> = NO_OPEN_KINDS,
    opensHostRun = false,
    separateQuoteScope = false,
    pairs?: InlinePairView,
  ): InlineNode[] {
    if (inlineDepthState.value >= MAX_NESTING_DEPTH) {
      return [this.withPos({ type: 'text', value: text } as Text, source, text, 0, text.length)]
    }
    if (this.activeMatchers.length === 0 && !source.cellWraps && text.length <= 64 && /^[A-Za-z0-9 ]+$/.test(text)) {
      return [this.withPos({ type: 'text', value: text } as Text, source, text, 0, text.length)]
    }
    if (this.inlinePairFrameDepth === 0) {
      this.pairEndCache.clear()
      this.pairEndCacheBytes = 0
      this.pairEndCacheBudget = Math.max(text.length * 64, 65536)
      this.pairEndText = undefined
      this.pairEndTable = []
    }
    const quoteRoot = this.inlinePairFrameDepth === 0 || separateQuoteScope
    const outerQuoteSpan = this.singleQuoteSpan
    const outerQuoteScopeDepth = this.quoteScopeDepth
    if (quoteRoot) this.singleQuoteSpan = null
    inlineDepthState.value++
    this.inlinePairFrameDepth++
    if (quoteRoot) this.quoteScopeDepth = this.inlinePairFrameDepth
    const outerPairText = this.pairEndText
    const outerPair = this.pairView(0)
    const outerSubstitutions = this.substitutionScans
    this.substitutionScans = undefined
    const outer = this.openKinds
    this.openKinds = kinds
    try {
      if (pairs !== undefined) {
        this.pairEndText = text
        this.pairEndTable = pairs.tables
        this.pairEndOffset = pairs.offset
        this.pairAttributeTails = pairs.attributeTails
        this.bareAttributePairs = pairs.barePairs
      }
      return this.scanInlineInner(
        text, source, inFootnote, captionContext, opensHostRun || inlineDepthState.value === 1,
      )
    } finally {
      if (quoteRoot) {
        const span = this.singleQuoteSpan
        if (span?.demote && span.node) {
          span.node.kind = 'right_single_quote'
          span.node.glyph = '’'
        }
        this.singleQuoteSpan = outerQuoteSpan
        this.quoteScopeDepth = outerQuoteScopeDepth
      }
      this.pairEndText = outerPairText
      this.pairEndTable = outerPair.tables
      this.pairEndOffset = outerPair.offset
      this.pairAttributeTails = outerPair.attributeTails
      this.bareAttributePairs = outerPair.barePairs
      this.substitutionScans = outerSubstitutions
      this.openKinds = outer
      inlineDepthState.value--
      this.inlinePairFrameDepth--
    }
  }

  private inlineScannerSession: InlineScannerSession | undefined

  private scanInlineInner(
    text: string,
    source: InlineSource,
    inFootnote: boolean,
    captionContext: boolean,
    atHostRunStart: boolean,
  ): InlineNode[] {
    const parseSession = this
    const session = this.inlineScannerSession ??= {
      get activeMatchers() { return parseSession.activeMatchers },
      set activeMatchers(value: InlineScannerSession['activeMatchers']) { parseSession.activeMatchers = value },
      get inLineBlock() { return parseSession.inLineBlock },
      set inLineBlock(value: InlineScannerSession['inLineBlock']) { parseSession.inLineBlock = value },
      get pairEndText() { return parseSession.pairEndText },
      set pairEndText(value: InlineScannerSession['pairEndText']) { parseSession.pairEndText = value },
      get recordPositions() { return parseSession.recordPositions },
      set recordPositions(value: InlineScannerSession['recordPositions']) { parseSession.recordPositions = value },
      get singleQuoteSpan() { return parseSession.singleQuoteSpan },
      set singleQuoteSpan(value: InlineScannerSession['singleQuoteSpan']) { parseSession.singleQuoteSpan = value },
      bracedPairEnd: this.bracedPairEnd.bind(this),
      criticPairEnd: this.criticPairEnd.bind(this),
      delimitedCommentClose: this.delimitedCommentClose.bind(this),
      extendPosTo: this.extendPosTo.bind(this),
      matchEmphasis: this.matchEmphasis.bind(this),
      pairView: this.pairView.bind(this),
      plainInlineWord: this.plainInlineWord.bind(this),
      positionCitationItems: this.positionCitationItems.bind(this),
      rawSourceSlice: this.rawSourceSlice.bind(this),
      scanInline: this.scanInline.bind(this),
      scanLinkLabel: this.scanLinkLabel.bind(this),
      shiftSource: this.shiftSource.bind(this),
      smartToken: this.smartToken.bind(this),
      substitutionAt: this.substitutionAt.bind(this),
      trimUnclosedRun: this.trimUnclosedRun.bind(this),
      tryInlineMatchers: this.tryInlineMatchers.bind(this),
      verbatimCellWraps: this.verbatimCellWraps.bind(this),
      withPos: this.withPos.bind(this),
    }
    return scanInlineInnerWithHelpers(session, text, source, inFootnote, captionContext, atHostRunStart)
  }

  private matchEmphasis(
    text: string,
    i: number,
    source: InlineSource,
    inFootnote = false,
    noClose: EmphasisMemo = newEmphasisMemo(),
    end = text.length,
  ): EmphasisMatch | null {
    const c = text[i]!

    // Bold-italic /*...*/  (priority over /emphasis/ and *bold*)
    // bare_opener('/'): the outer `/` does not open after a word character
    // or another slash (carve#3217); `a{/*y*/}b` is the intraword spelling.
    if (c === '/' && text[i + 1] === '*' && !/[A-Za-z0-9_/]/.test(text[i - 1] ?? '')) {
      const start = i + 2
      // A bold-italic span requires a non-whitespace char right after `/*`
      // (grammar boldItalic `~spaceOrEnd`). Empty (`/**/`) or space-initial
      // (`/* x*/`) content is not bold-italic and falls through to `/` emphasis,
      // matching carve-php parseBoldItalic.
      // `isCarveWhitespace`, not `\s`: PART 7 makes a vertical tab CONTENT, so
      // `/*<VT>a*/` is bold-italic exactly as `/*<SOH>a*/` already was.
      if (start < text.length && !isCarveWhitespace(text[start]) && !extendsGrapheme(text, start)) {
        const close = combinedSpanCloser(text, start, noClose)
        if (close !== undefined && close + 2 <= end) {
          const inner = text.slice(start, close)
          const children = this.scanInline(inner, this.shiftSource(source, text, start), inFootnote, false, new Set([...this.openKinds, '/', '*']))
          return {
            // `boldItalic` records that the author used the combined form. The
            // nested spelling `*/x/*` yields the same tree, so the writer needs the
            // mark to reproduce what was written (PART 11 §6).
            node: {
              type: 'strong',
              boldItalic: true,
              // The inner emphasis is synthesized from the single `/*…*/` token
              // rather than scanned as its own delimiter pair, so nothing else
              // assigns it a span. PART 12 §4 requires one on every node but the
              // document root, and a consumer cannot tell a synthesized node from
              // a parsed one. It spans the CONTENT; the outer strong spans the
              // delimiters too.
              children: [this.withPos({ type: 'emphasis', children }, source, text, start, close)],
            },
            end: close + 2,
          }
        }
      }
    }
    // Single-char delimiters. Highlight `=` is single-char like the rest; a
    // doubled `==` is therefore literal by same-delimiter adjacency (handled
    // below), exactly like `**x**`. There is NO bare `^`/`,` delimiter:
    // superscript and subscript exist only in the braced forms `{^x^}`/`{,x,}`
    // (grammar PART 9 §9 rationale note) -- a bare caret or comma is literal.
    const pairs: Array<[string, Emphasis['type']]> = [
      ['/', 'emphasis'],
      ['*', 'strong'],
      ['_', 'underline'],
      ['~', 'strike'],
      ['=', 'highlight'],
    ]
    for (const [delim, type] of pairs) {
      if (c === delim) {
        const after = text[i + 1]
        const before = text[i - 1]
        // Opener must be followed by a non-whitespace character (CARVE-P3-013;
        // a tab counts, PART 7).
        if (!after || isCarveWhitespace(after)) continue
        if (extendsGrapheme(text, i + 1)) continue
        // No same-type nesting (spec §4.2): a bare delimiter adjacent to the
        // same delimiter (before OR after) does not open, so a doubled
        // delimiter is literal text. `**x**`, `~~x~~`, `==x==` stay literal,
        // uniformly with `//x//` and `__x__`. Applies to all five.
        if (after === delim || before === delim) continue
        // E3: a second opener of an open kind is content.
        if (this.openKinds.has(delim)) continue
        // Word-boundary opener (spec §9): every bare delimiter can't open after
        // an alphanumeric or `_`, keeping paths/identifiers/numbers literal
        // (a/b/c, foo*bar*baz, snake_case, x = 5, key=value, 1,2,3). Use the
        // forced `{X…X}` family for deliberate intraword emphasis.
        if (before && /[A-Za-z0-9_]/.test(before)) continue
        // A HIGHLIGHT DOES NOT OPEN BEFORE `>` (markup-carve/carve#1442). `=>`
        // stopped being an arrow, which exposed its `=` to this machinery for the
        // first time: `d => e; x != y` opened here and closed on the `=` of `!=`,
        // rendering `<mark>&gt; e; x !</mark>` out of two things that are not
        // emphasis at all. The spec's Ohm grammar carries the same guard, and it
        // costs nothing real - a highlight whose content starts with `>` is a
        // shape nobody writes, while `=>` in prose about code is everywhere.
        if (delim === '=' && after === '>') continue
        // Italic/underline additionally can't open after `/` (path protection,
        // e.g. snake_/case/).
        if ((delim === '/' || delim === '_') && before === '/') continue
        // Find closer that's not preceded by space
        const close = this.cachedFindEmphasisClose(text, i + 1, delim, noClose, end)
        if (close !== -1) {
          const inner = text.slice(i + 1, close)
          return {
            node: { type, children: this.plainInlineWord(text, i + 1, close, source) ?? this.scanInline(inner, this.shiftSource(source, text, i + 1), inFootnote, false, this.withOpenKind(delim)) },
            end: close + 1,
          }
        }
      }
    }
    return null
  }

  private cachedFindEmphasisClose(
    text: string,
    from: number,
    delim: string,
    memo: EmphasisMemo,
    end: number,
  ): number {
    const failed = memo.failed.get(delim)
    if (failed !== undefined && failed[from] === 1) return -1
    const visited: number[] = []
    const close = this.findEmphasisClose(text, from, delim, memo, failed, visited, end)
    if (close === -1) {
      const marks = failed ?? new Uint8Array(text.length + 1)
      for (const j of visited) marks[j] = 1
      memo.failed.set(delim, marks)
    }
    return close
  }

  private withPos<T extends InlineNode>(
    node: T,
    source: InlineSource,
    text: string,
    start: number,
    end: number,
  ): T {
    if (source.anchored === false || (!this.recordPositions && node.type !== 'soft_break' && node.type !== 'hard_break')) return node
    const pos = this.sourcePos(source, text, start, end)
    if (pos) node.pos = pos
    return node
  }

  /** Give each semicolon-delimited citation item its own authored span. */
  private positionCitationItems(
    node: CitationGroup,
    source: InlineSource,
    text: string,
    groupStart: number,
  ): void {
    if (!this.recordPositions || source.anchored === false) return
    const innerStart = node.mode === 'integral' ? 2 : 1
    const inner = node.raw.slice(innerStart, -1)
    let cursor = 0
    const parts = inner.split(';')
    for (let index = 0; index < node.items.length; index++) {
      const part = parts[index]
      if (part === undefined) return
      const leading = part.length - part.trimStart().length
      const trailing = part.length - part.trimEnd().length
      const start = groupStart + innerStart + cursor + leading
      const end = groupStart + innerStart + cursor + part.length - trailing
      const pos = this.sourcePos(source, text, start, end)
      if (pos) node.items[index]!.pos = pos
      cursor += part.length + 1
    }
  }

  /**
   * Move a node's span end out to `end`, keeping its start where it was.
   *
   * Used when markup that belongs to an already-emitted node is read after it -
   * a trailing attribute block. A node parsed with `anchored: false` carries no
   * `pos` at all, and there is nothing to extend.
   */
  private extendPosTo(node: InlineNode, source: InlineSource, text: string, end: number): void {
    const pos = (node as { pos?: Position }).pos
    if (!pos) return
    const point = this.pointAt(source, text, end)
    // The markup read after the node is outside every anchored range, so the
    // extended span would end somewhere the text does not map. A span that cannot
    // state its own end is not a span; the node keeps none.
    if (!point) {
      delete (node as { pos?: Position }).pos
      return
    }
    pos.endLine = point.line
    pos.endColumn = point.column
    pos.endOffset = point.offset
  }

  private sourcePos(
    source: InlineSource,
    text: string,
    start: number,
    end: number,
  ): Position | undefined {
    const startPoint = this.pointAt(source, text, start)
    const endPoint = this.pointAt(source, text, end)
    if (!startPoint || !endPoint) return undefined
    // BOTH ENDS IN THE SAME RANGE. Two ends that each map is not enough when the
    // text is assembled: a node reaching from one fragment into the next covers
    // source it does not own - the row boundary between them - and one span for
    // two non-adjacent regions is the invented value PART 12 section 4 forbids.
    if (source.anchoredRanges && startPoint.range !== endPoint.range) return undefined
    return {
      startLine: startPoint.line,
      endLine: endPoint.line,
      startColumn: startPoint.column,
      endColumn: endPoint.column,
      startOffset: startPoint.offset,
      endOffset: endPoint.offset,
    }
  }

  /**
   * The AUTHORED SOURCE of `text[start..end)`, for a field that promises verbatim.
   */
  private rawSourceSlice(
    source: InlineSource,
    text: string,
    start: number,
    end: number,
  ): string | undefined {
    // ONLY ANCHORED TEXT CAN BE ASKED. Without `lineAnchors` a span is a single
    // base offset plus a local one, which is the document only when the two never
    // diverge - and a bare `inlineSource()` scanning a detached label has no
    // document behind it at all.
    if (!source.lineAnchors || this.activeDocument === null) return undefined
    const pos = this.sourcePos(source, text, start, end)
    if (pos?.startOffset === undefined || pos.endOffset === undefined) return undefined
    const candidate = normalizeNewlines(this.activeDocument.slice(pos.startOffset, pos.endOffset))
    const local = text.slice(start, end)
    if (candidate === local) return undefined
    const candidateLines = candidate.split('\n')
    const localLines = local.split('\n')
    if (candidateLines.length !== localLines.length) return undefined
    for (const [i, localLine] of localLines.entries()) {
      if (localLine !== '' && localLine !== candidateLines[i]) return undefined
    }

    return candidate
  }

  private shiftSource(source: InlineSource, text: string, by: number): InlineSource {
    const point = this.pointAt(source, text, by)
    const shifted: InlineSource = {
      // THE ANCHORED BASE, NOT THE LINEAR ONE. `baseOffset + by` walks the LOCAL
      // text, which is the document only while the two have the same length. A
      // line block's joined text is shorter than its source by every comment line
      // the block layer emptied, so past the first such line the linear sum lands
      // mid-comment: `*a` / `%% secret` / `c*` measured `c` at the second `%`
      // (carve-js#1182). `pointAt` already resolved the anchored answer.
      baseOffset: point?.offset ?? source.baseOffset + by,
      startLine: point?.line ?? source.startLine,
      startColumn: point?.column ?? source.startColumn,
    }
    if (source.anchoredRanges) {
      shifted.anchoredRanges = source.anchoredRanges
      shifted.rangeShift = (source.rangeShift ?? 0) + by
    }
    if (source.cellWraps) {
      shifted.cellWraps = source.cellWraps
      shifted.wrapShift = (source.wrapShift ?? 0) + by
    }
    if (source.lineAnchors) {
      // CARRIED INWARD, which is the whole defect: the anchors reached the
      // stanza's top-level nodes and stopped at the first inline container, so a
      // node nested under one was measured from the joined text. Shared, with the
      // starting LINE carried as a delta - the array belongs to the whole stanza,
      // and copying a suffix per nested construct is quadratic in a tall stanza
      // that also carries markup.
      shifted.lineAnchors = source.lineAnchors
      shifted.anchorShift = (source.anchorShift ?? 0) + this.newlinesUpTo(text, by)
    }
    return shifted
  }

  /** How many newlines of `text` sit strictly before `offset`. */
  private newlinesUpTo(text: string, offset: number): number {
    const indices = this.newlineIndices(text)
    let lo = 0
    let hi = indices.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (indices[mid]! < offset) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  // Per-document cache of newline offsets for each inline text. pointAt() used to
  // rescan `text` from 0 to `offset` on every token, which is O(offset) per call
  // and O(n^2) across a token-dense or many-line paragraph. Caching the sorted
  // newline indices once per distinct text and binary-searching makes each lookup
  // O(log n). Cleared at the start of every parse() so it never outlives a
  // document.
  private newlineIndexCache = new Map<string, number[]>()

  private newlineIndices(text: string): number[] {
    let indices = this.newlineIndexCache.get(text)
    if (indices === undefined) {
      indices = []
      for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
        indices.push(i)
      }
      this.newlineIndexCache.set(text, indices)
    }
    return indices
  }

  /**
   * Map a local offset in the inline text to its document line, column and
   * offset.
   *
   * With `lineAnchors` each line carries its own origin, so a continuation line is
   * measured from where that line actually starts in the document rather than by
   * adding a single base offset to a local one.
   *
   * With `anchoredRanges` the text was assembled from regions the scanner cannot
   * see the boundaries of, and an offset OUTSIDE every range has no document
   * position at all - undefined, rather than a number computed from the wrong
   * origin. The range is reported alongside so a caller can require both ends of a
   * span to come from the same one.
   */
  private pointAt(
    source: InlineSource,
    text: string,
    offset: number,
  ): { line: number; column: number; offset: number; range?: AnchorRange } | undefined {
    if (source.anchoredRanges) {
      const cellOffset = offset + (source.rangeShift ?? 0)
      const range = anchorRangeAt(source.anchoredRanges, cellOffset)
      if (!range) return undefined
      const within = cellOffset - range.from
      return {
        line: range.line,
        column: range.column + within,
        offset: range.offset + within,
        range,
      }
    }
    const indices = this.newlineIndices(text)
    const newlinesBefore = this.newlinesUpTo(text, offset)
    // A FALLBACK ONLY. `startLine + newlinesBefore` assumes the stripped text has
    // one newline per source line, which an anchored text need not: see
    // `lineAnchors`. Where anchors exist the anchor's own line wins below.
    const line = source.startLine + newlinesBefore
    // Offset of this line's start within the LOCAL text.
    const lineStart = newlinesBefore === 0 ? 0 : indices[newlinesBefore - 1]! + 1
    const withinLine = offset - lineStart

    // A NESTED SCAN STARTS PART WAY INTO THE ANCHORED TEXT, so its first line is
    // whichever line of the outer text it began on. `anchorShift` carries that
    // index rather than a re-based copy of the array, for the reason `rangeShift`
    // carries one: an inline construct per line would otherwise copy the whole
    // anchor list per construct.
    const anchor = source.lineAnchors?.[newlinesBefore + (source.anchorShift ?? 0)]
    if (anchor) {
      // THE FIRST LINE MAY BEGIN MID-LINE and the rest never do. A shifted text
      // starts wherever its opener left off, so its origin is the source's own
      // base, which `shiftSource` already resolved through this function; only a
      // line reached by crossing a newline starts where the anchor says. For an
      // unshifted source the two agree by construction, since its first anchor IS
      // its base.
      if (newlinesBefore === 0) {
        return { line, column: source.startColumn + offset, offset: source.baseOffset + offset }
      }
      return {
        line: anchor.line,
        column: anchor.column + withinLine,
        offset: anchor.offset + withinLine,
      }
    }

    // Column resets to 1 right after the most recent newline; with none, it
    // continues from the source's starting column.
    const column =
      newlinesBefore === 0
        ? source.startColumn + offset
        : offset - indices[newlinesBefore - 1]!
    return { line, column, offset: source.baseOffset + offset }
  }

  private findEmphasisClose(
    text: string,
    from: number,
    delim: string,
    memo: EmphasisMemo = newEmphasisMemo(),
    failed?: Uint8Array,
    visited?: number[],
    end = text.length,
  ): number {
    // PART 8: a delimiter inside a balanced label cannot pair past its close.
    // Keep the original text so flanking and source offsets use the same run.
    this.pairEndTables(text)
    const attached = this.bareAttributePairs.size === 0 ? undefined : new Map<number, number>()
    for (let j = from; j < end; j++) {
      if (failed !== undefined && failed[j] === 1) return -1
      visited?.push(j)
      const ch = text[j]!
      const child = ch !== delim && !this.openKinds.has(ch) ? this.pairBareAttributes(text, j) : undefined
      if (child) attached?.set(child.close + 1, child.end)
      const attachedEnd = attached?.get(j)
      if (attachedEnd !== undefined) { j = attachedEnd - 1; continue }
      // Skip escapes
      if (ch === '\\' && j + 1 < text.length) {
        j++
        continue
      }
      // Skip verbatim (code) spans. An unclosed run is opaque to the end of the
      // block, so no emphasis closer can follow it — the opener cannot close.
      if (ch === '`') {
        const span = verbatimSpanEnd(text, j)
        if (!span.closed) return -1
        j = this.pairAttributeEnd(text, span.end) - 1
        continue
      }
      // An unbounded comment consumes the rest of its line before the delimiter
      // stack can claim a closer there. A later line can still close the span.
      // ONE PREDICATE WITH THE BUILDER: a closer this scan hides and the builder
      // publishes, or the reverse, is a span whose two halves disagree. The scan
      // starts past its own opener, so the run-start arm cannot reach it.
      if (opensInlineComment(text, j)) {
        const newline = text.indexOf('\n', j + 2)
        if (newline === -1) return -1
        j = newline
        continue
      }
      // Comment contents are transparent to the surrounding emphasis structure.
      // Only a closed form is a comment; an unterminated opener remains literal.
      if (ch === '{' && text[j + 1] === '%' && !extendsGrapheme(text, j + 2)) {
        const close = this.delimitedCommentClose(text, j + 2)
        if (close !== -1) {
          j = close + 1
          continue
        }
      }
      // A raw inline's format token is opaque as itself, not as a braced
      // highlight: the main loop builds it together with the code span in front
      // of it, so a closer after it stays reachable (E2a, carve-js#1745).
      if (ch === '{' && text[j - 1] === '`') {
        RE_RAW_INLINE_STICKY.lastIndex = j
        const m = RE_RAW_INLINE_STICKY.exec(text)
        if (m) {
          j = this.pairAttributeEnd(text, j + m[0].length) - 1
          continue
        }
      }
      // Braced inlines are opaque too (E2a, markup-carve/carve#2027).
      if (ch === '{') {
        const end = this.bracedInlineEnd(text, j, memo)
        if (end !== -1) {
          j = this.pairAttributeEnd(text, end + 1) - 1
          continue
        }
      }
      // A BALANCED BRACKET RUN IS OPAQUE, ITS LABEL INCLUDED (PART 8,
      // markup-carve/carve#2577). Links rank 5 and the bare emphasis markers
      // rank 7, so the run resolves first and a marker inside it is label text
      // by the time the delimiter stack reaches it: `/[a/](/u)` is a link whose
      // label ends in a slash, not an emphasis paired across the bracket. An
      // UNBALANCED `[` is no run and hides nothing, which is what keeps `/[a/`
      // emphasizing.
      //
      // Asked of every balanced run, not only of one a link resolves from,
      // because the rank belongs to the RUN: `/[a/]` with no destination at all
      // is literal text too.
      if (ch === '[') {
        const close = emphasisBrackets(text, memo)(j)
        if (close !== undefined) {
          j = this.pairAttributeEnd(text, close + 1) - 1
          continue
        }
      }
      // A link or image destination, title included, and an autolink (E2a,
      // markup-carve/carve#2046).
      if (ch === '(' && text[j - 1] === ']') {
        const end = linkDestinations(text, memo).get(j)
        if (end !== undefined) {
          j = this.pairAttributeEnd(text, end + 1) - 1
          continue
        }
      }
      if (ch === '<') {
        // A cross-reference ranks with autolinks (PART 8 item 3).
        if (text.startsWith('</#', j) && text[j + 3] !== '>') {
          memo.crossref ??= { lastCloser: text.lastIndexOf('>') }
          if (crossrefBodyCanEnd(text, j + 3, memo.crossref)) {
            j = text.indexOf('>', j + 3)
            continue
          }
        }
        RE_AUTOLINK_STICKY.lastIndex = j
        const m = RE_AUTOLINK_STICKY.exec(text)
        if (m) {
          j = this.pairAttributeEnd(text, j + m[0].length) - 1
          continue
        }
      }
      if (ch === delim) {
        // Closer must not be preceded by whitespace (CARVE-P3-013).
        const prev = text[j - 1]
        if (prev === undefined || isCarveWhitespace(prev)) continue
        const next = text[j + 1]
        // Word-boundary closer (spec §9): no bare delimiter closes when followed
        // by an alphanumeric. Applies to every delimiter, not just / and _.
        if (next && /[A-Za-z0-9]/.test(next)) continue
        if (extendsGrapheme(text, j + 1)) continue
        return j
      }
    }
    return -1
  }

  // The last index of the braced inline opening at `open`, or -1.
  private bracedInlineEnd(text: string, open: number, memo: EmphasisMemo): number {
    if (memo.lastBrace === -2) memo.lastBrace = text.lastIndexOf('}')
    if (memo.lastBrace < open) return -1
    // The pairs whose closer the parser searches for across the block are asked
    // the same question here, so the scan hides the region the parser builds.
    const marker = text[open + 1]
    if (marker !== undefined && (FORCED_TYPE[marker] !== undefined || marker === '+' || marker === '-') && !splitBracedOpener(text, open)) {
      const stop = this.pairCloser(text, open + 2, marker)
      if (stop !== -1) return this.pairAttributeEnd(text, stop + 2) - 1
    }
    if (marker === '#' && !extendsGrapheme(text, open + 2)) {
      memo.lastCritic ??= text.lastIndexOf('#}')
      const close = memo.lastCritic >= open + 3 ? text.indexOf('#}', open + 2) : -1
      if (close > open + 2) return close + 1
    }
    return -1
  }
}
