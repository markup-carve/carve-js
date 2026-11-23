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
import {
  type InlineState, NONE, OPEN_FOOTNOTE, OPEN_IMAGE, setContent, TOKEN_A, TOKEN_B, TOKEN_C, TOKEN_OPEN, TOKEN_START, TOKEN_WIDTH,
} from './inline-state.ts'
import { IMAGE, INLINE_FOOTNOTE } from './inline-kinds.ts'
import { BARE_MARKS, BRACED_MARKS, CHARACTER_CLASSES, CLASS_SMART_TRIGGER } from './inline-tables.ts'
import { isSpaceOrTab } from './source.ts'
import { TextNotes } from './text-notes.ts'
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
  if (state.codeRuns !== null) {
    state.codeRuns = null
    state.codeRunCursors.clear()
  }
  state.codeRunEnd = 0
  state.tokenLength = 0
  state.tokenEnd = 0
  state.bracketDepth = 0
  state.notesOpen = 0
  state.swallowedNotes.length = 0
  state.closedNotesOpen = 0
  state.probesOpen = 0
  state.ownReads.stop()
  state.depthLength = 0
  state.depthLive = 0
  state.depthFloor = NONE
  state.depthLastSlash = NONE
  state.depthLastStar = NONE
  state.commentCloserMissingFrom = NONE
  state.editorialCloserMissingFrom = NONE
  state.labelCloserMissingFrom = NONE
  state.xrefFailEnd = NONE
  state.doubleQuoteFailEnd = NONE
  state.singleQuoteFailEnd = NONE
  state.valueFailEnd = NONE
  state.tailStart = NONE
  state.tailEnd = NONE
}

function scanPass(state: InlineState): void {
  const text = state.text
  const end = state.end
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
}

// A note whose closing depends on how a caret pair in it reads has no reading; this bounds the passes such notes take.
const MAX_NOTE_PASSES = 8

/**
 * Keeps the notes of the last pass that closed again, and returns whether that changed the set. One that opened and no
 * longer closes closed only because a caret pair in it opened, so it is text from now on (C2-I-089). One whose `^[` an
 * enclosing note swallowed was not read on its own, so it keeps its place until a pass opens it, unless `settle` holds
 * and `settlesSwallowed` decides it already. One that first closes in the last pass joins them.
 */
function narrowsNotes(state: InlineState, closed: Map<number, number>, opened: Set<number>, settle: boolean): boolean {
  const before = state.closedNotes
  if (before === null) {
    state.closedNotes = closed
    return true
  }
  let changed = false
  for (const [start, end] of before) {
    if (closed.has(start) || !opened.has(start)) continue
    before.delete(start)
    ;(state.textNotes ??= new TextNotes()).add(start, end)
    changed = true
  }
  // A note that first closes in this pass closes too: a caret pair inside it opens nothing in the next.
  for (const [start, end] of closed) {
    if (before.has(start)) continue
    before.set(start, end)
    changed = true
  }
  const settled = settle && settlesSwallowed(state, before)
  return changed || settled
}

/**
 * Makes text every swallowed note of `candidates` that stands outside every note that is text and whose bracket stayed
 * open to the end of the pass, and returns whether there was one. Behind its `^[` every caret pair was read as text, as
 * it is inside that note, so the note cannot close either. This settles a run of such notes in one pass, not one each.
 */
function settlesSwallowed(state: InlineState, candidates: Map<number, number>): boolean {
  if (state.swallowedNotes.length === 0) return false
  const unclosed = new Set<number>()
  for (let at = 0; at < state.bracketDepth; at++) unclosed.add(state.tokens[state.brackets[at]! + TOKEN_START]!)
  // Past the cap (C2-I-118) a closer may pop a swallowed `[` that its own reading keeps open.
  if (state.ownReads.on) state.ownReads.unclosed(unclosed)
  const settled: number[] = []
  // The swallowed notes come in source order; one inside a note settled before it is covered by that note.
  let reach = -1
  for (const start of state.swallowedNotes) {
    if (start < reach || !unclosed.has(start + 1) || !candidates.has(start) || state.textNotes?.covers(start) === true) continue
    settled.push(start)
    reach = candidates.get(start)!
  }
  for (const start of settled) {
    ;(state.textNotes ??= new TextNotes()).add(start, candidates.get(start)!)
    candidates.delete(start)
  }
  return settled.length > 0
}

/** Keeps the images of the last pass that formed again, and returns whether that changed the set. */
function narrowsImages(state: InlineState, formed: Set<number>): boolean {
  const before = state.formedImages
  if (before === null) {
    state.formedImages = formed
    return true
  }
  let changed = false
  for (const start of before) {
    if (formed.has(start)) continue
    before.delete(start)
    changed = true
  }
  return changed
}

function formedImages(state: InlineState): Set<number> {
  const formed = new Set<number>()
  const tokens = state.tokens
  for (let at = 0; at < state.tokenLength; at += TOKEN_WIDTH) {
    if (tokens[at] === TOKEN_OPEN && tokens[at + TOKEN_A] === OPEN_IMAGE && tokens[at + TOKEN_C] === IMAGE) {
      formed.add(tokens[at + TOKEN_START]!)
    }
  }
  return formed
}

/** The notes of the last pass that closed, by start, and fills `opened` with the start of every `^[` that opened one. */
function closedNotes(state: InlineState, opened: Set<number>): Map<number, number> {
  const closed = new Map<number, number>()
  const tokens = state.tokens
  for (let at = 0; at < state.tokenLength; at += TOKEN_WIDTH) {
    if (tokens[at] !== TOKEN_OPEN || tokens[at + TOKEN_A] !== OPEN_FOOTNOTE) continue
    opened.add(tokens[at + TOKEN_START]!)
    if (tokens[at + TOKEN_C] === INLINE_FOOTNOTE) closed.set(tokens[at + TOKEN_START]!, tokens[tokens[at + TOKEN_B]! + TOKEN_START]!)
  }
  return closed
}

/**
 * Reads the inline content of the source spans `spans[from..to)` (start and end pairs) and
 * leaves its events in the state. A line block reads no line comment (C2-B-135).
 */
export function scanInline(
  state: InlineState, src: string, spans: ArrayLike<number>, from: number, to: number, lineComments: boolean,
  cell = false,
): void {
  setContent(state, src, spans, from, to)
  const text = state.text
  // C2-I-002: the content holds no spaces at the end of a line (setContent).
  const end = text.length
  state.end = end
  state.lineComments = lineComments
  state.cell = cell
  state.commentLines = null
  state.closedNotes = null
  state.textNotes = null
  state.caretInNote = false
  state.formedImages = null
  state.percentInImage = false
  scanPass(state)
  // C2-I-089: inside a note that closes, a caret pair opens nothing. The notes that close with every caret pair read
  // are taken first; a pass that reads them as text may leave one unclosed, which is text from then on.
  // C2-I-074: images narrow the same way, so a `%%` stays alt source only inside an image that forms.
  for (let pass = 0; (state.caretInNote || state.percentInImage) && pass < MAX_NOTE_PASSES; pass++) {
    const opened = new Set<number>()
    const images = state.percentInImage && narrowsImages(state, formedImages(state))
    // A pass whose images narrowed reads differently, so a swallowed note waits for a pass that opens it.
    const notes = state.caretInNote && narrowsNotes(state, closedNotes(state, opened), opened, !images)
    if (!notes && !images) break
    scanPass(state)
  }
  failOpenBrackets(state)
  pairDelimiters(state)
  writeEvents(state)
}
