// The bracket stack of the inline scan (C2-I-006): openers, the closing bracket and what is
// glued to it, the link tail, reference labels and footnote references.
import { emptyBlockEnd, readAttributeBlock } from './attributes.ts'
import { APOSTROPHE, AT_SIGN, BACKSLASH, BRACE_OPEN, BRACKET_CLOSE, BRACKET_OPEN, CARET, LF, PAREN_CLOSE, PAREN_OPEN, PERCENT, QUOTE_MARK, SPACE } from './chars.ts'
import {
  ATTRIBUTE_BLOCK, BRACKET_SPAN, FLAG_COLLAPSED, FOOTNOTE_REF, IMAGE, INLINE_EXTENSION, INLINE_FOOTNOTE, LABEL, LINK,
} from './inline-kinds.ts'
import {
  type InlineState, NONE, OPEN_FOOTNOTE, OPEN_IMAGE, OPEN_PLAIN, pushToken, TOKEN_A, TOKEN_B, TOKEN_C, TOKEN_CLOSE,
  TOKEN_END, TOKEN_OPEN, TOKEN_START, TOKEN_TAIL, TOKEN_TEXT, TOKEN_WIDTH,
} from './inline-state.ts'
import { DEPTH_CAP } from './inline-tables.ts'
import { isBoundarySpace, isWhitespace } from './unicode.ts'


/** Pushes a bracket opener that spans `[start, end)`. C2-I-118: past the cap it is text. */
export function openBracket(state: InlineState, start: number, end: number, form: number): number {
  if (state.baseDepth + state.bracketDepth >= DEPTH_CAP) return start + 1
  if (state.bracketDepth === state.brackets.length) {
    const larger = new Int32Array(state.brackets.length * 2)
    larger.set(state.brackets)
    state.brackets = larger
  }
  state.brackets[state.bracketDepth++] = pushToken(state, TOKEN_OPEN, start, end, form, NONE, 0, NONE)
  return end
}

/** Whether `[start, end)` holds only spaces, tabs and line breaks: such a label has no key (C2-I-079). */
function isBlank(text: string, start: number, end: number): boolean {
  for (let p = start; p < end; p++) if (!isWhitespace(text.charCodeAt(p))) return false
  return true
}

/**
 * C2-I-076: the offset of the next `]` that no backslash escapes, from `pos` on, or NONE.
 * C2-I-077: a line comment that starts inside the label takes its closer.
 */
function labelEnd(state: InlineState, pos: number): number {
  if (state.labelCloserMissing) return NONE
  const text = state.text
  for (let p = pos; p < state.end; p++) {
    const code = text.charCodeAt(p)
    if (code === BRACKET_CLOSE) return p
    if (code === BACKSLASH) p++
    else if (code === PERCENT && state.lineComments && text.charCodeAt(p + 1) === PERCENT && isBoundarySpace(text.charCodeAt(p - 1))) return NONE
  }
  // No later label can find a closer either.
  state.labelCloserMissing = true
  return NONE
}

/** C2-I-087: a footnote reference. With no label the bracket is text. */
function footnoteReference(state: InlineState, pos: number): number {
  const close = labelEnd(state, pos + 2)
  if (close === NONE || isBlank(state.text, pos + 2, close)) return pos + 1
  pushToken(state, FOOTNOTE_REF, pos, close + 1, pos + 2, close, 0, NONE)
  return close + 1
}

export function scanBracketOpen(state: InlineState, pos: number): number {
  if (state.text.charCodeAt(pos + 1) === CARET) return footnoteReference(state, pos)
  return openBracket(state, pos, pos + 1, OPEN_PLAIN)
}

/** C2-I-089: `^[` opens an inline footnote. */
export function scanFootnoteOpen(state: InlineState, pos: number): number {
  return openBracket(state, pos, pos + 2, OPEN_FOOTNOTE)
}

/** C2-I-074: `![` opens what may become an image. */
export function scanImageOpen(state: InlineState, pos: number): number {
  return openBracket(state, pos, pos + 2, OPEN_IMAGE)
}

