import type { Position, BlockNode } from './ast.js'
import type { LinkDef } from './inline-resolution.js'
import type { ParseOptions, UnclosedContainer, RefusedContinuationMarker, StrippedLineOrigin, CloserIndex, QuotedFenceCloserMemo, QuoteLazyHint, AttachedViewScan } from './parse.js'
import { AttachmentFenceClosers } from './attachment-fence-closers.js'
import { ScopedFenceClosers } from './scoped-fence-closers.js'
import { LiteralCommentClosers } from './literal-comment-closers.js'

export const TRAILING_WS = '[ \\t]*$'

const RE_FRONTMATTER_OPEN = new RegExp('^--- ?(\\w*)' + TRAILING_WS)
// Frontmatter close fence: bare `---` only.
const RE_FRONTMATTER_CLOSE = new RegExp('^---' + TRAILING_WS)

// A BLANK LINE IS SPACE AND TAB AND NOTHING ELSE. The grammar names the class
// twice over: `blank_line = {whitespace}, newline` (grammar.ebnf:246) over
// `whitespace = ' ' | '\t'` (:2206). Nothing widens it for this position.
//
// It was `trimStructural(line) === ''`, i.e. `\s` minus U+00A0, which in
// JavaScript specifically is Unicode White_Space PLUS U+FEFF MINUS U+0085 - a
// legacy set rather than a property. Twelve characters the grammar calls content
// therefore ended a paragraph here, and a U+FEFF ended one in this engine alone,
// while the very same mark rendered as ordinary text INSIDE a paragraph: content
// in one position and absence of content in another, which PART 1 rules out in
// as many words ("ONE, and only there: a U+FEFF anywhere else is an ordinary
// zero-width character", grammar.ebnf:85-90). carve-rs reads exactly this class
// already; carve-php reads it but for U+000B (markup-carve/carve#890).
//
// A literal class, not a trim, because a trim is what let a wider set in: there
// is no `String.prototype` method that spells THIS class, and the native `trim()`
// fast path `trimStructural` takes carries the legacy set too.
//
// Asked as "is there a character outside the class": the anchored `^[ \t]*$`
// backtracked through the whole indent of a deep line before failing.
const RE_NOT_BLANK = /[^ \t]/

export function isBlankLine(line: string | undefined): boolean {
  // EOF ends lookahead. Keep the regex: a hand-written scan was slower on deep containers.
  return line !== undefined && !RE_NOT_BLANK.test(line)
}

/**
 * COUNTED instrumentation for the container-layout work (markup-carve/carve#752).
 *
 * Every nesting level hands its body to a nested parse, so a line at depth `d`
 * is handled `d` times. That is unavoidable in this container model; what is
 * not is doing `O(line length)` character work at each of those handlings,
 * which turns `O(bytes)` of document into `O(bytes^1.5)` of work.
 *
 * The regression guard counts those characters rather than timing them. This
 * repo already records why a clock cannot express the bound - see
 * `test/writer-deep-list-perf.test.ts` ("No ratio guard here on purpose... would
 * also fail on the healthy build") and `test/perf-regression.test.ts` (a ratio
 * bound "flaked on nearly every run"). A count is a property of the algorithm,
 * not of the machine: it reproduces byte-identically under any load.
 *
 * Off by default, so a normal parse pays one boolean test per counted call.
 */
export const layoutWork = {
  /** Whether to accumulate. Tests turn this on around a single parse. */
  on: false,
  reuseColonViews: true,
  /** Characters walked by the indentation gate (`indentColumns`). */
  gate: 0,
  /** Characters walked by the column strip (`sliceColumns`). */
  strip: 0,
  /** Characters re-copied at container or attributed-marker seams. */
  seam: 0,
  /** Entries built for local line-offset tables. */
  offsets: 0,
  colonLines: 0,
  bodyEntries: 0,
  closerLines: 0,
  fenceCandidateLines: 0,
  attachmentColonLines: 0,
  geometryEntries: 0,
  markerLinesClassified: 0,
  markerStackEntriesExamined: 0,
  markerFollowerProbes: 0,
  literalSpanDecisions: 0,
  reset(): void {
    this.gate = 0
    this.strip = 0
    this.seam = 0
    this.offsets = 0
    this.colonLines = 0
    this.bodyEntries = 0
    this.closerLines = 0
    this.fenceCandidateLines = 0
    this.attachmentColonLines = 0
    this.geometryEntries = 0
    this.markerLinesClassified = 0
    this.markerStackEntriesExamined = 0
    this.markerFollowerProbes = 0
    this.literalSpanDecisions = 0
  },
  get total(): number {
    return this.gate + this.strip + this.seam
  },
}

