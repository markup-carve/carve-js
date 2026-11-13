// The facts of the source-layout record that one block states about itself (C2-L-016 to C2-L-018,
// C2-L-023 to C2-L-028, C2-L-045), read from the block tree and the source.
import { type AstNode } from './ast.ts'
import { COLON, GREATER, HYPHEN, STAR } from './chars.ts'
import {
  ABBREVIATION, CAPTION, CODE, COMMENT, COMMENT_BLOCK, DESCRIPTION, DIV, FLAG_AUTO, FLAG_HARD_BREAKS, FLAG_UNCLOSED,
  FOOTNOTE, FRONTMATTER, HEADING, ITEM, LINE_BLOCK, LINK_DEFINITION, ORDERED_LIST, PARAGRAPH, QUOTE, TABLE, TERM,
  THEMATIC_BREAK,
} from './kinds.ts'
import type { NodeLayout } from './layout.ts'
import { columnOf, lineEndOf, lineStartOf, readPrefix } from './layout-lines.ts'
import {
  bulletMarkerEnd, descriptionMarkEnd, footnoteMarkerEnd, isWord, orderedDelimiter, orderedMarkerEnd, skipSpaces,
  taskBoxEnd, trimEnd,
} from './lines.ts'
import { definitionLabel } from './opener.ts'
import { isSpaceOrTab } from './source.ts'
import { type BlockNode } from './tree.ts'
import { HARD_BREAKS_CLASS } from './tree-tables.ts'

export type Facts = Omit<NodeLayout, 'path' | 'startByte' | 'endByte'>

const FRONTMATTER_RUN = 3

/** `quotes` is the number of open quotes with a mark around the block (C2-B-003). */
type Measure = (src: string, node: AstNode, origin: BlockNode, quotes: number, facts: Facts) => void

function setMarker(src: string, start: number, end: number, quotes: number, facts: Facts): void {
  facts.markerRaw = src.slice(start, end)
  facts.markerColumn = columnOf(src, start, quotes)
}

/** True when a line of a paragraph below `node` stands behind `first` and left of `column`. */
function hasLazyLine(src: string, node: BlockNode, first: number, column: number, quotes: number): boolean {
  for (const child of node.children ?? []) {
    if (child.children !== null) {
      if (hasLazyLine(src, child, first, column, quotes)) return true
    } else if (child.kind === PARAGRAPH) {
      const spans = child.spans!
      for (let at = 0; at < spans.length; at += 2) {
        if (spans[at]! > first && columnOf(src, spans[at]!, quotes) < column) return true
      }
    }
  }
  return false
}

/** C2-L-025: one value, in the order lazy, indent, marker_line, none. */
function continuationStyle(src: string, origin: BlockNode, column: number, quotes: number): NonNullable<Facts['continuationStyle']> {
  const first = src.indexOf('\n', origin.start)
  if (first < 0 || first >= origin.end) return 'marker_line'
  if (hasLazyLine(src, origin, first, column, quotes)) return 'lazy'
  let later = false
  for (let feed = first; feed >= 0 && feed + 1 < origin.end; feed = src.indexOf('\n', feed + 1)) {
    const end = lineEndOf(src, feed + 1)
    const at = skipSpaces(src, readPrefix(src, feed + 1, end, quotes).pos, end)
    if (at >= end) continue
    later = true
    if (columnOf(src, at, quotes) >= column) return 'indent'
  }
  return later ? 'none' : 'marker_line'
}

/** The content column and the continuation style of a container whose content starts at or behind `from` on its marker line. */
function setContent(src: string, origin: BlockNode, from: number, end: number, quotes: number, facts: Facts): void {
  const content = from < 0 ? end : skipSpaces(src, from, end)
  if (content >= end) return
  facts.contentColumn = columnOf(src, content, quotes)
  facts.continuationStyle = continuationStyle(src, origin, facts.contentColumn, quotes)
}

