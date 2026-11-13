// The block pass: one forward loop over the lines of one source string, an explicit
// container stack, no recursion. It writes enter, span and exit events and builds nothing.
// Clause ids (C2-B-nnn) refer to the block chapter of the 0.2 syntax spec.
import {
  BACKSLASH, BRACE_OPEN, BYTE_ORDER_MARK, COLON, CR, DIGIT_0, DIGIT_9, GREATER, HYPHEN, LOWER_A, LOWER_I, LOWER_X,
  PAREN_CLOSE, PERCENT, PIPE, STAR, UPPER_A, UPPER_I, UPPER_X,
} from './chars.ts'
import {
  FIRST_CHARACTER_SHAPES, SHAPE_BRACE, SHAPE_BULLET, SHAPE_CAPTION, SHAPE_COMMENT, SHAPE_DEFINITION,
  SHAPE_DESCRIPTION, SHAPE_DIV, SHAPE_FENCE, SHAPE_HEADING, SHAPE_ORDERED, SHAPE_QUOTE, SHAPE_THEMATIC_BREAK,
} from './dispatch.ts'
import { ENTER, eventTag, EXIT, SPAN } from './events.ts'
import {
  ABBREVIATION, ATTRIBUTES, BULLET_LIST, CAPTION, CODE, COMMENT, COMMENT_BLOCK, DESCRIPTION, DESCRIPTION_LIST,
  DIV, DOCUMENT, FLAG_ALPHA, FLAG_ATTRIBUTES, FLAG_AUTO, FLAG_FIGURE, FLAG_HARD_BREAKS, FLAG_IMAGE,
  FLAG_MARKER_ATTRIBUTES, FLAG_PAREN, FLAG_QUOTE_FENCE, FLAG_ROMAN, FLAG_STAR, FLAG_TASK, FLAG_TIGHT,
  FLAG_UNCLOSED, FLAG_UPPER, FOOTNOTE, FRONTMATTER, HEADING, INCLUDE, isIndentContainer, isList, isOpaqueLeaf,
  isTextLeaf, ITEM, LINE_BLOCK, LINK_DEFINITION, ORDERED_LIST, PARAGRAPH, QUOTE, TERM, THEMATIC_BREAK,
} from './kinds.ts'
import {
  bulletMarkerEnd, captionContentStart, decimalValue, descriptionMarkEnd, divSigil, fenceOpenerLength,
  fenceRunLength, footnoteMarkerEnd, headingLevel, isAbbreviation, isAttributeLine, isBareRun, isDefinition,
  isDescriptionListMark, isDisplayMathOnly, isFenceLine, isFigureName, isFrontmatterCloser, isFrontmatterOpener,
  isImageOnly, isIncludeLine, isLineComment, isLinkDefinition, isListMarker, isQuoteMark, isThematicBreak,
  orderedDelimiter, orderedMarkerEnd, romanLetterValue, romanValue, skipSpaces, taskBoxEnd, termMarkEnd,
} from './lines.ts'
import { advanceColumn, isSpaceOrTab, lineEndAt } from './source.ts'
import { addLine, type BlockState, MAX_DEPTH, NO_DEPTH, NO_LEAF, NO_LINE, writeEvent } from './state.ts'

const LIST_BOUNDARY_BLANKS = 3
const SPAN_TAG = eventTag(SPAN, 0, 0)
const ASCII = 128

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
  state.captionDepth = NO_DEPTH
  state.attributesDepth = NO_DEPTH
  state.takeAttributes = false
  const length = src.length
  push(state, DOCUMENT, 0, 0, 0, 0)
  let lineStart = 0
  while (lineStart < length) {
    let lineEnd = src.indexOf('\n', lineStart)
    if (lineEnd < 0) lineEnd = length
    const next = lineEnd + 1
    if (lineEnd > lineStart && src.charCodeAt(lineEnd - 1) === CR) lineEnd--
    addLine(state, lineStart)
    if (lineStart > 0 || !openFrontmatter(state, lineEnd)) scanLine(state, lineStart, lineEnd)
    lineStart = next
  }
  closeTo(state, 1)
  state.contentEnd = length
  closeTo(state, 0)
}

