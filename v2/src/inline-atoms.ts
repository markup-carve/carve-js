// The atoms of the inline scan (C2-I-005): escapes, breaks, code spans with their prefixes,
// autolinks, cross-references, comments, the forms at an opening brace, and the sigil forms.
// Each scanner takes the offset of its first character and returns the offset where the scan
// goes on; it pushes a token when its form matched.
import { classRunEnd, readAttributeBlock } from './attributes.ts'
import { AT_SIGN, BACKTICK, BRACE_CLOSE, BRACE_OPEN, BRACKET_OPEN, COLON, DOLLAR, DOT, EQUALS, GREATER, HASH, HYPHEN, LF, PERCENT, SLASH, SPACE } from './chars.ts'
import {
  ATTRIBUTE_BLOCK, AUTOLINK, CODE_SPAN, EDITORIAL, ESCAPE, FLAG_BRACED, FLAG_DISPLAY, FLAG_EMAIL, FLAG_OPEN_END,
  HARD_BREAK, INLINE_COMMENT, LITERAL, MATH, MENTION, NBSP, RAW_INLINE, SMART, SOFT_BREAK, SYMBOL, TAG, XREF,
} from './inline-kinds.ts'
import {
  type InlineState, NONE, OPEN_EXTENSION, pushToken, TOKEN_BRACED_OPEN, TOKEN_C, TOKEN_END, TOKEN_START, TOKEN_WIDTH,
} from './inline-state.ts'
import {
  BRACED_MARKS, CHARACTER_CLASSES, CLASS_BRACED_MARK, CLASS_EMAIL_DOMAIN, CLASS_EMAIL_LAST, CLASS_EMAIL_LOCAL,
  CLASS_EXTENSION_FIRST, CLASS_EXTENSION_REST, CLASS_MENTION, CLASS_RAW_FIRST, CLASS_RAW_REST, CLASS_SCHEME_FIRST,
  CLASS_SCHEME_REST, CLASS_SYMBOL_FIRST, CLASS_SYMBOL_REST, CLASS_URL_BODY, SMART_EN_DASH,
} from './inline-tables.ts'
import { isSpaceOrTab } from './source.ts'
import {
  codePointAt, codePointBefore, isAsciiLetter, isAsciiPunctuation, isJoining, isBoundarySpace, isUrlCharacter, isWhitespace,
  isWordCharacter, NO_CHARACTER,
} from './unicode.ts'

const ASCII = 128

function codeAt(state: InlineState, pos: number): number {
  return pos < state.end ? state.text.charCodeAt(pos) : NO_CHARACTER
}

function inClass(code: number, mask: number): boolean {
  return code >= 0 && code < ASCII && (CHARACTER_CLASSES[code]! & mask) !== 0
}

/**
 * The character before `pos`. C2-I-026: a braced comment counts as nothing for its neighbors,
 * so the comments that end at `pos` are skipped.
 */
export function characterBefore(state: InlineState, pos: number): number {
  const tokens = state.tokens
  for (let at = state.tokenLength - TOKEN_WIDTH; at >= 0; at -= TOKEN_WIDTH) {
    if (tokens[at + TOKEN_END] !== pos || tokens[at] !== INLINE_COMMENT || (tokens[at + TOKEN_C]! & FLAG_BRACED) === 0) break
    pos = tokens[at + TOKEN_START]!
  }
  return codePointBefore(state.text, pos)
}

/** The character at `pos`, behind the braced comments that start there (C2-I-026). */
export function characterAfter(state: InlineState, pos: number): number {
  const text = state.text
  while (!state.commentCloserMissing && text.charCodeAt(pos) === BRACE_OPEN && text.charCodeAt(pos + 1) === PERCENT) {
    const close = text.indexOf('%}', pos + 2)
    if (close < 0 || close + 2 > state.end) state.commentCloserMissing = true
    else pos = close + 2
  }
  return codePointAt(text, pos, state.end)
}

/** Pushes a break that starts at `start` and whose line ending, if it has one, is at `lineEnd`. */
function pushBreak(state: InlineState, kind: number, start: number, lineEnd: number): number {
  let end = lineEnd < state.end ? lineEnd + 1 : lineEnd
  // C2-I-103: the spaces and tabs behind the line ending are dropped.
  while (end < state.end && isSpaceOrTab(state.text.charCodeAt(end))) end++
  pushToken(state, kind, start, end, NONE, NONE, 0, NONE)
  return end
}

