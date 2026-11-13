// The block pass: one forward loop over the lines of one source string, an explicit
// container stack, no recursion. It writes enter, span and exit events and builds nothing.
// Clause ids (C2-B-nnn) refer to the block chapter of the 0.2 syntax spec.
import {
  BACKSLASH, BRACE_OPEN, BYTE_ORDER_MARK, CARET, COLON, CR, DIGIT_0, DIGIT_9, EQUALS, GREATER, HYPHEN, LESS, LOWER_A,
  LOWER_I, LOWER_X, PAREN_CLOSE, PERCENT, PIPE, STAR, TILDE, UPPER_A, UPPER_I, UPPER_X,
} from './chars.ts'
import {
  FIRST_CHARACTER_SHAPES, SHAPE_ABBREVIATION_DEFINITION, SHAPE_ATTRIBUTE_LINE, SHAPE_BULLET, SHAPE_CAPTION,
  SHAPE_CODE_FENCE_OPENER, SHAPE_COMMENT_BLOCK_OPENER, SHAPE_COMMENT_ONLY, SHAPE_CONTINUATION_ROW,
  SHAPE_DESCRIPTION, SHAPE_DIV_BARE_RUN, SHAPE_DIV_OPENER, SHAPE_FOOTNOTE_DEFINITION, SHAPE_HEADING,
  SHAPE_INCLUDE, SHAPE_LINK_DEFINITION, SHAPE_ORDERED, SHAPE_QUOTE, SHAPE_TABLE_ROW, SHAPE_TERM,
  SHAPE_THEMATIC_BREAK,
} from './dispatch.ts'
import { ENTER, eventTag, EXIT, SPAN } from './events.ts'
import {
  ABBREVIATION, ATTRIBUTES, BULLET_LIST, CAPTION, CELL, CODE, COMMENT, COMMENT_BLOCK, DESCRIPTION, DESCRIPTION_LIST,
  DIV, DOCUMENT, FLAG_ALPHA, FLAG_ATTRIBUTES, FLAG_AUTO, FLAG_CELL_ATTRIBUTES, FLAG_CONTINUATION, FLAG_DELIMITED,
  FLAG_FIGURE, FLAG_HARD_BREAKS, FLAG_HEADER, FLAG_IMAGE, FLAG_MARKER_ATTRIBUTES, FLAG_BLOCK_MATH, FLAG_PAREN,
  FLAG_QUOTE_FENCE, FLAG_RAW, FLAG_ROMAN, FLAG_SPAN_LEFT, FLAG_SPAN_UP, FLAG_STAR, FLAG_TASK, FLAG_TIGHT,
  FLAG_UNCLOSED, FLAG_UPPER, FOOTNOTE, FRONTMATTER, HEADING, INCLUDE, isIndentContainer, isList, isOpaqueLeaf,
  isTextLeaf, ITEM, LINE_BLOCK, LINK_DEFINITION, ORDERED_LIST, PARAGRAPH, QUOTE, ROW, TABLE, TERM, THEMATIC_BREAK,
} from './kinds.ts'
import {
  attributeKeyValue, braceBlocksEnd, bulletMarkerEnd, captionContentStart, continuationClosingPipe, countValue,
  decimalValue, descriptionMarkEnd, divRunLength, divSigil, fenceOpenerLength, fenceRunLength, footnoteMarkerEnd, headingLevel,
  isAbbreviation, isAttributeLine, isBareRun, isDefinition, isDescriptionListMark, isDisplayMathOnly, isFenceLine,
  isFigureName, isFrontmatterCloser, isFrontmatterOpener, isImageOnly, isIncludeLine, isLineComment,
  isLinkDefinition, isListMarker, isQuoteMark, isRawInfo, isThematicBreak, isWord, nextPipe, orderedDelimiter,
  orderedMarkerEnd, romanLetterValue, romanValue, rowAttributeStart, rowClosingPipe, skipSpaces, taskBoxEnd,
  termMarkEnd, trimEnd,
} from './lines.ts'
import { advanceColumn, isSpaceOrTab, lineEndAt } from './source.ts'
import { addLine, type BlockState, MAX_DEPTH, NO_DEPTH, NO_LEAF, NO_LINE, writeEvent } from './state.ts'
import { FACT_SHIFT } from './tree.ts'