export class Lexer {
  interruptRefusedSiblingPlusLine = -1
  attachmentBoundaries: Set<number>
  consumedContinuationLines: Set<number>
  /** Per document line whose quote chain ends in a lone `+`: text length at each depth to the levels below it. */
  quoteChainEndsInPlus: Map<number, Map<number, number>>
  prefixMemoLines?: boolean[]
  private storedLines: readonly string[] = []
  private lineView: { lexer: Lexer; start: number; length: number } | undefined

  get lines(): readonly string[] {
    const view = this.lineView
    if (view) {
      this.storedLines = Array.from({ length: view.length }, (_value, i) => view.lexer.lineAt(view.start + i)!)
      if (layoutWork.on) layoutWork.bodyEntries += view.length
      this.lineView = undefined
    }
    return this.storedLines
  }

  set lines(lines: readonly string[]) {
    this.storedLines = lines
    this.lineView = undefined
    this.literalCommentClosers = undefined
  }

  get lineCount(): number {
    return this.lineView?.length ?? this.storedLines.length
  }

  lineAt(index: number): string | undefined {
    if (index < 0 || index >= this.lineCount) return undefined
    return this.lineView ? this.lineView.lexer.lineAt(this.lineView.start + index) : this.storedLines[index]
  }

  useLineView(lexer: Lexer, start: number, length: number): void {
    this.lineView = { lexer, start, length }
    this.storedLines = []
    this.literalCommentClosers = undefined
  }
  private offsetLines: readonly string[]
  lineOffsets: number[] = []
  private localOffsetsReady = false
  private rawLineSource: string | undefined
  lineNumberOffset: number
  sourceLineMap?: number[]
  contiguousOrigin?: { lexer: Lexer; start: number }
  colonFenceEnds = new Map<number, number>()
  /**
   * Document offset of each line's CONTENT start, for a sub-lexer over stripped
   * container lines. Without it `lineOffset` reports an offset into the
   * container's own text, so every inline position inside a blockquote, list or
   * admonition pointed at the wrong place (#444).
   */
  sourceOffsetMap?: number[]
  sourceBoundaries?: Array<{ parent: Lexer; line: number; start: number; synthetic: number }>
  /**
   * The document's last line number, and whether the source ended without a
   * break after it. A code payload running to that line is the only one whose
   * literal text ends mid-line (CARVE-P12-064), so a fence consults both to
   * decide whether its last line owns a break.
   */
  documentLineCount = 0
  documentLacksFinalBreak = false
  /**
   * Width of the container prefix stripped from each line (`> `, `- `, and so
   * on). Columns are 1-based against the DOCUMENT line, so the inline scanner
   * has to add back what the container removed. It varies per line, since `>`,
   * `> ` and `>  ` are all valid.
   */
  linePrefixWidths?: number[]
  /**
   * The DOCUMENT's own lines, carried unchanged into every sub-lexer.
   *
   * A container's body reaches a sub-lexer DEDENTED, so a line's document
   * column is not recoverable from the view: `* * +` / `x` and `* * +` / `  x`
   * both arrive as `["* +", "x"]` and are byte-identical here. §17 L3 asks for
   * the document column - a continuation marker attaches a block that begins at
   * column 0 and nothing else (markup-carve/carve#1436) - so the question has to
   * be asked of the original line, which `lineNumber` still names.
   *
   * NOT `linePrefixWidths`, which would otherwise answer this: that map is
   * position bookkeeping and is allowed to DECLINE for reassembled content, so
   * parsing through it would make the tree depend on whether positions could be
   * anchored.
   */
  rootLines?: readonly string[]
  /** Root lexer for a document offset after a nested block's last payload line. */
  documentRoot?: Lexer
  /**
   * Whether an OVER-INDENTED SUBLIST in this lexer's lines carries its own
   * authored block base.
   *
   * A footnote body and a definition body both rebase over-indented blocks with
   * sublists included (`rebaseOverindentedBlocks(..., true)`), so a list marker
   * written above the body's minimum content column establishes a base of its
   * own (PART 9 S24 C3). Its span therefore begins at that marker. Everywhere
   * else - the document, a block quote, a list item - the run between the
   * container's content column and the marker is the indentation that PLACES the
   * marker, and PART 12 section 4 puts it INSIDE the span: "a list item's marker
   * and the indentation that places it". Anchoring every list at its marker
   * instead moved nine corpus documents off carve-rs and carve-php
   * (markup-carve/carve#1797).
   */
  sublistsCarryAuthoredBase = false
  /** This lexer parses content hosted by a footnote body. */
  inFootnoteBody = false
  /** The body whose content column owns this nested parse. */
  hostBody: 'list' | 'description' | 'footnote' | null = null
  hostMarkerColumn: number | undefined
  /**
   * The body this lexer IS, where `hostBody` is the body it is somewhere inside.
   *
   * `nestedSubLexer` propagates `hostBody`, so a container written in a
   * description body reports one too. This field is deliberately not propagated:
   * only the lexer handed the body's own lines carries it (carve-js#2408).
   */
  hostBodyRoot: 'footnote' | 'description' | null = null
  /** This container consumes indented link definitions on its host's behalf. */
  consumesHostedLinkDefs: false | 'all' | 'lazy' = false
  suppressPositions = false
  pos = 0
  // Block-container nesting depth of this (sub-)lexer; 0 at the document top.
  depth = 0
  frontmatter?: { format: string; content: string; pos?: Position }
  /** Format applied to a bare `---` fence; set from ParseOptions. */
  defaultFrontmatterFormat = 'yaml'
  parseOptions: ParseOptions
  unclosedContainerKeys: Set<string> | undefined
  abbrDefs: Map<string, string>
  /**
   * True only for the lexer over the whole document. PART 12 §7 recognizes an
   * abbreviation definition ONLY at document level: inside a block quote, list
   * item or div the line is ordinary paragraph text. Sub-lexers leave this
   * false, which is what makes a container-authored `*[X]: y` inert.
   */
  atDocumentLevel = false
  linkDefs: Map<string, LinkDef>
  /** Document lines admitted only as a block quote's lazy paragraph text. */
  literalLazyLinkDefLines: Set<number>
  /**
   * List-marker lines a block quote admitted as LAZY PARAGRAPH TEXT.
   *
   * PART 0 lazy continuation is explicit that a list marker is not one of the
   * exclusions that end a quote: an unmarked line folds into the innermost open
   * paragraph at whatever depth that paragraph sits. Where the quote's trailing
   * block is a list, that paragraph is the open item's, and the line reaches it
   * through the quote's own sub-parse - which read the marker again and opened
   * an item inside the quote instead (markup-carve/carve#1904).
   */
  quoteLazyMarkerLines: Set<number>
  /**
   * Lines a LIST ITEM admitted below its content column as lazy text.
   *
   * The item's own reparse reads them again, and at that depth their column
   * says nothing: the enclosing item already decided they were its lazy
   * continuation, and clamped a block-shaped one to a single column so it
   * reaches no content column below. What the clamp cannot carry is WHERE the
   * line came from, and an item whose lead line opened an unfinished fence
   * needs exactly that - a line the container folded in is the fence's body,
   * while one written at that column in the source ends the item
   * (markup-carve/carve-js#1630).
   */
  itemLazyLines: Set<number>
  hostContentColumn = 0
  hostQuoteDepth = 0
  nonAuthoredDefinitionStarts = new Set<number>()
  returnedDescriptionOwnerColumns = new Map<number, number>()
  definitionLeadFromItemMarker = false
  hostedFootnoteLines: Set<number>
  /**
   * EVERY line a block quote admitted as lazy continuation text.
   *
   * `quoteLazyMarkerLines` above records one SHAPE; this records the FACT, for
   * a consumer that needs it about a line of another shape. The fact is the
   * same one PART 0 states: a lazy line supplies no `>`, so it is not the
   * quote's content at any column and its indentation inside the quote body
   * means nothing - it reached the innermost open paragraph by the fold and is
   * that paragraph's text wherever it landed.
   *
   * Read today only by the list collector's description-marker arm
   * (markup-carve/carve-js#1606).
   */
  quoteLazyLines: Set<number>
  /** Comment openers rejected by a marker-line literal owner, keyed by both source lines. */
  literalCommentLineOpeners: Set<string>
  /** See `QuoteLazyHint`. Set by the enclosing quote, taken by the first quote parsed here. */
  quoteLazyHint: QuoteLazyHint | null = null
  /**
   * Definition-shaped lines the pre-pass looked at and DID NOT collect.
   *
   * The two layers decide the same line independently, and the block parser
   * strips a definition line because the pre-pass is supposed to have taken it.
   * Where they disagree the line is collected by nobody and removed by someone,
   * so the render loses text the author typed - which PART 9R R1a rules out
   * even for its own conservative fallback, and markup-carve/carve#1883 makes
   * normative. This set is the pre-pass's answer, and the strip consults it
   * instead of re-deciding (markup-carve/carve-js#1597).
   */
  declinedLinkDefLines: Set<number>
  // Footnote definitions keyed by raw label; value is the parsed note
  // body (def line + indented continuation), set by parseFootnoteDef.
  footnoteDefs: Map<string, BlockNode[]>
  /** Where each definition sits in the source, parallel to `footnoteDefs`. */
  footnoteDefPos: Map<string, Position>
  // True for sub-lexers over already-nested block content (list item /
  // blockquote / admonition bodies). Informational only: under the §10
  // Markdown-like rule a visible block interrupts a paragraph at EVERY level
  // (top and nested) — startsInterruptingBlock no longer branches on this —
  // but sub-lexers still set it to mark their context.
  nested = false
  /**
   * True while this lexer reads the body of an open `::: figure` group, at any
   * depth (PART 9 §4c: groups do not nest). `parseAdmonition` sets it on the
   * group's body sub-lexer and `nestedSubLexer` carries it into every deeper
   * container, so a bare `::: figure` ANYWHERE inside an open group's body is
   * demoted to a generic container. A sibling after the group parses from the
   * parent lexer, where the flag was never set.
   */
  inFigureGroup = false
  /**
   * True for the sub-lexer over a LIST ITEM's own body, and for that body only.
   */
  markerOpensSublist = false