/**
 * Scans the destination run that starts at `pos`: up to the next whitespace, with the depth of
 * parentheses before each character and the lowest depth from each character on. A later tail
 * that starts inside the run reads its fate from these tables instead of scanning again.
 */
function scanDestinationRun(state: InlineState, pos: number): void {
  const text = state.text
  const depth = state.tailDepth
  let level = 0
  let p = pos
  for (; p < state.end && !isWhitespace(text.charCodeAt(p)); p++) {
    const code = text.charCodeAt(p)
    depth[p] = level
    if (code === PAREN_OPEN) level++
    else if (code === PAREN_CLOSE) level--
    else if (code === BACKSLASH && isDestinationEscape(text.charCodeAt(p + 1)) && p + 1 < state.end) depth[++p] = level
  }
  depth[p] = level
  const lowest = state.tailLowest
  lowest[p] = level
  for (let q = p - 1; q >= pos; q--) lowest[q] = Math.min(lowest[q + 1]!, depth[q + 1]!)
  state.tailStart = pos
  state.tailEnd = p
  state.tailTitleFailed = false
}

/** C2-I-013: a destination reads only the escaped parenthesis and the escaped backslash. */
function isDestinationEscape(code: number): boolean {
  return code === PAREN_OPEN || code === PAREN_CLOSE || code === BACKSLASH
}

/** C2-I-068: a quoted title behind the one space at `pos`, optional spaces and `)`. Returns the offset behind the tail, or NONE. */
function titleEnd(state: InlineState, pos: number): number {
  const text = state.text
  const quote = text.charCodeAt(pos + 1)
  if (quote !== QUOTE_MARK && quote !== APOSTROPHE) return NONE
  let p = pos + 2
  while (p < state.end && text.charCodeAt(p) !== quote && text.charCodeAt(p) !== LF) p += text.charCodeAt(p) === BACKSLASH ? 2 : 1
  if (p >= state.end || text.charCodeAt(p) !== quote) return NONE
  p++
  while (p < state.end && text.charCodeAt(p) === SPACE) p++
  if (p >= state.end || text.charCodeAt(p) !== PAREN_CLOSE) return NONE
  state.tailTitleStart = pos + 1
  return p + 1
}

/**
 * C2-I-066 to C2-I-069: the link tail whose `(` is at `pos`. Returns the offset behind its `)`,
 * or NONE, and leaves the end of the destination and the start of the title in the state.
 */
function linkTail(state: InlineState, pos: number): number {
  const from = pos + 1
  if (from < state.tailStart || from > state.tailEnd || state.tailStart === NONE) scanDestinationRun(state, from)
  const depth = state.tailDepth
  const base = depth[from]!
  const runEnd = state.tailEnd
  state.tailTitleStart = NONE
  if (state.tailLowest[from]! < base) {
    // The parenthesis that closes the tail stands in the run.
    let p = from
    while (depth[p + 1]! >= base) p++
    state.tailDestinationEnd = p
    return p + 1
  }
  if (depth[runEnd] !== base || state.tailTitleFailed || state.text.charCodeAt(runEnd) !== SPACE) return NONE
  state.tailDestinationEnd = runEnd
  const end = titleEnd(state, runEnd)
  if (end === NONE) state.tailTitleFailed = true
  return end
}

/** C2-I-072, C2-I-078: the label glued at `pos`. Returns the offset behind its `]`, or NONE. */
function referenceLabel(state: InlineState, pos: number, textStart: number, textEnd: number): number {
  const text = state.text
  const first = text.charCodeAt(pos + 1)
  if (first === BRACKET_CLOSE) return isBlank(text, textStart, textEnd) ? NONE : pos + 2
  // A label that starts with a caret is a footnote reference behind the pair (C2-I-087).
  if (first === AT_SIGN || first === CARET) return NONE
  const close = labelEnd(state, pos + 1)
  return close === NONE || isBlank(text, pos + 1, close) ? NONE : close + 1
}

