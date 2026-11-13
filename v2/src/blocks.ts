// The block pass: one forward loop over the lines of one source string, an explicit
// container stack, no recursion. It writes enter, span and exit events and builds nothing.
// Clause ids (C2-B-nnn) refer to the block chapter of the 0.2 syntax spec.
import { CR, GREATER, HYPHEN, LOWER_X, PAREN_CLOSE, STAR, UPPER_X } from './chars.ts'
import { ENTER, eventTag, EXIT, SPAN } from './events.ts'
import {
  BULLET_LIST, CODE, COMMENT, DOCUMENT, FLAG_AUTO, FLAG_PAREN, FLAG_STAR, FLAG_TASK, FLAG_TIGHT, HEADING,
  isList, ITEM, ORDERED_LIST, PARAGRAPH, QUOTE, THEMATIC_BREAK,
} from './kinds.ts'
import {
  bulletMarkerEnd, decimalValue, fenceOpenerLength, headingLevel, isFenceCloser, isLineComment, isListMarker,
  isQuoteMark, isThematicBreak, orderedMarkerEnd, skipSpaces, taskBoxEnd,
} from './lines.ts'
import { advanceColumn, isSpaceOrTab, lineEndAt } from './source.ts'
import { addLine, type BlockState, MAX_DEPTH, NO_LEAF, NO_LINE, writeEvent } from './state.ts'

const LIST_BOUNDARY_BLANKS = 3
const SPAN_TAG = eventTag(SPAN, 0, 0)

/** Writes the block events of `src` into `state`, with the line-start table. */
export function scanBlocks(state: BlockState, src: string): void {
  state.src = src
  state.eventLength = 0
  state.lineCount = 0
  state.depth = 0
  state.leaf = NO_LEAF
  state.pendingBlankLine = NO_LINE
  state.blankCount = 0
  state.contentEnd = 0
  const length = src.length
  push(state, DOCUMENT, 0, 0, 0, 0)
  let lineStart = 0
  while (lineStart < length) {
    let lineEnd = src.indexOf('\n', lineStart)
    if (lineEnd < 0) lineEnd = length
    const next = lineEnd + 1
    if (lineEnd > lineStart && src.charCodeAt(lineEnd - 1) === CR) lineEnd--
    addLine(state, lineStart)
    scanLine(state, lineStart, lineEnd)
    lineStart = next
  }
  closeTo(state, 1)
  state.contentEnd = length
  closeTo(state, 0)
}

function scanLine(state: BlockState, lineStart: number, end: number): void {
  const matched = matchContainers(state, lineStart, end)
  const blank = state.pos >= end

  if (state.leaf === CODE) {
    if (matched === state.depth) {
      fenceLine(state, lineStart, end, blank)
      return
    }
    // C2-B-083: the fence ends with its container.
    closeLeaf(state)
  }
  if (blank) {
    // C2-B-029: a blank line without the mark ends a quote. C2-B-009: it ends nothing else.
    closeLeaf(state)
    closeTo(state, matched)
    state.blankCount++
    return
  }
  if (state.leaf === PARAGRAPH) {
    if (!interruptsParagraph(state, matched, end)) {
      // C2-B-011: a lazy line, whatever its indent or prefix.
      writeEvent(state, SPAN_TAG, state.pos, end)
      state.contentEnd = end
      return
    }
    closeLeaf(state)
  } else if (isLineComment(state.src, state.pos, end)) {
    // C2-B-095, C2-B-096: a comment-only line closes nothing and does not count as blank or as content.
    writeEvent(state, eventTag(ENTER, COMMENT, 0), state.pos, 0)
    writeEvent(state, SPAN_TAG, state.pos, end)
    writeEvent(state, eventTag(EXIT, COMMENT, 0), end, 0)
    state.contentEnd = end
    return
  }
  closeUnowned(state, matched, end)
  openBlocks(state, end)
  state.blankCount = 0
  state.contentEnd = end
}

