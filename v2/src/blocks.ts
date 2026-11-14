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
  isLinkDefinition, isListMarker, isQuoteMark, opensListInParagraph, isRawInfo, isThematicBreak, isWord, orderedDelimiter,
  orderedMarkerEnd, romanLetterValue, romanValue, rowAttributeStart, rowClosingPipe, separatorPipes, skipSpaces, taskBoxEnd,
  termMarkEnd, trimEnd,
} from './lines.ts'
import { advanceColumn, isSpaceOrTab, lineEndAt } from './source.ts'
import { addLine, type BlockState, MAX_DEPTH, NO_DEPTH, NO_LEAF, NO_LINE, writeEvent } from './state.ts'

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
  state.contentEnd = 0
  state.containers.depth = 0
  state.leaf.kind = NO_LEAF
  const above = state.above
  above.blankCount = 0
  above.captionDepth = NO_DEPTH
  above.attributesDepth = NO_DEPTH
  above.takeAttributes = false
  above.heldBlankLine = NO_LINE
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
  const cursor = state.cursor
  const src = state.src
  const pos = src.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : 0
  if (!isFrontmatterOpener(src, pos, end)) return false
  writeEvent(state, eventTag(ENTER, FRONTMATTER, 0), pos, 0)
  cursor.column = 0
  cursor.origin = 0
  openOpaqueLeaf(state, FRONTMATTER, HYPHEN, 0)
  state.contentEnd = end
  return true
}

/** Closes the open leaf that is not text, which did not take the line. Returns the containers the line still matches. */
function closeBodyLeaf(state: BlockState, matched: number, end: number, blank: boolean): number {
  const opaque = state.leaf.kind !== TABLE
  closeLeaf(state)
  if (!opaque || blank) return matched
  // C2-B-111: the leaf ends with its container. C2-B-135: a comment line is no exception,
  // so the containers that do not own this line close before it is read again.
  closeUnowned(state, matched, end)
  return state.containers.depth
}

/** C2-B-032: a blank line without the mark ends a quote. C2-B-009: it ends nothing else. */
function blankLine(state: BlockState, matched: number): void {
  const above = state.above
  closeLeaf(state)
  closeTo(state, matched)
  above.blankCount++
  above.captionDepth = NO_DEPTH
  above.attributesDepth = NO_DEPTH
}

/** C2-B-012: the open text leaf takes the line as a lazy line, whatever its indent or prefix, unless the line interrupts it. */
function lazyLine(state: BlockState, matched: number, lineStart: number, end: number): boolean {
  const cursor = state.cursor
  if (interruptsLeaf(state, matched, lineStart, end)) return false
  writeEvent(state, SPAN_TAG, cursor.pos, end)
  state.contentEnd = end
  // C2-B-157: a comment-only line below a block image or a math block does not count.
  if (!isLineComment(state.src, cursor.pos, end)) state.leaf.lines++
  return true
}

function scanLine(state: BlockState, lineStart: number, end: number): void {
  const leaf = state.leaf
  const cursor = state.cursor
  let matched = matchContainers(state, lineStart, end)
  const blank = cursor.pos >= end
  if (leaf.kind !== NO_LEAF && !isTextLeaf(leaf.kind)) {
    if (bodyLine(state, matched, lineStart, end, blank)) return
    matched = closeBodyLeaf(state, matched, end, blank)
  }
  if (blank) return blankLine(state, matched)
  // C2-B-154: a line that does not continue the open heading meets it closed.
  if (leaf.kind === HEADING && !continuesHeading(state, matched)) closeLeaf(state)
  if (isTextLeaf(leaf.kind)) {
    const captions = leaf.kind === PARAGRAPH && captionsAfterParagraph(state, matched, end)
    if (!captions && lazyLine(state, matched, lineStart, end)) return
    closeLeaf(state)
    return openLine(state, matched, lineStart, end, captions)
  }
  // C2-B-137, C2-B-138: a comment-only line closes nothing and counts neither as blank nor as content.
  if (isLineComment(state.src, cursor.pos, end)) return writeComment(state, end)
  openLine(state, matched, lineStart, end, captionsAfterBlock(state, matched, end))
}