const itemFacts: Measure = (src, _node, origin, quotes, facts) => {
  const start = origin.start
  const end = lineEndOf(src, start)
  const first = src.charCodeAt(start)
  if (first === HYPHEN || first === STAR) {
    setMarker(src, start, start + 1, quotes, facts)
    const content = bulletMarkerEnd(src, start, end)
    // The task box is not content of the item, so the content starts behind it.
    setContent(src, origin, origin.aux !== 0 && content >= 0 ? taskBoxEnd(src, content, end) : content, end, quotes, facts)
    return
  }
  const delimiter = orderedDelimiter(src, start, end)
  setMarker(src, start, delimiter + 1, quotes, facts)
  setContent(src, origin, orderedMarkerEnd(src, start, delimiter, end), end, quotes, facts)
}

const descriptionFacts: Measure = (src, _node, origin, quotes, facts) => {
  const end = lineEndOf(src, origin.start)
  setMarker(src, origin.start, origin.start + 1, quotes, facts)
  setContent(src, origin, descriptionMarkEnd(src, origin.start, end), end, quotes, facts)
}

/** The marker of a definition is its label with the colon, and its separator is the colon with the space behind it. */
function setDefinition(src: string, origin: BlockNode, end: number, quotes: number, facts: Facts): void {
  const close = definitionLabel(src, origin.start)[1]
  setMarker(src, origin.start, close + 2, quotes, facts)
  facts.metadataSeparatorRaw = src.slice(close + 1, skipSpaces(src, close + 2, end))
}

const footnoteFacts: Measure = (src, _node, origin, quotes, facts) => {
  const end = lineEndOf(src, origin.start)
  setDefinition(src, origin, end, quotes, facts)
  setContent(src, origin, footnoteMarkerEnd(src, origin.start, end), end, quotes, facts)
}

const definitionFacts: Measure = (src, _node, origin, quotes, facts) => {
  setDefinition(src, origin, origin.end, quotes, facts)
}

const termFacts: Measure = (src, _node, origin, quotes, facts) => {
  setMarker(src, origin.start, origin.start + 2, quotes, facts)
  facts.metadataSeparatorRaw = src.slice(origin.start + 2, origin.spans![0])
}

const headingFacts: Measure = (src, _node, origin, quotes, facts) => {
  setMarker(src, origin.start, origin.start + origin.aux, quotes, facts)
}

const breakFacts: Measure = (src, _node, origin, quotes, facts) => {
  setMarker(src, origin.start, trimEnd(src, origin.start, origin.end), quotes, facts)
}

/** C2-L-045: the column of the innermost quote mark on the line of a comment inside a quote. */
const commentFacts: Measure = (src, _node, origin, quotes, facts) => {
  if (quotes === 0) return
  const prefix = readPrefix(src, lineStartOf(src, origin.start), origin.start, quotes - 1)
  const mark = skipSpaces(src, prefix.pos, origin.start)
  if (mark < origin.start && src.charCodeAt(mark) === GREATER) facts.markerColumn = columnOf(src, mark, quotes - 1)
}

/** The run of the character before `stop` that ends there, as its start. */
function runStart(src: string, line: number, stop: number): number {
  const code = src.charCodeAt(stop - 1)
  let run = stop
  while (run > line && src.charCodeAt(run - 1) === code) run--
  return run
}

/** C2-L-027: the opener run and the closer run of a block that ends at a closer line, the closer empty where there is none. */
function setFence(src: string, origin: BlockNode, length: number, facts: Facts): void {
  facts.openerRaw = src.slice(origin.start, origin.start + length)
  if ((origin.exitFlags & FLAG_UNCLOSED) !== 0) {
    facts.closerRaw = ''
    return
  }
  const line = lineStartOf(src, origin.end)
  const stop = trimEnd(src, line, origin.end)
  facts.closerRaw = src.slice(runStart(src, line, stop), stop)
}