  // Cache the scan start and longest bare run by fence character. Later
  // openers with a longer marker can skip the scan.
  private ownFenceCloserMemo?: QuotedFenceCloserMemo
  get fenceCloserMemo(): QuotedFenceCloserMemo {
    return this.ownFenceCloserMemo ??= new Map()
  }

  // Where a closer of each fence shape LAST occurs in these lines, built once
  // by `closerIndex`. See `CloserIndex`.
  fenceCloserIndex: CloserIndex | undefined = undefined
  /** Attachment lookahead results, keyed by the view's content column. */
  attachmentScans?: Map<number, AttachedViewScan>
  attachmentFenceClosers?: AttachmentFenceClosers
  scopedFenceCloserIndex: ScopedFenceClosers | undefined = undefined

  /** Container-scoped §10 fence lookahead answers, keyed by source line. */
  fenceLookaheadAnswers: Map<string, boolean>
  /**
   * §10 answers a container gave for a fence a DESCENDANT of it owns.
   *
   * Separate from `fenceLookaheadAnswers` because the two are written by
   * different scopes and only this one may outrank a nested re-derivation: the
   * fence's own container never receives the line that closes it, so it cannot
   * answer for itself (markup-carve/carve#1399 one level in).
   */
  descendantFenceAnswers: Map<string, boolean>
  /** This lexer reads a container body whose collector supplied those answers. */
  usesContainerFenceLookahead = false