/** C2-I-010 to C2-I-012, C2-I-102. */
export function scanBackslash(state: InlineState, pos: number): number {
  const next = codeAt(state, pos + 1)
  if (next === NO_CHARACTER || next === LF) return pushBreak(state, HARD_BREAK, pos, pos + 1)
  if (next === SPACE) pushToken(state, NBSP, pos, pos + 2, NONE, NONE, 0, NONE)
  else if (isAsciiPunctuation(next)) pushToken(state, ESCAPE, pos, pos + 2, pos + 1, pos + 2, 0, NONE)
  else return pos + 1
  return pos + 2
}

/** C2-I-103: a soft break, with the spaces and tabs before it. */
export function scanLineBreak(state: InlineState, pos: number): number {
  let start = pos
  while (start > state.tokenEnd && isSpaceOrTab(state.text.charCodeAt(start - 1))) start--
  return pushBreak(state, SOFT_BREAK, start, pos)
}

function backtickRunEnd(text: string, pos: number, end: number): number {
  while (pos < end && text.charCodeAt(pos) === BACKTICK) pos++
  return pos
}

/** C2-I-015: the start of the next backtick run of exactly `length`, or NONE. */
function closingRun(text: string, pos: number, end: number, length: number): number {
  while (pos < end) {
    if (text.charCodeAt(pos) !== BACKTICK) {
      pos++
      continue
    }
    const after = backtickRunEnd(text, pos, end)
    if (after - pos === length) return pos
    pos = after
  }
  return NONE
}

/** C2-I-016: the content starts and ends with a space and holds a character that is not a space. */
function hasSpacePadding(text: string, start: number, end: number): boolean {
  if (end - start < 2 || text.charCodeAt(start) !== SPACE || text.charCodeAt(end - 1) !== SPACE) return false
  for (let p = start + 1; p < end - 1; p++) if (text.charCodeAt(p) !== SPACE) return true
  return false
}

/** C2-I-021: the offset behind the raw-format marker at `pos`, or NONE. */
function rawMarkerEnd(text: string, pos: number, end: number): number {
  if (text.charCodeAt(pos) !== BRACE_OPEN || text.charCodeAt(pos + 1) !== EQUALS) return NONE
  if (!inClass(pos + 2 < end ? text.charCodeAt(pos + 2) : NO_CHARACTER, CLASS_RAW_FIRST)) return NONE
  const nameEnd = classRunEnd(text, pos + 3, end, CLASS_RAW_REST)
  return nameEnd < end && text.charCodeAt(nameEnd) === BRACE_CLOSE ? nameEnd + 1 : NONE
}

/** A code span whose token starts at `start` and whose opening run starts at `run` (C2-I-014 to C2-I-022). */
function codeSpan(state: InlineState, start: number, run: number, kind: number, flags: number): number {
  const text = state.text
  const open = backtickRunEnd(text, run, state.end)
  const close = closingRun(text, open, state.end, open - run)
  if (close === NONE) {
    // C2-I-017: the span runs to the end of the content, and trailing whitespace is dropped.
    let contentEnd = state.end
    while (contentEnd > open && isWhitespace(text.charCodeAt(contentEnd - 1))) contentEnd--
    pushToken(state, kind, start, state.end, open, contentEnd, flags | FLAG_OPEN_END, NONE)
    return state.end
  }
  const padded = hasSpacePadding(text, open, close)
  const contentStart = padded ? open + 1 : open
  const contentEnd = padded ? close - 1 : close
  const after = close + open - run
  const marker = kind === CODE_SPAN ? rawMarkerEnd(text, after, state.end) : NONE
  if (marker !== NONE) {
    pushToken(state, RAW_INLINE, start, marker, contentStart, contentEnd, 0, after + 2)
    return marker
  }
  pushToken(state, kind, start, after, contentStart, contentEnd, flags, NONE)
  return after
}

export function scanBacktick(state: InlineState, pos: number): number {
  return codeSpan(state, pos, pos, CODE_SPAN, 0)
}

/** C2-I-018: the literal-text span. The image opener is read by the bracket scanner. */
export function scanLiteralSpan(state: InlineState, pos: number): number {
  return codeSpan(state, pos, pos + 1, LITERAL, 0)
}

/** C2-I-019: inline and display math. A dollar sign with no backtick run behind it is text. */
export function scanDollar(state: InlineState, pos: number): number {
  const next = codeAt(state, pos + 1)
  if (next === BACKTICK) return codeSpan(state, pos, pos + 1, MATH, 0)
  if (next === DOLLAR && codeAt(state, pos + 2) === BACKTICK) return codeSpan(state, pos, pos + 2, MATH, FLAG_DISPLAY)
  return pos + 1
}