/** True when a block inside `node` that ends on the same line takes a colon run of `length` as its own closer (C2-B-125). */
function closesInner(node: BlockNode, length: number): boolean {
  let at = node
  for (;;) {
    const children = at.children
    if (children === null || children.length === 0) return false
    const last = children[children.length - 1]!
    if (last.end !== node.end) return false
    if (last.kind === DIV && last.aux <= length) return true
    if (last.kind === LINE_BLOCK && (last.exitFlags & FLAG_UNCLOSED) === 0) return true
    at = last
  }
}

/** The closer run of a div, or the empty string for a div that ends without one. */
function divCloser(src: string, origin: BlockNode): string {
  const line = lineStartOf(src, origin.end)
  if (line === lineStartOf(src, origin.start)) return ''
  const stop = trimEnd(src, line, origin.end)
  if (stop === line || src.charCodeAt(stop - 1) !== COLON) return ''
  const run = runStart(src, line, stop)
  for (let pos = line; pos < run; pos++) {
    const code = src.charCodeAt(pos)
    if (!isSpaceOrTab(code) && code !== GREATER) return ''
  }
  return stop - run < origin.aux || closesInner(origin, stop - run) ? '' : src.slice(run, stop)
}

const divFacts: Measure = (src, node, origin, _quotes, facts) => {
  if (node.type === 'figure_group') return
  // C2-L-017.
  if (node.type === 'block_quote') facts.fenced = true
  // C2-L-018.
  if (node.type === 'div' && node.attrs?.classes?.includes(HARD_BREAKS_CLASS) === true) {
    facts.hardBreakOpener = (origin.flags & FLAG_HARD_BREAKS) !== 0
  }
  facts.openerRaw = src.slice(origin.start, origin.start + origin.aux)
  facts.closerRaw = divCloser(src, origin)
}

const codeFacts: Measure = (src, node, origin, _quotes, facts) => {
  if (node.type !== 'table') return setFence(src, origin, origin.aux, facts)
  // C2-L-023: a delimited table.
  facts.sourceFormat = isWord(src, origin.start + origin.aux, lineEndOf(src, origin.start), 'tsv') ? 'tsv' : 'csv'
}

const MEASURES = new Map<number, Measure>([
  [QUOTE, (_src, _node, _origin, _quotes, facts) => {
    facts.fenced = false
  }],
  // C2-L-016: the form of the first marker.
  [ORDERED_LIST, (_src, _node, origin, _quotes, facts) => {
    facts.bare = (origin.flags & FLAG_AUTO) !== 0
  }],
  [ITEM, itemFacts],
  [DESCRIPTION, descriptionFacts],
  [FOOTNOTE, footnoteFacts],
  [DIV, divFacts],
  [TABLE, (_src, _node, _origin, _quotes, facts) => {
    facts.sourceFormat = 'pipe'
  }],
  [TERM, termFacts],
  [CAPTION, (_src, _node, _origin, _quotes, facts) => {
    facts.attachment = 'preceding'
  }],
  [CODE, codeFacts],
  [COMMENT_BLOCK, (src, _node, origin, _quotes, facts) => setFence(src, origin, origin.aux, facts)],
  [LINE_BLOCK, (src, _node, origin, _quotes, facts) => setFence(src, origin, origin.aux, facts)],
  [FRONTMATTER, (src, _node, origin, _quotes, facts) => setFence(src, origin, FRONTMATTER_RUN, facts)],
  [HEADING, headingFacts],
  [THEMATIC_BREAK, breakFacts],
  [COMMENT, commentFacts],
  [LINK_DEFINITION, definitionFacts],
  [ABBREVIATION, definitionFacts],
])

/** Adds to `facts` what the block `origin` of the node `node` states about its own spelling. */
export function measureBlock(src: string, node: AstNode, origin: BlockNode, quotes: number, facts: Facts): void {
  MEASURES.get(origin.kind)?.(src, node, origin, quotes, facts)
}