const LIST_BOUNDARY_BLANKS = 3
const SPAN_TAG = eventTag(SPAN, 0, 0)
const ASCII = 128
// Unions of the shapes of spec/0.2/data/line-shapes.json that one rule treats alike.
const FENCE_SHAPES = SHAPE_CODE_FENCE_OPENER | SHAPE_DIV_BARE_RUN | SHAPE_DIV_OPENER | SHAPE_COMMENT_BLOCK_OPENER
const MARK_SHAPES = SHAPE_DESCRIPTION | SHAPE_TERM
const DEFINITION_SHAPES = SHAPE_FOOTNOTE_DEFINITION | SHAPE_LINK_DEFINITION | SHAPE_ABBREVIATION_DEFINITION
const MARKER_SHAPES = SHAPE_BULLET | SHAPE_ORDERED
const CONTAINER_SHAPES = SHAPE_QUOTE | MARKER_SHAPES | SHAPE_DESCRIPTION | SHAPE_FOOTNOTE_DEFINITION
const LEAF_SHAPES = FENCE_SHAPES | SHAPE_COMMENT_ONLY | SHAPE_HEADING | SHAPE_THEMATIC_BREAK | SHAPE_TERM |
  SHAPE_ATTRIBUTE_LINE | SHAPE_INCLUDE | SHAPE_LINK_DEFINITION | SHAPE_ABBREVIATION_DEFINITION | SHAPE_TABLE_ROW

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
    if (lineStart > 0) scanLine(state, lineStart, lineEnd)
    // C2-B-165: a byte-order mark is skipped before line 1 is read, whatever the line holds.
    else if (!openFrontmatter(state, lineEnd)) scanLine(state, src.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : 0, lineEnd)
    lineStart = next
  }
  closeTo(state, 1)
  state.contentEnd = length
  closeTo(state, 0)
}

/** C2-B-161, C2-B-165: line 1 opens frontmatter, after nothing but a byte-order mark. */
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
  let matched = matchContainers(state, lineStart, end)
  const blank = state.pos >= end
  if (state.leaf !== NO_LEAF && !isTextLeaf(state.leaf)) {
    if (bodyLine(state, matched, lineStart, end, blank)) return
    const opaque = state.leaf !== TABLE
    closeLeaf(state)
    if (opaque && !blank) {
      // C2-B-111: the leaf ends with its container. C2-B-135: a comment line is no exception,
      // so the containers that do not own this line close before it is read again.
      closeUnowned(state, matched, end)
      matched = state.depth
    }
  }
  if (blank) {
    // C2-B-032: a blank line without the mark ends a quote. C2-B-009: it ends nothing else.
    closeLeaf(state)
    closeTo(state, matched)
    state.blankCount++
    state.captionDepth = NO_DEPTH
    state.attributesDepth = NO_DEPTH
    return
  }
  // C2-B-154: a line that does not continue the open heading meets it closed.
  if (state.leaf === HEADING && !continuesHeading(state, matched)) closeLeaf(state)
  let captions = false
  if (isTextLeaf(state.leaf)) {
    captions = state.leaf === PARAGRAPH && captionsAfterParagraph(state, matched, end)
    if (!captions && !interruptsLeaf(state, matched, lineStart, end)) {
      // C2-B-012: a lazy line, whatever its indent or prefix.
      writeEvent(state, SPAN_TAG, state.pos, end)
      state.contentEnd = end
      // C2-B-157: a comment-only line below a block image or a math block does not count.
      if (!isLineComment(state.src, state.pos, end)) state.leafLines++
      return
    }
    closeLeaf(state)
  } else if (isLineComment(state.src, state.pos, end)) {
    // C2-B-137, C2-B-138: a comment-only line closes nothing and counts neither as blank nor as content.
    writeComment(state, end)
    return
  } else {
    captions = captionsAfterBlock(state, matched, end)
  }
  openLine(state, matched, lineStart, end, captions)
}

/** A line of the open opaque leaf or table. Returns false when the line ends that block. */
function bodyLine(state: BlockState, matched: number, lineStart: number, end: number, blank: boolean): boolean {
  const owned = matched === state.depth
  if (state.leaf !== TABLE) {
    if (owned) opaqueLine(state, lineStart, end, blank)
    return owned
  }
  if (blank) return false
  if (isLineComment(state.src, state.pos, end)) {
    // C2-B-137: a comment-only line does not end a table.
    writeComment(state, end)
    return true
  }
  return owned && tableLine(state, end)
}

