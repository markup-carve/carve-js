// The last step of the inline pass: writes the events of a content from its tokens, attaches
// attribute blocks to their hosts (C2-I-009) and runs smart typography over the text.
import { BRACE_CLOSE, LF, LOWER_A, SPACE } from './chars.ts'
import { ENTER, eventTag, EXIT, SPAN } from './events.ts'
import {
  ATTRIBUTE_BLOCK, BRACED_KINDS, BRACKET_SPAN, DESTINATION, EMPHASIS, ESCAPE, FLAG_BRACED, FLAG_COLLAPSED,
  FLAG_REFERENCE, HARD_BREAK, IMAGE, INLINE_COMMENT, INLINE_EXTENSION, INLINE_FOOTNOTE, isHost, LABEL, NBSP,
  RAW_INLINE, SMART, SOFT_BREAK, STRONG, TITLE,
} from './inline-kinds.ts'
import {
  type InlineState, NONE, TOKEN_A, TOKEN_B, TOKEN_BRACED_OPEN, TOKEN_C, TOKEN_CLOSE, TOKEN_D, TOKEN_DELIMITER,
  TOKEN_END, TOKEN_LITERAL, TOKEN_OPEN, TOKEN_START, TOKEN_TAIL, TOKEN_TEXT, TOKEN_WIDTH, writeInlineEvent,
} from './inline-state.ts'
import { BARE_MARKS, BRACED_MARKS, SMART_GLYPHS } from './inline-tables.ts'
import { startOfContent, toSource, writeText } from './typography.ts'

const SLASH_MARK = BRACED_MARKS.indexOf(BARE_MARKS[0]!)
const NO_BREAK_SPACE = 0xa0
const MAX_FOOTNOTES = 256

/** Writes `[start, end)` of the content as source spans, one per line. */
function writePieces(state: InlineState, start: number, end: number): void {
  const text = state.text
  while (start < end) {
    let lineEnd = text.indexOf('\n', start)
    if (lineEnd < 0 || lineEnd > end) lineEnd = end
    if (lineEnd > start) writeInlineEvent(state, eventTag(SPAN, 0, 0), toSource(state, start), toSource(state, lineEnd))
    start = lineEnd + 1
  }
}

/** A node with no inline children: its payload is `[from, to)`, or nothing when `from` is NONE. */
function writeLeaf(state: InlineState, kind: number, flags: number, start: number, aux: number, from: number, to: number, end: number): void {
  writeInlineEvent(state, eventTag(ENTER, kind, flags), toSource(state, start), aux)
  if (from !== NONE) writePieces(state, from, to)
  writeInlineEvent(state, eventTag(EXIT, kind, 0), toSource(state, end), 0)
}

/** What a quote or a hyphen run sees before it, after a closed node (C2-I-104): a word character. */
function afterNode(state: InlineState): void {
  state.previous = LOWER_A
  state.previousAfterSpace = false
}

/**
 * C2-I-036, C2-I-039: writes the attribute blocks glued at `end` to a host, from the token `at` on,
 * then the exit of the host. Returns the token behind them and leaves the end of the host in `textRun`.
 */
function closeHost(state: InlineState, at: number, kind: number, end: number): number {
  const tokens = state.tokens
  while (isHost(kind) && at < state.tokenLength && tokens[at] === ATTRIBUTE_BLOCK && tokens[at + TOKEN_START] === end) {
    end = tokens[at + TOKEN_END]!
    writeLeaf(state, ATTRIBUTE_BLOCK, 0, tokens[at + TOKEN_START]!, 0, NONE, NONE, end)
    at += TOKEN_WIDTH
  }
  writeInlineEvent(state, eventTag(EXIT, kind, 0), toSource(state, end), 0)
  state.textRun = end
  afterNode(state)
  return at
}

/** C2-I-066, C2-I-068: the destination and the title of a link tail. */
function writeTail(state: InlineState, at: number): void {
  const tokens = state.tokens
  const text = state.text
  const destinationEnd = tokens[at + TOKEN_B]!
  writeLeaf(state, DESTINATION, 0, tokens[at + TOKEN_A]!, 0, tokens[at + TOKEN_A]!, destinationEnd, destinationEnd)
  const title = tokens[at + TOKEN_C]!
  if (title === NONE) return
  let end = tokens[at + TOKEN_END]! - 1
  while (text.charCodeAt(end - 1) === SPACE) end--
  writeLeaf(state, TITLE, 0, title, 0, title + 1, end - 1, end)
}

/** The node kind of a paired delimiter token. */
function delimiterKind(state: InlineState, at: number): number {
  const mark = state.tokens[at + TOKEN_A]!
  if (state.tokens[at] !== TOKEN_DELIMITER) return BRACED_KINDS[mark]!
  return mark === SLASH_MARK ? EMPHASIS : STRONG
}

function writeDelimiter(state: InlineState, at: number): number {
  const tokens = state.tokens
  const partner = tokens[at + TOKEN_B]!
  if (partner > at) {
    const kind = delimiterKind(state, at)
    const flags = tokens[at] === TOKEN_BRACED_OPEN ? FLAG_BRACED : 0
    writeInlineEvent(state, eventTag(ENTER, kind, flags), toSource(state, tokens[at + TOKEN_START]!), 0)
    state.textRun = tokens[at + TOKEN_END]!
    // C2-I-104: the start of a span's content is a start of content.
    startOfContent(state)
    return at + TOKEN_WIDTH
  }
  return closeHost(state, at + TOKEN_WIDTH, delimiterKind(state, partner), tokens[at + TOKEN_END]!)
}

