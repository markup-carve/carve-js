import {
  type BlockSink, BULLET_LIST, CODE, DOCUMENT, HEADING, ITEM, ORDERED_LIST, PARAGRAPH, QUOTE,
} from './kinds.ts'
import {
  BACKTICK, bulletContentStart, CR, decimalAt, EQUALS, fenceOpenerLength, GREATER, HASH,
  headingLevel, HYPHEN, isFenceCloser, listContentStart, orderedContentStart, quoteMarkEnd,
  skipSpaces, SPACE, STAR, TAB,
} from './lines.ts'

const MAX_DEPTH = 200
const TAB_STOP = 4
const NO_LEAF = -1

class ContainerStack {
  readonly kind = new Uint8Array(MAX_DEPTH)
  readonly column = new Int32Array(MAX_DEPTH)
  readonly style = new Int32Array(MAX_DEPTH)
}

// One stack for every scan, made on first use: allocating these per parse
// added a third to the parse of a 1 KB document. Scans must not nest.
let sharedStack: ContainerStack | null = null

/**
 * Block pass over one source string: one forward loop over lines, an explicit
 * container stack, no recursion. It reports to a sink and builds nothing itself.
 */
export class BlockScanner<S extends BlockSink> {
  private readonly src: string
  private readonly sink: S

  // Container stack. `stackColumn` is the marker column of a list or an item.
  private readonly stackKind: Uint8Array
  private readonly stackColumn: Int32Array
  private readonly stackStyle: Int32Array
  private depth = 0

  // The open leaf: NO_LEAF, PARAGRAPH or CODE.
  private leaf = NO_LEAF
  private fenceLength = 0
  private fenceColumn = 0

  // Cursor within the current line, after the prefixes matched so far.
  private pos = 0
  private column = 0
  private lastContentEnd = 0

  constructor(src: string, sink: S) {
    this.src = src
    this.sink = sink
    const stack = (sharedStack ??= new ContainerStack())
    this.stackKind = stack.kind
    this.stackColumn = stack.column
    this.stackStyle = stack.style
  }

  scan(): void {
    const src = this.src
    const length = src.length
    this.push(DOCUMENT, 0, 0, 0, 0)
    let lineStart = 0
    while (lineStart < length) {
      let lineEnd = src.indexOf('\n', lineStart)
      if (lineEnd < 0) lineEnd = length
      const next = lineEnd + 1
      if (lineEnd > lineStart && src.charCodeAt(lineEnd - 1) === CR) lineEnd--
      this.line(lineStart, lineEnd)
      lineStart = next
    }
    this.lastContentEnd = length
    this.closeTo(0)
  }

  private line(start: number, end: number): void {
    this.pos = start
    this.column = 0
    const matched = this.matchContainers(end)
    const blank = this.pos >= end

    if (this.leaf === CODE) {
      if (matched === this.depth) {
        this.fenceLine(start, end, blank)
        return
      }
      // A fence ends with its container and never turns back into text.
      this.closeLeaf()
    }
    if (blank) {
      this.closeLeaf()
      if (matched < this.depth) this.closeTo(matched)
      return
    }
    if (this.leaf === PARAGRAPH) {
      if (!this.interruptsParagraph(matched, end)) {
        this.sink.span(this.pos, end)
        this.lastContentEnd = end
        return
      }
      this.closeLeaf()
    }
    this.closeUnowned(matched, end)
    this.openBlocks(end)
    this.lastContentEnd = end
  }

  /**
   * Walks the open containers outside-in and returns how many of them the
   * line carries. A quote needs its mark. An item needs the line indented
   * past its marker; a blank line passes every list and item. A list has no
   * prefix of its own, so the result can point at an item whose list above it
   * is still undecided (see `closeUnowned`).
   */
  private matchContainers(end: number): number {
    const src = this.src
    const depth = this.depth
    this.skipIndent(end)
    let index = 1
    for (; index < depth; index++) {
      const kind = this.stackKind[index]
      if (kind === QUOTE) {
        if (this.pos >= end || src.charCodeAt(this.pos) !== GREATER) break
        const after = quoteMarkEnd(src, this.pos, end)
        if (after < 0) break
        this.column += after - this.pos
        this.pos = after
        this.skipIndent(end)
      } else if (kind === ITEM) {
        if (this.pos < end && this.column <= this.stackColumn[index]!) break
      }
    }
    return index
  }

  /** Moves the cursor to the first character that is not indent. A tab counts to the next tab stop. */
  private skipIndent(end: number): void {
    const src = this.src
    let pos = this.pos
    let column = this.column
    while (pos < end) {
      const code = src.charCodeAt(pos)
      if (code === SPACE) column++
      else if (code === TAB) column += TAB_STOP - (column % TAB_STOP)
      else break
      pos++
    }
    this.pos = pos
    this.column = column
  }

  private fenceLine(lineStart: number, end: number, blank: boolean): void {
    if (!blank && isFenceCloser(this.src, this.pos, end, this.fenceLength)) {
      this.lastContentEnd = end
      this.closeLeaf()
      return
    }
    // Content is stripped by at most the opener's indent.
    const extra = this.column - this.fenceColumn
    const contentStart = extra > 0 ? Math.max(lineStart, this.pos - extra) : this.pos
    this.sink.span(contentStart, end)
    this.lastContentEnd = end
  }