  // EVERY line carrying a `%` run, keyed by run length and ascending, built
  // once by `commentRunLines`. `fenceCloserIndex` keeps only the LAST line of
  // each width, which answers "is there one ahead" and cannot answer "is there
  // one before the container ends" - the question `commentCloserInScope` asks.
  commentRunLines: Map<number, { line: number; depth: number }[]> | undefined = undefined
  literalCommentClosers: Map<number, { start: number; end: number; index: LiteralCommentClosers }> | undefined = undefined

  // Document line number to indices of this lexer's lines, built once per parent.
  lineIndicesByNumber: Map<number, number[]> | undefined = undefined

  private terminatorFreeLines: boolean[] = []
  // Reuse a measured whitespace run while literal dedents stay inside it.
  private leadingWhitespaceLines: number[] = []

  columnParent?: Lexer
  columnOrigins?: ReadonlyMap<number, StrippedLineOrigin> | undefined

  private ownedColumnCache = new Map<number, { text: string, value: number | undefined }>()

  ownedIndentColumns(index: number): number | undefined {
    const line = this.lineAt(index) ?? ''
    const cached = this.ownedColumnCache.get(index)
    if (cached?.text === line) return cached.value
    const value = this.measureOwnedIndentColumns(index, line)
    this.ownedColumnCache.set(index, { text: line, value })
    if (layoutWork.on) layoutWork.geometryEntries++
    return value
  }

