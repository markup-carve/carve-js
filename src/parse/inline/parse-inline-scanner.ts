import type {
  inlineScannerHelpers,
  BracketClose,
  CrossrefMemo,
  InlineSource,
  InlinePairView,
  EmphasisMatch,
  EmphasisMemo,
} from '../../parse.js'
import type { CarveExtension, InlineMatch } from '../../extension.js'
import type { CitationGroup, VerbatimCellWrap } from '../../ast.js'
import type {
  Attrs,
  AutoLink,
  CaptionNumber,
  Comment,
  CriticComment,
  CriticDelete,
  CriticInsert,
  CriticSubstitute,
  CrossRef,
  Emphasis,
  EscapedText,
  Extension,
  FootnoteRef,
  Image,
  InlineFootnote,
  InlineNode,
  Math,
  Link,
  LiteralInline,
  Mention,
  RawInline,
  SmartPunctuation,
  Span,
  SymbolInline,
  Tag,
  Text,
} from '../../ast.js'
import { isLiteralInlineDirective, scanDirectiveShape } from '../../include-directive.js'

const RE_EMPTY_ATTR = /\{ *\}/y

const ordinaryAscii = new Uint8Array(128)
for (let code = 48; code <= 57; code++) ordinaryAscii[code] = 1
for (let code = 65; code <= 90; code++) ordinaryAscii[code] = 1
for (let code = 97; code <= 122; code++) ordinaryAscii[code] = 1
for (const code of [9, 32, 41, 44, 59, 63]) ordinaryAscii[code] = 1

export interface InlineScannerSession {
  activeMatchers: CarveExtension[]
  pairEndText: string | undefined
  inLineBlock: boolean
  recordPositions: boolean
  singleQuoteSpan: { node?: SmartPunctuation; demote: boolean } | null
  bracedPairEnd(text: string, open: number, closer: string): number
  criticPairEnd(text: string, open: number, closer: '+}' | '-}'): number
  delimitedCommentClose(text: string, from: number): number
  inlineCommentEnd(text: string, at: number, lineEnd?: number): number
  extendPosTo(
    node: InlineNode,
    source: InlineSource,
    text: string,
    end: number,
  ): void
  matchEmphasis(
    text: string,
    i: number,
    source: InlineSource,
    inFootnote?: boolean,
    noClose?: EmphasisMemo,
    end?: number,
    inBracketRun?: boolean,
    guardOpen?: boolean,
  ): EmphasisMatch | null
  bareOpenerStands(text: string, i: number, guardOpen: boolean): boolean
  pairView(offset: number): InlinePairView
  plainInlineWord(
    text: string,
    start: number,
    end: number,
    source: InlineSource,
  ): InlineNode[] | undefined
  positionCitationItems(
    node: CitationGroup,
    source: InlineSource,
    text: string,
    groupStart: number,
  ): void
  rawSourceSlice(
    source: InlineSource,
    text: string,
    start: number,
    end: number,
  ): string | undefined
  scanInline(
    text: string,
    source?: InlineSource,
    inFootnote?: boolean,
    captionContext?: boolean,
    kinds?: ReadonlySet<string>,
    opensHostRun?: boolean,
    separateQuoteScope?: boolean,
    pairs?: InlinePairView,
  ): InlineNode[]
  scanLinkLabel(
    text: string,
    source: InlineSource,
    inFootnote: boolean,
  ): InlineNode[]
  shiftSource(source: InlineSource, text: string, by: number): InlineSource
  smartToken(
    text: string,
    i: number,
    prev: string,
    region?: { start: number; close: number },
  ): { out: string; len: number; kind: string } | null
  substitutionAborted(text: string, open: number): boolean
  substitutionAt(
    text: string,
    open: number,
  ): { end: number; arrow: number } | null
  trimUnclosedRun(content: string): string
  tryInlineMatchers(text: string, pos: number): InlineMatch | null
  verbatimCellWraps(
    text: string,
    source: InlineSource,
    start: number,
    payload: string,
    strippedPadding?: boolean,
  ): VerbatimCellWrap[] | undefined
  withPos<T extends InlineNode>(
    node: T,
    source: InlineSource,
    text: string,
    start: number,
    end: number,
  ): T
}

type SuffixTable = ReturnType<typeof inlineScannerHelpers.suffixHasChar>

// One inline scan: its input, the output built so far, and the per-text lookup tables.
interface InlineScan {
  session: InlineScannerSession
  text: string
  source: InlineSource
  inFootnote: boolean
  captionContext: boolean
  atHostRunStart: boolean
  out: InlineNode[]
  i: number
  buf: string
  bufStart: number
  // Last char appended to buf. Tracked explicitly because reading
  // `buf[buf.length - 1]` each char indexes a growing ConsString, which V8 must
  // flatten/traverse -- O(n^2) over a quote-dense run (and a catastrophic cliff
  // once the rope gets deep). A scalar keeps the smart-quote context check O(1).
  bufLast: string
  quoteContextIndex: number
  quoteContext: string
  // Caption number placeholder: only the first bare `#` in a caption becomes one.
  captionNumberEmitted: boolean
  emphasisNoClose: EmphasisMemo | undefined
  // The delimiter stack's unpaired open entries at this level: the last one's
  // position, and the kinds held (E3), so a `_` or `/` guard counts only
  // where it stands as one (carve#3973 X1).
  openEntryAt: number
  openEntryKinds: string
  crossrefMemo: CrossrefMemo | undefined
  commentLineEnd: number
  bracketRuns: Array<{ start: number; close: number }>
  bracketClose: BracketClose
  destinationOpeners: Set<number>
  rbraceSuf: SuffixTable | null
  rbracketSuf: SuffixTable | null
  criticCmtSuf: SuffixTable | null
  insSuf: SuffixTable | null
  delSuf: SuffixTable | null
  footnoteStops: Int32Array | undefined
  quoteEnd: (start: number) => number
  valueEnd: (start: number) => number
}

function ordinaryAt(text: string, i: number): boolean {
  const code = text.charCodeAt(i)
  return code >= 128 || ordinaryAscii[code] === 1 ||
    (code === 46 && text[i - 1] !== '.' && text[i + 1] !== '.')
}

// The `}` / `"'` stop tables the attribute-validity probes read, built on first use.
function attributeStops(text: string): { quoteEnd: (start: number) => number; valueEnd: (start: number) => number } {
  let valueStops: Int32Array | undefined
  const valueEnd = (start: number): number => {
    if (!valueStops) {
      valueStops = new Int32Array(text.length + 1)
      valueStops[text.length] = text.length
      for (let at = text.length - 1; at >= 0; at--) {
        valueStops[at] = /[}|"'\\ \t\n\r]/.test(text[at]!) ? at : valueStops[at + 1]!
      }
    }
    return valueStops[start]!
  }
  let quoteStops: { double: Int32Array; single: Int32Array } | undefined
  const quoteEnd = (start: number): number => {
    if (!quoteStops) {
      const double = new Int32Array(text.length + 2).fill(-1)
      const single = new Int32Array(text.length + 2).fill(-1)
      for (let at = text.length - 1; at >= 0; at--) {
        if (text[at] === '\\') {
          if (at + 1 < text.length && !/[\n\r\u2028\u2029]/.test(text[at + 1]!)) {
            double[at] = double[at + 2]!
            single[at] = single[at + 2]!
          }
        } else {
          double[at] = text[at] === '"' ? at : double[at + 1]!
          single[at] = text[at] === "'" ? at : single[at + 1]!
        }
      }
      quoteStops = { double, single }
    }
    return (text[start] === '"' ? quoteStops.double : quoteStops.single)[start + 1]!
  }
  return { quoteEnd, valueEnd }
}