/** A line that is not blank, not a lazy line and not a comment-only line: it closes and opens blocks. */
function openLine(state: BlockState, matched: number, lineStart: number, end: number, captions: boolean): void {
  const takes = state.attributesDepth === state.depth && matched === state.depth
  state.captionDepth = NO_DEPTH
  state.attributesDepth = NO_DEPTH
  if (captions) {
    // C2-B-018: a caption line without the mark of the quote closes the quote and captions it.
    closeTo(state, matched)
    writeEvent(state, eventTag(ENTER, CAPTION, 0), state.pos, 0)
    openTextLeaf(state, CAPTION, captionContentStart(state.src, state.pos, end), end)
  } else {
    closeUnowned(state, matched, end)
    // C2-B-096: a caption line takes no attribute line, also where it is text.
    state.takeAttributes = takes && captionContentStart(state.src, state.pos, end) < 0
    openBlocks(state, lineStart, end)
    state.takeAttributes = false
  }
  state.blankCount = 0
  state.contentEnd = end
}

/**
 * Reads the prefixes of the line outside-in (C2-B-008) and returns how many stack entries
 * the line carries. A quote needs its mark. An item, a description and a footnote body need
 * the line indented past their marker column (C2-B-025); a line that is blank so far passes
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

/** A line of an open opaque leaf that the leaf's container owns. */
function opaqueLine(state: BlockState, lineStart: number, end: number, blank: boolean): void {
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
  if (isCloser(state, lineStart, end)) {
    const kind = state.leaf
    writeEvent(state, eventTag(EXIT, kind, 0), end, 0)
    state.leaf = NO_LEAF
    state.blankCount = 0
    // C2-B-147: a code block takes a caption.
    state.captionDepth = kind === CODE ? state.depth : NO_DEPTH
    return
  }
  writeEvent(state, SPAN_TAG, opaqueContentStart(state, end), end)
}

function isCloser(state: BlockState, lineStart: number, end: number): boolean {
  // C2-B-162.
  if (state.leaf === FRONTMATTER) return isFrontmatterCloser(state.src, lineStart, end)
  // C2-B-109, C2-B-110, C2-B-123.
  return isBareRun(state.src, state.pos, end, state.fenceChar, state.fenceLength)
}

/** C2-B-029: strips at most the opener's indent. C2-B-007: a tab that straddles that column stays. */
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

/** C2-B-017, C2-B-018: the two cases in which a caption line ends an open paragraph. */
function captionsAfterParagraph(state: BlockState, matched: number, end: number): boolean {
  const src = state.src
  if ((shapesAt(state) & SHAPE_CAPTION) === 0 || captionContentStart(src, state.pos, end) < 0) return false
  if (matched < state.depth) return state.stackKind[matched] === QUOTE
  return state.leafLines === 1 &&
    (isImageOnly(src, state.leafStart, state.leafEnd) || isDisplayMathOnly(src, state.leafStart, state.leafEnd))
}

/** C2-B-146: a caption line directly below a block that takes one, or below a line of an open quote (C2-B-018). */
function captionsAfterBlock(state: BlockState, matched: number, end: number): boolean {
  if ((shapesAt(state) & SHAPE_CAPTION) === 0 || captionContentStart(state.src, state.pos, end) < 0) return false
  if (matched < state.depth) return state.stackKind[matched] === QUOTE
  return state.captionDepth === state.depth
}

/** C2-B-154: a heading takes only lines of its own containers that are indented past its marker. */
function continuesHeading(state: BlockState, matched: number): boolean {
  return matched === state.depth && state.column - state.origin > state.leafColumn
}

/** The interrupters of an open text leaf: (a) a fence line, (b) a list marker, (c) a sibling mark or definition, (e) a table row, (f) a thematic break. */
function interruptsLeaf(state: BlockState, matched: number, lineStart: number, end: number): boolean {
  const src = state.src
  const pos = state.pos
  const shapes = shapesAt(state)
  // C2-B-014.
  if ((shapes & FENCE_SHAPES) !== 0 && isFenceLine(src, pos, end)) return true
  // C2-B-200.
  if ((shapes & SHAPE_THEMATIC_BREAK) !== 0 && isThematicBreak(src, pos, end)) return true
  // C2-B-019.
  if ((shapes & SHAPE_TABLE_ROW) !== 0) return rowClosingPipe(src, pos, end) >= 0
  if ((shapes & MARK_SHAPES) !== 0) return isDescriptionListMark(src, pos, end) && isSiblingMark(state, matched)
  if ((shapes & DEFINITION_SHAPES) !== 0 && pos === lineStart && isSiblingDefinition(state, matched, end)) return true
  return (shapes & MARKER_SHAPES) !== 0 && isListMarker(src, pos, end) && markerInterrupts(state, matched)
}

