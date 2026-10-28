import type {
  AnchorRange,
  CarveExtension,
  CitationGroup,
  Emphasis,
  EmphasisMatch,
  EmphasisMemo,
  InlineMatch,
  InlineNode,
  InlinePairView,
  InlineScannerSession,
  InlineSource,
  LinkDef,
  MatcherContext,
  Position,
  SmartPunctuation,
  Text,
  VerbatimCellWrap,
} from '../parse-core.js'
import {
  ELISION_WORDS,
  FORCED_TYPE,
  MAX_NESTING_DEPTH,
  NO_OPEN_KINDS,
  PAIR_MARKERS,
  QUOTE_LETTER_RUN,
  RE_AUTOLINK_STICKY,
  RE_RAW_INLINE_STICKY,
  SMART_TOKENS,
  SubstitutionScanner,
  allocateDashes,
  anchorRangeAt,
  applyAbbreviations,
  applyLinkDefs,
  atomicLinkRegions,
  backtickRunEnds,
  buildBracketMap,
  closesAfterDash,
  codePointAfter,
  combinedSpanCloser,
  crossrefBodyCanEnd,
  emphasisBrackets,
  extendsGrapheme,
  inlineDepthState,
  inlineOpaqueEnds,
  inlineSource,
  isCarveWhitespace,
  isFlankSpace,
  isQuoteAlnum,
  isQuoteOpenContext,
  isQuoteSpace,
  linkDestinations,
  newEmphasisMemo,
  normalizeNewlines,
  opensInlineComment,
  scanInlineInnerWithHelpers,
  splitBracedOpener,
  trimEndNonNbsp,
  verbatimSpanEnd,
} from '../parse-core.js'

const smartTokensByFirst = new Map<string, typeof SMART_TOKENS>()
for (const token of SMART_TOKENS) {
  const first = token[0][0]!
  let group = smartTokensByFirst.get(first)
  if (!group) {
    group = []
    smartTokensByFirst.set(first, group)
  }
  group.push(token)
}
const emphasisPairs: ReadonlyArray<readonly [string, Emphasis['type']]> = [
  ['/', 'emphasis'], ['*', 'strong'], ['_', 'underline'],
  ['~', 'strike'], ['=', 'highlight'],
]

function canCloseBarePair(text: string, at: number, marker: string, openerMarks: Set<number>): boolean {
  const before = text[at - 1]
  const next = text[at + 1]
  return text[at] === marker && !(next === '}' && openerMarks.has(at)) && before !== undefined
    && !isCarveWhitespace(before) && (!next || !/[A-Za-z0-9]/.test(next)) && !extendsGrapheme(text, at + 1)
}

function editorialCloserInsideAttribute(text: string, start: number, marker: string, closer: number, attributeEnd: number): boolean {
  return text[start] === '{' && text[start + 1] !== '%'
    && !/}[ \t]*[#%]}$/.test(text.slice(start, attributeEnd))
    && (marker === '+' || marker === '-') && closer >= 0 && closer < attributeEnd
}

export class InlineParseSession {
  protected linkLabelDepth = 0

  // Matchers belong to this parse; fragment parsing scopes its matcher context.
  activeMatchers: CarveExtension[] = []

  protected activeMatcherCtx: MatcherContext | null = null

  /**
   * The document being parsed, for the one field that promises VERBATIM SOURCE.
   */
  protected activeDocument: string | null = null
  recordPositions = true
  protected definitionRegionLines: Set<number> | null = null
  protected inMatcherRequest = false

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
          let stop: number
          if (ch === '\\') stop = table[j + 2]!
          else if (bracketEnds.has(j)) stop = -1
          else if (lineComments.has(j)) stop = table[lineComments.get(j)!]!
          else if (codeEnd !== undefined) stop = codeEnd === -1 ? -1 : table[afterAttributes(codeEnd)]!
          else if (attributeEnd !== undefined) stop = table[ch === '<' ? afterAttributes(attributeEnd) : attributeEnd]!
          else if (bracketEnd !== undefined) stop = table[afterAttributes((destinations.get(bracketEnd + 1) ?? bracketEnd) + 1)]!
          else if (destinationEnd !== undefined) stop = table[afterAttributes(destinationEnd + 1)]!
          else if (ch === '{' && nextId !== -1 && ends[j] !== -1) stop = table[afterAttributes(ends[j]!)]!
          else if (canCloseBarePair(text, j, marker, openerMarks)) stop = j
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
        const isCloser = next === '}' && ch === PAIR_MARKERS[m] && (!openerMarks.has(j) || ch === '+' || ch === '-')
        raw[j] = next === '}' && ch === PAIR_MARKERS[m] ? j : raw[j + 1]!
        let stop: number
        const commentEnd = lineComments.get(j)
        if (bracketEnds.has(j)) stop = -1
        else if (commentEnd !== undefined) stop = raw[j] !== -1 && raw[j]! < commentEnd ? raw[j]! : table[commentEnd]!
        else if (codeEnd !== undefined) {
          // An unclosed run ends at the pair's closer instead of running to the
          // end of the block (markup-carve/carve#2056).
          stop = codeEnd !== -1 ? table[afterAttributes(codeEnd)]! : raw[j]!
        } else if (attributeEnd !== undefined) stop = editorialCloserInsideAttribute(text, j, PAIR_MARKERS[m]!, raw[j]!, attributeEnd)
          ? raw[j]! : table[ch === '<' ? afterAttributes(attributeEnd) : attributeEnd]!
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

  protected activeQuoteCharacters: readonly [string, string, string, string] = ['“', '”', '‘', '’']
  protected quoteGlyphHasNul = false

  private sourceCharacterAfter(text: string, source: InlineSource): string {
    if (this.activeDocument === null) return ''
    const offset = this.pointAt(source, text, text.length)?.offset
    if (offset === undefined || (!source.lineAnchors && !source.anchoredRanges &&
      (source.baseOffset === 0 || this.activeDocument[offset - 1] !== text[text.length - 1]))) return ''
    const codepoint = this.activeDocument.codePointAt(offset)
    return codepoint === undefined ? '' : String.fromCodePoint(codepoint)
  }

  private smartToken(
    text: string,
    i: number,
    prev: string,
    source: InlineSource,
  ): { out: string; len: number; kind: string } | null {
    const candidates = smartTokensByFirst.get(text[i]!)
    if (candidates) {
      for (const [tok, out, kind] of candidates) {
        if (text.startsWith(tok, i)) return { out, len: tok.length, kind }
      }
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
      const next = i + 1 < text.length ? codePointAfter(text, i) : this.sourceCharacterAfter(text, source)
      const open = isQuoteOpenContext(prev) && !closesAfterDash(prev, next)
      return { out: open ? this.activeQuoteCharacters[0] : this.activeQuoteCharacters[1], len: 1, kind: open ? 'left_double_quote' : 'right_double_quote' }
    }
    if (c === "'") {
      const next = i + 1 < text.length ? codePointAfter(text, i) : this.sourceCharacterAfter(text, source)
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

  protected parseInline(
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
  protected inLineBlock = false

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
    for (const [delim, type] of emphasisPairs) {
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
  protected newlineIndexCache = new Map<string, number[]>()

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
        column: Math.max(1, anchor.column + withinLine),
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
        if (text[j - 1] === '{' && text[j + 1] === '}' && !splitBracedOpener(text, j - 1)) {
          let slash = j - 2
          while (text[slash] === '\\') slash--
          if ((j - 2 - slash) % 2 === 0) continue
        }
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
