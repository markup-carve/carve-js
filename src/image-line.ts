// C2-B-197: the block image line. Its shape is that of the inline image form on one line: the alt
// closes where the bracket stack of the inline scan closes it, behind the atoms of the line, and the
// label and the tail follow the inline clauses (C2-I-066 to C2-I-079). Reads codes and copies nothing.
import {
  APOSTROPHE, AT_SIGN, BACKSLASH, BACKTICK, BANG, BRACE_CLOSE, BRACE_OPEN, BRACKET_CLOSE, BRACKET_OPEN, CARET, GREATER, HASH, LESS,
  PAREN_CLOSE, PAREN_OPEN, PERCENT, QUOTE_MARK, SLASH, SPACE,
} from './chars.ts'
import { emailEnd, urlEnd } from './inline-atoms.ts'
import { attributeBlocksEnd, BacktickRuns, quotedEnd, runLength, skipSpaces } from './lines.ts'
import { isBoundarySpace, isWhitespace } from './unicode.ts'
import { BRACED_MARKS } from './inline-tables.ts'
import { TextNotes } from './text-notes.ts'

const NONE = -1

/** The line under test and its backtick runs, built at the first backtick. */
interface ImageLine {
  src: string
  end: number
  runs: BacktickRuns | null
  braced: { mark: number, contentStart: number }[]
}

/** C2-I-023: a line comment starts at `p`. */
function isLineComment(src: string, p: number): boolean {
  return src.charCodeAt(p) === PERCENT && src.charCodeAt(p + 1) === PERCENT && isBoundarySpace(src.charCodeAt(p - 1))
}

/** C2-I-014, C2-I-119: the offset behind the code span at `p`, or behind its run when no closing run is on the line. */
function codeSpanEnd(line: ImageLine, p: number): number {
  const run = runLength(line.src, p, line.end, BACKTICK)
  line.runs ??= new BacktickRuns(line.src, p + run, line.end)
  const close = line.runs.closer(p + run, run)
  return close < 0 ? p + run : close + run
}

/** C2-I-073, C2-I-096: the offset behind the autolink or cross-reference at `p`, or `p + 1`. */
function angleEnd(src: string, p: number, end: number): number {
  if (src.charCodeAt(p + 1) === SLASH && src.charCodeAt(p + 2) === HASH) {
    let at = p + 3
    while (at < end && src.charCodeAt(at) !== GREATER && !isWhitespace(src.charCodeAt(at))) at++
    return at > p + 3 && src.charCodeAt(at) === GREATER ? at + 1 : p + 1
  }
  let close = urlEnd(src, p + 1, end)
  if (close === NONE) close = emailEnd(src, p + 1, end)
  return close === NONE ? p + 1 : close + 1
}

/** C2-I-025: the offset behind the braced comment at `p`, or `p + 1` when it does not close on the line. */
function bracedCommentEnd(src: string, p: number, end: number): number {
  for (let at = p + 2; at + 1 < end; at++) if (src.charCodeAt(at) === PERCENT && src.charCodeAt(at + 1) === BRACE_CLOSE) return at + 2
  return p + 1
}

/** C2-I-074: image alt text is source text, so a percent run inside it is not a comment. */
function atomEnd(line: ImageLine, p: number): number {
  const src = line.src
  const code = src.charCodeAt(p)
  if (code === BACKSLASH) return p + 2
  if (code === BACKTICK) return codeSpanEnd(line, p)
  if (code === LESS) return angleEnd(src, p, line.end)
  if (code === BRACE_OPEN && src.charCodeAt(p + 1) === PERCENT) return bracedCommentEnd(src, p, line.end)
  return p
}

/** C2-I-076, C2-I-077: the offset of the `]` that ends the label whose `[` is at `p`, or NONE. */
function labelClose(line: ImageLine, p: number): number {
  const src = line.src
  for (let at = p + 1; at < line.end; at++) {
    const code = src.charCodeAt(at)
    if (code === BRACKET_CLOSE) return at
    if (code === BACKSLASH) at++
    else if (isLineComment(src, at)) return NONE
  }
  return NONE
}

/** C2-I-079: a label of only spaces, tabs and line breaks has no key. */
function isBlank(src: string, start: number, end: number): boolean {
  for (let at = start; at < end; at++) if (!isWhitespace(src.charCodeAt(at))) return false
  return true
}

/**
 * C2-I-087: the offset behind the footnote reference at `p`, or `p` when `[` opens a plain bracket. A `[^` whose label
 * is none is text and opens no bracket pair, so the scan goes on behind the `[`.
 */
function footnoteReferenceEnd(line: ImageLine, p: number): number {
  if (line.src.charCodeAt(p + 1) !== CARET) return p
  const close = labelClose(line, p + 1)
  return close === NONE || isBlank(line.src, p + 2, close) ? p + 1 : close + 1
}

/**
 * C2-I-066 to C2-I-072, C2-I-078, C2-I-079: the offset behind what is glued to the closing bracket at `p` of a nested
 * pair whose text starts at `text`. A label the inline scan rejects leaves the pair text, and the scan goes on behind
 * the `]` (C2-I-006).
 */