/** C2-B-111: line 1 opens frontmatter, after nothing but a byte-order mark. */
function openFrontmatter(state: BlockState, end: number): boolean {
  const src = state.src
  const pos = src.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : 0
  if (!isFrontmatterOpener(src, pos, end)) return false
  writeEvent(state, eventTag(ENTER, FRONTMATTER, 0), pos, 0)
  state.column = 0
  state.origin = 0
  openOpaqueLeaf(state, FRONTMATTER, HYPHEN, 0)
  state.contentEnd = end
  return true
}

function scanLine(state: BlockState, lineStart: number, end: number): void {
  const matched = matchContainers(state, lineStart, end)
  const blank = state.pos >= end

  if (isOpaqueLeaf(state.leaf)) {
    // C2-B-093, C2-B-095: a comment-only line is skipped by ownership, so it stays in the body.
    if (matched === state.depth || (!blank && isLineComment(state.src, state.pos, end))) {
      opaqueLine(state, lineStart, end, blank, matched === state.depth)
      return
    }
    // C2-B-083: the leaf ends with its container.
    closeLeaf(state)
  }
  if (blank) {
    // C2-B-029: a blank line without the mark ends a quote. C2-B-009: it ends nothing else.
    closeLeaf(state)
    closeTo(state, matched)
    state.blankCount++
    state.captionDepth = NO_DEPTH
    state.attributesDepth = NO_DEPTH
    return
  }
  let captions = false
  if (isTextLeaf(state.leaf)) {
    captions = state.leaf === PARAGRAPH && captionsAfterParagraph(state, matched, end)
    if (!captions && !interruptsLeaf(state, matched, lineStart, end)) {
      // C2-B-011: a lazy line, whatever its indent or prefix.
      writeEvent(state, SPAN_TAG, state.pos, end)
      state.contentEnd = end
      state.leafLines++
      return
    }
    closeLeaf(state)
  } else if (isLineComment(state.src, state.pos, end)) {
    // C2-B-095, C2-B-096: a comment-only line closes nothing and counts neither as blank nor as content.
    writeComment(state, end)
    return
  } else {
    captions = captionsAfterBlock(state, matched, end)
  }
  const takes = state.attributesDepth === state.depth && matched === state.depth
  state.captionDepth = NO_DEPTH
  state.attributesDepth = NO_DEPTH
  if (captions) {
    // C2-B-017: a caption line without the mark of the quote closes the quote and captions it.
    closeTo(state, matched)
    writeEvent(state, eventTag(ENTER, CAPTION, 0), state.pos, 0)
    openTextLeaf(state, CAPTION, captionContentStart(state.src, state.pos, end), end)
  } else {
    closeUnowned(state, matched, end)
    state.takeAttributes = takes
    openBlocks(state, lineStart, end)
    state.takeAttributes = false
  }
  state.blankCount = 0
  state.contentEnd = end
}

/**
 * Reads the prefixes of the line outside-in (C2-B-008) and returns how many stack entries
 * the line carries. A quote needs its mark. An item, a description and a footnote body need
 * the line indented past their marker column (C2-B-023); a line that is blank so far passes
 * them (C2-B-009). Lists and divs have no prefix, so the result can be the index of an item
 * whose list is still undecided.
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
    const kind = state.stackKind[index]!
    if (kind === QUOTE) {
      if (!isQuoteMark(src, state.pos, end)) break
      passQuoteMark(state, end)
    } else if (isIndentContainer(kind)) {
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

/** The shapes the line at the cursor can have (data/line-shapes.json). */
function shapesAt(state: BlockState): number {
  const code = state.src.charCodeAt(state.pos)
  return code < ASCII ? FIRST_CHARACTER_SHAPES[code]! : 0
}