/**
 * Reads the prefixes of the line outside-in (C2-B-008) and returns how many stack entries
 * the line carries. A quote needs its mark. An item needs the line indented past its marker
 * column (C2-B-023); a line that is blank so far passes every item (C2-B-009). A list has no
 * prefix, so the result can be the index of an item whose list is still undecided.
 */
function matchContainers(state: BlockState, lineStart: number, end: number): number {
  const src = state.src
  const depth = state.depth
  state.pos = lineStart
  state.column = 0
  state.origin = 0
  state.prefixEnd = lineStart
  skipIndent(state, end)
  let index = 1
  for (; index < depth; index++) {
    const kind = state.stackKind[index]
    if (kind === QUOTE) {
      if (!isQuoteMark(src, state.pos, end)) break
      passQuoteMark(state, end)
    } else if (kind === ITEM) {
      if (state.pos < end && state.column - state.origin <= state.stackColumn[index]!) break
    }
  }
  return index
}

/** Moves the cursor past a quote mark. Columns count from behind it (C2-B-003). */
function passQuoteMark(state: BlockState, end: number): void {
  state.pos++
  state.column++
  state.origin = state.column
  state.prefixEnd = state.pos
  skipIndent(state, end)
}

/** Moves the cursor to the first character that is not a space or a tab (C2-B-004). */
function skipIndent(state: BlockState, end: number): void {
  const src = state.src
  let pos = state.pos
  let column = state.column
  while (pos < end) {
    const code = src.charCodeAt(pos)
    if (!isSpaceOrTab(code)) break
    column = advanceColumn(column, code)
    pos++
  }
  state.pos = pos
  state.column = column
}

/** A line of an open fence that the fence's container owns. */
function fenceLine(state: BlockState, lineStart: number, end: number, blank: boolean): void {
  const line = state.lineCount - 1
  if (blank) {
    // Held back: blank lines before the end of an unclosed fence are not code (C2-B-009).
    if (state.pendingBlankLine === NO_LINE) state.pendingBlankLine = line
    return
  }
  if (state.pendingBlankLine !== NO_LINE) {
    for (let pending = state.pendingBlankLine; pending < line; pending++) {
      const pendingEnd = lineEndAt(state.src, state.lineStarts, state.lineCount, pending)
      matchContainers(state, state.lineStarts[pending]!, pendingEnd)
      writeEvent(state, SPAN_TAG, fenceContentStart(state, pendingEnd), pendingEnd)
    }
    state.pendingBlankLine = NO_LINE
    matchContainers(state, lineStart, end)
  }
  state.contentEnd = end
  if (
    state.src.charCodeAt(state.pos) === state.fenceChar &&
    isFenceCloser(state.src, state.pos, end, state.fenceChar, state.fenceLength)
  ) {
    writeEvent(state, eventTag(EXIT, CODE, 0), end, 0)
    state.leaf = NO_LEAF
    state.blankCount = 0
    return
  }
  writeEvent(state, SPAN_TAG, fenceContentStart(state, end), end)
}

/** C2-B-027: strips at most the opener's indent. C2-B-007: a tab that straddles that column stays. */
function fenceContentStart(state: BlockState, end: number): number {
  const src = state.src
  let pos = state.prefixEnd
  let column = state.origin
  while (pos < end) {
    const code = src.charCodeAt(pos)
    if (!isSpaceOrTab(code)) break
    const after = advanceColumn(column, code)
    if (after - state.origin > state.fenceColumn) break
    column = after
    pos++
  }
  return pos
}

