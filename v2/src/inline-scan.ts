// The inline pass over one content (C2-I-004): the scan with its atoms and the bracket stack,
// then the delimiter stack, then the events with the attached attribute blocks.
import {
  AT_SIGN, BACKSLASH, BACKTICK, BANG, BRACE_OPEN, BRACKET_CLOSE, BRACKET_OPEN, CARET, COLON, DOLLAR, HASH, LESS, LF,
  PERCENT, SPACE,
} from './chars.ts'
import {
  scanAtSign, scanBackslash, scanBacktick, scanBrace, scanColon, scanDollar, scanHash, scanLess, scanLineBreak,
  scanLiteralSpan, scanPercent,
} from './inline-atoms.ts'
import {
  failOpenBrackets, openBracket, scanBracketClose, scanBracketOpen, scanFootnoteOpen, scanImageOpen,
} from './inline-brackets.ts'
import { pairDelimiters, scanBareMark, scanBracedMark } from './inline-delimiters.ts'
import { writeEvents } from './inline-emit.ts'
import { type InlineState, NONE, setContent } from './inline-state.ts'
import { BARE_MARKS, BRACED_MARKS, CHARACTER_CLASSES, CLASS_SMART_TRIGGER } from './inline-tables.ts'
import { isSpaceOrTab } from './source.ts'
import { BIDI_FIRST, BIDI_LAST, holdsBidiControl, isBidiControl } from './unicode.ts'

type Scanner = (state: InlineState, pos: number) => number

const ASCII = 128

function scanBang(state: InlineState, pos: number): number {
  const next = pos + 1 < state.end ? state.text.charCodeAt(pos + 1) : NONE
  if (next === BACKTICK) return scanLiteralSpan(state, pos)
  return next === BRACKET_OPEN ? scanImageOpen(state, pos) : pos + 1
}

function scanCaret(state: InlineState, pos: number): number {
  if (pos + 1 < state.end && state.text.charCodeAt(pos + 1) === BRACKET_OPEN) return scanFootnoteOpen(state, pos)
  return scanBracedMark(state, pos)
}

function scanSigilColon(state: InlineState, pos: number): number {
  return scanColon(state, pos, openBracket)
}

/** The scanner of each ASCII character that can start a token. Every other character is text. */
function scanners(): readonly (Scanner | undefined)[] {
  const table = new Array<Scanner | undefined>(ASCII).fill(undefined)
  for (const mark of BRACED_MARKS) table[mark.charCodeAt(0)] = scanBracedMark
  for (const mark of BARE_MARKS) table[mark.charCodeAt(0)] = scanBareMark
  table[BACKSLASH] = scanBackslash
  table[LF] = scanLineBreak
  table[BACKTICK] = scanBacktick
  table[BANG] = scanBang
  table[DOLLAR] = scanDollar
  table[LESS] = scanLess
  table[PERCENT] = scanPercent
  table[BRACE_OPEN] = scanBrace
  table[AT_SIGN] = scanAtSign
  table[HASH] = scanHash
  table[COLON] = scanSigilColon
  table[BRACKET_OPEN] = scanBracketOpen
  table[BRACKET_CLOSE] = scanBracketClose
  table[CARET] = scanCaret
  return table
}

const SCANNERS = scanners()
// Whether a character has a scanner, as bytes: the scan asks this once per character of text.
const STARTS_TOKEN = Uint8Array.from(SCANNERS, (scanner) => (scanner === undefined ? 0 : 1))
// Whether a character is text wherever it stands: it starts no token and no smart punctuation.
const ALWAYS_TEXT = Uint8Array.from(STARTS_TOKEN, (starts, code) => {
  const smart = (CHARACTER_CLASSES[code]! & CLASS_SMART_TRIGGER) !== 0
  return starts === 0 && !smart ? 1 : 0
})

/**
 * True when `src[start, end)`, one line, is one run of text for the inline pass: ASCII characters
 * that are text wherever they stand, with no space or tab at either end (C2-I-002). Such a content
 * needs no pass, and half of the contents of an ordinary document are of this kind.
 */
export function isPlainText(src: string, start: number, end: number): boolean {
  if (start >= end || isSpaceOrTab(src.charCodeAt(start)) || isSpaceOrTab(src.charCodeAt(end - 1))) return false
  for (let pos = start; pos < end; pos++) {
    const code = src.charCodeAt(pos)
    if (code >= ASCII || ALWAYS_TEXT[code] === 0) return false
  }
  return true
}

function resetScan(state: InlineState): void {
  state.tokenLength = 0
  state.tokenEnd = 0
  state.bracketDepth = 0
  state.commentCloserMissing = false
  state.editorialCloserMissing = false
  state.labelCloserMissing = false
  state.xrefFailEnd = NONE
  state.doubleQuoteFailEnd = NONE
  state.singleQuoteFailEnd = NONE
  state.valueFailEnd = NONE
  state.tailStart = NONE
  state.tailEnd = NONE
}

/**
 * C2-I-002: spaces and tabs at the end of the content are not part of it, but a space that a
 * backslash escapes is (C2-I-011). A backslash escapes when an even number of backslashes stands before it.
 */
function contentEnd(text: string): number {
  let end = text.length
  while (end > 0 && isSpaceOrTab(text.charCodeAt(end - 1))) end--
  if (end === text.length || text.charCodeAt(end) !== SPACE) return end
  let first = end
  while (first > 0 && text.charCodeAt(first - 1) === BACKSLASH) first--
  return (end - first) % 2 === 1 ? end + 1 : end
}

/**
 * Reads the inline content of the source spans `spans[from..to)` (start and end pairs) and
 * leaves its events in the state. `baseDepth` is the number of open containers around the
 * content (C2-I-118). A line block reads no line comment (C2-B-144).
 */
export function scanInline(
  state: InlineState, src: string, spans: ArrayLike<number>, from: number, to: number, baseDepth: number, lineComments: boolean,
): void {
  setContent(state, src, spans, from, to)
  const text = state.text
  const end = contentEnd(text)
  state.end = end
  state.baseDepth = baseDepth
  state.lineComments = lineComments
  resetScan(state)
  for (let pos = 0; pos < end;) {
    const code = text.charCodeAt(pos)
    if (code >= ASCII) {
      if (code >= BIDI_FIRST && code <= BIDI_LAST && isBidiControl(code)) state.bidi = true
      pos++
    } else if (STARTS_TOKEN[code] === 1) {
      const next = SCANNERS[code]!(state, pos)
      // C2-H-172: what a scanner stepped over can still end up as text.
      if (next > pos + 1 && !state.bidi) state.bidi = holdsBidiControl(text, pos + 1, next)
      pos = next
    } else {
      pos++
    }
  }
  failOpenBrackets(state)
  pairDelimiters(state)
  writeEvents(state)
}