/** C2-I-096: `</#`, an id without `>`, a space and a line break, and `>`. */
function crossReference(state: InlineState, pos: number): number {
  if (pos < state.xrefFailEnd) return pos + 1
  const text = state.text
  let p = pos + 3
  while (p < state.end && text.charCodeAt(p) !== GREATER && text.charCodeAt(p) !== SPACE && text.charCodeAt(p) !== LF) p++
  if (codeAt(state, p) !== GREATER) {
    // No opener before `p` can find a closer either.
    state.xrefFailEnd = p
    return pos + 1
  }
  if (p === pos + 3) return pos + 1
  pushToken(state, XREF, pos, p + 1, pos + 3, p, 0, NONE)
  return p + 1
}

/** C2-I-073: the offset of the `>` that closes the URL whose scheme starts at `pos`, or NONE. */
function urlEnd(text: string, pos: number, end: number): number {
  if (!inClass(text.charCodeAt(pos), CLASS_SCHEME_FIRST)) return NONE
  let p = classRunEnd(text, pos + 1, end, CLASS_SCHEME_REST)
  if (p >= end || text.charCodeAt(p) !== COLON) return NONE
  const body = ++p
  while (p < end) {
    const code = codePointAt(text, p, end)
    if (code < ASCII ? !inClass(code, CLASS_URL_BODY) : !isUrlCharacter(code)) break
    p += code > 0xffff ? 2 : 1
  }
  return p > body && p < end && text.charCodeAt(p) === GREATER ? p : NONE
}

/** C2-I-073: the offset of the `>` that closes the email address that starts at `pos`, or NONE. */
function emailEnd(text: string, pos: number, end: number): number {
  const at = classRunEnd(text, pos, end, CLASS_EMAIL_LOCAL)
  if (at === pos || at >= end || text.charCodeAt(at) !== AT_SIGN) return NONE
  const close = classRunEnd(text, at + 1, end, CLASS_EMAIL_DOMAIN)
  if (close >= end || text.charCodeAt(close) !== GREATER) return NONE
  let label = close
  while (label > at + 1 && inClass(text.charCodeAt(label - 1), CLASS_EMAIL_LAST)) label--
  // A domain, a dot and letters.
  return label < close && label > at + 2 && text.charCodeAt(label - 1) === DOT ? close : NONE
}

export function scanLess(state: InlineState, pos: number): number {
  const text = state.text
  if (text.charCodeAt(pos + 1) === SLASH && text.charCodeAt(pos + 2) === HASH) return crossReference(state, pos)
  let close = urlEnd(text, pos + 1, state.end)
  let flags = 0
  if (close === NONE) {
    close = emailEnd(text, pos + 1, state.end)
    flags = FLAG_EMAIL
  }
  if (close === NONE) return pos + 1
  pushToken(state, AUTOLINK, pos, close + 1, pos + 1, close, flags, NONE)
  return close + 1
}

/** C2-I-023: `%%` at the start of a line or after whitespace, to the end of its line. */
export function scanPercent(state: InlineState, pos: number): number {
  const text = state.text
  if (!state.lineComments || text.charCodeAt(pos + 1) !== PERCENT) return pos + 1
  if (!isBoundarySpace(pos > 0 ? text.charCodeAt(pos - 1) : NO_CHARACTER)) return pos + 1
  let start = pos
  while (start > state.tokenEnd && isSpaceOrTab(text.charCodeAt(start - 1))) start--
  let end = text.indexOf('\n', pos)
  if (end < 0 || end > state.end) end = state.end
  pushToken(state, INLINE_COMMENT, start, end, pos + 2, end, 0, NONE)
  return end
}

/** C2-I-025, C2-I-063: a braced or an editorial comment, whose closer must follow in the content. */
function bracedComment(state: InlineState, pos: number, kind: number): number {
  const text = state.text
  const editorial = kind === EDITORIAL
  // C2-I-050: the mark of a comment opener before a combining mark is text.
  if (isJoining(codePointAt(text, pos + 2, state.end))) return pos + 2
  if (editorial ? state.editorialCloserMissing : state.commentCloserMissing) return pos + 2
  const close = text.indexOf(editorial ? '#}' : '%}', pos + 2)
  if (close < 0 || close + 2 > state.end) {
    if (editorial) state.editorialCloserMissing = true
    else state.commentCloserMissing = true
    return pos + 2
  }
  // C2-I-063: an editorial comment holds at least one character before the first closer.
  if (editorial && close === pos + 2) return pos + 2
  pushToken(state, kind, pos, close + 2, pos + 2, close, editorial ? 0 : FLAG_BRACED, NONE)
  return close + 2
}