/** The interrupters of an open paragraph that this slice knows: (a) a code fence line and (b) a list marker. */
function interruptsParagraph(state: BlockState, matched: number, end: number): boolean {
  const src = state.src
  const pos = state.pos
  // C2-B-013.
  if (fenceOpenerLength(src, pos, end) > 0) return true
  if (!isListMarker(src, pos, end)) return false
  const depth = state.depth
  if (matched === depth) {
    // C2-B-014: past the marker of the item the paragraph sits in, a nested list opens.
    return state.stackKind[depth - 1] === ITEM && depth + 2 <= MAX_DEPTH + 1
  }
  if (state.stackKind[matched] === QUOTE) {
    // C2-B-020: without the mark of a quote that sits in an item, the marker closes the quote.
    return state.stackKind[matched - 1] === ITEM && matched + 2 <= MAX_DEPTH + 1
  }
  // The line is not indented past this item. C2-B-014: at its column the marker is a sibling.
  // C2-B-047: between two open lists it joins the deeper one. Left of every open list it is a lazy line.
  return state.column - state.origin === state.stackColumn[matched] || state.stackKind[matched - 2] === ITEM
}

/** C2-B-024: closes the containers that do not own the line. */
function closeUnowned(state: BlockState, matched: number, end: number): void {
  if (matched === state.depth) return
  // Below a marker the list of the item stays open: `openItem` decides between a sibling
  // and a new list (C2-B-041, C2-B-045, C2-B-046). Any other line closes that list too.
  const keepsList = state.stackKind[matched] !== ITEM || isListMarker(state.src, state.pos, end)
  closeTo(state, keepsList ? matched : matched - 1)
}

/** Opens the blocks that start at the cursor. Containers may stack on one line (C2-B-049, C2-B-050). */
function openBlocks(state: BlockState, end: number): void {
  while (openContainer(state, end)) {
    if (state.pos >= end) return
  }
  openLeaf(state, end)
}

function openContainer(state: BlockState, end: number): boolean {
  const src = state.src
  const pos = state.pos
  const code = src.charCodeAt(pos)
  if (code === GREATER) {
    if (!isQuoteMark(src, pos, end) || state.depth > MAX_DEPTH) return false
    push(state, QUOTE, 0, pos, 0, 0)
    passQuoteMark(state, end)
    return true
  }
  if (code === HYPHEN || code === STAR) {
    const markerEnd = bulletMarkerEnd(src, pos, end)
    if (markerEnd < 0) return false
    const boxEnd = taskBoxEnd(src, markerEnd, end)
    let style = code === STAR ? FLAG_STAR : 0
    if (boxEnd >= 0) style |= FLAG_TASK
    const box = boxEnd >= 0 ? taskState(src.charCodeAt(markerEnd + 1)) : 0
    if (!openItem(state, BULLET_LIST, style, 0, 0, box)) return false
    moveTo(state, boxEnd >= 0 ? boxEnd : markerEnd, end)
    return true
  }
  const markerEnd = orderedMarkerEnd(src, pos, end)
  if (markerEnd < 0) return false
  const delimiter = markerEnd - 2
  const start = decimalValue(src, pos, delimiter)
  const style = src.charCodeAt(delimiter) === PAREN_CLOSE ? FLAG_PAREN : 0
  // C2-B-038: the list starts at the value of its first marker; a bare delimiter numbers automatically.
  if (!openItem(state, ORDERED_LIST, style, start < 0 ? FLAG_AUTO : 0, start < 0 ? 0 : start, 0)) return false
  moveTo(state, markerEnd, end)
  return true
}

/** C2-B-039: `X` is read as `x`. */
function taskState(code: number): number {
  return code === UPPER_X ? LOWER_X : code
}

/** Moves the cursor from a marker to `pos` and on to the content column. A marker holds no tab. */
function moveTo(state: BlockState, pos: number, end: number): void {
  state.column += pos - state.pos
  state.pos = pos
  skipIndent(state, end)
}

/**
 * Opens an item at the cursor, and a list around it unless the open list on top of the stack
 * takes it as a sibling. Returns false at the depth cap (C2-B-131).
 */