/** The enter flags of a link or an image: whether a label follows its closing bracket (C2-I-072). */
function referenceFlags(state: InlineState, close: number): number {
  const tokens = state.tokens
  const part = close + TOKEN_WIDTH
  if (part >= state.tokenLength || tokens[part] !== LABEL) return 0
  return FLAG_REFERENCE | (tokens[part + TOKEN_C]! & FLAG_COLLAPSED)
}

function writeOpen(state: InlineState, at: number): number {
  const tokens = state.tokens
  const kind = tokens[at + TOKEN_C]!
  const start = toSource(state, tokens[at + TOKEN_START]!)
  const end = tokens[at + TOKEN_END]!
  const aux = kind === INLINE_EXTENSION ? toSource(state, end - 1) : 0
  writeInlineEvent(state, eventTag(ENTER, kind, referenceFlags(state, tokens[at + TOKEN_B]!)), start, aux)
  state.textRun = end
  if (kind === IMAGE) {
    state.textRun = tokens[tokens[at + TOKEN_B]! + TOKEN_START]!
    writePieces(state, end, state.textRun)
    return at + TOKEN_WIDTH
  }
  if (kind === INLINE_FOOTNOTE && state.footnoteDepth < MAX_FOOTNOTES) {
    // C2-I-109: an inline footnote has its own run of single quotes.
    state.footnoteQuotes[state.footnoteDepth++] = state.singleQuoteOpen ? 1 : 0
    state.singleQuoteOpen = false
  }
  startOfContent(state)
  return at + TOKEN_WIDTH
}

function writeClose(state: InlineState, at: number): number {
  const tokens = state.tokens
  const kind = tokens[tokens[at + TOKEN_A]! + TOKEN_C]!
  let end = tokens[at + TOKEN_END]!
  let next = at + TOKEN_WIDTH
  if (kind === INLINE_FOOTNOTE && state.footnoteDepth > 0) state.singleQuoteOpen = state.footnoteQuotes[--state.footnoteDepth] === 1
  if (next < state.tokenLength && (tokens[next] === TOKEN_TAIL || tokens[next] === LABEL) && kind !== BRACKET_SPAN) {
    if (tokens[next] === TOKEN_TAIL) writeTail(state, next)
    else writeLeaf(state, LABEL, 0, tokens[next + TOKEN_START]!, 0, tokens[next + TOKEN_A]!, tokens[next + TOKEN_B]!, tokens[next + TOKEN_END]!)
    end = tokens[next + TOKEN_END]!
    next += TOKEN_WIDTH
  }
  return closeHost(state, next, kind, end)
}

/** What typography sees before it, behind a node with no children. */
function afterAtom(state: InlineState, at: number, kind: number): void {
  const tokens = state.tokens
  state.previousAfterSpace = false
  if (kind === SOFT_BREAK || kind === HARD_BREAK) state.previous = LF
  else if (kind === NBSP) state.previous = NO_BREAK_SPACE
  else if (kind === ESCAPE) state.previous = state.text.charCodeAt(tokens[at + TOKEN_A]!)
  else if (kind === SMART) state.previous = SMART_GLYPHS[tokens[at + TOKEN_D]!]!.codePointAt(0)!
  // C2-I-026: a comment counts as nothing for its neighbors.
  else if (kind !== INLINE_COMMENT) state.previous = LOWER_A
}

function writeAtom(state: InlineState, at: number): number {
  const tokens = state.tokens
  const kind = tokens[at]!
  const start = tokens[at + TOKEN_START]!
  const end = tokens[at + TOKEN_END]!
  if (kind === ATTRIBUTE_BLOCK || kind === TOKEN_LITERAL) {
    // C2-I-035: a block that attaches to nothing is printed as written.
    writePieces(state, start, end)
    state.previous = BRACE_CLOSE
    state.previousAfterSpace = false
    state.textRun = end
    return at + TOKEN_WIDTH
  }
  let aux = tokens[at + TOKEN_D]!
  if (kind === RAW_INLINE) aux = toSource(state, aux)
  writeInlineEvent(state, eventTag(ENTER, kind, tokens[at + TOKEN_C]!), toSource(state, start), kind === SMART || kind === RAW_INLINE ? aux : 0)
  if (tokens[at + TOKEN_A] !== NONE) writePieces(state, tokens[at + TOKEN_A]!, tokens[at + TOKEN_B]!)
  const previous = state.previous
  const next = closeHost(state, at + TOKEN_WIDTH, kind, end)
  if (kind === INLINE_COMMENT) state.previous = previous
  else afterAtom(state, at, kind)
  return next
}

function writeToken(state: InlineState, at: number): number {
  const kind = state.tokens[at]!
  if (kind === TOKEN_OPEN) return writeOpen(state, at)
  if (kind === TOKEN_CLOSE) return writeClose(state, at)
  if (kind >= TOKEN_DELIMITER && kind < TOKEN_LITERAL) return writeDelimiter(state, at)
  return writeAtom(state, at)
}

/** Writes the events of the content from its tokens. */
export function writeEvents(state: InlineState): void {
  const tokens = state.tokens
  state.eventLength = 0
  state.line = 0
  state.singleQuoteOpen = false
  state.footnoteDepth = 0
  startOfContent(state)
  let textStart = 0
  for (let at = 0; at < state.tokenLength;) {
    if (tokens[at] === TOKEN_TEXT) {
      at += TOKEN_WIDTH
      continue
    }
    writeText(state, textStart, tokens[at + TOKEN_START]!)
    at = writeToken(state, at)
    textStart = state.textRun
  }
  writeText(state, textStart, state.end)
}