function nestedTailEnd(line: ImageLine, text: number, p: number): number {
  const src = line.src
  const code = src.charCodeAt(p + 1)
  if (code === PAREN_OPEN) {
    const tail = linkTailEnd(src, p + 1, line.end)
    return tail < 0 ? p + 1 : tail
  }
  if (code === BRACE_OPEN) return attributeBlocksEnd(src, p + 1, line.end)
  if (code !== BRACKET_OPEN) return p + 1
  const first = src.charCodeAt(p + 2)
  if (first === BRACKET_CLOSE) return isBlank(src, text, p) ? p + 1 : p + 3
  if (first === AT_SIGN || first === CARET) return p + 1
  const close = labelClose(line, p + 1)
  return close === NONE || isBlank(src, p + 2, close) ? p + 1 : close + 1
}

/**
 * The open brackets of the alt scan: per bracket, the offset of the inline footnote it opened, or -1 (C2-I-089).
 * `closing` holds the notes that closed in this pass with the offset of their `]`, `demote` the notes in which a caret
 * pair opens nothing, and `text` the notes that are text.
 */
interface Pairs {
  open: number[]
  /** Per open plain bracket, the offset its text starts at. */
  starts: number[]
  closing: Map<number, number>
  demote: Map<number, number> | null
  text: TextNotes | null
  caret: boolean
  /** The open notes, and those of them in `demote`, counted as the stack changes so that no opener scans it. */
  notes: number
  demoted: number
}

/** C2-I-089: whether a note in which a caret pair opens nothing is open; the first pass demotes in none. */
function demoted(pairs: Pairs, p: number): boolean {
  if (pairs.notes > 0) pairs.caret = true
  return pairs.demoted > 0 || pairs.text?.covers(p) === true
}

/** C2-I-087, C2-I-089: pushes the bracket at `p`, a footnote reference or a note opener; returns the offset behind it. */
function openAt(line: ImageLine, pairs: Pairs, p: number): number {
  if (line.src.charCodeAt(p) === CARET) {
    if (demoted(pairs, p)) return p + 1
    if (pairs.text?.has(p) === true) return p + 2
    pairs.open.push(p)
    pairs.notes++
    if (pairs.demote?.has(p) === true) pairs.demoted++
    return p + 2
  }
  const reference = line.src.charCodeAt(p + 1) === CARET && !demoted(pairs, p) ? footnoteReferenceEnd(line, p) : p
  if (reference === p) {
    pairs.open.push(-1)
    pairs.starts.push(p + 1)
  }
  return Math.max(reference, p + 1)
}

/** C2-I-087: the bracket of a nested image opener is plain, never a footnote reference, `![^]` included. */
function openImage(pairs: Pairs, p: number): number {
  pairs.open.push(-1)
  pairs.starts.push(p + 2)
  return p + 2
}

/** Closes the nearest open bracket at `p`; a note takes no tail or label. Returns the offset the scan goes on from. */
function closeAt(line: ImageLine, pairs: Pairs, p: number): number {
  const note = pairs.open.pop()!
  if (note < 0) return nestedTailEnd(line, pairs.starts.pop()!, p)
  pairs.notes--
  if (pairs.demote?.has(note) === true) pairs.demoted--
  pairs.closing.set(note, p)
  return p + 1
}

/**
 * C2-I-006, C2-I-074: the offset of the `]` that closes the bracket at `pos` on the line, or NONE. An inline footnote
 * closes taking no tail or label (C2-I-089).
 */
function bracketPass(line: ImageLine, pos: number, pairs: Pairs): number {
  const src = line.src
  let p = pos + 1
  while (p < line.end) {
    const skipped = skipAtom(line, p)
    if (skipped === NONE) return NONE
    const code = src.charCodeAt(p)
    if (skipped !== p) p = skipped
    else if (code === BANG && src.charCodeAt(p + 1) === BRACKET_OPEN) p = openImage(pairs, p)
    else if (code === BRACKET_OPEN || (code === CARET && src.charCodeAt(p + 1) === BRACKET_OPEN)) p = openAt(line, pairs, p)
    else if (bracedMarkEnd(line, p) > p) p += 2
    else if (code !== BRACKET_CLOSE) p++
    else if (pairs.open.length === 1) return p
    else p = closeAt(line, pairs, p)
    if (p === NONE) return NONE
  }
  return NONE
}

// As in the inline scan, a note whose closing depends on how a caret pair in it reads takes a bounded number of passes.
const MAX_NOTE_PASSES = 8

/**
 * C2-I-089: the close of the bracket at `pos`, read in passes as the inline scan reads it: the notes that close with
 * every caret pair read are taken first, and each later pass keeps those that closed again.
 */