  /** Only a fence opener and a list marker end an open paragraph without a blank line. */
  private interruptsParagraph(matched: number, end: number): boolean {
    const src = this.src
    if (src.charCodeAt(this.pos) === BACKTICK && fenceOpenerLength(src, this.pos, end) > 0) return true
    if (matched === this.depth) {
      // A marker past the marker of the item the paragraph sits in opens a nested list.
      return this.stackKind[matched - 1] === ITEM && listContentStart(src, this.pos, end) >= 0
    }
    if (this.isSiblingMarker(matched, end)) return true
    // A marker line with the item's indent and no quote mark closes a quote that sits in the item.
    return this.stackKind[matched] === QUOTE && this.stackKind[matched - 1] === ITEM &&
      listContentStart(src, this.pos, end) >= 0
  }

  /** True when the walk stopped at an item and the line is a marker that continues that item's list. */
  private isSiblingMarker(matched: number, end: number): boolean {
    if (this.stackKind[matched] !== ITEM) return false
    if (listContentStart(this.src, this.pos, end) < 0) return false
    // Left of an outermost list the marker is not a sibling; between two open lists it joins the deeper one.
    return this.column >= this.stackColumn[matched - 1]! || this.stackKind[matched - 2] === ITEM
  }

  /** Closes the containers the line does not belong to. */
  private closeUnowned(matched: number, end: number): void {
    if (matched === this.depth) return
    if (this.stackKind[matched] === ITEM && !this.isSiblingMarker(matched, end)) {
      this.closeTo(matched - 1)
    } else {
      this.closeTo(matched)
    }
  }

  /** Opens the blocks that start at the cursor. Containers may stack on one line. */
  private openBlocks(end: number): void {
    const src = this.src
    while (this.depth < MAX_DEPTH - 1) {
      const code = src.charCodeAt(this.pos)
      let opened = false
      switch (code) {
        case GREATER:
          opened = this.openQuote(end)
          break
        case HYPHEN:
        case STAR:
          opened = this.openItem(BULLET_LIST, code, bulletContentStart(src, this.pos, end))
          break
        case 48: case 49: case 50: case 51: case 52:
        case 53: case 54: case 55: case 56: case 57:
          opened = this.openItem(ORDERED_LIST, 0, orderedContentStart(src, this.pos, end))
          break
        case EQUALS:
        case HASH:
          if (this.openHeading(end)) return
          break
        case BACKTICK:
          if (this.openFence(end)) return
          break
      }
      if (!opened) break
      if (this.pos >= end) return
    }
    this.leaf = PARAGRAPH
    this.sink.enter(PARAGRAPH, this.pos, 0)
    this.sink.span(this.pos, end)
  }

  private openQuote(end: number): boolean {
    const after = quoteMarkEnd(this.src, this.pos, end)
    if (after < 0) return false
    this.push(QUOTE, this.pos, 0, this.column, 0)
    this.column += after - this.pos
    this.pos = after
    this.skipIndent(end)
    return true
  }

  /** Opens an item, and a list around it unless the open list on top takes it as a sibling. */
  private openItem(listKind: number, style: number, contentStart: number): boolean {
    if (contentStart < 0) return false
    const top = this.depth - 1
    const topKind = this.stackKind[top]!
    const topIsList = topKind === BULLET_LIST || topKind === ORDERED_LIST
    if (topIsList && (topKind !== listKind || this.stackStyle[top] !== style)) this.closeTo(top)
    if (this.stackKind[this.depth - 1] !== listKind) {
      const aux = listKind === ORDERED_LIST ? decimalAt(this.src, this.pos) : style
      this.push(listKind, this.pos, aux, this.column, style)
    }
    this.push(ITEM, this.pos, 0, this.column, 0)
    this.column += contentStart - this.pos
    this.pos = contentStart
    return true
  }

  private openHeading(end: number): boolean {
    const src = this.src
    const level = headingLevel(src, this.pos, end)
    if (level === 0) return false
    this.sink.enter(HEADING, this.pos, level)
    this.sink.span(skipSpaces(src, this.pos + level + 1, end), end)
    this.sink.exit(HEADING, end)
    return true
  }

  private openFence(end: number): boolean {
    const length = fenceOpenerLength(this.src, this.pos, end)
    if (length === 0) return false
    this.leaf = CODE
    this.fenceLength = length
    this.fenceColumn = this.column
    this.sink.enter(CODE, this.pos, length)
    return true
  }

  private push(kind: number, pos: number, aux: number, column: number, style: number): void {
    const depth = this.depth
    this.stackKind[depth] = kind
    this.stackColumn[depth] = column
    this.stackStyle[depth] = style
    this.depth = depth + 1
    this.sink.enter(kind, pos, aux)
  }

  private closeLeaf(): void {
    if (this.leaf === NO_LEAF) return
    this.sink.exit(this.leaf, this.lastContentEnd)
    this.leaf = NO_LEAF
  }

  private closeTo(depth: number): void {
    this.closeLeaf()
    while (this.depth > depth) {
      this.depth--
      this.sink.exit(this.stackKind[this.depth]!, this.lastContentEnd)
    }
  }
}