  private measureOwnedIndentColumns(index: number, line: string): number | undefined {
    if (line.slice(0, this.lineLeadingWhitespace(index)).includes('\t')) return undefined
    const origin = this.columnOrigins?.get(index)
    if (origin?.text === line && this.columnParent) {
      const parentLine = this.columnParent.lineAt(origin.parentIndex) ?? ''
      if (parentLine.slice(0, this.columnParent.lineLeadingWhitespace(origin.parentIndex)).includes('\t')) return undefined
      if (origin.prefix <= this.columnParent.lineLeadingWhitespace(origin.parentIndex)) {
        const column = this.columnParent.ownedIndentColumns(origin.parentIndex)
        return column === undefined ? undefined : Math.max(0, column - indentColumns(parentLine.slice(0, origin.prefix)))
      }
      return indentColumns(line)
    }
    if (this.nested && line.slice(0, this.lineLeadingWhitespace(index)).includes('\t')) return undefined
    return indentColumns(line)
  }

  lineLeadingWhitespace(index: number): number {
    return this.leadingWhitespaceLines[index] ??= /^[ \t]*/.exec(this.lineAt(index) ?? '')![0].length
  }

  inheritLeadingWhitespace(index: number, parent: Lexer, parentIndex: number, prefix: number): void {
    const remaining = parent.lineLeadingWhitespace(parentIndex) - prefix
    if (remaining >= 0) this.leadingWhitespaceLines[index] = remaining
  }

  lineTerminatorFree(index: number): boolean {
    return this.terminatorFreeLines[index] ??= !/[\n\r\u2028\u2029]/.test(this.lineAt(index) ?? '')
  }

  inheritTerminatorFree(index: number, parent: Lexer, parentIndex: number): void {
    if (parent.lineTerminatorFree(parentIndex)) this.terminatorFreeLines[index] = true
  }