function bracketClose(line: ImageLine, pos: number): number {
  let demote: Map<number, number> | null = null
  let text: TextNotes | null = null
  for (let pass = 0; ; pass++) {
    const pairs: Pairs = { open: [-1], starts: [pos + 1], closing: new Map(), demote, text, caret: false, notes: 0, demoted: 0 }
    const close = bracketPass(line, pos, pairs)
    if (!pairs.caret || pass >= MAX_NOTE_PASSES) return close
    // C2-I-074: the alt of an image that forms is source text, so a note in it is no note that closed.
    const closing = close === NONE ? pairs.closing : new Map<number, number>()
    if (demote === null) {
      demote = closing
      continue
    }
    const before = text?.size ?? 0
    text = narrows(demote, closing, text)
    if ((text?.size ?? 0) === before) return close
  }
}

/** Keeps the notes of `demote` that closed again in `closing`; one that did not is text from now on (C2-I-089). */
function narrows(demote: Map<number, number>, closing: Map<number, number>, text: TextNotes | null): TextNotes | null {
  for (const [start, end] of demote) {
    if (closing.has(start)) continue
    demote.delete(start)
    ;(text ??= new TextNotes()).add(start, end)
  }
  return text
}

function bracedMarkEnd(line: ImageLine, at: number): number {
  const src = line.src
  const code = src.charCodeAt(at)
  if (code === BRACE_OPEN && at + 1 < line.end && BRACED_MARKS.includes(src[at + 1]!)) {
    line.braced.push({ mark: src.charCodeAt(at + 1), contentStart: at + 2 })
    return at + 2
  }
  if (line.braced.at(-1)?.mark === code && src.charCodeAt(at + 1) === BRACE_CLOSE) {
    line.braced.pop()
    return at + 2
  }
  return at
}

/** The offset behind the atom at `p`, `p` where none starts; a line comment takes every closer on its line. */
function skipAtom(line: ImageLine, p: number): number {
  return atomEnd(line, p)
}

/** C2-I-013: a destination reads only the escaped parenthesis and the escaped backslash. */
function isDestinationEscape(code: number): boolean {
  return code === PAREN_OPEN || code === PAREN_CLOSE || code === BACKSLASH
}

/** C2-I-068: the offset behind a link tail whose title opens at `pos`: a quoted title, spaces and `)`; or -1. */
function titleTailEnd(src: string, pos: number, end: number): number {
  const quote = src.charCodeAt(pos)
  if (quote !== QUOTE_MARK && quote !== APOSTROPHE) return -1
  const after = quotedEnd(src, pos, end, quote)
  if (after < 0) return -1
  // C2-I-068: spaces may follow the title, and a tab is no space (C2-I-069).
  let p = after
  while (p < end && src.charCodeAt(p) === SPACE) p++
  return p < end && src.charCodeAt(p) === PAREN_CLOSE ? p + 1 : -1
}

/**
 * C2-I-066 to C2-I-069: the offset behind the link tail whose `(` is at `pos`, or -1. The destination
 * runs to whitespace with its parentheses balanced or escaped, and a title stands after exactly one space.
 */
function linkTailEnd(src: string, pos: number, end: number): number {
  let depth = 0
  let p = pos + 1
  for (; p < end && !isWhitespace(src.charCodeAt(p)); p++) {
    const code = src.charCodeAt(p)
    if (code === PAREN_OPEN) depth++
    else if (code === PAREN_CLOSE && depth-- === 0) return p + 1
    else if (code === BACKSLASH && isDestinationEscape(src.charCodeAt(p + 1))) p++
  }
  return depth === 0 && p < end && src.charCodeAt(p) === SPACE ? titleTailEnd(src, p + 1, end) : -1
}

/** C2-I-072, C2-I-076 to C2-I-079: the offset behind the label of the image whose alt closes at `close`, or -1. */
function imageLabelEnd(line: ImageLine, altStart: number, close: number): number {
  const src = line.src
  const first = src.charCodeAt(close + 2)
  // C2-I-078: a label that starts with an at-sign or a caret is no reference label.
  if (first === AT_SIGN || first === CARET) return -1
  const end = labelClose(line, close + 1)
  if (end === NONE) return -1
  // C2-I-072: a collapsed reference takes its key from the alt, which must not fold to nothing.
  const blank = end === close + 2 ? isBlank(src, altStart, close) : isBlank(src, close + 2, end)
  return blank ? -1 : end + 1
}

/** C2-B-197: exactly one image form, `![alt](destination)` or `![alt][label]`, with optional glued brace blocks. */
export function isImageOnly(src: string, pos: number, end: number): boolean {
  if (pos + 1 >= end || src.charCodeAt(pos) !== BANG || src.charCodeAt(pos + 1) !== BRACKET_OPEN) return false
  const line: ImageLine = { src, end, runs: null, braced: [] }
  const close = bracketClose(line, pos + 1)
  if (close === NONE || close + 1 >= end) return false
  const code = src.charCodeAt(close + 1)
  let p = -1
  if (code === PAREN_OPEN) p = linkTailEnd(src, close + 1, end)
  else if (code === BRACKET_OPEN) p = imageLabelEnd(line, pos + 2, close)
  return p >= 0 && skipSpaces(src, attributeBlocksEnd(src, p, end), end) === end
}