function openItem(
  state: BlockState, listKind: number, style: number, listFlags: number, listAux: number, itemAux: number,
): boolean {
  let top = state.depth - 1
  if (isList(state.stackKind[top]!)) {
    if (
      state.stackKind[top] !== listKind || state.stackStyle[top] !== style ||
      state.blankCount >= LIST_BOUNDARY_BLANKS
    ) {
      // C2-B-042, C2-B-044: another kind, or three blank lines, end the list.
      closeTo(state, top)
      top--
    } else if (state.blankCount > 0) {
      // C2-B-052: a blank line counts for the list whose sibling follows it.
      state.stackLoose[top] = 1
    }
  }
  const column = state.column - state.origin
  if (!isList(state.stackKind[top]!)) {
    if (state.depth + 2 > MAX_DEPTH + 1) return false
    push(state, listKind, style | listFlags, state.pos, listAux, column)
    state.stackStyle[state.depth - 1] = style
  }
  push(state, ITEM, 0, state.pos, itemAux, column)
  return true
}

function openLeaf(state: BlockState, end: number): void {
  const src = state.src
  const pos = state.pos
  const level = headingLevel(src, pos, end)
  if (level > 0) {
    // C2-B-106, C2-B-107: one line, and everything after the space is its text.
    writeEvent(state, eventTag(ENTER, HEADING, 0), pos, level)
    writeEvent(state, SPAN_TAG, skipSpaces(src, pos + level, end), end)
    writeEvent(state, eventTag(EXIT, HEADING, 0), end, 0)
    return
  }
  if (isThematicBreak(src, pos, end)) {
    writeEvent(state, eventTag(ENTER, THEMATIC_BREAK, 0), pos, 0)
    writeEvent(state, eventTag(EXIT, THEMATIC_BREAK, 0), end, 0)
    return
  }
  const fenceLength = fenceOpenerLength(src, pos, end)
  if (fenceLength > 0) {
    // C2-B-130: the fence opens whether or not a closer follows.
    state.leaf = CODE
    state.fenceChar = src.charCodeAt(pos)
    state.fenceLength = fenceLength
    state.fenceColumn = state.column - state.origin
    state.pendingBlankLine = NO_LINE
    writeEvent(state, eventTag(ENTER, CODE, 0), pos, fenceLength)
    return
  }
  // C2-B-010.
  state.leaf = PARAGRAPH
  writeEvent(state, eventTag(ENTER, PARAGRAPH, 0), pos, 0)
  writeEvent(state, SPAN_TAG, pos, end)
}

function push(state: BlockState, kind: number, flags: number, pos: number, aux: number, column: number): void {
  const depth = state.depth
  state.stackKind[depth] = kind
  state.stackColumn[depth] = column
  state.stackStyle[depth] = 0
  state.stackLoose[depth] = 0
  state.depth = depth + 1
  writeEvent(state, eventTag(ENTER, kind, flags), pos, aux)
}

function closeLeaf(state: BlockState): void {
  if (state.leaf === NO_LEAF) return
  writeEvent(state, eventTag(EXIT, state.leaf, 0), state.contentEnd, 0)
  if (state.pendingBlankLine !== NO_LINE) {
    // The blank lines an unclosed fence did not take stand between blocks.
    state.blankCount = state.lineCount - 1 - state.pendingBlankLine
    state.pendingBlankLine = NO_LINE
  }
  state.leaf = NO_LEAF
}

/** Closes the open leaf and the containers above stack index `depth`. Tightness is set here (C2-B-132). */
function closeTo(state: BlockState, depth: number): void {
  closeLeaf(state)
  while (state.depth > depth) {
    const index = --state.depth
    const kind = state.stackKind[index]!
    const flags = isList(kind) && state.stackLoose[index] === 0 ? FLAG_TIGHT : 0
    writeEvent(state, eventTag(EXIT, kind, flags), state.contentEnd, 0)
  }
}