/** C2-B-016: a mark at the column of the open description list, below a term or below description text. */
function isSiblingMark(state: BlockState, matched: number): boolean {
  const column = state.column - state.origin
  const depth = state.depth
  if (matched === depth) return state.stackKind[depth - 1] === DESCRIPTION_LIST && column === state.stackColumn[depth - 1]
  return state.stackKind[matched] === DESCRIPTION && column === state.stackColumn[matched]
}

/** C2-B-016: a definition line at column 0 while a definition is open. */
function isSiblingDefinition(state: BlockState, matched: number, end: number): boolean {
  return matched === 1 && state.depth > 1 && state.stackKind[1] === FOOTNOTE && isDefinition(state.src, state.pos, end)
}

/** Interrupter (b) for a list marker at the cursor, by the first container the line does not carry. */
function markerInterrupts(state: BlockState, matched: number): boolean {
  const depth = state.depth
  if (matched === depth) {
    // C2-B-015: past the marker of the item the leaf sits in, a nested list opens.
    return isIndentContainer(state.stackKind[depth - 1]!) && depth + 2 <= MAX_DEPTH + 1
  }
  const kind = state.stackKind[matched]
  const column = state.column - state.origin
  if (kind === QUOTE) {
    // C2-B-021: without the mark of a quote that sits in an item, the marker closes the quote.
    return isIndentContainer(state.stackKind[matched - 1]!) && matched + 2 <= MAX_DEPTH + 1
  }
  if (kind === ITEM) {
    // The line is not indented past this item. C2-B-015: at its column the marker is a sibling.
    // C2-B-055: between two open lists it joins the deeper one. Left of every open list it is a lazy line.
    return column === state.stackColumn[matched] || isIndentContainer(state.stackKind[matched - 2]!)
  }
  // C2-B-022: at the column of a description list a list marker is a lazy line.
  return kind === DESCRIPTION && column < state.stackColumn[matched]! && isIndentContainer(state.stackKind[matched - 2]!)
}

/** C2-B-026: closes the containers that do not own the line. */
function closeUnowned(state: BlockState, matched: number, end: number): void {
  const src = state.src
  if (matched < state.depth) {
    // Below a marker the list of an item stays open: `openItem` decides between a sibling
    // and a new list (C2-B-049, C2-B-053, C2-B-054). Any other line closes that list too.
    // A description list is judged below.
    const keepsList = state.stackKind[matched] !== ITEM || isListMarker(src, state.pos, end)
    closeTo(state, keepsList ? matched : matched - 1)
  }
  const top = state.depth - 1
  if (state.stackKind[top] === DESCRIPTION_LIST) {
    // C2-B-071: a term owns no lines, so only a mark at the list's column keeps the list. C2-B-052.
    const sibling = state.column - state.origin === state.stackColumn[top] &&
      isDescriptionListMark(src, state.pos, end) && state.blankCount < LIST_BOUNDARY_BLANKS
    if (!sibling) closeTo(state, top)
  }
}

/** Opens the blocks that start at the cursor. Containers may stack on one line (C2-B-057, C2-B-058, C2-B-072). */
function openBlocks(state: BlockState, lineStart: number, end: number): void {
  while (openContainer(state, lineStart, end)) {
    if (state.pos >= end) return
  }
  openLeaf(state, lineStart, end)
}

/** Tries the container shapes the first character allows, in the order of their bits. */
function openContainer(state: BlockState, lineStart: number, end: number): boolean {
  let shapes = shapesAt(state) & CONTAINER_SHAPES
  while (shapes !== 0) {
    const shape = shapes & -shapes
    if (openContainerOf(state, shape, lineStart, end)) return true
    shapes ^= shape
  }
  return false
}

