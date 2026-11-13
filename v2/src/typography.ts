// Smart typography (C2-I-104 to C2-I-117). It reads the text that the scan left as text and
// writes a text span for each plain stretch and a SMART node for each match.
import { APOSTROPHE, GREATER, HYPHEN, PAREN_OPEN, QUOTE_MARK, SLASH } from './chars.ts'
import { ENTER, eventTag, EXIT, SPAN } from './events.ts'
import { characterAfter } from './inline-atoms.ts'
import { SMART } from './inline-kinds.ts'
import { type InlineState, writeInlineEvent } from './inline-state.ts'
import {
  APOSTROPHE_WORDS, CHARACTER_CLASSES, CLASS_QUOTE_CLOSES_BEFORE, CLASS_QUOTE_OPENS_AFTER, CLASS_SMART_TRIGGER,
  SMART_EM_DASH, SMART_EN_DASH, SMART_GLYPHS, SMART_LEFT_DOUBLE_QUOTE, SMART_LEFT_SINGLE_QUOTE,
  SMART_RIGHT_DOUBLE_QUOTE, SMART_RIGHT_SINGLE_QUOTE, SMART_RIGHTWARDS_ARROW, SMART_RUNS,
} from './inline-tables.ts'
import {
  codePointAt, codePointBefore, isAsciiDigit, isAsciiLetter, isBoundarySpace, isLetter, isWordCharacter, NO_CHARACTER,
} from './unicode.ts'

const ASCII = 128
const EN_DASH = 0x2013
const EM_DASH = 0x2014
const LEFT_SINGLE = 0x2018
const LEFT_DOUBLE = 0x201c
const LONGEST_WORD = 6
const NO_MATCH = -1
// Whether a character can start a match, as bytes: the text is asked this once per character.
const TRIGGERS = Uint8Array.from(CHARACTER_CLASSES, (classes) => ((classes & CLASS_SMART_TRIGGER) === 0 ? 0 : 1))

/** Offset in the source of the offset `pos` of the content. Offsets are asked for in rising order. */
export function toSource(state: InlineState, pos: number): number {
  let line = state.line
  while (line + 1 < state.lineCount && state.lineText[line + 1]! <= pos) line++
  while (line > 0 && state.lineText[line]! > pos) line--
  state.line = line
  return state.lineSource[line]! + pos - state.lineText[line]!
}

function inClass(code: number, mask: number): boolean {
  return code >= 0 && code < ASCII && (CHARACTER_CLASSES[code]! & mask) !== 0
}

function isDash(code: number): boolean {
  return code === HYPHEN || code === EN_DASH || code === EM_DASH
}

/** The character before `pos` in the text stretch that starts at `from`; before `from` it is the state's. */
function before(state: InlineState, pos: number, from: number): number {
  return pos > from ? codePointBefore(state.text, pos) : state.previous
}

function beforeFollowsSpace(state: InlineState, pos: number, from: number): boolean {
  if (pos > from + 1) return isBoundarySpace(state.text.charCodeAt(pos - 2))
  return pos === from + 1 ? isBoundarySpace(state.previous) : state.previousAfterSpace
}

/** The character at `pos`, or behind the text stretch when it ends at `to`. */
function after(state: InlineState, pos: number, to: number): number {
  return pos < to ? codePointAt(state.text, pos, to) : characterAfter(state, to)
}

/** C2-I-104, C2-I-106: whether a straight quote after `previous` and before `next` opens. */
function quoteOpens(previous: number, next: number): boolean {
  if (isBoundarySpace(previous) || previous === LEFT_SINGLE || previous === LEFT_DOUBLE) return true
  if (!isDash(previous) && !inClass(previous, CLASS_QUOTE_OPENS_AFTER)) return false
  if (!isDash(previous) && previous !== SLASH) return true
  return !isBoundarySpace(next) && !inClass(next, CLASS_QUOTE_CLOSES_BEFORE)
}

/** C2-I-107: the length of the apostrophe word that starts at `pos`, or 0. The word ends where its letters end. */
function apostropheWord(text: string, pos: number, end: number): number {
  let p = pos
  while (p < end && p - pos <= LONGEST_WORD && isAsciiLetter(text.charCodeAt(p))) p++
  if (p === pos || isLetter(codePointAt(text, p, end))) return 0
  return APOSTROPHE_WORDS.includes(text.slice(pos, p).toLowerCase()) ? p - pos : 0
}

/** C2-I-105 to C2-I-109: the kind of the single quote at `pos`. */
function singleQuote(state: InlineState, pos: number, previous: number, next: number): number {
  const text = state.text
  if (isAsciiDigit(next)) return SMART_RIGHT_SINGLE_QUOTE
  if (!quoteOpens(previous, next)) {
    // C2-I-109: a closing quote that is not inside a word ends the run.
    if (!isWordCharacter(previous) || !isWordCharacter(next)) state.singleQuoteOpen = false
    return SMART_RIGHT_SINGLE_QUOTE
  }
  const word = apostropheWord(text, pos + 1, state.end)
  if (word > 0) {
    // C2-I-108: the word is quoted when a single quote and then no letter and no number follow it.
    const closer = pos + 1 + word
    if (text.charCodeAt(closer) !== APOSTROPHE || isWordCharacter(codePointAt(text, closer + 1, state.end))) return SMART_RIGHT_SINGLE_QUOTE
  } else if (state.singleQuoteOpen && isWordCharacter(next)) {
    return SMART_RIGHT_SINGLE_QUOTE
  }
  state.singleQuoteOpen = true
  return SMART_LEFT_SINGLE_QUOTE
}