  constructor(
    source: string | readonly string[],
    opts: ParseOptions = {},
    lineNumberOffset = 0,
    unclosedContainerKeys?: Set<string>,
    inherited?: Lexer,
  ) {
    this.attachmentBoundaries = inherited?.attachmentBoundaries ?? new Set()
    this.consumedContinuationLines = inherited?.consumedContinuationLines ?? new Set()
    this.quoteChainEndsInPlus = inherited?.quoteChainEndsInPlus ?? new Map()
    this.abbrDefs = inherited?.abbrDefs ?? new Map()
    this.linkDefs = inherited?.linkDefs ?? new Map()
    this.literalLazyLinkDefLines = inherited?.literalLazyLinkDefLines ?? new Set()
    this.quoteLazyMarkerLines = inherited?.quoteLazyMarkerLines ?? new Set()
    this.itemLazyLines = inherited?.itemLazyLines ?? new Set()
    this.hostedFootnoteLines = inherited?.hostedFootnoteLines ?? new Set()
    this.quoteLazyLines = inherited?.quoteLazyLines ?? new Set()
    this.literalCommentLineOpeners = inherited?.literalCommentLineOpeners ?? new Set()
    this.declinedLinkDefLines = inherited?.declinedLinkDefLines ?? new Set()
    this.footnoteDefs = inherited?.footnoteDefs ?? new Map()
    this.footnoteDefPos = inherited?.footnoteDefPos ?? new Map()
    this.fenceLookaheadAnswers = inherited?.fenceLookaheadAnswers ?? new Map()
    this.descendantFenceAnswers = inherited?.descendantFenceAnswers ?? new Map()
    this.parseOptions = opts
    this.unclosedContainerKeys = unclosedContainerKeys
    this.lineNumberOffset = lineNumberOffset
    this.defaultFrontmatterFormat = opts.defaultFrontmatterFormat ?? 'yaml'
    // ALREADY-SPLIT LINES. A container's body reaches here as the lines its
    // parent collected, so joining them and splitting them again copies the
    // whole body twice per nesting level - `depth` times over for a line at
    // depth `depth` (markup-carve/carve#752). The parent's lines are newline-free
    // by construction (it split on the same normalization), so the join was a
    // round trip with no effect other than its cost.
    //
    // The one thing the round trip DID do is drop a trailing empty line: a
    // terminal `''` element joins to a terminal `\n`, which splits back to a
    // `''` that the pop below removes. Reproduced exactly - one trailing `''`,
    // not a run - or a body ending in a blank line gains a line it never had.
    if (typeof source === 'string') {
      if (layoutWork.on) layoutWork.seam += source.length
      const lines = normalizeNewlines(source).split('\n')
      if (lines.length && lines[lines.length - 1] === '') lines.pop()
      this.lines = lines
    } else {
      this.lines = source
    }
    // Drop the trailing empty line a terminal newline introduces. ONLY for a
    // string source, where that `''` is an artifact of the split: `'a\n'`
    // splits to `['a', '']` and the document has one line, not two.
    //
    // An ARRAY source is a container body whose lines were already collected,
    // so a trailing `''` is a REAL blank line. Popping it discarded the blank
    // the flush above had just handed over, which is why an item-final fence
    // came out one line short (markup-carve/carve-js#988). The old
    // join-then-split round trip lost it the same way; reproducing that here
    // reproduced the loss with it.
    if (typeof source === 'string') {
      this.documentLineCount = this.lineCount
      // The last CHARACTER, not a suffix scan over a normalized copy: `\r\n`
      // ends in LF and a lone `\r` normalizes to one, so both are breaks.
      const last = source.charCodeAt(source.length - 1)
      this.documentLacksFinalBreak = source !== '' && last !== 10 && last !== 13
    }
    // MEASURED ON THE SOURCE AS GIVEN, not on the normalized lines. `+1` per
    // line assumes every ending is one character, but `\r\n` is two - so a
    // CRLF document's offsets were short by one per preceding line and every
    // span landed before the text it named: `abc` on line 3 reported the two
    // characters ending line 2 instead (carve#876).
    //
    // The widths come from the original endings, which is why this walks the
    // raw string rather than the split result. `newline` admits '\n', '\r\n'
    // and a lone '\r', so all three are counted at their real width. Lines
    // handed in already split carry no endings at all, so every width is 1 -
    // which is exactly what the join they replace produced.
    this.offsetLines = this.lines
    this.rawLineSource = typeof source === 'string' ? source : undefined
    if (!inherited) this.measureLineOffsets()
    // Frontmatter is document-leading only; the root lexer consumes it
    // explicitly in parse(). Sub-lexers (list items, divs, admonitions)
    // must NOT, or nested `---`-fenced content would be swallowed.
  }

  private measureLineOffsets(): number[] {
    if (layoutWork.on) layoutWork.offsets += this.offsetLines.length
    const offsets = this.lineOffsets
    const raw = this.rawLineSource
    let offset = 0
    let index = 0
    for (const line of this.offsetLines) {
      offsets.push(offset)
      index += line.length
      let width = 1
      if (raw !== undefined && raw[index] === '\r') width = raw[index + 1] === '\n' ? 2 : 1
      offset += line.length + width
      index += width
    }
    this.localOffsetsReady = true
    this.rawLineSource = undefined
    return offsets
  }

  consumeFrontmatter() {
    if (this.lineCount < 2) return
    const open = RE_FRONTMATTER_OPEN.exec(this.lineAt(0)!)
    if (!open) return
    for (let i = 1; i < this.lineCount; i++) {
      if (RE_FRONTMATTER_CLOSE.test(this.lineAt(i)!)) {
        const content = this.lines.slice(1, i).join('\n')
        const format = open[1] !== '' ? open[1]! : this.defaultFrontmatterFormat
        // The block runs from the opening fence to the closing one. Frontmatter
        // is document-leading, so it starts at the first byte - but the END has
        // to be measured, and without it the node `toAstJson` builds has no
        // position at all (carve-js#480).
        const closeOffset = (this.lineOffsets[i] ?? 0) + this.lineAt(i)!.length
        this.frontmatter = {
          format,
          content,
          pos: {
            startLine: 1,
            endLine: i + 1,
            startColumn: 1,
            endColumn: this.lineAt(i)!.length + 1,
            startOffset: 0,
            endOffset: closeOffset,
          },
        }
        this.pos = i + 1
        return
      }
    }
  }