function flush(s: InlineScan): void {
  if (s.buf) {
    const node = { type: 'text', value: s.buf } as Text
    s.out.push(s.session.withPos(node, s.source, s.text, s.bufStart, s.i))
    s.buf = ''
    s.bufLast = ''
  }
}

function append(s: InlineScan, value: string): void {
  if (!s.buf) s.bufStart = s.i
  s.buf += value
  if (value) s.bufLast = value[value.length - 1]!
}

function emit(s: InlineScan, node: InlineNode, start: number, end: number): void {
  s.out.push(s.session.withPos(node, s.source, s.text, start, end))
}

// Flush, emit a fixed-width node at the cursor, and step past it.
function emitAtCursor(s: InlineScan, node: InlineNode, width: number): true {
  flush(s)
  emit(s, node, s.i, s.i + width)
  s.i += width
  return true
}

export function createInlineScanner(helpers: typeof inlineScannerHelpers) {
  const {
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
  } = helpers
  const RE_MENTION_AT = new RegExp(RE_MENTION.source.slice(1), 'y')
  const RE_TAG_AT = new RegExp(RE_TAG.source.slice(1), 'y')
  const RE_NAME_LETTER = /[A-Za-z]/

  // A trailing `{...}` on a link or image tail. An invalid payload (`{2=v}`)
  // is literal (§14), and an empty-attr `{…}` is literal too -- neither is
  // consumed, so `unconsumed` is the width handed back to the text.
  function tailAttrs(payload: string | undefined): { attrs: Attrs | undefined; unconsumed: number } {
    if (!payload) return { attrs: undefined, unconsumed: 0 }
    if (!isValidInlineAttrPayload(payload)) return { attrs: undefined, unconsumed: payload.length + 2 }
    const a = parseAttrs(payload)
    return isEmptyAttrs(a) ? { attrs: undefined, unconsumed: payload.length + 2 } : { attrs: a, unconsumed: 0 }
  }

  function execReferenceTail(s: InlineScan, tail: string, start: number): RegExpExecArray | null {
    const { text } = s
    const match = RE_REF_TAIL.exec(tail)
    if (!match) return null
    const brace = start + match[0].length
    const attrs = text[brace] === '{' && s.rbraceSuf?.[brace] && !spanAttrProvablyInvalid(text, brace, s.quoteEnd, s.valueEnd)
      ? RE_INLINE_ATTR.exec(text.slice(brace)) : null
    if (attrs) { match[0] += attrs[0]; match[2] = attrs[1]! }
    return match
  }

  function scanReservedReferenceTail(s: InlineScan, close: number, tail: string): boolean {
    const match = execReferenceTail(s, tail, s.i + close + 1)
    if (!match?.[1]?.startsWith('@') || match[1].includes('\n')) return false
    const end = s.i + close + 1 + match[0].length
    flush(s)
    emit(s, { type: 'text', value: s.text.slice(s.i, end) }, s.i, end)
    s.i = end
    return true
  }

  function createInlineScan(
    session: InlineScannerSession, text: string, source: InlineSource,
    inFootnote: boolean, captionContext: boolean, atHostRunStart: boolean,
  ): InlineScan {
    // Precompute each `[`'s balancing `]` once (O(n)) so the link/image/span
    // branches resolve the close bracket in O(1); see buildBracketMap.
    const firstLinkTail = text.indexOf('](')
    const sharedSlots: { first: number; ends?: Map<number, number> } | undefined =
      firstLinkTail === -1 ? undefined : { first: firstLinkTail + 1 }
    const bracketClose: BracketClose = text.includes('[') ?
      buildBracketMap(text, false, undefined, sharedSlots, !inFootnote) :
      () => undefined
    // Suffix tables so a tail regex is only run when its mandatory close
    // delimiter still lies ahead; otherwise the regex would backtrack to EOF and
    // fail. See suffixHasChar/suffixHasPair. Built only when the delimiter is
    // present at all, mirroring the bracketClose guard above.
    const destinationOpeners = sharedSlots ?
      new Set((sharedSlots.ends ??= destinationSlotEnds(text, sharedSlots.first)).keys()) :
      new Set<number>()
    const rbraceSuf = text.includes('}') ? suffixHasChar(text, '}') : null
    const rbracketSuf = text.includes(']') ? suffixHasChar(text, ']') : null
    const criticCmtSuf = text.includes('#}') ? suffixHasPair(text, '#', '}') : null
    const footnoteStops = text.includes('[^') ? new Int32Array(text.length + 1) : undefined
    if (footnoteStops) {
      footnoteStops[text.length] = text.length
      for (let at = text.length - 1; at >= 0; at--) {
        footnoteStops[at] = /[\]\r\n]/.test(text[at]!) ? at : footnoteStops[at + 1]!
      }
    }
    const { quoteEnd, valueEnd } = attributeStops(text)
    return {
      session, text, source, inFootnote, captionContext, atHostRunStart,
      out: [],
      i: 0,
      buf: '',
      bufStart: 0,
      bufLast: '',
      quoteContextIndex: 0,
      quoteContext: '',
      captionNumberEmitted: false,
      emphasisNoClose: undefined,
      openEntryAt: -1,
      openEntryKinds: '',
      crossrefMemo: undefined,
      commentLineEnd: -1,
      bracketRuns: [],
      bracketClose,
      destinationOpeners,
      rbraceSuf,
      rbracketSuf,
      criticCmtSuf,
      insSuf: text.includes('+}') ? suffixHasPair(text, '+', '}') : null,
      delSuf: text.includes('-}') ? suffixHasPair(text, '-', '}') : null,
      footnoteStops,
      quoteEnd,
      valueEnd,
    }
  }

  function scanCellWrap(s: InlineScan, c: string): boolean {
    const wrap = c === ' ' ? s.source.cellWraps?.get(s.i + (s.source.wrapShift ?? 0)) : undefined
    if (!wrap) return false
    flush(s)
    s.out.push({ type: 'cell_wrap', line: wrap.line, ...(wrap.row ? { row: wrap.row } : {}), ...(wrap.col ? { col: wrap.col } : {}), ...(s.session.recordPositions && wrap.pos ? { pos: wrap.pos } : {}) })
    s.i++
    return true
  }

  function trackBracketRuns(s: InlineScan, c: string): void {
    const { bracketRuns } = s
    while (bracketRuns.length && s.i >= bracketRuns[bracketRuns.length - 1]!.close) {
      bracketRuns.pop()
    }
    // The bracket scanner decides which escapes and opaque spans hide a closer.
    if (c === '[') {
      const close = s.text[s.i - 1] === '!' && s.bracketClose.declinedImageAsLink
        ? s.bracketClose.declinedImageAsLink(s.i) : s.bracketClose(s.i)
      if (close !== undefined) bracketRuns.push({ start: s.i + 1, close })
    }
  }

  // Core inline constructs all begin with punctuation. When no extension
  // matcher can claim an arbitrary offset, append ordinary text as a
  // run instead of asking smart typography, emphasis and every other inline
  // recognizer about each letter and space individually.
  function appendOrdinaryRun(s: InlineScan): void {
    const { text, source } = s
    const start = s.i
    let i = start
    do {
      i++
      if (i >= text.length) break
      if (source.cellWraps?.has(i + (source.wrapShift ?? 0))) break
      if (!ordinaryAt(text, i)) break
    } while (true)
    append(s, text.slice(start, i))
    s.i = i
  }

  function scanBackslash(s: InlineScan): boolean {
    const { text, i } = s
    // Hard line break: a backslash at end of line (before a newline).
    if (text[i + 1] === '\n') return emitAtCursor(s, { type: 'hard_break' }, 2)
    // A backslash at the very end of the content (no following character) is
    // still a hard break, mirroring the `\`-before-newline rule at end of
    // input (`para\` at EOF -> `<br>`), matching djot and carve's cheatsheet.
    if (i + 1 >= text.length) return emitAtCursor(s, { type: 'hard_break' }, 1)
    // Non-breaking space: a backslash followed by a space (djot). Emit the
    // internal placeholder (U+E000) rather than a literal U+00A0 so it is
    // converted per renderer (HTML &nbsp;, Markdown U+00A0, plain/ANSI a
    // space) and never confused with an author's literal non-breaking space.
    if (text[i + 1] === ' ') return emitAtCursor(s, { type: 'non_breaking_space' }, 2)

    // Escape: a backslash before any ASCII punctuation yields that literal
    // character (djot / grammar `ascii_punctuation` — the full set, including
    // `& : ; ?`).
    const nxt = text[i + 1]!
    if (!RE_ESCAPABLE_PUNCTUATION.test(nxt)) return false
    // The escape is its own node: the backslash carries intent the literal
    // character does not. `\-\-` was written precisely so a downstream
    // processor would not read an en dash, and flattening it into text lost
    // that (carve#350).
    flush(s)
    emit(s, { type: 'escaped_text', value: nxt } as EscapedText, i, i + 2)
    if (nxt === '<' && text.startsWith('</#', i + 1)) {
      s.crossrefMemo ??= { lastCloser: text.lastIndexOf('>') }
      if (text[i + 4] !== '>' && crossrefBodyCanEnd(text, i + 4, s.crossrefMemo)) {
        const end = text.indexOf('>', i + 4) + 1
        s.i += 2
        append(s, text.slice(s.i, end))
        s.i = end
        return true
      }
    }
    s.i += 2
    return true
  }

  // A dash run resolves to one or more glyphs; each consumes a fixed
  // number of source hyphens (3 for em, 2 for en), so the run partitions
  // into one node per glyph carrying the hyphens it came from.
  function emitDashRun(s: InlineScan, glyphs: string): void {
    const { text, i } = s
    let consumed = 0
    for (const glyph of glyphs) {
      const width = glyph === '—' ? 3 : 2
      emit(s, {
        type: 'smart_punctuation',
        kind: glyph === '—' ? 'em_dash' : 'en_dash',
        value: text.slice(i + consumed, i + consumed + width),
      } as SmartPunctuation, i + consumed, i + consumed + width)
      consumed += width
    }
  }

  // Smart typography (grammar.ebnf §"Smart Typography", PART 9 §8).
  // Runs after the escape check, so `\->` etc. are already absorbed
  // into buf as literals and never reach here. Inside code is handled
  // by the opaque code branch below (continues before this on a
  // backtick). Multi-char tokens are matched longest-first.
  function scanSmartToken(s: InlineScan): boolean {
    const { text, i, out, session } = s
    // Comments emit no character; visit each appended node only once for quote context.
    while (s.quoteContextIndex < out.length) {
      const node = out[s.quoteContextIndex++]!
      if (node.type !== 'comment') s.quoteContext = lastEmittedGlyph(node)
    }
    const prevForQuote = s.buf.length ? s.bufLast : s.quoteContext
    // A literal bracket run is a typography region like a span (CARVE-P3-021, carve#4551).
    const st = session.smartToken(text, i, prevForQuote, s.bracketRuns.at(-1))
    if (!st) return false
    if (st.kind === 'literal_hyphen_run') {
      // A flag-shaped hyphen run (carve#1443) is ordinary text: it joins the
      // buffer rather than becoming a node, so it renders and round-trips as
      // the hyphens the author wrote.
      s.buf += st.out
      s.bufLast = st.out[st.out.length - 1]!
      s.i += st.len
      return true
    }
    flush(s)
    if (st.kind === 'dash_run') emitDashRun(s, st.out)
    else {
      const node = {
        type: 'smart_punctuation',
        kind: st.kind,
        value: text.slice(i, i + st.len),
      } as SmartPunctuation
      // Quote glyphs are locale-dependent and decided here, so record the
      // resolved character; other kinds resolve through the glyph table.
      if (st.kind.endsWith('_quote')) node.glyph = st.out
      if (st.kind === 'left_single_quote' && session.singleQuoteSpan && !session.singleQuoteSpan.node) {
        session.singleQuoteSpan.node = node
      }
      emit(s, node, i, i + st.len)
    }
    s.i += st.len
    return true
  }

  // Trailing (inline) line comment: `%%` behind its separator consumes to the
  // next newline or the enclosing bracket run's closer. Absorbing the separator
  // leaves no trailing space; the terminating newline stays and becomes a
  // soft break. `%%` inside a code span never reaches here (code is consumed
  // opaquely), and `\%%` is already handled by the escape branch. (§4.13,
  // grammar inline_comment.)
  // A NEWLINE counts as the separator before it: `%%` at the start of a
  // later line is a comment exactly as it is on the first. A paragraph never
  // showed the difference - a comment-only line is handled at the block layer
  // there - but inside a line block the whole stanza is inline content, so
  // the verse kept `%% c` as text where the other engines drop it, and this
  // one dropped it on the first line and not the second (carve#574).
  function scanLineComment(s: InlineScan): boolean {
    const { text, i } = s
    const commentRun = s.bracketRuns[s.bracketRuns.length - 1]
    if (!opensInlineComment(text, i, s.atHostRunStart || commentRun !== undefined, commentRun?.start)) return false
    // Absorb the separating SPACE run; a tab stays content (CARVE-P9-041).
    // The flushed text ends where the run begins, keeping source spans contiguous.
    const trimmed = s.buf.replace(/ +$/, '')
    const commentStart = i - (s.buf.length - trimmed.length)
    if (trimmed) emit(s, { type: 'text', value: trimmed } as Text, s.bufStart, commentStart)
    s.buf = ''
    // Several bracket comments can share a line; search its suffix only once.
    if (s.commentLineEnd < i) {
      const nl = text.indexOf('\n', i)
      s.commentLineEnd = nl === -1 ? text.length : nl
    }
    const end = Math.min(s.session.inlineCommentEnd(text, i, s.commentLineEnd), commentRun?.close ?? text.length)
    const content = trimEndSpaceTab(text.slice(i + 2, end).replace(/^ /, ''))
    emit(s, { type: 'comment', block: false, content } as Comment, i, end)
    s.i = end
    return true
  }

  // Explicitly delimited inline comment (PART 9 §21a). The first `%}` wins;
  // an opener in the content is ordinary text, and an opener with no closer
  // stays literal. Unlike `%%`, surrounding whitespace is ordinary visible
  // text and scanning resumes after the closer.
  function scanDelimitedComment(s: InlineScan): boolean {
    const { text, i } = s
    if (text[i + 1] !== '%' || extendsGrapheme(text, i + 2)) return false
    const close = s.session.delimitedCommentClose(text, i + 2)
    if (close === -1) return false
    flush(s)
    const content = text.slice(i + 2, close).replace(/^ /, '').replace(/ $/, '')
    emit(s, { type: 'comment', block: false, delimited: true, content } as Comment, i, close + 2)
    s.i = close + 2
    return true
  }

  // Inline verbatim (code span). The opening run is the MAXIMAL run of
  // backticks; it closes only on a run of EXACTLY the same length (a shorter
  // OR longer run is content). An opener with no equal-length closer still
  // opens a verbatim span that runs to the END of the block — matches djot
  // upstream + carve-php (grammar code_span, "UNCLOSED RUN"). Uses the shared
  // verbatimSpanEnd helper so the tokenizer, findEmphasisClose, and
  // buildBracketMap stay in lockstep on span boundaries.
  function scanCodeSpan(s: InlineScan): true {
    const { text, i, session, source } = s
    const { end, closed, openLen } = verbatimSpanEnd(text, i)
    flush(s)
    if (!closed) {
      // Unclosed: verbatim to end of block, with the block's trailing
      // whitespace stripped (no surrounding single-space strip — that applies
      // only to a closed span).
      // PART 7's four characters (the run may cross a line, so `\n` and `\r`
      // are in). `\s` ate a trailing vertical tab out of the span's content.
      const value = session.trimUnclosedRun(text.slice(i + openLen))
      const cellWraps = session.verbatimCellWraps(text, source, i + openLen, value)
      emit(s, { type: 'code', value, ...(cellWraps ? { cellWraps } : {}) }, i, text.length)
      s.i = text.length
      return true
    }
    const padded = text.slice(i + openLen, end - openLen)
    const inner = stripVerbatimPadding(padded)
    const cellWraps = session.verbatimCellWraps(text, source, i + openLen + (padded.length - inner.length) / 2, inner, padded.length !== inner.length)
    // A verbatim span tagged `{=format}` is raw inline passthrough.
    const raw = RE_RAW_INLINE.exec(text.slice(end))
    if (raw) {
      const len = end - i + raw[0].length
      emit(s, { type: 'raw_inline', format: raw[1]!, content: inner, ...(cellWraps ? { cellWraps } : {}) } as RawInline, i, i + len)
      s.i += len
      return true
    }
    emit(s, { type: 'code', value: inner, ...(cellWraps ? { cellWraps } : {}) }, i, end)
    s.i = end
    return true
  }

  // Math (djot form): inline $`x`, display $$`x`. A bare `$` not
  // followed by a backtick run (e.g. currency `$5`) stays literal.
  function scanMath(s: InlineScan): boolean {
    const { text, i, session, source } = s
    const display = text[i + 1] === '$'
    const dollarLen = display ? 2 : 1
    const tick = i + dollarLen
    if (text[tick] !== '`') return false
    const { end, closed, openLen } = verbatimSpanEnd(text, tick)
    const innerEnd = end - openLen
    const hasContent = closed
      ? innerEnd > tick + openLen && text[innerEnd - 1] !== '`'
      : true
    if (!hasContent || (closed && text[end] === '`')) return false
    flush(s)
    const padded = closed ? text.slice(tick + openLen, innerEnd) : ''
    const content = closed
      ? stripVerbatimPadding(padded)
      : session.trimUnclosedRun(text.slice(tick + openLen))
    const cellWraps = session.verbatimCellWraps(text, source, tick + openLen + (padded.length - (closed ? content.length : 0)) / 2, content)
    const len = end - i
    emit(s, { type: 'math', display, content, ...(cellWraps ? { cellWraps } : {}) } as Math, i, i + len)
    s.i += len
    return true
  }

  // Inline literal (§27): a `!` prefix on a verbatim code span, mirroring
  // the `$`-math prefix above. The span content is captured verbatim, later
  // HTML-escaped and emitted by every renderer with the `<code>` wrapper
  // dropped; a trailing `{…}` attaches below as an ordinary inline attribute
  // block (no special first-token sigil). Like code and math, an unclosed
  // span reaches the end of the containing block.
  function scanLiteralInline(s: InlineScan): boolean {
    const { text, i } = s
    if (text[i + 1] !== '`') return false
    const { end, closed, openLen } = verbatimSpanEnd(text, i + 1)
    flush(s)
    const content = closed
      ? stripVerbatimPadding(text.slice(i + 1 + openLen, end - openLen))
      : s.session.trimUnclosedRun(text.slice(i + 1 + openLen))
    emit(s, { type: 'literal_inline', content } as LiteralInline, i, end)
    s.i = end
    return true
  }

  // Image ![alt](src) — the alt text allows nested balanced [...], so the
  // close `]` is found by balance, not a [^\]]* regex that would mis-split
  // a nested bracket (e.g. `![a [b] c](/u)`). Alt is scalar text with punctuation escapes.
  function scanImage(s: InlineScan): boolean {
    const { text, i } = s
    if (text[i + 1] !== '[' || s.bracketClose.footnotes?.has(i + 1)) return false
    const closeAbs = s.bracketClose(i + 1)
    const close = closeAbs === undefined ? -1 : closeAbs - i
    if (close <= 1) return false
    const rest = text.slice(i)
    const alt = rest.slice(2, close)
    const tail = rest.slice(close + 1)
    return scanInlineImage(s, close, alt, tail) || scanReservedReferenceTail(s, close, tail) || scanReferenceImage(s, rest, close, alt, tail)
  }

  function scanInlineImage(s: InlineScan, close: number, alt: string, tail: string): boolean {
    const { text, i } = s
    // A link/image tail needs a literal `)`; skip when none lies ahead.
    const ml = s.destinationOpeners.has(i + close + 1) ? execLinkTail(tail, offset => !spanAttrProvablyInvalid(text, i + close + 1 + offset, s.quoteEnd, s.valueEnd)) : null
    if (!ml) return false
    flush(s)
    const img: Image = { type: 'image', src: ml[1]!, alt: unescapeAttrValue(alt) }
    const title = ml[2] ?? ml[3]
    if (title !== undefined) img.title = unescapeAttrValue(title)
    const extra = tailAttrs(ml[4])
    if (extra.attrs) img.attrs = extra.attrs
    const len = close + 1 + ml[0].length - extra.unconsumed
    emit(s, img, i, i + len)
    s.i += len
    return true
  }

  // Reference image `![alt][ref]{attrs}`; collapsed `![alt][]` reuses the
  // alt as the label. The image form of a reference link — same explicit
  // `[label]: url` resolution (applyLinkDefs), src instead of href. Alt
  // must be non-empty (as for a reference link's text).
  function scanReferenceImage(s: InlineScan, rest: string, close: number, alt: string, tail: string): boolean {
    const { text, i, session, source } = s
    const mref = execReferenceTail(s, tail, i + close + 1)
    // Full `![alt][ref]` allows an empty alt (`![][ref]`, label = ref);
    // collapsed `![alt][]` needs a non-empty alt to use as the label.
    if (!mref || (mref[1]! === '' && alt === '')) return false
    flush(s)
    const extra = tailAttrs(mref[2])
    const len = close + 1 + mref[0].length - extra.unconsumed
    const img = referenceImage(
      mref[1]! !== '' ? mref[1]! : alt,
      session.rawSourceSlice(source, text, i, i + len) ?? rest.slice(0, len),
      unescapeAttrValue(alt), extra.attrs,
    )
    emit(s, img, i, i + len)
    s.i += len
    return true
  }

  // Inline footnote `^[content]` (pandoc-style; design §2-§5). The caret must
  // immediately precede `[` and must not be inside footnote content (no notes
  // inside notes, §3.1). A `^` anywhere else is literal text (there is no bare
  // superscript), so `^^[x]` is a literal `^` followed by a note. The matching
  // `]` is the balanced close from bracketClose (escape/code-span aware).
  // Empty or whitespace-only content is literal. Content is inline-only,
  // parsed with footnote recognition disabled.
  function scanInlineFootnote(s: InlineScan): boolean {
    const { text, i, session } = s
    if (s.inFootnote || text[i + 1] !== '[' || s.bracketClose.footnotes?.has(i + 1)) return false
    const close = s.bracketClose(i + 1)
    if (close === undefined || trimStructural(text.slice(i + 2, close)) === '') return false
    flush(s)
    const inner = text.slice(i + 2, close)
    const children = session.scanInline(inner, session.shiftSource(s.source, text, i + 2), true, false, NO_OPEN_KINDS, true, true)
    emit(s, { type: 'inline_footnote', inline: children } as InlineFootnote, i, close + 1)
    s.i = close + 1
    return true
  }

  function scanFootnoteRef(s: InlineScan, rest: string): boolean {
    const { text, i } = s
    const mfn = s.inFootnote || !s.footnoteStops || text[s.footnoteStops[i + 2]!] !== ']' ? null : RE_FOOTNOTE_REF.exec(rest)
    if (!mfn) return false
    flush(s)
    emit(s, { type: 'footnote_ref', label: mfn[1]! } as FootnoteRef, i, i + mfn[0].length)
    s.i += mfn[0].length
    return true
  }

  function scanInlineLink(s: InlineScan, close: number, innerText: string, tail: string): boolean {
    const { text, i, session, source } = s
    // Inline link [text](url "title"){attrs}
    const ml = s.destinationOpeners.has(i + close + 1) ? execLinkTail(tail, offset => !spanAttrProvablyInvalid(text, i + close + 1 + offset, s.quoteEnd, s.valueEnd)) : null
    if (!ml) return false
    flush(s)
    const link: Link = {
      type: 'link',
      href: ml[1]!,
      children: session.scanLinkLabel(innerText, session.shiftSource(source, text, i + 1), s.inFootnote),
    }
    const title = ml[2] ?? ml[3]
    if (title !== undefined) link.title = unescapeAttrValue(title)
    const extra = tailAttrs(ml[4])
    if (extra.attrs) link.attrs = extra.attrs
    const len = close + 1 + ml[0].length - extra.unconsumed
    emit(s, link, i, i + len)
    s.i += len
    return true
  }

  function scanReferenceLink(s: InlineScan, rest: string, close: number, innerText: string, tail: string): boolean {
    const { text, i, session, source } = s
    const mref = execReferenceTail(s, tail, i + close + 1)
    if (!mref) return false
    flush(s)
    const extra = tailAttrs(mref[2])
    const len = close + 1 + mref[0].length - extra.unconsumed
    const refLink = referenceLink(
      mref[1]! !== '' ? mref[1]! : innerText,
      session.rawSourceSlice(source, text, i, i + len) ?? rest.slice(0, len),
      session.scanLinkLabel(innerText, session.shiftSource(source, text, i + 1), s.inFootnote),
      extra.attrs,
    )
    emit(s, refLink, i, i + len)
    s.i += len
    return true
  }

  function scanSpan(s: InlineScan, rest: string, close: number): boolean {
    const { text, i, session } = s
    const innerText = rest.slice(1, close)
    // A span tail needs a literal `}` ahead; and its `{…}` content must be
    // able to form a valid attribute payload. Skip RE_SPAN_TAIL (which would
    // otherwise scan to a far `}` at every `[` -> O(n^2) on `[x]{[x]{…}`)
    // when no `}` lies ahead or the payload is provably invalid.
    const ms =
      s.rbraceSuf && s.rbraceSuf[i + close + 1] && !spanAttrProvablyInvalid(text, i + close + 1, s.quoteEnd, s.valueEnd)
        ? RE_SPAN_TAIL.exec(rest.slice(close + 1))
        : null
    if (!ms || !isValidInlineAttrPayload(ms[1]!)) return false
    flush(s)
    // A span at the inline cap is its own source, unparsed (corpus 882).
    if (helpers.inlineDepth >= MAX_NESTING_DEPTH) {
      const end = i + close + 1 + ms[0].length
      emit(s, { type: 'text', value: text.slice(i, end) } as Text, i, end)
      s.i = end
      return true
    }
    emit(s, {
      type: 'span',
      // A BRACKETED LABEL IS A HOST - see `scanLinkLabel`.
      children: session.scanInline(
        innerText, session.shiftSource(s.source, text, i + 1), s.inFootnote, false, NO_OPEN_KINDS, true,
      ),
      attrs: parseAttrs(ms[1]!),
    } as Span, i, i + close + 1 + ms[0].length)
    s.i += close + 1 + ms[0].length
    return true
  }

  // Link / reference link / footnote / span. The bracket text may contain
  // nested balanced [...] (djot: `[a [b] c](/u)`, `[[x](y)](z)`), so the
  // matching close `]` is found by balance — not a [^\]]* regex that would
  // mis-split at the first inner `]`. The (url) / [ref] / {attrs} tail is
  // then parsed by the same sub-patterns the old fast-path regexes used.
  function scanBracket(s: InlineScan): boolean {
    const { text, i } = s
    const closeAbs = text[i - 1] === '!' && s.bracketClose.declinedImageAsLink
      ? s.bracketClose.declinedImageAsLink(i) : s.bracketClose(i)
    const close = closeAbs === undefined ? -1 : closeAbs - i
    const rest = text.slice(i)
    if (close > 0) {
      const innerText = rest.slice(1, close)
      const tail = rest.slice(close + 1)
      // Footnote reference [^label] -- before reference links so adjacent
      // refs like `[^a][^a]` are two notes, not one unresolved `[text][ref]`.
      // Inside footnote content a `[^x]` is literal, not a reference
      // (no notes inside notes, design §3.1).
      if (scanFootnoteRef(s, rest)) return true
      if (scanInlineLink(s, close, innerText, tail)) return true
      if (scanReservedReferenceTail(s, close, tail)) return true
      if (scanReferenceLink(s, rest, close, innerText, tail)) return true
    }
    // Footnote reference [^label] -- before span, so `[^x]{.c}` stays a
    // footnote ref (the `{.c}` then attaches via the inline-attr pass)
    // rather than becoming a <span> of `^x`. Footnote labels hold no
    // nested brackets, so its own regex stays authoritative.
    if (scanFootnoteRef(s, rest)) return true
    // Inline span `[text]{attrs}` (PART 9 §14). After links so `[t](u)` /
    // `[t][r]` win; the `{` must directly abut `]`. A bracket followed by a
    // VALID attribute block forms a span -- including an empty one (`[x]{}`,
    // `[x]{ }` -> empty <span>, matching djot). An INVALID block (`{???}`,
    // `{=y=}`) is not an attribute block, so it stays literal.
    return close > 0 && scanSpan(s, rest, close)
  }

  // Inline extension :type[content]{attrs}
  function scanInlineExtension(s: InlineScan, rest: string): boolean {
    const { text, i, session } = s
    const m = s.rbracketSuf?.[i] ? RE_EXTENSION.exec(rest) : null
    if (!m) return false
    const attrsStart = i + m[0].length
    const attrs = text[attrsStart] === '{' && s.rbraceSuf?.[attrsStart] && !spanAttrProvablyInvalid(text, attrsStart, s.quoteEnd, s.valueEnd)
      ? RE_INLINE_ATTR.exec(text.slice(attrsStart)) : null
    if (attrs) { m[0] += attrs[0]; m[3] = attrs[1]! }
    flush(s)
    const ext: Extension = {
      type: 'inline_extension',
      name: m[1]!,
      content: session.scanInline(
        m[2]!, session.shiftSource(s.source, text, i + m[0].indexOf('[') + 1), s.inFootnote,
        false, NO_OPEN_KINDS, true,
      ),
    }
    // THE ONLY INLINE ATTRIBUTE SURFACE WITH NO VALIDITY GATE, until now: a
    // trailing block here went straight to `parseAttrs`, so `{#1a}` became
    // `a=""` where §14 makes it literal on every sibling surface, a tab
    // separated two attributes after markup-carve/carve#906 narrowed the
    // rest, and a quoted value carried a line break past
    // markup-carve/carve#888. An invalid payload is not consumed - the
    // extension parses without attributes and the braces stay literal
    // text, exactly as the link and image tails already do.
    let consumed = m[0].length
    if (m[3] !== undefined) {
      if (isValidInlineAttrPayload(m[3])) ext.attrs = parseAttrs(m[3])
      else consumed -= m[3].length + 2
    }
    emit(s, ext, i, i + consumed)
    s.i += consumed
    return true
  }

  function scanColon(s: InlineScan): boolean {
    const rest = s.text.slice(s.i)
    if (scanInlineExtension(s, rest)) return true
    // Symbol shortcode `:name:` (after extension, which needs `[`).
    const sym = symbolOpensAt(s.text, s.i) ? RE_SYMBOL.exec(rest) : null
    if (!sym) return false
    return emitAtCursor(s, { type: 'symbol', name: sym[1]! } as SymbolInline, sym[0].length)
  }

  // Optional trailing {attrs} on an autolink, or undefined when none attaches.
  function autolinkAttrs(s: InlineScan, at: number): { attrs: Attrs | undefined; width: number } | undefined {
    const { text } = s
    // Optional trailing {attrs} (djot): `<url>{.c}`. An explicit
    // `href` in the block is ignored -- the structural href wins
    // (djot + carve-php), so it never produces a duplicate attribute.
    // An invalid payload (`{2=v}`) is literal (§14), not an
    // attribute block -- leave it for normal text processing.
    const am = text[at] === '{' && !spanAttrProvablyInvalid(text, at, s.quoteEnd, s.valueEnd)
      ? /^\{([^}\n]+)\}/.exec(text.slice(at)) : null
    if (!am || !isValidInlineAttrPayload(am[1]!)) return undefined
    const attrs = parseAttrs(am[1]!)
    if (isEmptyAttrs(attrs)) return undefined
    // A real attribute block: consume it (so it is not
    // re-processed). Drop a structural `href` so it never
    // duplicates the autolink's own href (djot + carve-php).
    if (attrs.keyValues?.href !== undefined) {
      delete attrs.keyValues.href
      if (attrs.order) attrs.order = attrs.order.filter((s) => s !== 'href')
    }
    return { attrs: isEmptyAttrs(attrs) ? undefined : attrs, width: am[0].length }
  }

  // Autolink <url>
  function scanAngle(s: InlineScan): boolean {
    const { text, i } = s
    const rest = text.slice(i)
    let cr: RegExpExecArray | null = null
    if (text.startsWith('</#', i)) {
      s.crossrefMemo ??= { lastCloser: text.lastIndexOf('>') }
      if (crossrefBodyCanEnd(text, i + 3, s.crossrefMemo)) cr = RE_CROSSREF.exec(rest)
    }
    if (cr) return emitAtCursor(s, { type: 'heading_ref', target: cr[1]! } as CrossRef, cr[0].length)
    const m = RE_AUTOLINK.exec(rest)
    if (!m) return false
    flush(s)
    const href = m[1]!
    const auto: AutoLink = {
      type: 'autolink',
      href: href.includes('@') && !href.includes(':') ? `mailto:${href}` : href,
      // Display is the raw `<...>` content: a URI autolink keeps its scheme
      // (`<mailto:a@b>` -> `mailto:a@b`), an email autolink shows the address.
      text: href,
    }
    let consumed = m[0].length
    const extra = autolinkAttrs(s, i + consumed)
    if (extra) {
      if (extra.attrs) auto.attrs = extra.attrs
      consumed += extra.width
    }
    emit(s, auto, i, i + consumed)
    s.i += consumed
    return true
  }

  function scanSubstitution(s: InlineScan, hasBrace: boolean, inlineEnd: number): boolean {
    const { text, i, session, source } = s
    if (hasBrace && session.substitutionAborted(text, i)) {
      append(s, '{~')
      s.i += 2
      return true
    }
    const sub = hasBrace ? session.substitutionAt(text, i) : null
    if (!sub || sub.end > inlineEnd) return false
    flush(s)
    emit(s, {
      type: 'substitution',
      old: session.scanInline(text.slice(i + 2, sub.arrow), session.shiftSource(source, text, i + 2), s.inFootnote),
      new: session.scanInline(text.slice(sub.arrow + 2, sub.end - 2), session.shiftSource(source, text, sub.arrow + 2), s.inFootnote),
    } as CriticSubstitute, i, sub.end)
    s.i = sub.end
    return true
  }

  // A pair opened inside a bracket run must close inside that run.
  function scanCriticEdit(s: InlineScan, inlineEnd: number, suffix: SuffixTable | null, type: 'insert' | 'delete'): boolean {
    const { text, i, session } = s
    const sign = type === 'insert' ? '+' : '-'
    const end = suffix && suffix[i] && text[i + 1] === sign ? session.criticPairEnd(text, i, `${sign}}`) : -1
    if (end === -1 || end > inlineEnd) return false
    flush(s)
    const children = session.scanInline(text.slice(i + 2, end - 2), session.shiftSource(s.source, text, i + 2), s.inFootnote)
    emit(s, { type, children } as CriticInsert | CriticDelete, i, end)
    s.i = end
    return true
  }

  function scanBracedEnDash(s: InlineScan, hasBrace: boolean): boolean {
    if (!hasBrace || !RE_BRACED_EN_DASH.test(s.text.slice(s.i))) return false
    // The SAME node the bare run produces, carrying the authored spelling
    // in `value` - so the AST says "an en dash was written here" rather
    // than holding a glyph in a text run, and `fmt` writes `{--}` back
    // instead of the literal character. PART 12's vocabulary already has
    // the kind; the braced form is a second spelling of it, not a second
    // construct.
    return emitAtCursor(s, { type: 'smart_punctuation', kind: 'en_dash', value: '{--}' } as SmartPunctuation, 4)
  }

  function execAt(re: RegExp, text: string, at: number): RegExpExecArray | null {
    re.lastIndex = at
    return re.exec(text)
  }

  function scanAttachedAttrs(s: InlineScan, hasBrace: boolean): boolean {
    const { text, i, out } = s
    // Inline attribute block — attaches to preceding node. It must be GLUED:
    // a non-empty `buf` means unflushed text (e.g. a space) sits between the
    // preceding node and the `{`, so the block is NOT attached -- it stays
    // literal text (`<url> {.x}` keeps `{.x}`). Matches carve-php / carve-rs.
    // A bracketed span's run also takes the blessed empty block as a member
    // that adds nothing (CARVE-P9-021, carve#4077).
    const empty = !s.buf && hasBrace && out.at(-1)?.type === 'span' ? execAt(RE_EMPTY_ATTR, text, i) : null
    const attr = empty ?? (!s.buf && hasBrace && !spanAttrProvablyInvalid(text, i, s.quoteEnd, s.valueEnd) ? RE_INLINE_ATTR.exec(text.slice(i)) : null)
    // A digit-leading key or otherwise invalid payload (`{2=v}`) makes the
    // whole block literal (§14), same strict rule as block/span attrs — so
    // `` `code`{#1a} `` keeps the braces rather than parsing a bogus attr.
    if (!attr || !out.length || (!empty && !isValidInlineAttrPayload(attr[1]!))) return false
    const prev = out[out.length - 1]!
    const parsed = parseAttrs(attr[1]!)
    // A `{...}` that yields no real attribute is literal text (PART 9
    // §15), not an empty attribute block to attach. Without this guard a
    // payload like `{=hl=}`, `{ }`, or `{???}` after a non-text node is
    // silently consumed and dropped.
    // The block also stays literal after an inert node whose renderer emits
    // NO attributes -- a soft/hard break, a mention, or a tag -- otherwise
    // the attrs attach and are silently discarded at render (mentions/tags
    // are stable inert spans that do not take attributes). Matches
    // carve-rs / carve-php, which keep the `{...}` literal in these cases.
    if (ATTR_INERT_PREV.has(prev.type) || (isEmptyAttrs(parsed) && !empty)) return false
    if (!empty) (prev as { attrs?: Attrs }).attrs = accumulateAttrs(
      (prev as { attrs?: Attrs }).attrs,
      parsed,
    )
    // A TRAILING ATTRIBUTE BLOCK IS THE NODE'S OWN MARKUP (PART 12 §4,
    // carve#521), so the span covers it: `*x*{#i}` gives the `strong`
    // offsets 0..7, not 0..3. The braces are where the node's `attrs`
    // came from, and a span stopping at `*x*` says the node ends before
    // the markup that gave it half its content -- the same reading that
    // already puts a break's backslash inside the break.
    s.session.extendPosTo(prev, s.source, text, i + attr[0].length)
    // An unresolved reference renders as its source, so a later block of the run is part of it.
    const reference = prev as { rawRef?: string }
    if (reference.rawRef !== undefined) reference.rawRef += s.session.rawSourceSlice(s.source, text, i, i + attr[0].length) ?? attr[0]
    s.i += attr[0].length
    return true
  }

  function scanCriticComment(s: InlineScan): boolean {
    const { text, i } = s
    const criticClose = text[i + 1] === '#' && s.criticCmtSuf?.[i] && !extendsGrapheme(text, i + 2) ? text.indexOf('#}', i + 2) : -1
    if (criticClose <= i + 2) return false
    flush(s)
    emit(s, { type: 'critic_comment', text: text.slice(i + 2, criticClose) } as CriticComment, i, criticClose + 2)
    s.i = criticClose + 2
    return true
  }

  // Forced intraword emphasis `{X…X}` (§22) — emits the same node as the
  // bare delimiter, but with no word-boundary condition.
  function scanForcedEmphasis(s: InlineScan, hasBrace: boolean, inlineEnd: number): boolean {
    const { text, i, session, source } = s
    const delim = text[i + 1]
    const forced = hasBrace && delim !== undefined && FORCED_TYPE[delim] !== undefined && !splitBracedOpener(text, i)
      ? session.bracedPairEnd(text, i, `${delim}}`)
      : -1
    if (forced === -1 || forced > inlineEnd) return false
    flush(s)
    if (helpers.inlineDepth >= MAX_NESTING_DEPTH) {
      emit(s, { type: 'text', value: text.slice(i, forced) } as Text, i, forced)
      s.i = forced
      return true
    }
    const pairs = session.pairEndText === text ? session.pairView(i + 2) : undefined
    emit(s, { type: FORCED_TYPE[delim!]!, children: session.plainInlineWord(text, i + 2, forced - 2, source) ?? session.scanInline(text.slice(i + 2, forced - 2), session.shiftSource(source, text, i + 2), s.inFootnote, false, new Set([delim!]), false, false, pairs) } as Emphasis, i, forced)
    s.i = forced
    return true
  }

  // CriticMarkup family
  function scanBraceFamily(s: InlineScan): boolean {
    // Each `{…}` tail regex requires its own literal close (`}`, `+}`, `-}`);
    // skip it when that delimiter is absent from the rest of the input, which
    // would otherwise force a backtrack to EOF at every `{` (quadratic on
    // runs like `{+`×n or `{~`×n). O(1) suffix lookups; output-identical.
    const hasBrace = !!(s.rbraceSuf && s.rbraceSuf[s.i])
    const inlineEnd = s.bracketRuns.at(-1)?.close ?? s.text.length
    return scanSubstitution(s, hasBrace, inlineEnd) ||
      scanCriticEdit(s, inlineEnd, s.insSuf, 'insert') ||
      scanCriticEdit(s, inlineEnd, s.delSuf, 'delete') ||
      scanBracedEnDash(s, hasBrace) ||
      scanAttachedAttrs(s, hasBrace) ||
      scanCriticComment(s) ||
      scanForcedEmphasis(s, hasBrace, inlineEnd)
  }

  function scanMention(s: InlineScan): boolean {
    const { text, i } = s
    if (i !== 0 && /[A-Za-z0-9_]/.test(text[i - 1]!)) return false
    RE_MENTION_AT.lastIndex = i
    const m = RE_MENTION_AT.exec(text)
    if (!m || !RE_NAME_LETTER.test(m[1]!)) return false
    return emitAtCursor(s, { type: 'mention', user: m[1]! } as Mention, m[0].length)
  }

  function scanTag(s: InlineScan): boolean {
    const { text, i } = s
    RE_TAG_AT.lastIndex = i
    const m = RE_TAG_AT.exec(text)
    const tagBoundary = i === 0 || !/[A-Za-z0-9_]/.test(text[i - 1]!)
    // A name holds an ASCII letter (carve#4809); `#1` is neither a tag nor a caption placeholder.
    if (m && !RE_NAME_LETTER.test(m[1]!)) return false
    if (m && tagBoundary) return emitAtCursor(s, { type: 'tag', name: m[1]! } as Tag, m[0].length)
    // Bare `#` (not a tag) in a caption = number placeholder, first only.
    // `\#` never reaches here (the escape branch consumes it as literal).
    if (m || !s.captionContext || s.captionNumberEmitted) return false
    s.captionNumberEmitted = true
    return emitAtCursor(s, { type: 'caption_number' } as CaptionNumber, 1)
  }

  function scanEmphasis(s: InlineScan): boolean {
    const { text, i } = s
    const guardOpen = s.openEntryAt === i - 1
    const em = s.session.matchEmphasis(text, i, s.source, s.inFootnote,
      s.emphasisNoClose ??= { ...newEmphasisMemo(), noteBody: s.inFootnote }, s.bracketRuns.at(-1)?.close ?? text.length, s.bracketRuns.length > 0, guardOpen)
    if (!em) {
      const ch = text[i]!
      if (!s.openEntryKinds.includes(ch) && s.session.bareOpenerStands(text, i, guardOpen)) {
        s.openEntryAt = i
        s.openEntryKinds += ch
      }
      return false
    }
    flush(s)
    const node = helpers.inlineDepth >= MAX_NESTING_DEPTH ? { type: 'text', value: text.slice(i, em.end) } as Text : em.node
    emit(s, node, i, em.end)
    s.i = em.end
    return true
  }

  // Extension inline matchers run only here, where every core construct has
  // declined position i: extensions add syntax, they never hijack core.
  function scanExtensionMatch(s: InlineScan): boolean {
    const { text, i, session } = s
    const xm = session.tryInlineMatchers(text, i)
    if (!xm) return false
    flush(s)
    const node = session.withPos(xm.node, s.source, text, i, xm.end)
    if (node.type === 'citation_group') session.positionCitationItems(node, s.source, text, i)
    s.out.push(node)
    s.i = xm.end
    return true
  }

  // Core constructs that open on `c`, tried in their precedence order.
  function scanInvalidLineRangeDirective(s: InlineScan): boolean {
    const { text, i } = s
    if (text.slice(i, i + 2) !== '{{') return false
    const shape = scanDirectiveShape(text, i)
    if (!shape || !isLiteralInlineDirective(shape)) return false
    flush(s)
    emit(s, { type: 'text', value: text.slice(i, shape.end) }, i, shape.end)
    s.i = shape.end
    return true
  }

  function scanConstruct(s: InlineScan, c: string): boolean {
    switch (c) {
      case '{': return scanInvalidLineRangeDirective(s) || scanDelimitedComment(s) || scanBraceFamily(s)
      case '`': return scanCodeSpan(s)
      case '$': return scanMath(s)
      case '!': return scanLiteralInline(s) || scanImage(s)
      case '^': return scanInlineFootnote(s)
      case '[': return scanBracket(s)
      case ':': return scanColon(s)
      case '<': return scanAngle(s)
      case '@': return scanMention(s)
      case '#': return scanTag(s)
      case '/': case '*': case '_': case '~': case '=': return scanEmphasis(s)
      // Soft break (single newline inside paragraph)
      case '\n': return emitAtCursor(s, { type: 'soft_break' }, 1)
    }
    return false
  }

  return function scanInlineInner(session: InlineScannerSession,
    text: string,
    source: InlineSource,
    inFootnote: boolean,
    captionContext: boolean,
    // Whether a `%%` at index 0 stands at the start of the HOST's own inline run -
    // see `opensInlineComment`. True for the outermost scan of a block's text and
    // for a label, which is a host of its own; false inside emphasis or any other
    // span.
    atHostRunStart: boolean,
  ): InlineNode[] {
    // Non-ASCII text and ASCII letters/digits have no core inline openers.
    // Extension matchers can claim ordinary text, so they retain the full scan.
    if (!source.cellWraps && session.activeMatchers.length === 0 && /^[A-Za-z0-9 \t\u0080-\uFFFF]+$/.test(text)) {
      return [session.withPos({ type: 'text', value: text } as Text, source, text, 0, text.length)]
    }
    const s = createInlineScan(session, text, source, inFootnote, captionContext, atHostRunStart)
    while (s.i < text.length) {
      const c = text[s.i]!
      if (scanCellWrap(s, c)) continue
      trackBracketRuns(s, c)
      if (c === '\0' && session.inLineBlock) {
        emitAtCursor(s, { type: 'non_breaking_space' }, 1)
        continue
      }
      if (session.activeMatchers.length === 0 && ordinaryAt(text, s.i)) {
        appendOrdinaryRun(s)
        continue
      }
      if (c === '\\' && scanBackslash(s)) continue
      if (scanSmartToken(s) || scanLineComment(s) || scanConstruct(s, c)) continue
      if (session.activeMatchers.length && scanExtensionMatch(s)) continue
      append(s, c)
      s.i++
    }
    flush(s)
    return s.out
  }

}