/** A line of the open opaque leaf or table. Returns false when the line ends that block. */
function bodyLine(state: BlockState, matched: number, lineStart: number, end: number, blank: boolean): boolean {
  const owned = matched === state.containers.depth
  if (state.leaf.kind !== TABLE) {
    if (owned) opaqueLine(state, lineStart, end, blank)
    return owned
  }
  if (blank) return false
  if (isLineComment(state.src, state.cursor.pos, end)) {
    // C2-B-137: a comment-only line does not end a table.
    writeComment(state, end)
    return true
  }
  return owned && tableLine(state, end)
}

/** A line that is not blank, not a lazy line and not a comment-only line: it closes and opens blocks. */
function openLine(state: BlockState, matched: number, lineStart: number, end: number, captions: boolean): void {
  const containers = state.containers
  const above = state.above
  const cursor = state.cursor
  const takes = above.attributesDepth === containers.depth && matched === containers.depth
  above.captionDepth = NO_DEPTH
  above.attributesDepth = NO_DEPTH
  if (captions) {
    // C2-B-018: a caption line without the mark of the quote closes the quote and captions it.
    closeTo(state, matched)
    writeEvent(state, eventTag(ENTER, CAPTION, 0), cursor.pos, 0)
    openTextLeaf(state, CAPTION, captionContentStart(state.src, cursor.pos, end), end)
  } else {
    closeUnowned(state, matched, end)
    // C2-B-096: a caption line takes no attribute line, also where it is text.
    above.takeAttributes = takes && captionContentStart(state.src, cursor.pos, end) < 0
    openBlocks(state, lineStart, end)
    above.takeAttributes = false
  }
  above.blankCount = 0
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
  const containers = state.containers
  const depth = containers.depth
  const cursor = state.cursor
  cursor.pos = lineStart
  cursor.column = 0
  cursor.origin = 0
  cursor.prefixEnd = lineStart
  skipIndent(state, end)
  let index = 1
  for (; index < depth; index++) {
    const kind = containers.kind[index]!
    if (kind === QUOTE) {
      if (!isQuoteMark(src, cursor.pos, end)) break
      passQuoteMark(state, end)
    } else if (isIndentContainer(kind)) {
      if (cursor.pos < end && cursor.column - cursor.origin <= containers.column[index]!) break
    }
  }
  return index
}

/** Moves the cursor past a quote mark. Columns count from behind it (C2-B-003). */
function passQuoteMark(state: BlockState, end: number): void {
  const cursor = state.cursor
  cursor.pos++
  cursor.column++
  cursor.origin = cursor.column
  cursor.prefixEnd = cursor.pos
  skipIndent(state, end)
}

/** Moves the cursor to the first character that is not a space or a tab (C2-B-004). */
function skipIndent(state: BlockState, end: number): void {
  const src = state.src
  const cursor = state.cursor
  let pos = cursor.pos
  let column = cursor.column
  while (pos < end) {
    const code = src.charCodeAt(pos)
    if (!isSpaceOrTab(code)) break
    column = advanceColumn(column, code)
    pos++
  }
  cursor.pos = pos
  cursor.column = column
}

/** The shapes the line at the cursor can have (data/line-shapes.json). */
function shapesAt(state: BlockState): number {
  const code = state.src.charCodeAt(state.cursor.pos)
  return code < ASCII ? FIRST_CHARACTER_SHAPES[code]! : 0
}

/** A line of an open opaque leaf that the leaf's container owns. */
function opaqueLine(state: BlockState, lineStart: number, end: number, blank: boolean): void {
  const leaf = state.leaf
  const above = state.above
  const line = state.lineCount - 1
  if (blank) {
    // Held back: blank lines before the end of an unclosed leaf are not its content (C2-B-009).
    if (above.heldBlankLine === NO_LINE) above.heldBlankLine = line
    return
  }
  if (above.heldBlankLine !== NO_LINE) {
    for (let pending = above.heldBlankLine; pending < line; pending++) {
      const pendingEnd = lineEndAt(state.src, state.lineStarts, state.lineCount, pending)
      matchContainers(state, state.lineStarts[pending]!, pendingEnd)
      writeEvent(state, SPAN_TAG, opaqueContentStart(state, pendingEnd), pendingEnd)
    }
    above.heldBlankLine = NO_LINE
    matchContainers(state, lineStart, end)
  }
  state.contentEnd = end
  if (isCloser(state, lineStart, end)) {
    const kind = leaf.kind
    writeEvent(state, eventTag(EXIT, kind, 0), end, 0)
    leaf.kind = NO_LEAF
    above.blankCount = 0
    // C2-B-147: a code block takes a caption.
    above.captionDepth = kind === CODE ? state.containers.depth : NO_DEPTH
    return
  }
  writeEvent(state, SPAN_TAG, opaqueContentStart(state, end), end)
}