  peek(offset = 0): string | undefined {
    return this.lineAt(this.pos + offset)
  }

  consume(): string {
    return this.lineAt(this.pos++)!
  }

  eof(): boolean {
    return this.pos >= this.lineCount
  }

  lineOffset(lineIndex: number): number {
    if (this.contiguousOrigin) return this.contiguousOrigin.lexer.lineOffset(this.contiguousOrigin.start + lineIndex)
    return this.sourceOffsetMap?.[lineIndex] ?? (this.localOffsetsReady ? this.lineOffsets : this.measureLineOffsets())[lineIndex] ?? 0
  }

  sourceBoundary(lineIndex: number, column: number): { offset: number; column: number } {
    if (this.contiguousOrigin) return this.contiguousOrigin.lexer.sourceBoundary(this.contiguousOrigin.start + lineIndex, column)
    const boundary = this.sourceBoundaries?.[lineIndex]
    if (boundary) {
      return boundary.parent.sourceBoundary(boundary.line, boundary.start + Math.max(0, column - boundary.synthetic))
    }
    return { offset: this.lineOffset(lineIndex) + column, column: this.lineStartColumn(lineIndex) + column }
  }

  /** 1-based column, in the DOCUMENT line, where this line's content starts. */
  lineStartColumn(lineIndex: number): number {
    if (this.contiguousOrigin) return this.contiguousOrigin.lexer.lineStartColumn(this.contiguousOrigin.start + lineIndex)
    return (this.linePrefixWidths?.[lineIndex] ?? 0) + 1
  }

  /**
   * Whether `lineOffset` returns a DOCUMENT offset rather than one into this
   * lexer's own text.
   *
   * True at the root, and for a sub-lexer whose lines were mapped back (see
   * attachDocumentOffsets). An unmapped sub-lexer - a container whose lines were
   * reconstructed rather than stripped - has offsets that are only meaningful
   * locally, and emitting them as document positions is the invented value PART
   * 12 section 4 forbids.
   */
  get hasDocumentOffsets(): boolean {
    return !this.nested || this.sourceOffsetMap !== undefined || (this.contiguousOrigin?.lexer.hasDocumentOffsets ?? false)
  }

  lineNumber(lineIndex: number): number {
    if (this.contiguousOrigin) return this.contiguousOrigin.lexer.lineNumber(this.contiguousOrigin.start + lineIndex)
    return this.sourceLineMap?.[lineIndex] ?? this.lineNumberOffset + lineIndex + 1
  }

  prefixMemoAllowed(lineIndex: number): boolean {
    return this.contiguousOrigin
      ? this.contiguousOrigin.lexer.prefixMemoAllowed(this.contiguousOrigin.start + lineIndex)
      : this.prefixMemoLines?.[lineIndex] !== false
  }

  reportInvalidContainerMetadata(container: UnclosedContainer): void {
    if (!this.hasDocumentOffsets) return
    const key = `invalid:${container.startOffset}:${container.endOffset}`
    if (this.unclosedContainerKeys?.has(key)) return
    this.unclosedContainerKeys?.add(key)
    this.parseOptions.onInvalidContainerMetadata?.(container)
  }

  reportUnclosedContainer(container: UnclosedContainer): void {
    if (!this.hasDocumentOffsets) return
    const seen = this.unclosedContainerKeys
    const key = `${container.startOffset}:${container.endOffset}`
    if (seen?.has(key)) return
    seen?.add(key)
    this.parseOptions.onUnclosedContainer?.(container)
  }

  reportUnclosedCodeFence(start: number, marker: string, indent: number): void {
    if (!this.parseOptions.onUnclosedCodeFence) return
    const line = this.lineNumber(start)
    const endLine = this.lineNumber(this.pos)
    const rootLine = this.rootLines?.[endLine - 1]
    const reason = this.attachmentBoundaries.has(endLine) && rootLine?.trim() === '+'
      ? 'continuation' : endLine > this.documentLineCount ? 'document' : 'container'
    this.parseOptions.onUnclosedCodeFence({ line, column: this.lineStartColumn(start) + indent,
      marker, endLine, reason })
  }

