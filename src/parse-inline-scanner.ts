import type {
  inlineScannerHelpers,
  BracketClose,
  CrossrefMemo,
  InlineSource,
  InlinePairView,
  EmphasisMatch,
  EmphasisMemo,
} from "./parse.js";
import type { CarveExtension, InlineMatch } from "./extension.js";
import type { CitationGroup, VerbatimCellWrap } from "./ast.js";
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
} from "./ast.js";

export interface InlineScannerSession {
  activeMatchers: CarveExtension[];
  pairEndText: string | undefined;
  inLineBlock: boolean;
  recordPositions: boolean;
  singleQuoteSpan: { node?: SmartPunctuation; demote: boolean } | null;
  bracedPairEnd(text: string, open: number, closer: string): number;
  criticPairEnd(text: string, open: number, closer: "+}" | "-}"): number;
  delimitedCommentClose(text: string, from: number): number;
  extendPosTo(
    node: InlineNode,
    source: InlineSource,
    text: string,
    end: number,
  ): void;
  matchEmphasis(
    text: string,
    i: number,
    source: InlineSource,
    inFootnote?: boolean,
    noClose?: EmphasisMemo,
    end?: number,
  ): EmphasisMatch | null;
  pairView(offset: number): InlinePairView;
  plainInlineWord(
    text: string,
    start: number,
    end: number,
    source: InlineSource,
  ): InlineNode[] | undefined;
  positionCitationItems(
    node: CitationGroup,
    source: InlineSource,
    text: string,
    groupStart: number,
  ): void;
  rawSourceSlice(
    source: InlineSource,
    text: string,
    start: number,
    end: number,
  ): string | undefined;
  scanInline(
    text: string,
    source?: InlineSource,
    inFootnote?: boolean,
    captionContext?: boolean,
    kinds?: ReadonlySet<string>,
    opensHostRun?: boolean,
    separateQuoteScope?: boolean,
    pairs?: InlinePairView,
  ): InlineNode[];
  scanLinkLabel(
    text: string,
    source: InlineSource,
    inFootnote: boolean,
  ): InlineNode[];
  shiftSource(source: InlineSource, text: string, by: number): InlineSource;
  smartToken(
    text: string,
    i: number,
    prev: string,
  ): { out: string; len: number; kind: string } | null;
  substitutionAt(
    text: string,
    open: number,
  ): { end: number; arrow: number } | null;
  trimUnclosedRun(content: string): string;
  tryInlineMatchers(text: string, pos: number): InlineMatch | null;
  verbatimCellWraps(
    text: string,
    source: InlineSource,
    start: number,
    payload: string,
    strippedPadding?: boolean,
  ): VerbatimCellWrap[] | undefined;
  withPos<T extends InlineNode>(
    node: T,
    source: InlineSource,
    text: string,
    start: number,
    end: number,
  ): T;
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
  } = helpers;
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
    const out: InlineNode[] = []
    let i = 0
    let buf = ''
    let bufStart = 0
    // Caption number placeholder: only the first bare `#` in a caption becomes one.
    let captionNumberEmitted = false
    // Last char appended to buf. Tracked explicitly because reading
    // `buf[buf.length - 1]` each char indexes a growing ConsString, which V8 must
    // flatten/traverse -- O(n^2) over a quote-dense run (and a catastrophic cliff
    // once the rope gets deep). A scalar keeps the smart-quote context check O(1).
    let bufLast = ''
    let quoteContextIndex = 0
    let quoteContext = ''
    const emphasisNoClose = newEmphasisMemo()
    let crossrefMemo: CrossrefMemo | undefined

    // Precompute each `[`'s balancing `]` once (O(n)) so the link/image/span
    // branches resolve the close bracket in O(1); see buildBracketMap.
    const bracketClose: BracketClose = text.includes('[') ? buildBracketMap(text) : () => undefined
    let commentLineEnd = -1
    const bracketRuns: Array<{ start: number; close: number }> = []

    // Suffix tables so a tail regex is only run when its mandatory close
    // delimiter still lies ahead; otherwise the regex would backtrack to EOF and
    // fail. See suffixHasChar/suffixHasPair. Built only when the delimiter is
    // present at all, mirroring the bracketClose guard above.
    const destinationOpeners = text.includes('](') ? completeDestinationOpeners(text) : new Set<number>()
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
    const execReferenceTail = (tail: string, start: number): RegExpExecArray | null => {
      const match = RE_REF_TAIL.exec(tail)
      if (!match) return null
      const brace = start + match[0].length
      const attrs = text[brace] === '{' && rbraceSuf?.[brace] && !spanAttrProvablyInvalid(text, brace, quoteEnd, valueEnd)
        ? RE_INLINE_ATTR.exec(text.slice(brace)) : null
      if (attrs) { match[0] += attrs[0]; match[2] = attrs[1]! }
      return match
    }
    const insSuf = text.includes('+}') ? suffixHasPair(text, '+', '}') : null
    const delSuf = text.includes('-}') ? suffixHasPair(text, '-', '}') : null

    const flush = () => {
      if (buf) {
        const node = { type: 'text', value: buf } as Text
        out.push(session.withPos(node, source, text, bufStart, i))
        buf = ''
        bufLast = ''
      }
    }

    const append = (value: string) => {
      if (!buf) bufStart = i
      buf += value
      if (value) bufLast = value[value.length - 1]!
    }

    while (i < text.length) {
      const c = text[i]!
      const wrap = c === ' ' ? source.cellWraps?.get(i + (source.wrapShift ?? 0)) : undefined
      if (wrap) {
        flush()
        out.push({ type: 'cell_wrap', line: wrap.line, ...(wrap.row ? { row: wrap.row } : {}), ...(wrap.col ? { col: wrap.col } : {}), ...(session.recordPositions && wrap.pos ? { pos: wrap.pos } : {}) })
        i++
        continue
      }
      while (bracketRuns.length && i >= bracketRuns[bracketRuns.length - 1]!.close) {
        bracketRuns.pop()
      }
      // The bracket scanner decides which escapes and opaque spans hide a closer.
      if (c === '[') {
        const close = bracketClose(i)
        if (close !== undefined) bracketRuns.push({ start: i + 1, close })
      }
      if (c === '\0' && session.inLineBlock) {
        flush()
        out.push(session.withPos({ type: 'non_breaking_space' }, source, text, i, i + 1))
        i++
        continue
      }

      // Core inline constructs all begin with punctuation. When no extension
      // matcher can claim an arbitrary offset, append ordinary text as a
      // run instead of asking smart typography, emphasis and every other inline
      // recognizer about each letter and space individually.
      const code = text.charCodeAt(i)
      if (
        session.activeMatchers.length === 0 &&
        (code >= 128 || (code >= 48 && code <= 57) ||
          (code >= 65 && code <= 90) ||
          (code >= 97 && code <= 122) ||
          code === 32 ||
          code === 9)
      ) {
        const start = i
        do {
          i++
          if (i >= text.length) break
          if (source.cellWraps?.has(i + (source.wrapShift ?? 0))) break
          const next = text.charCodeAt(i)
          if (
            !(
              next >= 128 ||
              (next >= 48 && next <= 57) ||
              (next >= 65 && next <= 90) ||
              (next >= 97 && next <= 122) ||
              next === 32 ||
              next === 9
            )
          ) {
            break
          }
        } while (true)
        const value = text.slice(start, i)
        if (!buf) bufStart = start
        buf += value
        bufLast = value[value.length - 1]!
        continue
      }
      const rest = text.slice(i)

      // Hard line break: a backslash at end of line (before a newline).
      if (c === '\\' && text[i + 1] === '\n') {
        flush()
        out.push(session.withPos({ type: 'hard_break' }, source, text, i, i + 2))
        i += 2
        continue
      }
      // A backslash at the very end of the content (no following character) is
      // still a hard break, mirroring the `\`-before-newline rule at end of
      // input (`para\` at EOF -> `<br>`), matching djot and carve's cheatsheet.
      if (c === '\\' && i + 1 >= text.length) {
        flush()
        out.push(session.withPos({ type: 'hard_break' }, source, text, i, i + 1))
        i++
        continue
      }
      // Non-breaking space: a backslash followed by a space (djot). Emit the
      // internal placeholder (U+E000) rather than a literal U+00A0 so it is
      // converted per renderer (HTML &nbsp;, Markdown U+00A0, plain/ANSI a
      // space) and never confused with an author's literal non-breaking space.
      if (c === '\\' && text[i + 1] === ' ') {
        flush()
        out.push(session.withPos({ type: 'non_breaking_space' }, source, text, i, i + 2))
        i += 2
        continue
      }

      // Escape: a backslash before any ASCII punctuation yields that literal
      // character (djot / grammar `ascii_punctuation` — the full set, including
      // `& : ; ?`).
      if (c === '\\' && i + 1 < text.length) {
        const nxt = text[i + 1]!
        if (RE_ESCAPABLE_PUNCTUATION.test(nxt)) {
          // The escape is its own node: the backslash carries intent the literal
          // character does not. `\-\-` was written precisely so a downstream
          // processor would not read an en dash, and flattening it into text lost
          // that (carve#350).
          const escStart = i
          flush()
          out.push(
            session.withPos({ type: 'escaped_text', value: nxt } as EscapedText, source, text, escStart, i + 2),
          )
          if (nxt === '<' && text.startsWith('</#', i + 1)) {
            crossrefMemo ??= { lastCloser: text.lastIndexOf('>') }
            if (text[i + 4] !== '>' && crossrefBodyCanEnd(text, i + 4, crossrefMemo)) {
              const end = text.indexOf('>', i + 4) + 1
              i += 2
              append(text.slice(i, end))
              i = end
              continue
            }
          }
          i += 2
          continue
        }
      }

      // Smart typography (grammar.ebnf §"Smart Typography", PART 9 §8).
      // Runs after the escape check, so `\->` etc. are already absorbed
      // into buf as literals and never reach here. Inside code is handled
      // by the opaque code branch below (continues before this on a
      // backtick). Multi-char tokens are matched longest-first.
      {
        // Comments emit no character; visit each appended node only once for quote context.
        while (quoteContextIndex < out.length) {
          const node = out[quoteContextIndex++]!
          if (node.type !== 'comment') quoteContext = lastEmittedGlyph(node)
        }
        const prevForQuote = buf.length ? bufLast : quoteContext
        const st = session.smartToken(text, i, prevForQuote)
        if (st && st.kind === 'literal_hyphen_run') {
          // A flag-shaped hyphen run (carve#1443) is ordinary text: it joins the
          // buffer rather than becoming a node, so it renders and round-trips as
          // the hyphens the author wrote.
          buf += st.out
          bufLast = st.out[st.out.length - 1]!
          i += st.len
          continue
        }
        if (st) {
          flush()
          // A dash run resolves to one or more glyphs; each consumes a fixed
          // number of source hyphens (3 for em, 2 for en), so the run partitions
          // into one node per glyph carrying the hyphens it came from.
          if (st.kind === 'dash_run') {
            let consumed = 0
            for (const glyph of st.out) {
              const width = glyph === '—' ? 3 : 2
              out.push(
                session.withPos(
                  {
                    type: 'smart_punctuation',
                    kind: glyph === '—' ? 'em_dash' : 'en_dash',
                    value: text.slice(i + consumed, i + consumed + width),
                  } as SmartPunctuation,
                  source,
                  text,
                  i + consumed,
                  i + consumed + width,
                ),
              )
              consumed += width
            }
          } else {
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
            out.push(session.withPos(node, source, text, i, i + st.len))
          }
          i += st.len
          continue
        }
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
      const commentRun = bracketRuns[bracketRuns.length - 1]
      if (opensInlineComment(text, i, atHostRunStart || commentRun !== undefined, commentRun?.start)) {
        // Absorb the separating SPACE run; a tab stays content (CARVE-P9-041).
        // The flushed text ends where the run begins, keeping source spans contiguous.
        const trimmed = buf.replace(/ +$/, '')
        const commentStart = i - (buf.length - trimmed.length)
        if (trimmed) {
          const node = { type: 'text', value: trimmed } as Text
          out.push(session.withPos(node, source, text, bufStart, commentStart))
        }
        buf = ''
        // Several bracket comments can share a line; search its suffix only once.
        if (commentLineEnd < i) {
          const nl = text.indexOf('\n', i)
          commentLineEnd = nl === -1 ? text.length : nl
        }
        const end = Math.min(commentLineEnd, commentRun?.close ?? text.length)
        const content = trimEndSpaceTab(text.slice(i + 2, end).replace(/^[ \t]/, ''))
        out.push(
          session.withPos({ type: 'comment', block: false, content } as Comment, source, text, i, end),
        )
        i = end
        continue
      }

      // Explicitly delimited inline comment (PART 9 §21a). The first `%}` wins;
      // an opener in the content is ordinary text, and an opener with no closer
      // stays literal. Unlike `%%`, surrounding whitespace is ordinary visible
      // text and scanning resumes after the closer.
      if (c === '{' && text[i + 1] === '%' && !extendsGrapheme(text, i + 2)) {
        const close = session.delimitedCommentClose(text, i + 2)
        if (close !== -1) {
          flush()
          const content = text.slice(i + 2, close).replace(/^ /, '').replace(/ $/, '')
          out.push(
            session.withPos(
              { type: 'comment', block: false, delimited: true, content } as Comment,
              source,
              text,
              i,
              close + 2,
            ),
          )
          i = close + 2
          continue
        }
      }

      // Inline verbatim (code span). The opening run is the MAXIMAL run of
      // backticks; it closes only on a run of EXACTLY the same length (a shorter
      // OR longer run is content). An opener with no equal-length closer still
      // opens a verbatim span that runs to the END of the block — matches djot
      // upstream + carve-php (grammar code_span, "UNCLOSED RUN"). Uses the shared
      // verbatimSpanEnd helper so the tokenizer, findEmphasisClose, and
      // buildBracketMap stay in lockstep on span boundaries.
      if (c === '`') {
        const { end, closed, openLen } = verbatimSpanEnd(text, i)
        flush()
        if (!closed) {
          // Unclosed: verbatim to end of block, with the block's trailing
          // whitespace stripped (no surrounding single-space strip — that applies
          // only to a closed span).
          // PART 7's four characters (the run may cross a line, so `\n` and `\r`
          // are in). `\s` ate a trailing vertical tab out of the span's content.
          const value = session.trimUnclosedRun(text.slice(i + openLen))
          const cellWraps = session.verbatimCellWraps(text, source, i + openLen, value)
          out.push(session.withPos({ type: 'code', value, ...(cellWraps ? { cellWraps } : {}) }, source, text, i, text.length))
          i = text.length
          continue
        }
        const padded = text.slice(i + openLen, end - openLen)
        const inner = stripVerbatimPadding(padded)
        const cellWraps = session.verbatimCellWraps(text, source, i + openLen + (padded.length - inner.length) / 2, inner, padded.length !== inner.length)
        // A verbatim span tagged `{=format}` is raw inline passthrough.
        const raw = RE_RAW_INLINE.exec(text.slice(end))
        if (raw) {
          const len = end - i + raw[0].length
          out.push(session.withPos({ type: 'raw_inline', format: raw[1]!, content: inner, ...(cellWraps ? { cellWraps } : {}) } as RawInline, source, text, i, i + len))
          i += len
          continue
        }
        out.push(session.withPos({ type: 'code', value: inner, ...(cellWraps ? { cellWraps } : {}) }, source, text, i, end))
        i = end
        continue
      }

      // Math (djot form): inline $`x`, display $$`x`. A bare `$` not
      // followed by a backtick run (e.g. currency `$5`) stays literal.
      if (c === '$') {
        const display = text[i + 1] === '$'
        const dollarLen = display ? 2 : 1
        const tick = i + dollarLen
        if (text[tick] === '`') {
          const { end, closed, openLen } = verbatimSpanEnd(text, tick)
          const innerEnd = end - openLen
          const hasContent = closed
            ? innerEnd > tick + openLen && text[innerEnd - 1] !== '`'
            : text.length > tick + openLen
          if (hasContent && (!closed || text[end] !== '`')) {
            flush()
            const padded = closed ? text.slice(tick + openLen, innerEnd) : ''
            const content = closed
              ? stripVerbatimPadding(padded)
              : session.trimUnclosedRun(text.slice(tick + openLen))
            const cellWraps = session.verbatimCellWraps(text, source, tick + openLen + (padded.length - (closed ? content.length : 0)) / 2, content)
            const len = end - i
            out.push(session.withPos({ type: 'math', display, content, ...(cellWraps ? { cellWraps } : {}) } as Math, source, text, i, i + len))
            i += len
            continue
          }
        }
      }

      // Inline literal (§27): a `!` prefix on a verbatim code span, mirroring
      // the `$`-math prefix above. The span content is captured verbatim, later
      // HTML-escaped and emitted by every renderer with the `<code>` wrapper
      // dropped; a trailing `{…}` attaches below as an ordinary inline attribute
      // block (no special first-token sigil). Like code and math, an unclosed
      // span reaches the end of the containing block.
      if (c === '!' && text[i + 1] === '`') {
        const { end, closed, openLen } = verbatimSpanEnd(text, i + 1)
        flush()
        const content = closed
          ? stripVerbatimPadding(text.slice(i + 1 + openLen, end - openLen))
          : session.trimUnclosedRun(text.slice(i + 1 + openLen))
        out.push(session.withPos({ type: 'literal_inline', content } as LiteralInline, source, text, i, end))
        i = end
        continue
      }

      // Image ![alt](src) — the alt text allows nested balanced [...], so the
      // close `]` is found by balance, not a [^\]]* regex that would mis-split
      // a nested bracket (e.g. `![a [b] c](/u)`). Alt is scalar text with punctuation escapes.
      if (c === '!' && text[i + 1] === '[') {
        const closeAbs = bracketClose(i + 1)
        const close = closeAbs === undefined ? -1 : closeAbs - i
        if (close > 1) {
          const alt = rest.slice(2, close)
          const tail = rest.slice(close + 1)
          // A link/image tail needs a literal `)`; skip when none lies ahead.
          const ml = destinationOpeners.has(i + close + 1) ? execLinkTail(tail, offset => !spanAttrProvablyInvalid(text, i + close + 1 + offset, quoteEnd, valueEnd)) : null
          if (ml) {
            flush()
            const img: Image = { type: 'image', src: ml[1]!, alt: unescapeAttrValue(alt) }
            const title = ml[2] ?? ml[3]
            if (title !== undefined) img.title = unescapeAttrValue(title)
            let len = close + 1 + ml[0].length
            if (ml[4]) {
              // An invalid payload (`{2=v}`) is literal (§14), and an
              // empty-attr `{…}` is literal too -- neither is consumed.
              if (!isValidInlineAttrPayload(ml[4])) {
                len -= ml[4].length + 2
              } else {
                const a = parseAttrs(ml[4])
                if (isEmptyAttrs(a)) len -= ml[4].length + 2
                else img.attrs = a
              }
            }
            out.push(session.withPos(img, source, text, i, i + len))
            i += len
            continue
          }
          // Reference image `![alt][ref]{attrs}`; collapsed `![alt][]` reuses the
          // alt as the label. The image form of a reference link — same explicit
          // `[label]: url` resolution (applyLinkDefs), src instead of href. Alt
          // must be non-empty (as for a reference link's text).
          const mref = execReferenceTail(tail, i + close + 1)
          // Full `![alt][ref]` allows an empty alt (`![][ref]`, label = ref);
          // collapsed `![alt][]` needs a non-empty alt to use as the label.
          if (mref && (mref[1]! !== '' || alt !== '')) {
            flush()
            let len = close + 1 + mref[0].length
            let attrs: Attrs | undefined
            if (mref[2]) {
              if (!isValidInlineAttrPayload(mref[2])) {
                len -= mref[2].length + 2
              } else {
                const a = parseAttrs(mref[2])
                if (isEmptyAttrs(a)) len -= mref[2].length + 2
                else attrs = a
              }
            }
            const img = referenceImage(
              mref[1]! !== '' ? mref[1]! : alt,
              session.rawSourceSlice(source, text, i, i + len) ?? rest.slice(0, len),
              unescapeAttrValue(alt), attrs,
            )
            out.push(session.withPos(img, source, text, i, i + len))
            i += len
            continue
          }
        }
      }

      // Inline footnote `^[content]` (pandoc-style; design §2-§5). The caret must
      // immediately precede `[` and must not be inside footnote content (no notes
      // inside notes, §3.1). A `^` anywhere else is literal text (there is no bare
      // superscript), so `^^[x]` is a literal `^` followed by a note. The matching
      // `]` is the balanced close from bracketClose (escape/code-span aware).
      // Empty or whitespace-only content is literal. Content is inline-only,
      // parsed with footnote recognition disabled.
      if (!inFootnote && c === '^' && text[i + 1] === '[') {
        const close = bracketClose(i + 1)
        if (close !== undefined && trimStructural(text.slice(i + 2, close)) !== '') {
          flush()
          const inner = text.slice(i + 2, close)
          const children = session.scanInline(inner, session.shiftSource(source, text, i + 2), true, false, NO_OPEN_KINDS, false, true)
          out.push(session.withPos({ type: 'inline_footnote', inline: children } as InlineFootnote, source, text, i, close + 1))
          i = close + 1
          continue
        }
      }

      // Link / reference link / footnote / span. The bracket text may contain
      // nested balanced [...] (djot: `[a [b] c](/u)`, `[[x](y)](z)`), so the
      // matching close `]` is found by balance — not a [^\]]* regex that would
      // mis-split at the first inner `]`. The (url) / [ref] / {attrs} tail is
      // then parsed by the same sub-patterns the old fast-path regexes used.
      if (c === '[') {
        const closeAbs = bracketClose(i)
        const close = closeAbs === undefined ? -1 : closeAbs - i
        if (close > 0) {
          const innerText = rest.slice(1, close)
          const tail = rest.slice(close + 1)
          // Footnote reference [^label] -- before reference links so adjacent
          // refs like `[^a][^a]` are two notes, not one unresolved `[text][ref]`.
          // Inside footnote content a `[^x]` is literal, not a reference
          // (no notes inside notes, design §3.1).
          const mfn = inFootnote || !footnoteStops || text[footnoteStops[i + 2]!] !== ']' ? null : RE_FOOTNOTE_REF.exec(rest)
          if (mfn) {
            flush()
            out.push(session.withPos({ type: 'footnote_ref', label: mfn[1]! } as FootnoteRef, source, text, i, i + mfn[0].length))
            i += mfn[0].length
            continue
          }
          // Inline link [text](url "title"){attrs}
          const ml = destinationOpeners.has(i + close + 1) ? execLinkTail(tail, offset => !spanAttrProvablyInvalid(text, i + close + 1 + offset, quoteEnd, valueEnd)) : null
          if (ml) {
            flush()
            const link: Link = {
              type: 'link',
              href: ml[1]!,
              children: session.scanLinkLabel(innerText, session.shiftSource(source, text, i + 1), inFootnote),
            }
            const title = ml[2] ?? ml[3]
            if (title !== undefined) link.title = unescapeAttrValue(title)
            let len = close + 1 + ml[0].length
            if (ml[4]) {
              // An invalid payload (`{2=v}`) is literal (§14), and an
              // empty-attr `{…}` is literal too -- neither is consumed.
              if (!isValidInlineAttrPayload(ml[4])) {
                len -= ml[4].length + 2
              } else {
                const a = parseAttrs(ml[4])
                if (isEmptyAttrs(a)) len -= ml[4].length + 2
                else link.attrs = a
              }
            }
            out.push(session.withPos(link, source, text, i, i + len))
            i += len
            continue
          }
          const mref = execReferenceTail(tail, i + close + 1)
          if (mref && (innerText !== '' || !mref[1]!.startsWith('@'))) {
            flush()
            let len = close + 1 + mref[0].length
            let attrs: Attrs | undefined
            if (mref[2]) {
              // An invalid payload (`{2=v}`) is literal (§14), and an
              // empty-attr `{…}` is literal too -- neither is consumed.
              if (!isValidInlineAttrPayload(mref[2])) {
                len -= mref[2].length + 2
              } else {
                const a = parseAttrs(mref[2])
                if (isEmptyAttrs(a)) len -= mref[2].length + 2
                else attrs = a
              }
            }
            const refLink = referenceLink(
              mref[1]! !== '' ? mref[1]! : innerText,
              session.rawSourceSlice(source, text, i, i + len) ?? rest.slice(0, len),
              session.scanLinkLabel(innerText, session.shiftSource(source, text, i + 1), inFootnote),
              attrs,
            )
            out.push(session.withPos(refLink, source, text, i, i + len))
            i += len
            continue
          }
        }
        // Footnote reference [^label] -- before span, so `[^x]{.c}` stays a
        // footnote ref (the `{.c}` then attaches via the inline-attr pass)
        // rather than becoming a <span> of `^x`. Footnote labels hold no
        // nested brackets, so its own regex stays authoritative.
        const mfn = inFootnote || !footnoteStops || text[footnoteStops[i + 2]!] !== ']' ? null : RE_FOOTNOTE_REF.exec(rest)
        if (mfn) {
          flush()
          out.push(session.withPos({ type: 'footnote_ref', label: mfn[1]! } as FootnoteRef, source, text, i, i + mfn[0].length))
          i += mfn[0].length
          continue
        }
        // Inline span `[text]{attrs}` (PART 9 §14). After links so `[t](u)` /
        // `[t][r]` win; the `{` must directly abut `]`. A bracket followed by a
        // VALID attribute block forms a span -- including an empty one (`[x]{}`,
        // `[x]{ }` -> empty <span>, matching djot). An INVALID block (`{???}`,
        // `{=y=}`) is not an attribute block, so it stays literal.
        if (close > 0) {
          const innerText = rest.slice(1, close)
          // A span tail needs a literal `}` ahead; and its `{…}` content must be
          // able to form a valid attribute payload. Skip RE_SPAN_TAIL (which would
          // otherwise scan to a far `}` at every `[` -> O(n^2) on `[x]{[x]{…}`)
          // when no `}` lies ahead or the payload is provably invalid.
          const ms =
            rbraceSuf && rbraceSuf[i + close + 1] && !spanAttrProvablyInvalid(text, i + close + 1, quoteEnd, valueEnd)
              ? RE_SPAN_TAIL.exec(rest.slice(close + 1))
              : null
          if (ms && isValidInlineAttrPayload(ms[1]!)) {
            flush()
            out.push(
              session.withPos(
                {
                  type: 'span',
                  // A BRACKETED LABEL IS A HOST - see `scanLinkLabel`.
                  children: session.scanInline(
                    innerText, session.shiftSource(source, text, i + 1), inFootnote, false, NO_OPEN_KINDS, true,
                  ),
                  attrs: parseAttrs(ms[1]!),
                } as Span,
                source,
                text,
                i,
                i + close + 1 + ms[0].length,
              ),
            )
            i += close + 1 + ms[0].length
            continue
          }
        }
      }

      // Inline extension :type[content]{attrs}
      if (c === ':') {
        const m = rbracketSuf?.[i] ? RE_EXTENSION.exec(rest) : null
        if (m) {
          const attrsStart = i + m[0].length
          const attrs = text[attrsStart] === '{' && rbraceSuf?.[attrsStart] && !spanAttrProvablyInvalid(text, attrsStart, quoteEnd, valueEnd)
            ? RE_INLINE_ATTR.exec(text.slice(attrsStart)) : null
          if (attrs) { m[0] += attrs[0]; m[3] = attrs[1]! }
          flush()
          const ext: Extension = {
            type: 'inline_extension',
            name: m[1]!,
            content: session.scanInline(
              m[2]!, session.shiftSource(source, text, i + m[0].indexOf('[') + 1), inFootnote,
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
          out.push(session.withPos(ext, source, text, i, i + consumed))
          i += consumed
          continue
        }
        // Symbol shortcode `:name:` (after extension, which needs `[`).
        const sym = symbolOpensAt(text, i) ? RE_SYMBOL.exec(rest) : null
        if (sym) {
          flush()
          out.push(session.withPos({ type: 'symbol', name: sym[1]! } as SymbolInline, source, text, i, i + sym[0].length))
          i += sym[0].length
          continue
        }
      }

      // Autolink <url>
      if (c === '<') {
        let cr: RegExpExecArray | null = null
        if (text.startsWith('</#', i)) {
          crossrefMemo ??= { lastCloser: text.lastIndexOf('>') }
          if (crossrefBodyCanEnd(text, i + 3, crossrefMemo)) cr = RE_CROSSREF.exec(rest)
        }
        if (cr) {
          flush()
          const cref: CrossRef = { type: 'heading_ref', target: cr[1]! }
          out.push(session.withPos(cref, source, text, i, i + cr[0].length))
          i += cr[0].length
          continue
        }
        const m = RE_AUTOLINK.exec(rest)
        if (m) {
          flush()
          const href = m[1]!
          const auto: AutoLink = {
            type: 'autolink',
            href: href.includes('@') && !href.includes(':') ? `mailto:${href}` : href,
            // Display is the raw `<...>` content: a URI autolink keeps its scheme
            // (`<mailto:a@b>` -> `mailto:a@b`), an email autolink shows the address.
            text: href,
          }
          let consumed = m[0].length
          // Optional trailing {attrs} (djot): `<url>{.c}`. An explicit
          // `href` in the block is ignored -- the structural href wins
          // (djot + carve-php), so it never produces a duplicate attribute.
          // An invalid payload (`{2=v}`) is literal (§14), not an
          // attribute block -- leave it for normal text processing.
          const am = text[i + consumed] === '{' && !spanAttrProvablyInvalid(text, i + consumed, quoteEnd, valueEnd)
            ? /^\{([^}\n]+)\}/.exec(text.slice(i + consumed)) : null
          if (am && isValidInlineAttrPayload(am[1]!)) {
            const attrs = parseAttrs(am[1]!)
            if (!isEmptyAttrs(attrs)) {
              // A real attribute block: consume it (so it is not
              // re-processed). Drop a structural `href` so it never
              // duplicates the autolink's own href (djot + carve-php).
              if (attrs.keyValues?.href !== undefined) {
                delete attrs.keyValues.href
                if (attrs.order) attrs.order = attrs.order.filter((s) => s !== 'href')
              }
              if (!isEmptyAttrs(attrs)) auto.attrs = attrs
              consumed += am[0].length
            }
          }
          out.push(session.withPos(auto, source, text, i, i + consumed))
          i += consumed
          continue
        }
      }

      // CriticMarkup family
      if (c === '{') {
        // Each `{…}` tail regex requires its own literal close (`}`, `+}`, `-}`);
        // skip it when that delimiter is absent from the rest of the input, which
        // would otherwise force a backtrack to EOF at every `{` (quadratic on
        // runs like `{+`×n or `{~`×n). O(1) suffix lookups; output-identical.
        const hasBrace = !!(rbraceSuf && rbraceSuf[i])
        const inlineEnd = bracketRuns.at(-1)?.close ?? text.length
        const sub = hasBrace ? session.substitutionAt(text, i) : null
        if (sub && sub.end <= inlineEnd) {
          flush()
          out.push(
            session.withPos(
              {
                type: 'substitution',
                old: session.scanInline(text.slice(i + 2, sub.arrow), session.shiftSource(source, text, i + 2), inFootnote),
                new: session.scanInline(text.slice(sub.arrow + 2, sub.end - 2), session.shiftSource(source, text, sub.arrow + 2), inFootnote),
              } as CriticSubstitute,
              source,
              text,
              i,
              sub.end,
            ),
          )
          i = sub.end
          continue
        }
        // A pair opened inside a bracket run must close inside that run.
        const ins = insSuf && insSuf[i] && text[i + 1] === '+' ? session.criticPairEnd(text, i, '+}') : -1
        if (ins !== -1 && ins <= inlineEnd) {
          flush()
          out.push(session.withPos({ type: 'insert', children: session.scanInline(text.slice(i + 2, ins - 2), session.shiftSource(source, text, i + 2), inFootnote) } as CriticInsert, source, text, i, ins))
          i = ins
          continue
        }
        const del = delSuf && delSuf[i] && text[i + 1] === '-' ? session.criticPairEnd(text, i, '-}') : -1
        if (del !== -1 && del <= inlineEnd) {
          flush()
          out.push(session.withPos({ type: 'delete', children: session.scanInline(text.slice(i + 2, del - 2), session.shiftSource(source, text, i + 2), inFootnote) } as CriticDelete, source, text, i, del))
          i = del
          continue
        }
        if (hasBrace && RE_BRACED_EN_DASH.test(rest)) {
          // The SAME node the bare run produces, carrying the authored spelling
          // in `value` - so the AST says "an en dash was written here" rather
          // than holding a glyph in a text run, and `fmt` writes `{--}` back
          // instead of the literal character. PART 12's vocabulary already has
          // the kind; the braced form is a second spelling of it, not a second
          // construct.
          flush()
          out.push(
            session.withPos(
              { type: 'smart_punctuation', kind: 'en_dash', value: '{--}' } as SmartPunctuation,
              source,
              text,
              i,
              i + 4,
            ),
          )
          i += 4
          continue
        }
        // Inline attribute block — attaches to preceding node. It must be GLUED:
        // a non-empty `buf` means unflushed text (e.g. a space) sits between the
        // preceding node and the `{`, so the block is NOT attached -- it stays
        // literal text (`<url> {.x}` keeps `{.x}`). Matches carve-php / carve-rs.
        const attr = !buf && hasBrace && !spanAttrProvablyInvalid(text, i, quoteEnd, valueEnd) ? RE_INLINE_ATTR.exec(rest) : null
        // A digit-leading key or otherwise invalid payload (`{2=v}`) makes the
        // whole block literal (§14), same strict rule as block/span attrs — so
        // `` `code`{#1a} `` keeps the braces rather than parsing a bogus attr.
        if (attr && out.length && isValidInlineAttrPayload(attr[1]!)) {
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
          if (!ATTR_INERT_PREV.has(prev.type) && !isEmptyAttrs(parsed)) {
            ;(prev as { attrs?: Attrs }).attrs = accumulateAttrs(
              (prev as { attrs?: Attrs }).attrs,
              parsed,
            )
            // A TRAILING ATTRIBUTE BLOCK IS THE NODE'S OWN MARKUP (PART 12 §4,
            // carve#521), so the span covers it: `*x*{#i}` gives the `strong`
            // offsets 0..7, not 0..3. The braces are where the node's `attrs`
            // came from, and a span stopping at `*x*` says the node ends before
            // the markup that gave it half its content -- the same reading that
            // already puts a break's backslash inside the break.
            session.extendPosTo(prev, source, text, i + attr[0].length)
            i += attr[0].length
            continue
          }
        }
        const criticClose = text[i + 1] === '#' && criticCmtSuf?.[i] && !extendsGrapheme(text, i + 2) ? text.indexOf('#}', i + 2) : -1
        if (criticClose > i + 2) {
          flush()
          out.push(session.withPos({ type: 'critic_comment', text: text.slice(i + 2, criticClose) } as CriticComment, source, text, i, criticClose + 2))
          i = criticClose + 2
          continue
        }
        // Forced intraword emphasis `{X…X}` (§22) — emits the same node as the
        // bare delimiter, but with no word-boundary condition.
        const delim = text[i + 1]
        const forced = hasBrace && delim !== undefined && FORCED_TYPE[delim] !== undefined && !splitBracedOpener(text, i)
          ? session.bracedPairEnd(text, i, `${delim}}`)
          : -1
        if (forced !== -1 && forced <= inlineEnd) {
          flush()
          if (helpers.inlineDepth >= MAX_NESTING_DEPTH) {
            out.push(session.withPos({ type: 'text', value: text.slice(i, forced) } as Text, source, text, i, forced))
            i = forced
            continue
          }
          const pairs = session.pairEndText === text ? session.pairView(i + 2) : undefined
          out.push(session.withPos({ type: FORCED_TYPE[delim!]!, children: session.plainInlineWord(text, i + 2, forced - 2, source) ?? session.scanInline(text.slice(i + 2, forced - 2), session.shiftSource(source, text, i + 2), inFootnote, false, new Set([delim!]), false, false, pairs) } as Emphasis, source, text, i, forced))
          i = forced
          continue
        }

      }

      // Mention
      if (c === '@' && (i === 0 || !/[A-Za-z0-9_]/.test(text[i - 1]!))) {
        const m = RE_MENTION.exec(rest)
        if (m) {
          flush()
          out.push(session.withPos({ type: 'mention', user: m[1]! } as Mention, source, text, i, i + m[0].length))
          i += m[0].length
          continue
        }
      }
      // Tag
      if (c === '#') {
        const m = RE_TAG.exec(rest)
        const tagBoundary = i === 0 || !/[A-Za-z0-9_]/.test(text[i - 1]!)
        if (m && tagBoundary) {
          flush()
          out.push(session.withPos({ type: 'tag', name: m[1]! } as Tag, source, text, i, i + m[0].length))
          i += m[0].length
          continue
        }
        // Bare `#` (not a tag) in a caption = number placeholder, first only.
        // `\#` never reaches here (the escape branch consumes it as literal).
        if (!m && captionContext && !captionNumberEmitted) {
          flush()
          out.push(session.withPos({ type: 'caption_number' } as CaptionNumber, source, text, i, i + 1))
          captionNumberEmitted = true
          i += 1
          continue
        }
      }

      // Emphasis-family delimiters
      const em = session.matchEmphasis(text, i, source, inFootnote, emphasisNoClose, bracketRuns.at(-1)?.close ?? text.length)
      if (em) {
        flush()
        const node = helpers.inlineDepth >= MAX_NESTING_DEPTH ? { type: 'text', value: text.slice(i, em.end) } as Text : em.node
        out.push(session.withPos(node, source, text, i, em.end))
        i = em.end
        continue
      }

      // Soft break (single newline inside paragraph)
      if (c === '\n') {
        flush()
        out.push(session.withPos({ type: 'soft_break' }, source, text, i, i + 1))
        i++
        continue
      }

      // Extension inline matchers run only here, where every core construct has
      // declined position i: extensions add syntax, they never hijack core.
      if (session.activeMatchers.length) {
        const xm = session.tryInlineMatchers(text, i)
        if (xm) {
          flush()
          const node = session.withPos(xm.node, source, text, i, xm.end)
          if (node.type === 'citation_group') session.positionCitationItems(node, source, text, i)
          out.push(node)
          i = xm.end
          continue
        }
      }

      append(c)
      i++
    }
    flush()
    return out
  }

}