/** A line of an open opaque leaf. `owned` is false for a comment line that the leaf's container does not own. */
function opaqueLine(state: BlockState, lineStart: number, end: number, blank: boolean, owned: boolean): void {
  const line = state.lineCount - 1
  if (blank) {
    // Held back: blank lines before the end of an unclosed leaf are not its content (C2-B-009).
    if (state.pendingBlankLine === NO_LINE) state.pendingBlankLine = line
    return
  }
  if (state.pendingBlankLine !== NO_LINE) {
    for (let pending = state.pendingBlankLine; pending < line; pending++) {
      const pendingEnd = lineEndAt(state.src, state.lineStarts, state.lineCount, pending)
      matchContainers(state, state.lineStarts[pending]!, pendingEnd)
      writeEvent(state, SPAN_TAG, opaqueContentStart(state, pendingEnd), pendingEnd)
    }
    state.pendingBlankLine = NO_LINE
    matchContainers(state, lineStart, end)
  }
  state.contentEnd = end
  if (owned && isCloser(state, lineStart, end)) {
    const kind = state.leaf
    writeEvent(state, eventTag(EXIT, kind, 0), end, 0)
    state.leaf = NO_LEAF
    state.blankCount = 0
    // C2-B-102: a code block takes a caption.
    state.captionDepth = kind === CODE ? state.depth : NO_DEPTH
    return
  }
  writeEvent(state, SPAN_TAG, opaqueContentStart(state, end), end)
}

function isCloser(state: BlockState, lineStart: number, end: number): boolean {
  // C2-B-112.
  if (state.leaf === FRONTMATTER) return isFrontmatterCloser(state.src, lineStart, end)
  // C2-B-081, C2-B-082, C2-B-087.
  return isBareRun(state.src, state.pos, end, state.fenceChar, state.fenceLength)
}