function openContainerOf(state: BlockState, shape: number, lineStart: number, end: number): boolean {
  switch (shape) {
    case SHAPE_QUOTE: return openQuote(state, end)
    case SHAPE_BULLET: return openBulletItem(state, end)
    case SHAPE_ORDERED: return openOrderedItem(state, end)
    case SHAPE_DESCRIPTION: return openDescription(state, end)
    case SHAPE_FOOTNOTE_DEFINITION: return openFootnote(state, lineStart, end)
    default: return false
  }
}

function openQuote(state: BlockState, end: number): boolean {
  if (!isQuoteMark(state.src, state.pos, end) || state.depth > MAX_DEPTH) return false
  push(state, QUOTE, 0, state.pos, 0, 0)
  passQuoteMark(state, end)
  return true
}

/** C2-B-074: a description line with no term above it is text. */
function openDescription(state: BlockState, end: number): boolean {
  const markEnd = descriptionMarkEnd(state.src, state.pos, end)
  if (markEnd < 0 || state.stackKind[state.depth - 1] !== DESCRIPTION_LIST || state.depth > MAX_DEPTH) return false
  push(state, DESCRIPTION, 0, state.pos, 0, state.column - state.origin)
  moveTo(state, markEnd, end)
  return true
}

/** C2-B-081, C2-B-082: a footnote definition stands at column 0 outside every container. */
function openFootnote(state: BlockState, lineStart: number, end: number): boolean {
  if (state.pos !== lineStart || state.depth !== 1) return false
  const markerEnd = footnoteMarkerEnd(state.src, state.pos, end)
  if (markerEnd < 0) return false
  push(state, FOOTNOTE, 0, state.pos, 0, 0)
  moveTo(state, markerEnd, end)
  return true
}