function writeSmart(state: InlineState, start: number, end: number, kind: number): void {
  writeInlineEvent(state, eventTag(ENTER, SMART, 0), toSource(state, start), kind)
  writeInlineEvent(state, eventTag(EXIT, SMART, 0), toSource(state, end), 0)
}

/** C2-I-111: the dashes of a run of `length` hyphens at `pos`. */
function writeDashes(state: InlineState, pos: number, length: number): void {
  while (length > 0) {
    const em = length % 3 === 0 || length % 2 !== 0
    const size = em ? 3 : 2
    state.smartKind = em ? SMART_EM_DASH : SMART_EN_DASH
    writeSmart(state, pos, pos + size, state.smartKind)
    pos += size
    length -= size
  }
}

/** C2-I-112: a hyphen run after whitespace, or after `(` or a quote that follows whitespace, and before no whitespace. */
function isFlag(state: InlineState, pos: number, from: number, next: number): boolean {
  if (isBoundarySpace(next)) return false
  const previous = before(state, pos, from)
  if (isBoundarySpace(previous)) return true
  const opener = previous === PAREN_OPEN || previous === QUOTE_MARK || previous === APOSTROPHE || previous === LEFT_SINGLE || previous === LEFT_DOUBLE
  return opener && beforeFollowsSpace(state, pos, from)
}

/**
 * The hyphen run at `pos`. Returns the offset behind what was written, `pos` when the run stays
 * as typed, and sets `state.textRun` behind a flag so that its hyphens are not read again.
 */
function hyphens(state: InlineState, pos: number, from: number, to: number): number {
  const text = state.text
  let end = pos
  while (end < to && text.charCodeAt(end) === HYPHEN) end++
  const length = end - pos
  // C2-I-116: an arrow needs its exact run.
  if (length === 2 && end < to && text.charCodeAt(end) === GREATER) {
    flushSpan(state, pos)
    writeSmart(state, pos, end + 1, SMART_RIGHTWARDS_ARROW)
    state.smartKind = SMART_RIGHTWARDS_ARROW
    return end + 1
  }
  if (length < 2 || isFlag(state, pos, from, after(state, end, to))) return -end
  flushSpan(state, pos)
  writeDashes(state, pos, length)
  return end
}

/** C2-I-115, C2-I-117: the longest replaced run at `pos`, as an index into SMART_RUNS, or NO_MATCH. */
function runAt(text: string, pos: number, to: number): number {
  for (let index = 0; index < SMART_RUNS.length; index++) {
    const source = SMART_RUNS[index]![0]
    const end = pos + source.length
    if (end > to || source.charCodeAt(0) === HYPHEN || !text.startsWith(source, pos)) continue
    // C2-I-116: a longer hyphen run next to `<` is a dash run.
    if (source.charCodeAt(source.length - 1) === HYPHEN && end < to && text.charCodeAt(end) === HYPHEN) continue
    return index
  }
  return NO_MATCH
}

function flushSpan(state: InlineState, end: number): void {
  if (end > state.textRun) writeInlineEvent(state, eventTag(SPAN, 0, 0), toSource(state, state.textRun), toSource(state, end))
  state.textRun = end
}

function quote(state: InlineState, pos: number, from: number, to: number, code: number): number {
  const previous = before(state, pos, from)
  const next = after(state, pos + 1, to)
  let kind = quoteOpens(previous, next) ? SMART_LEFT_DOUBLE_QUOTE : SMART_RIGHT_DOUBLE_QUOTE
  if (code === APOSTROPHE) kind = singleQuote(state, pos, previous, next)
  flushSpan(state, pos)
  writeSmart(state, pos, pos + 1, kind)
  state.smartKind = kind
  return pos + 1
}

/**
 * The match at the trigger character at `pos`. Returns the offset behind the match when nodes
 * were written, `pos` when there is none, and a negative offset behind text to skip.
 */
function smartAt(state: InlineState, pos: number, from: number, to: number): number {
  const text = state.text
  const code = text.charCodeAt(pos)
  if (code === QUOTE_MARK || code === APOSTROPHE) return quote(state, pos, from, to, code)
  if (code === HYPHEN) return hyphens(state, pos, from, to)
  const run = runAt(text, pos, to)
  if (run === NO_MATCH) return pos
  const [source, kind] = SMART_RUNS[run]!
  flushSpan(state, pos)
  writeSmart(state, pos, pos + source.length, kind)
  state.smartKind = kind
  return pos + source.length
}

/** Sets what the next quote or hyphen run sees before it, after a node was written up to `pos`. */
function afterSmart(state: InlineState, pos: number, from: number, start: number): void {
  state.previousAfterSpace = isBoundarySpace(before(state, start, from))
  state.previous = SMART_GLYPHS[state.smartKind]!.codePointAt(0)!
  state.textRun = pos
}

/** Writes the text `[from, to)` of the content, with its smart punctuation. */
export function writeText(state: InlineState, from: number, to: number): void {
  if (from >= to) return
  const text = state.text
  state.textRun = from
  let start = from
  for (let pos = from; pos < to;) {
    const code = text.charCodeAt(pos)
    if (code >= ASCII || TRIGGERS[code] === 0) {
      pos++
      continue
    }
    const end = smartAt(state, pos, start, to)
    if (end > pos) {
      afterSmart(state, end, start, pos)
      start = end
    }
    pos = end > pos ? end : Math.max(pos + 1, -end)
  }
  if (to > state.textRun) {
    state.previousAfterSpace = beforeFollowsSpace(state, to, start)
    state.previous = codePointBefore(text, to)
    flushSpan(state, to)
  }
}

/** Sets the typography state as it is at the start of a content, or of the content of a node. */
export function startOfContent(state: InlineState): void {
  state.previous = NO_CHARACTER
  state.previousAfterSpace = true
}