function isCloser(state: BlockState, lineStart: number, end: number): boolean {
  const leaf = state.leaf
  // C2-B-162.
  if (leaf.kind === FRONTMATTER) return isFrontmatterCloser(state.src, lineStart, end)
  // C2-B-109, C2-B-110, C2-B-123.
  return isBareRun(state.src, state.cursor.pos, end, leaf.fenceChar, leaf.fenceLength)
}

/** C2-B-029: strips at most the opener's indent. C2-B-007: a tab that straddles that column stays. */
function opaqueContentStart(state: BlockState, end: number): number {
  const cursor = state.cursor
  const src = state.src
  let pos = cursor.prefixEnd
  let column = cursor.origin
  while (pos < end) {
    const code = src.charCodeAt(pos)
    if (!isSpaceOrTab(code)) break
    const after = advanceColumn(column, code)
    if (after - cursor.origin > state.leaf.fenceColumn) break
    column = after
    pos++
  }
  return pos
}

/** C2-B-017, C2-B-018: the two cases in which a caption line ends an open paragraph. */
function captionsAfterParagraph(state: BlockState, matched: number, end: number): boolean {
  const containers = state.containers
  const leaf = state.leaf
  const src = state.src
  if ((shapesAt(state) & SHAPE_CAPTION) === 0 || captionContentStart(src, state.cursor.pos, end) < 0) return false
  if (matched < containers.depth) return containers.kind[matched] === QUOTE
  return leaf.lines === 1 &&
    (isImageOnly(src, leaf.start, leaf.end) || isDisplayMathOnly(src, leaf.start, leaf.end))
}

/** C2-B-146: a caption line directly below a block that takes one, or below a line of an open quote (C2-B-018). */
function captionsAfterBlock(state: BlockState, matched: number, end: number): boolean {
  const containers = state.containers
  if ((shapesAt(state) & SHAPE_CAPTION) === 0 || captionContentStart(state.src, state.cursor.pos, end) < 0) return false
  if (matched < containers.depth) return containers.kind[matched] === QUOTE
  return state.above.captionDepth === containers.depth
}

/** C2-B-154: a heading takes only lines of its own containers that are indented past its marker. */
function continuesHeading(state: BlockState, matched: number): boolean {
  const cursor = state.cursor
  return matched === state.containers.depth && cursor.column - cursor.origin > state.leaf.column
}

/**
 * The interrupters of an open text leaf: (a) a fence line, (b) a list marker, (c) a sibling mark or
 * definition, (e) a table row, (f) a thematic break.
 */
function interruptsLeaf(state: BlockState, matched: number, lineStart: number, end: number): boolean {
  const src = state.src
  const pos = state.cursor.pos
  const shapes = shapesAt(state)
  // C2-B-014.
  if ((shapes & FENCE_SHAPES) !== 0 && isFenceLine(src, pos, end)) return true
  // C2-B-200.
  if ((shapes & SHAPE_THEMATIC_BREAK) !== 0 && isThematicBreak(src, pos, end)) return true
  // C2-B-019.
  if ((shapes & SHAPE_TABLE_ROW) !== 0) return rowClosingPipe(src, pos, end) >= 0
  if ((shapes & MARK_SHAPES) !== 0) return isDescriptionListMark(src, pos, end) && isSiblingMark(state, matched)
  if ((shapes & DEFINITION_SHAPES) !== 0 && pos === lineStart && isSiblingDefinition(state, matched, end)) return true
  return (shapes & MARKER_SHAPES) !== 0 && isListMarker(src, pos, end) && markerInterrupts(state, matched, end)
}

/** C2-B-016: a mark at the column of the open description list, below a term or below description text. */
function isSiblingMark(state: BlockState, matched: number): boolean {
  const containers = state.containers
  const cursor = state.cursor
  const column = cursor.column - cursor.origin
  const depth = containers.depth
  if (matched === depth) return containers.kind[depth - 1] === DESCRIPTION_LIST && column === containers.column[depth - 1]
  return containers.kind[matched] === DESCRIPTION && column === containers.column[matched]
}

/** C2-B-016: a definition line at column 0 while a definition is open. */
function isSiblingDefinition(state: BlockState, matched: number, end: number): boolean {
  const containers = state.containers
  return matched === 1 && containers.depth > 1 && containers.kind[1] === FOOTNOTE && isDefinition(state.src, state.cursor.pos, end)
}