/** C2-B-027: strips at most the opener's indent. C2-B-007: a tab that straddles that column stays. */
function opaqueContentStart(state: BlockState, end: number): number {
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

/** C2-B-016, C2-B-017: the two cases in which a caption line ends an open paragraph. */
function captionsAfterParagraph(state: BlockState, matched: number, end: number): boolean {
  const src = state.src
  if ((shapesAt(state) & SHAPE_CAPTION) === 0 || captionContentStart(src, state.pos, end) < 0) return false
  if (matched === state.depth) {
    return state.leafLines === 1 &&
      (isImageOnly(src, state.leafStart, state.leafEnd) || isDisplayMathOnly(src, state.leafStart, state.leafEnd))
  }
  return matched === state.depth - 1 && state.stackKind[matched] === QUOTE
}

/** C2-B-101: a caption line directly below a block that takes one, owned by the same container. */
function captionsAfterBlock(state: BlockState, matched: number, end: number): boolean {
  if ((shapesAt(state) & SHAPE_CAPTION) === 0 || captionContentStart(state.src, state.pos, end) < 0) return false
  if (matched === state.depth) return state.captionDepth === state.depth
  return matched === state.depth - 1 && state.stackKind[matched] === QUOTE
}

/** The interrupters of an open text leaf: (a) a fence line, (b) a list marker, (c) a sibling mark or definition. */
function interruptsLeaf(state: BlockState, matched: number, lineStart: number, end: number): boolean {
  const src = state.src
  const pos = state.pos
  const shapes = shapesAt(state)
  const depth = state.depth
  const column = state.column - state.origin
  // C2-B-013.
  if ((shapes & (SHAPE_FENCE | SHAPE_DIV | SHAPE_COMMENT)) !== 0 && isFenceLine(src, pos, end)) return true
  if ((shapes & SHAPE_DESCRIPTION) !== 0 && isDescriptionListMark(src, pos, end)) {
    // C2-B-015: a mark at the column of the open description list, below a term or below description text.
    if (matched === depth) return state.stackKind[depth - 1] === DESCRIPTION_LIST && column === state.stackColumn[depth - 1]
    return state.stackKind[matched] === DESCRIPTION && column === state.stackColumn[matched]
  }
  if ((shapes & SHAPE_DEFINITION) !== 0 && pos === lineStart && matched === 1 && depth > 1 && state.stackKind[1] === FOOTNOTE) {
    // C2-B-015: a definition line at column 0 while a definition is open.
    if (isDefinition(src, pos, end)) return true
  }
  if ((shapes & (SHAPE_BULLET | SHAPE_ORDERED)) === 0 || !isListMarker(src, pos, end)) return false
  if (matched === depth) {
    // C2-B-014: past the marker of the item the leaf sits in, a nested list opens.
    return isIndentContainer(state.stackKind[depth - 1]!) && depth + 2 <= MAX_DEPTH + 1
  }
  const kind = state.stackKind[matched]
  if (kind === QUOTE) {
    // C2-B-020: without the mark of a quote that sits in an item, the marker closes the quote.
    return isIndentContainer(state.stackKind[matched - 1]!) && matched + 2 <= MAX_DEPTH + 1
  }
  if (kind === ITEM) {
    // The line is not indented past this item. C2-B-014: at its column the marker is a sibling.
    // C2-B-047: between two open lists it joins the deeper one. Left of every open list it is a lazy line.
    return column === state.stackColumn[matched] || isIndentContainer(state.stackKind[matched - 2]!)
  }
  // C2-B-021: at the column of a description list a list marker is a lazy line.
  return kind === DESCRIPTION && column < state.stackColumn[matched]! && isIndentContainer(state.stackKind[matched - 2]!)
}

/** C2-B-024: closes the containers that do not own the line. */
function closeUnowned(state: BlockState, matched: number, end: number): void {
  const src = state.src
  if (matched < state.depth) {
    const kind = state.stackKind[matched]
    let keepsList = true
    if (kind === ITEM) {
      // Below a marker the list of the item stays open: `openItem` decides between a sibling
      // and a new list (C2-B-041, C2-B-045, C2-B-046). Any other line closes that list too.
      keepsList = isListMarker(src, state.pos, end)
    } else if (kind === DESCRIPTION) {
      keepsList = state.column - state.origin === state.stackColumn[matched] && isDescriptionListMark(src, state.pos, end)
    }
    closeTo(state, keepsList ? matched : matched - 1)
  }
  const top = state.depth - 1
  if (state.stackKind[top] === DESCRIPTION_LIST) {
    // C2-B-059: a term owns no lines, so only a mark at the list's column keeps the list. C2-B-044.
    const sibling = state.column - state.origin === state.stackColumn[top] &&
      isDescriptionListMark(src, state.pos, end) && state.blankCount < LIST_BOUNDARY_BLANKS
    if (!sibling) closeTo(state, top)
  }
}

/** Opens the blocks that start at the cursor. Containers may stack on one line (C2-B-049, C2-B-050, C2-B-060). */
function openBlocks(state: BlockState, lineStart: number, end: number): void {
  while (openContainer(state, lineStart, end)) {
    if (state.pos >= end) return
  }
  openLeaf(state, lineStart, end)
}

function openContainer(state: BlockState, lineStart: number, end: number): boolean {
  const src = state.src
  const pos = state.pos
  const shapes = shapesAt(state)
  if ((shapes & SHAPE_QUOTE) !== 0) {
    if (!isQuoteMark(src, pos, end) || state.depth > MAX_DEPTH) return false
    push(state, QUOTE, 0, pos, 0, 0)
    passQuoteMark(state, end)
    return true
  }
  if ((shapes & SHAPE_BULLET) !== 0 && openBulletItem(state, end)) return true
  if ((shapes & SHAPE_ORDERED) !== 0) return openOrderedItem(state, end)
  if ((shapes & SHAPE_DESCRIPTION) !== 0) {
    // C2-B-056: a description line with no term above it is text.
    const markEnd = descriptionMarkEnd(src, pos, end)
    if (markEnd < 0 || state.stackKind[state.depth - 1] !== DESCRIPTION_LIST || state.depth > MAX_DEPTH) return false
    push(state, DESCRIPTION, 0, pos, 0, state.column - state.origin)
    moveTo(state, markEnd, end)
    return true
  }
  if ((shapes & SHAPE_DEFINITION) !== 0 && pos === lineStart && state.depth === 1) {
    // C2-B-062, C2-B-063: a footnote definition stands at column 0 outside every container.
    const markerEnd = footnoteMarkerEnd(src, pos, end)
    if (markerEnd < 0) return false
    push(state, FOOTNOTE, 0, pos, 0, 0)
    moveTo(state, markerEnd, end)
    return true
  }
  return false
}

function openBulletItem(state: BlockState, end: number): boolean {
  const src = state.src
  const pos = state.pos
  const markerEnd = bulletMarkerEnd(src, pos, end)
  if (markerEnd < 0) return false
  const boxEnd = taskBoxEnd(src, markerEnd, end)
  let style = src.charCodeAt(pos) === STAR ? FLAG_STAR : 0
  if (boxEnd >= 0) style |= FLAG_TASK
  // C2-B-039: `X` is read as `x`.
  const box = boxEnd < 0 ? 0 : src.charCodeAt(markerEnd + 1) === UPPER_X ? LOWER_X : src.charCodeAt(markerEnd + 1)
  if (!openItem(state, BULLET_LIST, style, 0, 0, box, pos + 1)) return false
  moveTo(state, boxEnd >= 0 ? boxEnd : markerEnd, end)
  return true
}

function openOrderedItem(state: BlockState, end: number): boolean {
  const src = state.src
  const pos = state.pos
  const delimiter = orderedDelimiter(src, pos, end)
  if (delimiter < 0) return false
  const markerEnd = orderedMarkerEnd(src, pos, delimiter, end)
  if (markerEnd < 0) return false
  let style = src.charCodeAt(delimiter) === PAREN_CLOSE ? FLAG_PAREN : 0
  let start = 0
  const first = src.charCodeAt(pos)
  if (delimiter === pos) {
    // C2-B-038: the bare dot numbers automatically. It is of the kind of a decimal marker.
    start = -1
  } else if (first >= DIGIT_0 && first <= DIGIT_9) {
    start = decimalValue(src, pos, delimiter)
  } else {
    const upper = first < LOWER_A
    if (upper) style |= FLAG_UPPER
    style |= letterStyle(state, style, delimiter - pos === 1, romanLetterValue(first) > 0, first === LOWER_I || first === UPPER_I)
    start = (style & FLAG_ROMAN) !== 0 ? romanValue(src, pos, delimiter) : first - (upper ? UPPER_A : LOWER_A) + 1
  }
  if (!openItem(state, ORDERED_LIST, style, start < 0 ? FLAG_AUTO : 0, start < 0 ? 0 : start, 0, delimiter + 1)) {
    return false
  }
  moveTo(state, markerEnd, end)
  return true
}

/**
 * The numbering style of a letter marker. An open list of the same case and delimiter takes
 * a single roman letter as roman (C2-B-035) and any single letter as alphabetic (C2-B-036).
 * Otherwise the marker alone decides (C2-B-034).
 */
function letterStyle(state: BlockState, style: number, single: boolean, roman: boolean, loneI: boolean): number {
  const top = state.depth - 1
  if (state.stackKind[top] === ORDERED_LIST) {
    const open = state.stackStyle[top]!
    if ((open & (FLAG_PAREN | FLAG_UPPER)) === style) {
      if ((open & FLAG_ROMAN) !== 0 && roman) return FLAG_ROMAN
      if ((open & FLAG_ALPHA) !== 0 && single) return FLAG_ALPHA
    }
  }
  return single && !loneI ? FLAG_ALPHA : FLAG_ROMAN
}

/** Moves the cursor from a marker to `pos` and on to the content column. A marker holds no tab. */
function moveTo(state: BlockState, pos: number, end: number): void {
  state.column += pos - state.pos
  state.pos = pos
  skipIndent(state, end)
}

/**
 * Opens an item at the cursor, and a list around it unless the open list on top of the stack
 * takes it as a sibling. `afterMarker` is the offset behind the marker, where brace blocks
 * may abut it (C2-B-079). Returns false at the depth cap (C2-B-131).
 */
function openItem(
  state: BlockState, listKind: number, style: number, listFlags: number, listAux: number, itemAux: number,
  afterMarker: number,
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
  const itemFlags = state.src.charCodeAt(afterMarker) === BRACE_OPEN ? FLAG_MARKER_ATTRIBUTES : 0
  push(state, ITEM, itemFlags, state.pos, itemAux, column)
  return true
}

function openLeaf(state: BlockState, lineStart: number, end: number): void {
  const src = state.src
  const pos = state.pos
  const shapes = shapesAt(state)
  if ((shapes & SHAPE_COMMENT) !== 0) {
    if (isLineComment(src, pos, end)) {
      // C2-B-094: after a marker the comment is the content of the block that opened.
      state.takeAttributes = false
      writeComment(state, end)
      return
    }
    const length = fenceRunLength(src, pos, end, PERCENT)
    if (length > 0) {
      writeEvent(state, enterTag(state, COMMENT_BLOCK, 0), pos, length)
      openOpaqueLeaf(state, COMMENT_BLOCK, PERCENT, length)
      return
    }
  }
  if ((shapes & SHAPE_HEADING) !== 0) {
    const level = headingLevel(src, pos, end)
    if (level > 0) {
      // C2-B-106, C2-B-107: one line, and everything after the space is its text.
      writeEvent(state, enterTag(state, HEADING, 0), pos, level)
      writeEvent(state, SPAN_TAG, skipSpaces(src, pos + level, end), end)
      writeEvent(state, eventTag(EXIT, HEADING, 0), end, 0)
      return
    }
  }
  if ((shapes & SHAPE_THEMATIC_BREAK) !== 0 && isThematicBreak(src, pos, end)) {
    writeEvent(state, enterTag(state, THEMATIC_BREAK, 0), pos, 0)
    writeEvent(state, eventTag(EXIT, THEMATIC_BREAK, 0), end, 0)
    return
  }
  if ((shapes & SHAPE_FENCE) !== 0) {
    const length = fenceOpenerLength(src, pos, end)
    if (length > 0) {
      // C2-B-130: the fence opens whether or not a closer follows.
      writeEvent(state, enterTag(state, CODE, 0), pos, length)
      openOpaqueLeaf(state, CODE, src.charCodeAt(pos), length)
      return
    }
  }
  if ((shapes & SHAPE_DIV) !== 0 && openDivLine(state, end)) return
  if ((shapes & SHAPE_DESCRIPTION) !== 0 && openTerm(state, end)) return
  if ((shapes & SHAPE_BRACE) !== 0) {
    if (isAttributeLine(src, pos, end)) {
      // C2-B-070: held pending until the next line. C2-B-071: consecutive lines merge.
      writeLeafLine(state, enterTag(state, ATTRIBUTES, 0), ATTRIBUTES, end)
      state.attributesDepth = state.depth
      return
    }
    if (isIncludeLine(src, pos, end)) {
      writeLeafLine(state, enterTag(state, INCLUDE, 0), INCLUDE, end)
      return
    }
  }
  if ((shapes & SHAPE_DEFINITION) !== 0 && pos === lineStart && state.depth === 1) {
    // C2-B-062: a definition stands at column 0 outside every container.
    if (isLinkDefinition(src, pos, end)) {
      writeLeafLine(state, enterTag(state, LINK_DEFINITION, 0), LINK_DEFINITION, end)
      return
    }
    if (isAbbreviation(src, pos, end)) {
      writeLeafLine(state, enterTag(state, ABBREVIATION, 0), ABBREVIATION, end)
      return
    }
  }
  // C2-B-010.
  writeEvent(state, enterTag(state, PARAGRAPH, 0), pos, 0)
  openTextLeaf(state, PARAGRAPH, pos, end)
}

/** A leaf of one line whose span is the line from the cursor on. */
function writeLeafLine(state: BlockState, tag: number, kind: number, end: number): void {
  writeEvent(state, tag, state.pos, 0)
  writeEvent(state, SPAN_TAG, state.pos, end)
  writeEvent(state, eventTag(EXIT, kind, 0), end, 0)
}

function writeComment(state: BlockState, end: number): void {
  writeLeafLine(state, eventTag(ENTER, COMMENT, 0), COMMENT, end)
  state.contentEnd = end
}

function openTextLeaf(state: BlockState, kind: number, contentStart: number, end: number): void {
  writeEvent(state, SPAN_TAG, contentStart, end)
  state.leaf = kind
  state.leafStart = contentStart
  state.leafEnd = end
  state.leafLines = 1
}

function openOpaqueLeaf(state: BlockState, kind: number, closerChar: number, length: number): void {
  state.leaf = kind
  state.fenceChar = closerChar
  state.fenceLength = length
  state.fenceColumn = state.column - state.origin
  state.pendingBlankLine = NO_LINE
}

/** C2-B-055, C2-B-057: a term is one leaf of its description list. */
function openTerm(state: BlockState, end: number): boolean {
  const markEnd = termMarkEnd(state.src, state.pos, end)
  if (markEnd < 0) return false
  if (state.stackKind[state.depth - 1] !== DESCRIPTION_LIST) {
    if (state.depth > MAX_DEPTH) return false
    push(state, DESCRIPTION_LIST, 0, state.pos, 0, state.column - state.origin)
  }
  writeEvent(state, enterTag(state, TERM, 0), state.pos, 0)
  openTextLeaf(state, TERM, skipSpaces(state.src, markEnd, end), end)
  return true
}

/** A colon run of three or more: the closer of an open div, or the opener of a div or a line block. */
function openDivLine(state: BlockState, end: number): boolean {
  const src = state.src
  const pos = state.pos
  const length = fenceRunLength(src, pos, end, COLON)
  if (length === 0) return false
  const runEnd = pos + length
  if (skipSpaces(src, runEnd, end) === end) {
    // C2-B-089: a bare run closes the innermost open div it is long enough for.
    for (let index = state.depth - 1; state.stackKind[index] === DIV; index--) {
      if (state.stackColumn[index]! > length) continue
      const captioned = (state.stackStyle[index]! & (FLAG_QUOTE_FENCE | FLAG_FIGURE)) !== 0
      state.contentEnd = end
      closeTo(state, index)
      // C2-B-102: a quote fence and a figure group take a caption.
      if (captioned) state.captionDepth = state.depth
      return true
    }
  }
  const sigil = divSigil(src, runEnd, end)
  if (sigil === PIPE) {
    // C2-B-087: the body of a line block is one leaf.
    writeEvent(state, enterTag(state, LINE_BLOCK, 0), pos, length)
    openOpaqueLeaf(state, LINE_BLOCK, COLON, length)
    return true
  }
  if (state.depth > MAX_DEPTH) return false
  let style = 0
  if (sigil === BACKSLASH) style = FLAG_HARD_BREAKS
  else if (sigil === GREATER) style = FLAG_QUOTE_FENCE
  else if (isFigureName(src, runEnd, end)) style = FLAG_FIGURE
  // C2-B-090: a run followed by a name or a sigil always opens.
  push(state, DIV, style, pos, length, length)
  state.stackStyle[state.depth - 1] = style
  return true
}

/** The tag of an enter event. The first block of a line takes the pending attribute lines (C2-B-069). */
function enterTag(state: BlockState, kind: number, flags: number): number {
  if (state.takeAttributes) {
    state.takeAttributes = false
    flags |= FLAG_ATTRIBUTES
  }
  return eventTag(ENTER, kind, flags)
}

function push(state: BlockState, kind: number, flags: number, pos: number, aux: number, column: number): void {
  const depth = state.depth
  state.stackKind[depth] = kind
  state.stackColumn[depth] = column
  state.stackStyle[depth] = 0
  state.stackLoose[depth] = 0
  state.depth = depth + 1
  writeEvent(state, enterTag(state, kind, flags), pos, aux)
}

/** Closes the open leaf. The facts of a leaf are set here (C2-B-132). */
function closeLeaf(state: BlockState): void {
  const kind = state.leaf
  if (kind === NO_LEAF) return
  let flags = 0
  if (isOpaqueLeaf(kind)) {
    // C2-B-083, C2-B-113.
    flags = FLAG_UNCLOSED
    if (state.pendingBlankLine !== NO_LINE) {
      // The blank lines an unclosed leaf did not take stand between blocks.
      state.blankCount = state.lineCount - 1 - state.pendingBlankLine
      state.pendingBlankLine = NO_LINE
    }
  } else if (kind === PARAGRAPH && state.leafLines === 1 && isImageOnly(state.src, state.leafStart, state.leafEnd)) {
    // C2-B-109: a paragraph that closes holding nothing but one image is a block image.
    flags = FLAG_IMAGE
  }
  writeEvent(state, eventTag(EXIT, kind, flags), state.contentEnd, 0)
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