  reportRefusedContinuationMarker(lineIndex: number, column: number, host: RefusedContinuationMarker['host'], reason?: RefusedContinuationMarker['reason'], firstBlock = false): void {
    const line = this.lineNumber(lineIndex)
    const next = this.rootLines?.[line] ?? (this.rootLines ? undefined : this.peek())
    if (reason === undefined && next !== undefined && !isBlankLine(next)) return
    const physical = this.rootLines?.[line - 1]
    const plus = physical?.lastIndexOf('+') ?? -1
    let visual = 1
    if (plus >= 0) for (const char of physical!.slice(0, plus)) visual += char === '\t' ? 4 - (visual - 1) % 4 : 1
    this.parseOptions.onRefusedContinuationMarker?.({ line,
      column: plus >= 0 ? visual : column,
      host, reason: reason ?? (next === undefined ? 'document' : 'blank'), firstBlock })
  }

  /**
   * A block-attribute run at `lineIndex` that attached to nothing (§15 A4).
   *
   * Shares the unclosed-container dedup set, under a prefixed key: a region the
   * parser re-parses would otherwise report the same dead run once per visit.
   */
  reportDanglingBlockAttributes(lineIndex: number, wholeBodyOf?: 'footnote' | 'description'): void {
    if (!this.hasDocumentOffsets) return
    if (!this.parseOptions.onDanglingBlockAttributes) return
    const startOffset = this.lineOffset(lineIndex)
    const endOffset = startOffset + (this.lineAt(lineIndex)?.length ?? 0)
    const seen = this.unclosedContainerKeys
    const key = `attr:${startOffset}:${endOffset}`
    if (seen?.has(key)) return
    seen?.add(key)
    this.parseOptions.onDanglingBlockAttributes({
      line: this.lineNumber(lineIndex),
      column: this.lineStartColumn(lineIndex),
      startOffset,
      endOffset,
      ...(wholeBodyOf ? { wholeBodyOf } : {}),
    })
  }
}

/**
 * The document's line endings as the lexer reads them: `\r\n` and a lone `\r`
 * both become `\n`.
 *
 * Named once because a THIRD spelling of it is what a verbatim capture needs.
 * Offsets index the RAW source, endings and all, while every line the scanner
 * walks has already been normalized - so a document slice compared against the
 * scanner's text differs on every line of a CRLF document unless both are read
 * the same way.
 */
export function normalizeNewlines(source: string): string {
  return source.replace(/\r\n?/g, '\n')
}

export function indentColumns(line: string, cap = Infinity): number {
  let col = 0
  let i = 0
  while (i < line.length && col < cap) {
    const c = line[i]
    if (c === ' ') col++
    else if (c === '\t') col += 4 - (col % 4)
    else break
    i++
  }
  if (layoutWork.on) layoutWork.gate += i
  return col > cap ? cap : col
}

// Dedent counterpart of indentColumns(): drop leading whitespace up to `cols`
// columns. By default a tab straddling the boundary is consumed whole, so a
// block opener (quote, heading) dedents flush to column 0 and parses -- Carve
// has no indent-sensitive block where a leftover column would change meaning.
// With keepResidual (used only for sub-list marker lines), the unconsumed
// columns of a straddling tab are re-emitted as spaces so tab+space-aligned
// sibling markers keep the same visual column and the recursive parse re-derives
// the child base from it. For space-only indentation this equals line.slice(cols).
export function sliceColumns(line: string, cols: number, keepResidual = false, onLiteralStrip?: (prefix: number) => void): string {
  let col = 0
  let i = 0
  while (i < line.length && col < cols) {
    if (line[i] === ' ') {
      col++
      i++
    } else if (line[i] === '\t') {
      col += 4 - (col % 4)
      i++
    } else {
      break
    }
  }
  // When dedenting a sub-list block stream, a tab straddling the boundary leaves
  // residual columns; reinsert them as spaces so tab+space-aligned sibling
  // markers stay at the same visual column and the recursive parse re-derives
  // correctly. Lead content uses whole-tab consumption (keepResidual=false) so a
  // block opener reaches column 0. (Space-only indentation has no residual.)
  if (layoutWork.on) layoutWork.strip += i
  if (keepResidual && col > cols) return ' '.repeat(col - cols) + line.slice(i)
  onLiteralStrip?.(i)
  return line.slice(i)
}