/** Interrupter (b) for a list marker at the cursor, by the first container the line does not carry. */
function markerInterrupts(state: BlockState, matched: number, end: number): boolean {
  const containers = state.containers
  const cursor = state.cursor
  const depth = containers.depth
  // C2-B-015: a marker that opens a new list, and continues none, interrupts only as a bullet or with the value 1.
  const opens = opensListInParagraph(state.src, cursor.pos, end)
  if (matched === depth) {
    // C2-B-015: past the marker of the item the leaf sits in, a nested list opens.
    return opens && isIndentContainer(containers.kind[depth - 1]!) && depth + 2 <= MAX_DEPTH + 1
  }
  const kind = containers.kind[matched]
  const column = cursor.column - cursor.origin
  if (kind === QUOTE) {
    // C2-B-021: without the mark of a quote that sits in an item, the marker closes the quote.
    return opens && isIndentContainer(containers.kind[matched - 1]!) && matched + 2 <= MAX_DEPTH + 1
  }
  if (kind === ITEM) {
    // The line is not indented past this item. C2-B-015: at its column the marker is a sibling.
    // C2-B-055: between two open lists it joins the deeper one. Left of every open list it is a lazy line.
    return column === containers.column[matched] || isIndentContainer(containers.kind[matched - 2]!)
  }
  // C2-B-022: at the column of a description list a list marker is a lazy line.
  return opens && kind === DESCRIPTION && column < containers.column[matched]! && isIndentContainer(containers.kind[matched - 2]!)
}

/** C2-B-026: closes the containers that do not own the line. */
function closeUnowned(state: BlockState, matched: number, end: number): void {
  const containers = state.containers
  const cursor = state.cursor
  const src = state.src
  if (matched < containers.depth) {
    // Below a marker the list of an item stays open: `openItem` decides between a sibling
    // and a new list (C2-B-049, C2-B-053, C2-B-054). Any other line closes that list too.
    // A description list is judged below.
    const keepsList = containers.kind[matched] !== ITEM || isListMarker(src, cursor.pos, end)
    closeTo(state, keepsList ? matched : matched - 1)
  }
  const top = containers.depth - 1
  if (containers.kind[top] === DESCRIPTION_LIST) {
    // C2-B-071: a term owns no lines, so only a mark at the list's column keeps the list. C2-B-052.
    const sibling = cursor.column - cursor.origin === containers.column[top] &&
      isDescriptionListMark(src, cursor.pos, end) && state.above.blankCount < LIST_BOUNDARY_BLANKS
    if (!sibling) closeTo(state, top)
  }
}

