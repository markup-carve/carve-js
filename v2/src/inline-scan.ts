// The inline pass over one content (C2-I-004): the scan with its atoms and the bracket stack,
// then the delimiter stack, then the events with the attached attribute blocks.
import {
  AT_SIGN, BACKSLASH, BACKTICK, BANG, BRACE_OPEN, BRACKET_CLOSE, BRACKET_OPEN, CARET, COLON, DOLLAR, HASH, LESS, LF,
  PERCENT,
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
import { BARE_MARKS, BRACED_MARKS } from './inline-tables.ts'
import { isSpaceOrTab } from './source.ts'

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
 * Reads the inline content of the source spans `spans[from..to)` (start and end pairs) and
 * leaves its events in the state. `baseDepth` is the number of open containers around the
 * content (C2-I-118). A line block reads no line comment (C2-B-144).
 */
export function scanInline(
  state: InlineState, src: string, spans: ArrayLike<number>, from: number, to: number, baseDepth: number, lineComments: boolean,
): void {
  setContent(state, src, spans, from, to)
  const text = state.text
  let end = text.length
  while (end > 0 && isSpaceOrTab(text.charCodeAt(end - 1))) end--
  state.end = end
  state.baseDepth = baseDepth
  state.lineComments = lineComments
  resetScan(state)
  for (let pos = 0; pos < end;) {
    const code = text.charCodeAt(pos)
    const scanner = code < ASCII ? SCANNERS[code] : undefined
    pos = scanner === undefined ? pos + 1 : scanner(state, pos)
  }
  failOpenBrackets(state)
  pairDelimiters(state)
  writeEvents(state)
}