function openBulletItem(state: BlockState, end: number): boolean {
  const src = state.src
  const pos = state.pos
  const markerEnd = bulletMarkerEnd(src, pos, end)
  if (markerEnd < 0) return false
  const boxEnd = taskBoxEnd(src, markerEnd, end)
  let style = src.charCodeAt(pos) === STAR ? FLAG_STAR : 0
  if (boxEnd >= 0) style |= FLAG_TASK
  // C2-B-046: `X` is read as `x`.
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
    // C2-B-042, C2-B-043: the bare dot numbers automatically and is of the decimal style.
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
 * a single roman letter as roman (C2-B-038) and any single letter as alphabetic (C2-B-039).
 * Otherwise the marker alone decides (C2-B-042).
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
 * may abut it (C2-B-101). Returns false at the depth cap (C2-B-190).
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
      // C2-B-050, C2-B-052: another kind, or three blank lines, end the list.
      closeTo(state, top)
      top--
    } else if (state.blankCount > 0) {
      // C2-B-065: a blank line counts for the list whose sibling follows it.
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

/** Tries the leaf shapes the first character allows, in the order of their bits. C2-B-011: else a paragraph. */
function openLeaf(state: BlockState, lineStart: number, end: number): void {
  let shapes = shapesAt(state) & LEAF_SHAPES
  while (shapes !== 0) {
    const shape = shapes & -shapes
    if (openLeafOf(state, shape, lineStart, end)) return
    shapes ^= shape
  }
  writeEvent(state, enterTag(state, PARAGRAPH, 0), state.pos, 0)
  openTextLeaf(state, PARAGRAPH, state.pos, end)
}

function openLeafOf(state: BlockState, shape: number, lineStart: number, end: number): boolean {
  switch (shape) {
    case SHAPE_HEADING: return openHeading(state, end)
    case SHAPE_COMMENT_BLOCK_OPENER: return openCommentBlock(state, end)
    case SHAPE_COMMENT_ONLY: return openComment(state, end)
    case SHAPE_ABBREVIATION_DEFINITION: return openDefinitionLine(state, ABBREVIATION, lineStart, end)
    case SHAPE_THEMATIC_BREAK: return openThematicBreak(state, end)
    case SHAPE_DIV_BARE_RUN: return openBareRun(state, end)
    case SHAPE_DIV_OPENER: return openDiv(state, end)
    case SHAPE_TERM: return openTerm(state, end)
    case SHAPE_LINK_DEFINITION: return openDefinitionLine(state, LINK_DEFINITION, lineStart, end)
    case SHAPE_CODE_FENCE_OPENER: return openFence(state, end)
    case SHAPE_ATTRIBUTE_LINE: return openAttributeLine(state, end)
    case SHAPE_INCLUDE: return openInclude(state, end)
    case SHAPE_TABLE_ROW: return openTable(state, end)
    default: return false
  }
}

/** C2-B-136: after a marker the comment is the content of the block that opened. */
function openComment(state: BlockState, end: number): boolean {
  if (!isLineComment(state.src, state.pos, end)) return false
  state.takeAttributes = false
  writeComment(state, end)
  return true
}

function openCommentBlock(state: BlockState, end: number): boolean {
  const length = fenceRunLength(state.src, state.pos, end, PERCENT)
  if (length === 0) return false
  writeEvent(state, enterTag(state, COMMENT_BLOCK, 0), state.pos, length)
  openOpaqueLeaf(state, COMMENT_BLOCK, PERCENT, length)
  // C2-B-108: text behind the run is the first line of the value.
  const tail = skipSpaces(state.src, state.pos + length, end)
  if (tail < end) writeEvent(state, SPAN_TAG, tail, end)
  return true
}

/** C2-B-153, C2-B-154: everything after the space is its text, and lines indented past the marker continue it. */
function openHeading(state: BlockState, end: number): boolean {
  const pos = state.pos
  const level = headingLevel(state.src, pos, end)
  if (level === 0) return false
  writeEvent(state, enterTag(state, HEADING, 0), pos, level)
  openTextLeaf(state, HEADING, skipSpaces(state.src, pos + level, end), end)
  state.leafColumn = state.column - state.origin
  state.contentEnd = end
  return true
}

function openThematicBreak(state: BlockState, end: number): boolean {
  if (!isThematicBreak(state.src, state.pos, end)) return false
  writeEvent(state, enterTag(state, THEMATIC_BREAK, 0), state.pos, 0)
  writeEvent(state, eventTag(EXIT, THEMATIC_BREAK, 0), end, 0)
  return true
}

/** C2-B-189: the fence opens whether or not a closer follows. */
function openFence(state: BlockState, end: number): boolean {
  const src = state.src
  const length = fenceOpenerLength(src, state.pos, end)
  if (length === 0) return false
  const info = state.pos + length
  let flags = isRawInfo(src, info, end) ? FLAG_RAW : 0
  // C2-B-180: a `csv` or `tsv` fence that the `table` attribute marks is a delimited table.
  if (state.takeAttributes && (isWord(src, info, end, 'csv') || isWord(src, info, end, 'tsv'))) {
    if (attributeKeyValue(src, state.attributesStart, state.attributesEnd, 'table') !== null) flags = FLAG_DELIMITED
  }
  writeEvent(state, enterTag(state, CODE, flags), state.pos, length)
  openOpaqueLeaf(state, CODE, src.charCodeAt(state.pos), length)
  return true
}

/** C2-B-166: a row opens a table. `footer-rows` on its attribute line is read here (C2-B-187). */
function openTable(state: BlockState, end: number): boolean {
  const src = state.src
  const closing = rowClosingPipe(src, state.pos, end)
  if (closing < 0) return false
  state.tableFooterRows = 0
  if (state.takeAttributes) {
    // C2-B-210: a value that is no count has no effect.
    state.tableFooterRows = Math.max(0, countValue(attributeKeyValue(src, state.attributesStart, state.attributesEnd, 'footer-rows')))
  }
  writeEvent(state, enterTag(state, TABLE, 0), state.pos, 0)
  state.leaf = TABLE
  state.tableRows = 0
  state.tableHeadRows = 0
  state.tableHeadOpen = true
  writeRow(state, closing, end)
  return true
}

/** A row or a continuation row of the open table. Returns false for any other line (C2-B-170). */
function tableLine(state: BlockState, end: number): boolean {
  const src = state.src
  const closing = rowClosingPipe(src, state.pos, end)
  if (closing >= 0) {
    writeRow(state, closing, end)
    return true
  }
  const last = (shapesAt(state) & SHAPE_CONTINUATION_ROW) === 0 ? -1 : continuationClosingPipe(src, state.pos, end)
  if (last < 0) return false
  // C2-B-184, C2-B-185: a fragment is plain text for the cell of its column in the row above.
  writeEvent(state, eventTag(ENTER, ROW, FLAG_CONTINUATION), state.pos, 0)
  for (let start = state.pos + 1; start <= last;) {
    const stop = nextPipe(src, start, last + 1)
    const content = skipSpaces(src, start, stop)
    writeEvent(state, eventTag(ENTER, CELL, 0), start, 0)
    writeEvent(state, SPAN_TAG, content, trimEnd(src, content, stop))
    writeEvent(state, eventTag(EXIT, CELL, 0), stop, 0)
    start = stop + 1
  }
  writeEvent(state, eventTag(EXIT, ROW, 0), end, 0)
  state.contentEnd = end
  return true
}

/** Writes the row at the cursor, whose closing pipe is at `closing`. The aux of a row is the offset of its attribute. */
function writeRow(state: BlockState, closing: number, end: number): void {
  const src = state.src
  const attribute = rowAttributeStart(src, closing, end)
  writeEvent(state, eventTag(ENTER, ROW, 0), state.pos, attribute < 0 ? 0 : attribute)
  let headers = 0
  let others = 0
  for (let pipe = state.pos; pipe < closing;) {
    const next = nextPipe(src, pipe + 1, closing + 1)
    const flags = writeCell(state, pipe, next)
    if ((flags & FLAG_HEADER) !== 0) headers++
    else if ((flags & (FLAG_SPAN_LEFT | FLAG_SPAN_UP)) === 0) others++
    pipe = next
  }
  writeEvent(state, eventTag(EXIT, ROW, 0), end, 0)
  state.contentEnd = end
  state.tableRows++
  // C2-B-178: the head is the leading rows made only of header cells. A span mark joins another cell and is none itself.
  state.tableHeadOpen = state.tableHeadOpen && headers > 0 && others === 0
  if (state.tableHeadOpen) state.tableHeadRows++
}

/** Writes the cell between the pipes at `pipe` and `next` and returns its flags. */
function writeCell(state: BlockState, pipe: number, next: number): number {
  const src = state.src
  // C2-B-171: the header cell mark, a glued brace block, one space.
  let p = pipe + 1
  let flags = 0
  if (src.charCodeAt(p) === EQUALS) {
    flags = FLAG_HEADER
    p++
  }
  const blocksEnd = braceBlocksEnd(src, p, next)
  // C2-B-182: the alignment mark comes first in the brace block.
  const alignment = blocksEnd > p ? alignmentMark(src.charCodeAt(p + 1)) : 0
  if (blocksEnd > p) flags |= FLAG_CELL_ATTRIBUTES
  const content = skipSpaces(src, blocksEnd, next)
  const contentEnd = trimEnd(src, content, next)
  if (contentEnd - content === 1 && blocksEnd === pipe + 1) flags |= spanMark(src.charCodeAt(content))
  writeEvent(state, eventTag(ENTER, CELL, flags), pipe, alignment)
  writeEvent(state, SPAN_TAG, content, contentEnd)
  writeEvent(state, eventTag(EXIT, CELL, 0), next, 0)
  return flags
}

function alignmentMark(code: number): number {
  return code === LESS || code === GREATER || code === TILDE ? code : 0
}

/** C2-B-172: a cell that holds only `<` or `^` is a span mark. */
function spanMark(code: number): number {
  if (code === LESS) return FLAG_SPAN_LEFT
  return code === CARET ? FLAG_SPAN_UP : 0
}

/** C2-B-092: held pending until the next line. C2-B-102: consecutive lines merge. */
function openAttributeLine(state: BlockState, end: number): boolean {
  if (!isAttributeLine(state.src, state.pos, end)) return false
  if (!state.takeAttributes) state.attributesStart = state.pos
  state.attributesEnd = end
  writeLeafLine(state, enterTag(state, ATTRIBUTES, 0), ATTRIBUTES, end)
  state.attributesDepth = state.depth
  return true
}

function openInclude(state: BlockState, end: number): boolean {
  if (!isIncludeLine(state.src, state.pos, end)) return false
  writeLeafLine(state, enterTag(state, INCLUDE, 0), INCLUDE, end)
  return true
}

/** C2-B-081: a link or abbreviation definition stands at column 0 outside every container. */
function openDefinitionLine(state: BlockState, kind: number, lineStart: number, end: number): boolean {
  if (state.pos !== lineStart || state.depth !== 1) return false
  const matches = kind === LINK_DEFINITION ? isLinkDefinition(state.src, state.pos, end) : isAbbreviation(state.src, state.pos, end)
  if (!matches) return false
  writeLeafLine(state, enterTag(state, kind, 0), kind, end)
  return true
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

/** C2-B-067, C2-B-069, C2-B-075: a term is one leaf of its description list. */
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

/** C2-B-125: a bare colon run closes the innermost open div it is long enough for, and otherwise opens an anonymous div. */
function openBareRun(state: BlockState, end: number): boolean {
  const src = state.src
  const length = divRunLength(src, state.pos, end)
  if (length === 0 || skipSpaces(src, state.pos + length, end) !== end) return false
  for (let index = state.depth - 1; state.stackKind[index] === DIV; index--) {
    if (state.stackColumn[index]! > length) continue
    const captioned = (state.stackStyle[index]! & (FLAG_QUOTE_FENCE | FLAG_FIGURE)) !== 0
    state.contentEnd = end
    closeTo(state, index)
    // C2-B-147: a quote fence and a figure group take a caption.
    if (captioned) state.captionDepth = state.depth
    return true
  }
  return pushDiv(state, 0, length)
}

/** C2-B-126: a colon run followed by a name or a sigil always opens a div or a line block. */
function openDiv(state: BlockState, end: number): boolean {
  const src = state.src
  const pos = state.pos
  const length = divRunLength(src, pos, end)
  const runEnd = pos + length
  if (length === 0 || skipSpaces(src, runEnd, end) === end) return false
  const sigil = divSigil(src, runEnd, end)
  if (sigil === PIPE) {
    // C2-B-123: the body of a line block is one leaf.
    writeEvent(state, enterTag(state, LINE_BLOCK, 0), pos, length)
    openOpaqueLeaf(state, LINE_BLOCK, COLON, length)
    return true
  }
  let style = 0
  if (sigil === BACKSLASH) style = FLAG_HARD_BREAKS
  else if (sigil === GREATER) style = FLAG_QUOTE_FENCE
  else if (isFigureName(src, runEnd, end)) style = FLAG_FIGURE
  return pushDiv(state, style, length)
}

/** Opens a div. Its run length stands in the column slot of the stack. Returns false at the depth cap. */
function pushDiv(state: BlockState, style: number, length: number): boolean {
  if (state.depth > MAX_DEPTH) return false
  push(state, DIV, style, state.pos, length, length)
  state.stackStyle[state.depth - 1] = style
  return true
}

/** The tag of an enter event. The first block of a line takes the pending attribute lines (C2-B-091). */
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

/** Closes the open leaf or table. The facts of a leaf are set here (C2-B-191). */
function closeLeaf(state: BlockState): void {
  const kind = state.leaf
  if (kind === NO_LEAF) return
  state.leaf = NO_LEAF
  if (kind === TABLE) {
    // C2-B-187: the footer rows are the last rows of the body. C2-B-147: a table takes a caption.
    const footer = Math.min(state.tableFooterRows, state.tableRows - state.tableHeadRows)
    writeEvent(state, eventTag(EXIT, TABLE, 0), state.contentEnd, state.tableHeadRows | (footer << FACT_SHIFT))
    state.captionDepth = state.depth
    return
  }
  writeEvent(state, eventTag(EXIT, kind, leafFacts(state, kind)), state.contentEnd, 0)
}

function leafFacts(state: BlockState, kind: number): number {
  if (isOpaqueLeaf(kind)) {
    if (state.pendingBlankLine !== NO_LINE) {
      // C2-B-113: the blank lines an unclosed leaf did not take stand between blocks.
      state.blankCount = state.lineCount - 1 - state.pendingBlankLine
      state.pendingBlankLine = NO_LINE
    }
    // C2-B-111, C2-B-163.
    return FLAG_UNCLOSED
  }
  if (kind !== PARAGRAPH || state.leafLines !== 1) return 0
  // C2-B-157, C2-B-158: a paragraph that closes holding nothing but one image or one display math span (block image, block math).
  if (isImageOnly(state.src, state.leafStart, state.leafEnd)) return FLAG_IMAGE
  return isDisplayMathOnly(state.src, state.leafStart, state.leafEnd) ? FLAG_BLOCK_MATH : 0
}

/** Closes the open leaf and the containers above stack index `depth`. Tightness is set here (C2-B-191). */
function closeTo(state: BlockState, depth: number): void {
  closeLeaf(state)
  while (state.depth > depth) {
    const index = --state.depth
    const kind = state.stackKind[index]!
    const flags = isList(kind) && state.stackLoose[index] === 0 ? FLAG_TIGHT : 0
    writeEvent(state, eventTag(EXIT, kind, flags), state.contentEnd, 0)
  }
}