/** Opens the blocks that start at the cursor. Containers may stack on one line (C2-B-057, C2-B-058, C2-B-072). */
function openBlocks(state: BlockState, lineStart: number, end: number): void {
  while (openContainer(state, lineStart, end)) {
    if (state.cursor.pos >= end) return
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
  const cursor = state.cursor
  if (!isQuoteMark(state.src, cursor.pos, end) || state.containers.depth > MAX_DEPTH) return false
  push(state, QUOTE, 0, cursor.pos, 0, 0)
  passQuoteMark(state, end)
  return true
}

/** C2-B-074: a description line with no term above it is text. */
function openDescription(state: BlockState, end: number): boolean {
  const cursor = state.cursor
  const markEnd = descriptionMarkEnd(state.src, cursor.pos, end)
  const containers = state.containers
  if (markEnd < 0 || containers.kind[containers.depth - 1] !== DESCRIPTION_LIST || containers.depth > MAX_DEPTH) return false
  push(state, DESCRIPTION, 0, cursor.pos, 0, cursor.column - cursor.origin)
  moveTo(state, markEnd, end)
  return true
}

/** C2-B-081, C2-B-082: a footnote definition stands at column 0 outside every container. */
function openFootnote(state: BlockState, lineStart: number, end: number): boolean {
  const cursor = state.cursor
  if (cursor.pos !== lineStart || state.containers.depth !== 1) return false
  const markerEnd = footnoteMarkerEnd(state.src, cursor.pos, end)
  if (markerEnd < 0) return false
  push(state, FOOTNOTE, 0, cursor.pos, 0, 0)
  moveTo(state, markerEnd, end)
  return true
}

function openBulletItem(state: BlockState, end: number): boolean {
  const src = state.src
  const pos = state.cursor.pos
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

/** The style flags of an ordered marker of letters that starts at `pos`, added to `style`. */
function letterFlags(state: BlockState, pos: number, delimiter: number, style: number): number {
  const first = state.src.charCodeAt(pos)
  const flags = first < LOWER_A ? style | FLAG_UPPER : style
  return flags | letterStyle(state, flags, delimiter - pos === 1, romanLetterValue(first) > 0, first === LOWER_I || first === UPPER_I)
}

/** The number of an ordered marker of letters of the style `style`. */
function letterStart(src: string, pos: number, delimiter: number, style: number): number {
  if ((style & FLAG_ROMAN) !== 0) return romanValue(src, pos, delimiter)
  return src.charCodeAt(pos) - ((style & FLAG_UPPER) !== 0 ? UPPER_A : LOWER_A) + 1
}

function openOrderedItem(state: BlockState, end: number): boolean {
  const src = state.src
  const pos = state.cursor.pos
  const delimiter = orderedDelimiter(src, pos, end)
  if (delimiter < 0) return false
  const markerEnd = orderedMarkerEnd(src, pos, delimiter, end)
  if (markerEnd < 0) return false
  let style = src.charCodeAt(delimiter) === PAREN_CLOSE ? FLAG_PAREN : 0
  const first = src.charCodeAt(pos)
  // C2-B-042, C2-B-043: the bare dot numbers automatically and is of the decimal style.
  let start = -1
  if (delimiter !== pos && first >= DIGIT_0 && first <= DIGIT_9) {
    start = decimalValue(src, pos, delimiter)
  } else if (delimiter !== pos) {
    style = letterFlags(state, pos, delimiter, style)
    start = letterStart(src, pos, delimiter, style)
  }
  const auto = start < 0
  if (!openItem(state, ORDERED_LIST, style, auto ? FLAG_AUTO : 0, auto ? 0 : start, 0, delimiter + 1)) return false
  moveTo(state, markerEnd, end)
  return true
}

/**
 * The numbering style of a letter marker. An open list of the same case and delimiter takes
 * a single roman letter as roman (C2-B-038) and any single letter as alphabetic (C2-B-039).
 * Otherwise the marker alone decides (C2-B-042).
 */
function letterStyle(state: BlockState, style: number, single: boolean, roman: boolean, loneI: boolean): number {
  const containers = state.containers
  const top = containers.depth - 1
  if (containers.kind[top] === ORDERED_LIST) {
    const open = containers.style[top]!
    if ((open & (FLAG_PAREN | FLAG_UPPER)) === style) {
      if ((open & FLAG_ROMAN) !== 0 && roman) return FLAG_ROMAN
      if ((open & FLAG_ALPHA) !== 0 && single) return FLAG_ALPHA
    }
  }
  return single && !loneI ? FLAG_ALPHA : FLAG_ROMAN
}

/** Moves the cursor from a marker to `pos` and on to the content column. A marker holds no tab. */
function moveTo(state: BlockState, pos: number, end: number): void {
  const cursor = state.cursor
  cursor.column += pos - cursor.pos
  cursor.pos = pos
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
  const containers = state.containers
  const above = state.above
  const cursor = state.cursor
  let top = containers.depth - 1
  if (isList(containers.kind[top]!)) {
    if (
      containers.kind[top] !== listKind || containers.style[top] !== style ||
      above.blankCount >= LIST_BOUNDARY_BLANKS
    ) {
      // C2-B-050, C2-B-052: another kind, or three blank lines, end the list.
      closeTo(state, top)
      top--
    } else if (above.blankCount > 0) {
      // C2-B-065: a blank line counts for the list whose sibling follows it.
      containers.loose[top] = 1
    }
  }
  const column = cursor.column - cursor.origin
  if (!isList(containers.kind[top]!)) {
    if (containers.depth + 2 > MAX_DEPTH + 1) return false
    push(state, listKind, style | listFlags, cursor.pos, listAux, column)
    containers.style[containers.depth - 1] = style
  }
  const itemFlags = state.src.charCodeAt(afterMarker) === BRACE_OPEN ? FLAG_MARKER_ATTRIBUTES : 0
  push(state, ITEM, itemFlags, cursor.pos, itemAux, column)
  return true
}

/** Tries the leaf shapes the first character allows, in the order of their bits. C2-B-011: else a paragraph. */
function openLeaf(state: BlockState, lineStart: number, end: number): void {
  const cursor = state.cursor
  let shapes = shapesAt(state) & LEAF_SHAPES
  while (shapes !== 0) {
    const shape = shapes & -shapes
    if (openLeafOf(state, shape, lineStart, end)) return
    shapes ^= shape
  }
  writeEvent(state, enterTag(state, PARAGRAPH, 0), cursor.pos, 0)
  openTextLeaf(state, PARAGRAPH, cursor.pos, end)
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
  if (!isLineComment(state.src, state.cursor.pos, end)) return false
  state.above.takeAttributes = false
  writeComment(state, end)
  return true
}

function openCommentBlock(state: BlockState, end: number): boolean {
  const cursor = state.cursor
  const length = fenceRunLength(state.src, cursor.pos, end, PERCENT)
  if (length === 0) return false
  writeEvent(state, enterTag(state, COMMENT_BLOCK, 0), cursor.pos, length)
  openOpaqueLeaf(state, COMMENT_BLOCK, PERCENT, length)
  // C2-B-108: text behind the run is the first line of the value.
  const tail = skipSpaces(state.src, cursor.pos + length, end)
  if (tail < end) writeEvent(state, SPAN_TAG, tail, end)
  return true
}

/** C2-B-153, C2-B-154: everything after the space is its text, and lines indented past the marker continue it. */
function openHeading(state: BlockState, end: number): boolean {
  const cursor = state.cursor
  const pos = cursor.pos
  const level = headingLevel(state.src, pos, end)
  if (level === 0) return false
  writeEvent(state, enterTag(state, HEADING, 0), pos, level)
  openTextLeaf(state, HEADING, skipSpaces(state.src, pos + level, end), end)
  state.leaf.column = cursor.column - cursor.origin
  state.contentEnd = end
  return true
}

function openThematicBreak(state: BlockState, end: number): boolean {
  const cursor = state.cursor
  if (!isThematicBreak(state.src, cursor.pos, end)) return false
  writeEvent(state, enterTag(state, THEMATIC_BREAK, 0), cursor.pos, 0)
  writeEvent(state, eventTag(EXIT, THEMATIC_BREAK, 0), end, 0)
  return true
}

/** C2-B-189: the fence opens whether or not a closer follows. */
function openFence(state: BlockState, end: number): boolean {
  const above = state.above
  const cursor = state.cursor
  const src = state.src
  const length = fenceOpenerLength(src, cursor.pos, end)
  if (length === 0) return false
  const info = cursor.pos + length
  let flags = isRawInfo(src, info, end) ? FLAG_RAW : 0
  // C2-B-180: a `csv` or `tsv` fence that the `table` attribute marks is a delimited table.
  if (above.takeAttributes && (isWord(src, info, end, 'csv') || isWord(src, info, end, 'tsv'))) {
    if (attributeKeyValue(src, above.attributesStart, above.attributesEnd, 'table') !== null) flags = FLAG_DELIMITED
  }
  writeEvent(state, enterTag(state, CODE, flags), cursor.pos, length)
  openOpaqueLeaf(state, CODE, src.charCodeAt(cursor.pos), length)
  return true
}

/** C2-B-166: a row opens a table. `footer-rows` on its attribute line is read here (C2-B-187). */
function openTable(state: BlockState, end: number): boolean {
  const leaf = state.leaf
  const above = state.above
  const cursor = state.cursor
  const src = state.src
  const closing = rowClosingPipe(src, cursor.pos, end)
  if (closing < 0) return false
  let footerRows = 0
  if (above.takeAttributes) {
    // C2-B-210: a value that is no count has no effect.
    const value = attributeKeyValue(src, above.attributesStart, above.attributesEnd, 'footer-rows')
    footerRows = Math.max(0, countValue(value))
  }
  writeEvent(state, enterTag(state, TABLE, 0), cursor.pos, footerRows)
  leaf.kind = TABLE
  leaf.tableHeadRows = 0
  leaf.tableHeadOpen = true
  writeRow(state, closing, end)
  return true
}

/** A row or a continuation row of the open table. Returns false for any other line (C2-B-170). */
function tableLine(state: BlockState, end: number): boolean {
  const cursor = state.cursor
  const src = state.src
  const closing = rowClosingPipe(src, cursor.pos, end)
  if (closing >= 0) {
    writeRow(state, closing, end)
    return true
  }
  const last = (shapesAt(state) & SHAPE_CONTINUATION_ROW) === 0 ? -1 : continuationClosingPipe(src, cursor.pos, end)
  if (last < 0) return false
  // C2-B-184, C2-B-185: a fragment is plain text for the cell of its column in the row above.
  writeEvent(state, eventTag(ENTER, ROW, FLAG_CONTINUATION), cursor.pos, 0)
  let start = cursor.pos + 1
  for (const stop of separatorPipes(src, start, last + 1)) {
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
  const leaf = state.leaf
  const cursor = state.cursor
  const src = state.src
  const attribute = rowAttributeStart(src, closing, end)
  writeEvent(state, eventTag(ENTER, ROW, 0), cursor.pos, attribute < 0 ? 0 : attribute)
  let headers = 0
  let others = 0
  let pipe = cursor.pos
  for (const next of separatorPipes(src, pipe + 1, closing + 1)) {
    const flags = writeCell(state, pipe, next)
    if ((flags & FLAG_HEADER) !== 0) headers++
    else if ((flags & (FLAG_SPAN_LEFT | FLAG_SPAN_UP)) === 0) others++
    pipe = next
  }
  writeEvent(state, eventTag(EXIT, ROW, 0), end, 0)
  state.contentEnd = end
  // C2-B-178: the head is the leading rows made only of header cells. A span mark joins another cell and is none itself.
  leaf.tableHeadOpen = leaf.tableHeadOpen && headers > 0 && others === 0
  if (leaf.tableHeadOpen) leaf.tableHeadRows++
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
  const above = state.above
  const cursor = state.cursor
  if (!isAttributeLine(state.src, cursor.pos, end)) return false
  if (!above.takeAttributes) above.attributesStart = cursor.pos
  above.attributesEnd = end
  writeLeafLine(state, enterTag(state, ATTRIBUTES, 0), ATTRIBUTES, end)
  above.attributesDepth = state.containers.depth
  return true
}

function openInclude(state: BlockState, end: number): boolean {
  if (!isIncludeLine(state.src, state.cursor.pos, end)) return false
  writeLeafLine(state, enterTag(state, INCLUDE, 0), INCLUDE, end)
  return true
}

/** C2-B-081: a link or abbreviation definition stands at column 0 outside every container. */
function openDefinitionLine(state: BlockState, kind: number, lineStart: number, end: number): boolean {
  const cursor = state.cursor
  if (cursor.pos !== lineStart || state.containers.depth !== 1) return false
  const pos = cursor.pos
  const matches = kind === LINK_DEFINITION ? isLinkDefinition(state.src, pos, end) : isAbbreviation(state.src, pos, end)
  if (!matches) return false
  writeLeafLine(state, enterTag(state, kind, 0), kind, end)
  return true
}

/** A leaf of one line whose span is the line from the cursor on. */
function writeLeafLine(state: BlockState, tag: number, kind: number, end: number): void {
  const cursor = state.cursor
  writeEvent(state, tag, cursor.pos, 0)
  writeEvent(state, SPAN_TAG, cursor.pos, end)
  writeEvent(state, eventTag(EXIT, kind, 0), end, 0)
}

function writeComment(state: BlockState, end: number): void {
  writeLeafLine(state, eventTag(ENTER, COMMENT, 0), COMMENT, end)
  state.contentEnd = end
}

function openTextLeaf(state: BlockState, kind: number, contentStart: number, end: number): void {
  const leaf = state.leaf
  writeEvent(state, SPAN_TAG, contentStart, end)
  leaf.kind = kind
  leaf.start = contentStart
  leaf.end = end
  leaf.lines = 1
}

function openOpaqueLeaf(state: BlockState, kind: number, fenceChar: number, length: number): void {
  const leaf = state.leaf
  const cursor = state.cursor
  leaf.kind = kind
  leaf.fenceChar = fenceChar
  leaf.fenceLength = length
  leaf.fenceColumn = cursor.column - cursor.origin
  state.above.heldBlankLine = NO_LINE
}

/** C2-B-067, C2-B-069, C2-B-075: a term is one leaf of its description list. */
function openTerm(state: BlockState, end: number): boolean {
  const containers = state.containers
  const cursor = state.cursor
  const markEnd = termMarkEnd(state.src, cursor.pos, end)
  if (markEnd < 0) return false
  if (containers.kind[containers.depth - 1] !== DESCRIPTION_LIST) {
    if (containers.depth > MAX_DEPTH) return false
    push(state, DESCRIPTION_LIST, 0, cursor.pos, 0, cursor.column - cursor.origin)
  }
  writeEvent(state, enterTag(state, TERM, 0), cursor.pos, 0)
  openTextLeaf(state, TERM, skipSpaces(state.src, markEnd, end), end)
  return true
}

/** C2-B-125: a bare colon run closes the innermost open div it is long enough for, and otherwise opens an anonymous div. */
function openBareRun(state: BlockState, end: number): boolean {
  const containers = state.containers
  const cursor = state.cursor
  const src = state.src
  const length = divRunLength(src, cursor.pos, end)
  if (length === 0 || skipSpaces(src, cursor.pos + length, end) !== end) return false
  for (let index = containers.depth - 1; containers.kind[index] === DIV; index--) {
    if (containers.column[index]! > length) continue
    const captioned = (containers.style[index]! & (FLAG_QUOTE_FENCE | FLAG_FIGURE)) !== 0
    state.contentEnd = end
    closeTo(state, index, index)
    // C2-B-147: a quote fence and a figure group take a caption.
    if (captioned) state.above.captionDepth = containers.depth
    return true
  }
  return pushDiv(state, 0, length)
}

/** C2-B-126: a colon run followed by a name or a sigil always opens a div or a line block. */
function openDiv(state: BlockState, end: number): boolean {
  const src = state.src
  const pos = state.cursor.pos
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
  const containers = state.containers
  if (containers.depth > MAX_DEPTH) return false
  push(state, DIV, style, state.cursor.pos, length, length)
  containers.style[containers.depth - 1] = style
  return true
}

/** The tag of an enter event. The first block of a line takes the pending attribute lines (C2-B-091). */
function enterTag(state: BlockState, kind: number, flags: number): number {
  const above = state.above
  if (above.takeAttributes) {
    above.takeAttributes = false
    flags |= FLAG_ATTRIBUTES
  }
  return eventTag(ENTER, kind, flags)
}

function push(state: BlockState, kind: number, flags: number, pos: number, aux: number, column: number): void {
  const containers = state.containers
  const depth = containers.depth
  containers.kind[depth] = kind
  containers.column[depth] = column
  containers.style[depth] = 0
  containers.loose[depth] = 0
  containers.depth = depth + 1
  writeEvent(state, enterTag(state, kind, flags), pos, aux)
}

/** Closes the open leaf or table. The facts of a leaf are set here (C2-B-191). */
function closeLeaf(state: BlockState): void {
  const leaf = state.leaf
  const kind = leaf.kind
  if (kind === NO_LEAF) return
  leaf.kind = NO_LEAF
  if (kind === TABLE) {
    // C2-B-147: a table takes a caption.
    writeEvent(state, eventTag(EXIT, TABLE, 0), state.contentEnd, leaf.tableHeadRows)
    state.above.captionDepth = state.containers.depth
    return
  }
  writeEvent(state, eventTag(EXIT, kind, leafFacts(state, kind)), state.contentEnd, 0)
}

function leafFacts(state: BlockState, kind: number): number {
  const leaf = state.leaf
  const above = state.above
  if (isOpaqueLeaf(kind)) {
    if (above.heldBlankLine !== NO_LINE) {
      // C2-B-113: the blank lines an unclosed leaf did not take stand between blocks.
      above.blankCount = state.lineCount - 1 - above.heldBlankLine
      above.heldBlankLine = NO_LINE
    }
    // C2-B-111, C2-B-163.
    return FLAG_UNCLOSED
  }
  if (kind !== PARAGRAPH || leaf.lines !== 1) return 0
  // C2-B-157, C2-B-158: a paragraph that closes holding nothing but one image or one display math span (block image, block math).
  if (isImageOnly(state.src, leaf.start, leaf.end)) return FLAG_IMAGE
  return isDisplayMathOnly(state.src, leaf.start, leaf.end) ? FLAG_BLOCK_MATH : 0
}

/**
 * Closes the open leaf and the containers above stack index `depth`. Tightness is set here (C2-B-191), and a div
 * other than `closed`, the one its closer ends, is marked as ending without one (C2-B-111).
 */
function closeTo(state: BlockState, depth: number, closed = -1): void {
  closeLeaf(state)
  const containers = state.containers
  while (containers.depth > depth) {
    const index = --containers.depth
    const kind = containers.kind[index]!
    let flags = isList(kind) && containers.loose[index] === 0 ? FLAG_TIGHT : 0
    if (kind === DIV && index !== closed) flags = FLAG_UNCLOSED
    writeEvent(state, eventTag(EXIT, kind, flags), state.contentEnd, 0)
  }
}