/** Pushes the run of attribute blocks glued at `pos` (C2-I-064) and returns the offset behind it. */
function attributeRun(state: InlineState, pos: number): number {
  const text = state.text
  for (;;) {
    let end = text.charCodeAt(pos) === BRACE_OPEN ? readAttributeBlock(text, pos, state.end, state, null) : NONE
    // C2-I-040: the block with no part is valid only here.
    if (end === NONE) end = emptyBlockEnd(text, pos, state.end)
    if (end === NONE) return pos
    pushToken(state, ATTRIBUTE_BLOCK, pos, end, NONE, NONE, 0, NONE)
    pos = end
  }
}

/** Pushes the closing bracket at `pos` of the pair that `open` starts and that forms a node of `kind`. */
function closePair(state: InlineState, open: number, pos: number, kind: number): void {
  // C2-I-074: the alt text of an image is source, so the tokens inside it are dropped.
  if (kind === IMAGE) state.tokenLength = open + TOKEN_WIDTH
  const close = pushToken(state, TOKEN_CLOSE, pos, pos + 1, open, NONE, 0, NONE)
  // Read the array behind the push, which may have replaced it.
  state.tokens[open + TOKEN_B] = close
  state.tokens[open + TOKEN_C] = kind
}

/** What is glued to the closing bracket at `pos` decides the construct (C2-I-006). Returns the offset behind it, or NONE. */
function closeConstruct(state: InlineState, open: number, pos: number): number {
  const text = state.text
  const image = state.tokens[open + TOKEN_A] === OPEN_IMAGE
  const next = pos + 1 < state.end ? text.charCodeAt(pos + 1) : NONE
  if (next === PAREN_OPEN) {
    const end = linkTail(state, pos + 1)
    if (end === NONE) return NONE
    closePair(state, open, pos, image ? IMAGE : LINK)
    pushToken(state, TOKEN_TAIL, pos + 1, end, pos + 2, state.tailDestinationEnd, state.tailTitleStart, NONE)
    return end
  }
  if (next === BRACKET_OPEN) {
    const end = referenceLabel(state, pos + 1, state.tokens[open + TOKEN_END]!, pos)
    if (end === NONE) return NONE
    closePair(state, open, pos, image ? IMAGE : LINK)
    pushToken(state, LABEL, pos + 1, end, pos + 2, end - 1, end === pos + 3 ? FLAG_COLLAPSED : 0, NONE)
    return end
  }
  if (next !== BRACE_OPEN) return NONE
  if (readAttributeBlock(text, pos + 1, state.end, state, null) === NONE && emptyBlockEnd(text, pos + 1, state.end) === NONE) return NONE
  // C2-I-074: before a span the `!` is text.
  if (image) state.tokens[open + TOKEN_START]!++
  closePair(state, open, pos, BRACKET_SPAN)
  return attributeRun(state, pos + 1)
}

/** C2-I-006: a closing bracket pairs with the nearest open one. With none it is text. */
export function scanBracketClose(state: InlineState, pos: number): number {
  if (state.bracketDepth === 0) return pos + 1
  const open = state.brackets[--state.bracketDepth]!
  const form = state.tokens[open + TOKEN_A]!
  if (form >= OPEN_FOOTNOTE) {
    closePair(state, open, pos, form === OPEN_FOOTNOTE ? INLINE_FOOTNOTE : INLINE_EXTENSION)
    return pos + 1
  }
  const end = closeConstruct(state, open, pos)
  if (end !== NONE) return end
  // C2-I-065: the pair forms no construct. It is text and bounds nothing.
  state.tokens[open] = TOKEN_TEXT
  return pos + 1
}

/** C2-I-119: at the end of the content every bracket that is still open is text. */
export function failOpenBrackets(state: InlineState): void {
  while (state.bracketDepth > 0) state.tokens[state.brackets[--state.bracketDepth]!] = TOKEN_TEXT
}