/** C2-I-043: the forms at an opening brace, in their order. */
export function scanBrace(state: InlineState, pos: number): number {
  const text = state.text
  const block = readAttributeBlock(text, pos, state.end, state, null)
  if (block !== NONE) {
    pushToken(state, ATTRIBUTE_BLOCK, pos, block, NONE, NONE, 0, NONE)
    return block
  }
  const next = codeAt(state, pos + 1)
  if (next === PERCENT) return bracedComment(state, pos, INLINE_COMMENT)
  if (next === HASH) return bracedComment(state, pos, EDITORIAL)
  if (next === HYPHEN && text.startsWith('--}', pos + 1)) {
    pushToken(state, SMART, pos, pos + 4, NONE, NONE, 0, SMART_EN_DASH)
    return pos + 4
  }
  // C2-I-050: a mark before a combining mark is text, and so the brace is (C2-I-044).
  if (!inClass(next, CLASS_BRACED_MARK) || isJoining(codePointAt(text, pos + 2, state.end))) return pos + 1
  pushToken(state, TOKEN_BRACED_OPEN, pos, pos + 2, BRACED_MARKS.indexOf(String.fromCharCode(next)), NONE, 0, NONE)
  return pos + 2
}

/** C2-I-090: a sigil starts a form only at the start of the content or after a character that is no letter and no number. */
function atSigilBoundary(state: InlineState, pos: number): boolean {
  return !isWordCharacter(characterBefore(state, pos))
}

/** C2-I-092: the end of the name of a mention or a tag that starts at `pos`, or NONE. */
function dottedNameEnd(text: string, pos: number, end: number): number {
  let p = pos
  let letters = false
  for (; p < end; p++) {
    const code = text.charCodeAt(p)
    if (inClass(code, CLASS_MENTION)) letters ||= isAsciiLetter(code)
    else if (code !== DOT || p === pos || text.charCodeAt(p - 1) === DOT || !inClass(p + 1 < end ? text.charCodeAt(p + 1) : NO_CHARACTER, CLASS_MENTION)) break
  }
  // A trailing hyphen is text behind the name.
  while (p > pos && (text.charCodeAt(p - 1) === HYPHEN || text.charCodeAt(p - 1) === DOT)) p--
  return p > pos && letters ? p : NONE
}

function mentionOrTag(state: InlineState, pos: number, kind: number): number {
  if (!atSigilBoundary(state, pos)) return pos + 1
  const end = dottedNameEnd(state.text, pos + 1, state.end)
  if (end === NONE) return pos + 1
  pushToken(state, kind, pos, end, pos + 1, end, 0, NONE)
  return end
}

export function scanAtSign(state: InlineState, pos: number): number {
  return mentionOrTag(state, pos, MENTION)
}

export function scanHash(state: InlineState, pos: number): number {
  return mentionOrTag(state, pos, TAG)
}

/** C2-I-093: a symbol. Returns the offset behind it, or NONE. */
function symbol(state: InlineState, pos: number): number {
  const text = state.text
  if (!inClass(codeAt(state, pos + 1), CLASS_SYMBOL_FIRST)) return NONE
  const end = classRunEnd(text, pos + 2, state.end, CLASS_SYMBOL_REST)
  if (codeAt(state, end) !== COLON || text.charCodeAt(end - 1) === HYPHEN) return NONE
  pushToken(state, SYMBOL, pos, end + 1, pos + 1, end, 0, NONE)
  return end + 1
}

export type BracketOpener = (state: InlineState, start: number, end: number, form: number) => number

/** C2-I-093, C2-I-094: a symbol, or the opener of an inline extension, which `open` pushes. */
export function scanColon(state: InlineState, pos: number, open: BracketOpener): number {
  if (!atSigilBoundary(state, pos)) return pos + 1
  if (inClass(codeAt(state, pos + 1), CLASS_EXTENSION_FIRST)) {
    const nameEnd = classRunEnd(state.text, pos + 2, state.end, CLASS_EXTENSION_REST)
    if (codeAt(state, nameEnd) === BRACKET_OPEN) return open(state, pos, nameEnd + 1, OPEN_EXTENSION)
  }
  const after = symbol(state, pos)
  return after === NONE ? pos + 1 : after
}
