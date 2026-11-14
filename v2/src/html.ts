// The block elements of spec/0.2/html.md, the sections of C2-H-026 and the footnote section.
import {
  type AdmonitionNode, type Block, type BlockExtensionNode, type BlockQuoteNode, type CaptionNode, type CellParagraphNode,
  type CodeBlockNode, DEFINITION_TYPES, type DefinitionDescriptionNode, type DirectiveNode, type DivNode, type DocumentNode,
  type FigureGroupNode, type FigureNode, type HeadingNode, type IncludeNode, type LineBlockNode, type LineNode, type ListItemNode,
  type ListNode, type Marker, type Node, type NodeOfType, type ParagraphNode, type RawBlockNode, type TableBodyNode,
  type TableCellNode, type TableColumnNode, type TableFootNode, type TableHeadNode, type TableNode, type TableRowNode,
} from './ast.ts'
import { blockText } from './ast-text.ts'
import { type Findings } from './diagnostics.ts'
import {
  attributes, escapeAttribute, escapeText, loss, type Pair, type Render, type TagParts,
} from './html-attributes.ts'
import { inlineHtml } from './html-inline.ts'
import { type Settings } from './options.ts'
import { includeSource } from './include.ts'
import { PROFILES } from './render-tables.ts'
import { hasAuthoredName, headMarks, type Note, type Resolution } from './resolve.ts'
import { LINE_BLOCK_CLASS, TASK_CHECKED, TASK_NO_STATE } from './tree-tables.ts'

/** A writer per block type, each of which reads a node of its own type. */
type BlockWriters = { [T in keyof NodeOfType]?: (r: Render, node: NodeOfType[T], level: number) => void }

/** A node with children. */
type Parent = Extract<Node, { children: unknown[] }>

type TableGroup = TableHeadNode | TableBodyNode | TableFootNode

const MAX_HEADING_ELEMENT = 6
const INVISIBLE = ['comment', 'frontmatter', ...DEFINITION_TYPES]
const ALPHA_STYLES = ['a', 'A', 'i', 'I']
const NO_CLASSES: readonly string[] = []
const GROUP_CLASSES: readonly string[] = ['carve-figure-group']
const PANEL_CLASSES: readonly string[] = ['carve-figure-panel']

const CACHED_LEVELS = 64
// C2-H-005: a line break and two spaces per level, for the levels a document usually has.
const LINE_STARTS: readonly string[] = Array.from({ length: CACHED_LEVELS }, (_, level) => `\n${'  '.repeat(level)}`)

/** Adds one line to the output, indented by `level`. */
function line(r: Render, level: number, text: string): void {
  r.out += (level < CACHED_LEVELS ? LINE_STARTS[level]! : `\n${'  '.repeat(level)}`) + text
  r.count++
}

/** Adds one line as it stands, with no indent. */
function rawLine(r: Render, text: string): void {
  r.out += `\n${text}`
  r.count++
}

const NO_PARTS: TagParts = {}

/** True for a node whose element takes nothing from it: no attribute, no language and no source line. */
function isPlain(r: Render, node: Node): boolean {
  return node.attrs === undefined && node.lang === undefined && !r.settings.sourceLines
}

function tag(r: Render, node: Node | null, parts: TagParts = NO_PARTS): string {
  // Most blocks carry no attribute and add none.
  if (parts === NO_PARTS && !r.settings.sourceLines && (node === null || (node.attrs === undefined && node.lang === undefined))) return ''
  return attributes(r, node, { ...parts, block: true })
}

function onlyComments(nodes: readonly Node[]): boolean {
  for (const child of nodes) if (child.type !== 'comment') return false
  return true
}

/** The blocks of `nodes` that write something: the list itself where all of them do. */
function visibleBlocks<N extends Node>(nodes: readonly N[]): readonly N[] {
  for (const node of nodes) if (!isVisible(node)) return nodes.filter(isVisible)
  return nodes
}

/** A block that writes something. C2-H-019: a paragraph that holds only comments writes nothing. */
function isVisible(node: Node): boolean {
  if (INVISIBLE.includes(node.type)) return false
  return node.type !== 'paragraph' || !onlyComments(node.children)
}

/** C2-H-020: a block image is a bare `<img>`; one whose reference does not resolve is text and keeps its `<p>`. */
function isBareImage(node: ParagraphNode): boolean {
  if (node.blockImage !== true) return false
  // A block image that a profile degraded holds its text and keeps its `<p>` (C2-H-165).
  for (const child of node.children) if (child.type === 'image') return child.key === undefined || child.src !== undefined
  return false
}

/** A paragraph that is written as `<p>`. */
function isTextParagraph(node: Node | undefined): node is ParagraphNode {
  return node !== undefined && node.type === 'paragraph' && !isBareImage(node)
}

/** Writes `node` through the writer of its type, where it has one. */
function writeBlock<T extends keyof NodeOfType>(r: Render, type: T, node: NodeOfType[T], level: number): void {
  BLOCKS[type]?.(r, node, level)
}

function writeBlocks(r: Render, nodes: readonly Node[], level: number): void {
  for (const node of nodes) writeBlock(r, node.type, node, level)
}

/** C2-H-008: a body that writes nothing keeps one empty line between its tags. */
function writeBody(r: Render, nodes: readonly Node[], level: number): void {
  const before = r.count
  writeBlocks(r, nodes, level)
  if (r.count === before) rawLine(r, '')
}

function container(name: string): (r: Render, node: Parent, level: number) => void {
  return (r, node, level) => {
    line(r, level, `<${name}${tag(r, node)}>`)
    writeBody(r, node.children, level + 1)
    line(r, level, `</${name}>`)
  }
}

const BLOCKQUOTE = container('blockquote')

function paragraphHtml(r: Render, node: ParagraphNode): string {
  const tail = r.backlinkHost === node ? r.backlinks : ''
  const open = isPlain(r, node) ? '<p>' : `<p${tag(r, node, { alignStyle: true })}>`
  return `${open}${inlineHtml(r, node.children)}${tail}</p>`
}

/** C2-H-122: in static mode a math block is its source as a code block. */
function staticMathBlock(r: Render, node: ParagraphNode): string {
  let value = ''
  for (const child of node.children) {
    if (child.type === 'math') {
      value = child.value
      break
    }
  }
  return `<pre${tag(r, node)}><code class="language-math">${escapeText(value.endsWith('\n') ? value : `${value}\n`)}</code></pre>`
}

function paragraph(r: Render, node: ParagraphNode, level: number): void {
  if (onlyComments(node.children)) return
  if (node.blockMath === true && r.settings.mode === 'static') {
    line(r, level, staticMathBlock(r, node))
    return
  }
  line(r, level, isBareImage(node) ? inlineHtml(r, node.children) : paragraphHtml(r, node))
}

function headingId(node: HeadingNode): string | undefined {
  return node.attrs?.id ?? node.generatedId
}

/** C2-H-023: under `roundtrip` a carrier says whether the id of a heading was authored or generated. */
function idCarriers(r: Render, node: HeadingNode): Pair[] {
  if (!r.settings.roundtrip || headingId(node) === undefined) return []
  return [[node.attrs?.id === undefined ? 'data-carve-generated-id' : 'data-carve-explicit-id', null]]
}

/** C2-H-021: `h1` to `h6`, and above them a `div` that keeps the true level. `inSection`: the section carries the id. */
function headingHtml(r: Render, node: HeadingNode, inSection: boolean): string {
  const level = node.level
  const name = level <= MAX_HEADING_ELEMENT ? `h${level}` : 'div'
  // The heading of a section that carries no attribute of its own, which is the usual one.
  if (inSection && level <= MAX_HEADING_ELEMENT && isPlain(r, node)) return `<${name}>${inlineHtml(r, node.children)}</${name}>`
  const structural: Pair[] = level <= MAX_HEADING_ELEMENT ? [] : [['role', 'heading'], ['aria-level', String(level)]]
  if (!inSection) structural.push(...idCarriers(r, node))
  const parts: TagParts = { structural, id: inSection ? null : headingId(node) ?? null, alignStyle: true }
  return `<${name}${tag(r, node, parts)}>${inlineHtml(r, node.children)}</${name}>`
}

/** C2-H-006: a quote whose only visible child is one paragraph is written on one line. */
function quote(r: Render, node: BlockQuoteNode, level: number): void {
  const visible = visibleBlocks(node.children)
  const first = visible[0]
  if (visible.length === 1 && isTextParagraph(first)) {
    line(r, level, `<blockquote${tag(r, node)}>${paragraphHtml(r, first)}</blockquote>`)
    return
  }
  BLOCKQUOTE(r, node, level)
}

/** C2-H-030, C2-H-031: the attributes an ordered list derives from its marker. */
function orderedAttributes(marker: Marker): Pair[] {
  const structural: Pair[] = []
  if (marker.style !== undefined && ALPHA_STYLES.includes(marker.style)) structural.push(['type', marker.style])
  if (marker.start !== undefined && marker.start !== 1) structural.push(['start', String(marker.start)])
  if (marker.delimiter === ')') structural.push(['data-delim', ')'])
  return structural
}

function listParts(r: Render, node: ListNode): TagParts {
  const marker = node.marker
  const structural: Pair[] = marker.kind === 'ordered' ? orderedAttributes(marker) : []
  if (r.settings.roundtrip) {
    if (marker.kind === 'bullet' && marker.char !== undefined && marker.char !== '-') structural.push(['data-marker', marker.char])
    // C2-H-138.
    if (node.spacing === 'tight') structural.push(['data-carve-tight', null])
  }
  const tasks = node.children.some((item) => item.task !== undefined)
  return tasks ? { structural, base: ['task-list'] } : { structural }
}

function list(r: Render, node: ListNode, level: number): void {
  const name = node.marker.kind === 'ordered' ? 'ol' : 'ul'
  line(r, level, `<${name}${tag(r, node, listParts(r, node))}>`)
  for (const item of node.children) listItem(r, item, level + 1, node.spacing === 'tight')
  line(r, level, `</${name}>`)
}

/** C2-H-032, C2-H-033: the opening tag of an item, with the box of a task item. */
function itemOpen(r: Render, node: ListItemNode): string {
  const task = node.task
  if (task === undefined) return `<li${tag(r, node)}>`
  const state: Pair[] = TASK_NO_STATE.includes(task.mark) ? [] : [['data-task-state', task.mark]]
  const checked = TASK_CHECKED.includes(task.mark) ? ' checked' : ''
  const label = escapeAttribute(blockText(node.children))
  return `<li${tag(r, node, { structural: state })}><input type="checkbox"${checked} disabled aria-label="${label}"> `
}

/** C2-H-007, C2-H-034, C2-H-035: the first paragraph stands on the line of `<li>`, bare in a tight list. */
function listItem(r: Render, node: ListItemNode, level: number, tight: boolean): void {
  const blocks = visibleBlocks(node.children)
  const first = blocks[0]
  let open = itemOpen(r, node)
  let rest = blocks
  if (isTextParagraph(first)) {
    // A bare paragraph has no element for attributes of its own, so one that carries any keeps its `<p>`.
    const bare = tight && first.attrs === undefined && first.lang === undefined
    open += bare ? inlineHtml(r, first.children) : paragraphHtml(r, first)
    rest = blocks.slice(1)
  }
  if (rest.length === 0) {
    line(r, level, `${open}</li>`)
    return
  }
  line(r, level, open)
  writeBlocks(r, rest, level + 1)
  line(r, level, '</li>')
}

/** C2-H-040: a description with one visible block writes a paragraph bare, unless it carries attributes (C2-H-018). */
function description(r: Render, node: DefinitionDescriptionNode, level: number): void {
  const blocks = node.children.filter(isVisible)
  const first = blocks[0]
  if (blocks.length <= 1 && (first === undefined || isTextParagraph(first))) {
    let text = ''
    const bare = first !== undefined && first.attrs === undefined && first.lang === undefined
    if (first !== undefined) text = bare ? inlineHtml(r, first.children) : paragraphHtml(r, first)
    line(r, level, `<dd${tag(r, node)}>${text}</dd>`)
    return
  }
  line(r, level, `<dd${tag(r, node)}>`)
  writeBlocks(r, blocks, level + 1)
  line(r, level, '</dd>')
}

/** C2-H-154: the title of the opener and then its label, each only when the author wrote it. */
function writeTitle(r: Render, node: AdmonitionNode | DivNode | DirectiveNode, level: number, id: string | null): void {
  const title = node.title
  if (title !== undefined) {
    line(r, level, `<p class="admonition-title"${id === null ? '' : ` id="${escapeAttribute(id)}"`}>${inlineHtml(r, title)}</p>`)
  }
  const label = node.groupLabel
  if (label !== undefined) line(r, level, `<p class="div-label">${escapeText(label)}</p>`)
}

/** C2-H-042, C2-H-157, C2-H-158: a div, and a directive that places nothing, are `<div>` with no name. */
function div(r: Render, node: DivNode | DirectiveNode, level: number): void {
  const base = node.type === 'directive' ? [node.kind] : NO_CLASSES
  const attrs = tag(r, node, { base, alignStyle: true })
  // C2-H-114: a div with no other attribute.
  line(r, level, `<div${attrs === '' && r.settings.roundtrip ? ' data-carve-div' : attrs}>`)
  const before = r.count
  writeTitle(r, node, level + 1, null)
  writeBlocks(r, node.children, level + 1)
  if (r.count === before) rawLine(r, '')
  line(r, level, '</div>')
}

function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** C2-H-155: the title names the element, or else the `labels` string of the kind; an authored name stops both. */
function admonitionName(r: Render, node: AdmonitionNode, id: string | null): Pair[] {
  if (id !== null) return [['aria-labelledby', id]]
  if (hasAuthoredName(node)) return []
  const kind = capitalized(node.kind)
  return [['aria-label', r.settings.labels[`admonition${kind}`] ?? kind]]
}

/** C2-H-154: an admonition is `<aside>` with the classes `admonition` and its kind. */
function admonition(r: Render, node: AdmonitionNode, level: number): void {
  const id = r.resolution.labelIds.get(node) ?? null
  line(r, level, `<aside${tag(r, node, { base: ['admonition', node.kind], generated: admonitionName(r, node, id) })}>`)
  const before = r.count
  writeTitle(r, node, level + 1, id)
  writeBlocks(r, node.children, level + 1)
  if (r.count === before) rawLine(r, '')
  line(r, level, '</aside>')
}

/** C2-H-065: a caption with one paragraph writes it bare; with several blocks every paragraph gets `<p>`. */
function captionLine(r: Render, caption: CaptionNode, name: string, level: number): void {
  const blocks = caption.children.filter(isVisible)
  const first = blocks[0]
  if (blocks.length === 1 && isTextParagraph(first)) {
    line(r, level, `<${name}>${inlineHtml(r, first.children)}</${name}>`)
    return
  }
  line(r, level, `<${name}>`)
  writeBlocks(r, blocks, level + 1)
  line(r, level, `</${name}>`)
}

function figureOf(r: Render, node: FigureNode | FigureGroupNode, level: number, base: readonly string[]): void {
  line(r, level, `<figure${tag(r, node, { base })}>`)
  const before = r.count
  const group = base === GROUP_CLASSES
  for (const child of node.children) {
    // C2-H-064: each panel of a group.
    if (group && child.type === 'figure') figureOf(r, child, level + 1, PANEL_CLASSES)
    else writeBlock(r, child.type, child, level + 1)
  }
  const caption = node.caption
  if (caption !== undefined) captionLine(r, caption, 'figcaption', level + 1)
  if (r.count === before) rawLine(r, '')
  line(r, level, '</figure>')
}

/**
 * C2-H-047, C2-H-048: the attributes go on `<pre>`, and an authored `title` key wins over the title of the opener.
 * `label`: the label of the opener, which `roundtrip` carries.
 */
function preHtml(r: Render, node: CodeBlockNode | RawBlockNode, language: string | undefined, title?: string, label?: string): string {
  const structural: Pair[] = []
  const authored = node.attrs?.keyValues?.some(([key]) => key.toLowerCase() === 'title') === true
  if (title !== undefined && !authored) structural.push(['title', title])
  if (r.settings.roundtrip && label !== undefined) structural.push(['data-carve-label', label])
  const code = language === undefined ? '<code>' : `<code class="language-${escapeAttribute(language)}">`
  return `<pre${tag(r, node, { structural })}>${code}${escapeText(node.value)}</code></pre>`
}

function codeBlock(r: Render, node: CodeBlockNode, level: number): void {
  const title = node.title?.map((part) => ('value' in part ? part.value : '')).join('')
  line(r, level, preHtml(r, node, node.syntax, title, node.groupLabel))
}

/** C2-H-050, C2-H-053, C2-H-054, C2-H-134. */
function rawBlock(r: Render, node: RawBlockNode, level: number): void {
  if (node.format !== 'html') {
    loss(r, node, 'raw-format-dropped', `raw content in the format ${node.format} is not written to HTML`)
    return
  }
  if (!r.settings.rawHtml) {
    line(r, level, preHtml(r, node, 'html'))
    return
  }
  const value = node.value
  rawLine(r, value.endsWith('\n') ? value.slice(0, -1) : value)
}

function leadingSpaces(text: string): number {
  let count = 0
  while (text[count] === ' ') count++
  return count
}

/** C2-H-043: the leading spaces of a line are written as `&nbsp;`, one per space. */
function lineHtml(r: Render, node: LineNode): string {
  const children = node.children
  const first = children[0]
  if (first?.type !== 'text') return inlineHtml(r, children)
  const spaces = leadingSpaces(first.value)
  return '&nbsp;'.repeat(spaces) + inlineHtml(r, [{ ...first, value: first.value.slice(spaces) }, ...children.slice(1)])
}

/** C2-H-043: one `<p>` per stanza, and every line break in it is `<br>`. */
function lineBlock(r: Render, node: LineBlockNode, level: number): void {
  const structural: Pair[] = r.settings.roundtrip ? [['data-carve-line-block', null]] : []
  line(r, level, `<div${tag(r, node, { last: [LINE_BLOCK_CLASS], structural })}>`)
  const before = r.count
  let stanza: string[] = []
  const flush = (): void => {
    if (stanza.length > 0) line(r, level + 1, `<p>${stanza.join('<br>\n')}</p>`)
    stanza = []
  }
  for (const child of node.children) {
    if (child.children.length === 0) flush()
    else stanza.push(lineHtml(r, child))
  }
  flush()
  if (r.count === before) rawLine(r, '')
  line(r, level, '</div>')
}

/** C2-H-133: an include directive that was not expanded is a paragraph that holds the directive as text, written as in C2-W-058. */
function include(r: Render, node: IncludeNode, level: number): void {
  loss(r, node, 'include-unresolved', `the include of ${node.path} was not expanded`)
  line(r, level, `<p>${escapeText(includeSource(node))}</p>`)
}

/** C2-A-127: an extension this engine does not know renders through its fallback. */
function blockExtension(r: Render, node: BlockExtensionNode, level: number): void {
  loss(r, node, 'extension-fallback-rendered', `the extension ${node.name} is rendered through its fallback`)
  writeBlocks(r, node.fallback, level)
}

// ---- tables ----

/** C2-B-213: each axis on its own: the mark of the cell, then that of the head cell of its column, then the column. */
function cellStyle(cell: TableCellNode, column: TableColumnNode | undefined, headValign: string | undefined): string {
  const align = cell.align ?? column?.resolvedAlign ?? column?.align
  const valign = cell.valign ?? headValign ?? column?.valign
  let declarations = align === undefined ? '' : `text-align: ${align};`
  if (valign !== undefined) declarations += `${declarations === '' ? '' : ' '}vertical-align: ${valign};`
  return declarations
}

function isCellParagraph(block: Block | CellParagraphNode): block is CellParagraphNode {
  return block.type === 'cell_paragraph'
}

function cellContent(r: Render, cell: TableCellNode): string {
  const blocks = cell.children
  if (blocks.every(isCellParagraph)) return blocks.map((block) => inlineHtml(r, block.children)).join(' ')
  // C2-A-175: blocks in a cell, which only a supplied tree holds.
  const inner: Render = { ...r, out: '', count: 0 }
  writeBlocks(inner, blocks, 0)
  return inner.out.slice(1)
}

/** C2-H-056 to C2-H-058. */
function cellHtml(
  r: Render, cell: TableCellNode, column: TableColumnNode | undefined, headValign: string | undefined, inHead: boolean,
): string {
  const name = cell.header ? 'th' : 'td'
  const structural: Pair[] = []
  const rowspan = cell.rowspan
  if (rowspan !== undefined && rowspan > 1) structural.push(['rowspan', String(rowspan)])
  const colspan = cell.colspan
  if (colspan !== undefined && colspan > 1) structural.push(['colspan', String(colspan)])
  if (cell.header) structural.push(['scope', inHead ? 'col' : 'row'])
  return `<${name}${attributes(r, cell, { structural, style: cellStyle(cell, column, headValign) })}>${cellContent(r, cell)}</${name}>`
}

/** The columns of a table, and the vertical mark each takes from the head (C2-B-213). */
interface TableLayout {
  columns: readonly TableColumnNode[]
  headValign: (string | undefined)[]
}

/** Moves `column` past the positions a row span from above covers, and counts each of them down. Returns the new column. */
function skipCovered(covered: number[], column: number): number {
  let at = column
  for (let left = covered[at] ?? 0; left > 0; left = covered[at] ?? 0) covered[at++] = left - 1
  return at
}

/**
 * The cells of one row with their columns. A row with span marks holds one cell per column
 * (C2-A-092); a row with counts alone covers the positions its counts give (C2-A-093).
 */
function rowHtml(r: Render, row: TableRowNode, layout: TableLayout, covered: number[], inHead: boolean): string {
  const cells = row.children
  const marked = cells.some((cell) => cell.span !== undefined)
  let html = ''
  let column = 0
  for (const cell of cells) {
    if (!marked) column = skipCovered(covered, column)
    const colspan = cell.colspan ?? 1
    if (cell.span === undefined) {
      html += cellHtml(r, cell, layout.columns[column], layout.headValign[column], inHead)
      const below = (cell.rowspan ?? 1) - 1
      if (!marked) for (let more = 0; more < colspan; more++) covered[column + more] = below
    }
    column += marked ? 1 : colspan
  }
  return `<tr${tag(r, row)}>${html}</tr>`
}

function writeRows(r: Render, layout: TableLayout, group: TableGroup, level: number, covered: number[]): void {
  for (const row of group.children) {
    if (row.type === 'table_row') line(r, level, rowHtml(r, row, layout, covered, group.type === 'table_head'))
  }
}

function isRow(row: Node): row is TableRowNode {
  return row.type === 'table_row'
}

/** C2-H-060: true when a row span crosses the end of its group. */
function spanCrossesGroup(groups: readonly TableGroup[]): boolean {
  for (const group of groups) {
    const rows = group.children.filter(isRow)
    const crosses = rows.some((row, index) => row.children.some((cell) => index + (cell.rowspan ?? 1) > rows.length))
    if (crosses) return true
  }
  return false
}

const GROUP_ELEMENTS: Readonly<Record<TableGroup['type'], string>> = { table_head: 'thead', table_body: 'tbody', table_foot: 'tfoot' }

function isGroup(node: TableNode['children'][number]): node is TableGroup {
  return node.type !== 'comment'
}

function writeGroups(r: Render, layout: TableLayout, groups: readonly TableGroup[], level: number): void {
  if (spanCrossesGroup(groups)) {
    const covered: number[] = []
    line(r, level, '<tbody>')
    for (const group of groups) writeRows(r, layout, group, level + 1, covered)
    line(r, level, '</tbody>')
    return
  }
  for (const group of groups) {
    // C2-H-055: an empty group is not written.
    if (!group.children.some(isRow)) continue
    const name = GROUP_ELEMENTS[group.type]
    line(r, level, `<${name}${tag(r, group)}>`)
    writeRows(r, layout, group, level + 1, [])
    line(r, level, `</${name}>`)
  }
}

const PERCENT_DIGITS = 10

/** C2-H-152: the width times 100 as a decimal number without trailing zeros. */
function percentText(width: number): string {
  const text = (width * 100).toFixed(PERCENT_DIGITS)
  let end = text.length
  while (text[end - 1] === '0') end--
  return text.slice(0, text[end - 1] === '.' ? end - 1 : end)
}

/** C2-H-152: one `<col>` per column when at least one column has a width. */
function writeColumnGroup(r: Render, columns: readonly TableColumnNode[], level: number): void {
  if (!columns.some((column) => column.width !== undefined)) return
  line(r, level, '<colgroup>')
  for (const column of columns) {
    const width = column.width
    line(r, level + 1, width === undefined ? '<col>' : `<col style="width: ${percentText(width)}%;">`)
  }
  line(r, level, '</colgroup>')
}

function table(r: Render, node: TableNode, level: number): void {
  line(r, level, `<table${tag(r, node)}>`)
  const caption = node.caption
  if (caption !== undefined) captionLine(r, caption, 'caption', level + 1)
  const layout: TableLayout = { columns: node.columns, headValign: headMarks(node, 'valign') }
  writeColumnGroup(r, layout.columns, level + 1)
  writeGroups(r, layout, node.children.filter(isGroup), level + 1)
  line(r, level, '</table>')
}

const BLOCKS: BlockWriters = {
  paragraph,
  heading: (r, node, level) => line(r, level, headingHtml(r, node, false)),
  block_quote: quote,
  list,
  definition_list: container('dl'),
  definition_term: (r, node, level) => line(r, level, `<dt${tag(r, node)}>${inlineHtml(r, node.children)}</dt>`),
  definition_description: description,
  div,
  directive: div,
  admonition,
  figure: (r, node, level) => figureOf(r, node, level, NO_CLASSES),
  figure_group: (r, node, level) => figureOf(r, node, level, GROUP_CLASSES),
  table,
  code_block: codeBlock,
  raw_block: rawBlock,
  line_block: lineBlock,
  // C2-H-046.
  thematic_break: (r, node, level) => line(r, level, `<hr${tag(r, node)}>`),
  include,
  // C2-H-142.
  section: container('section'),
  block_extension: blockExtension,
}

// ---- footnotes ----

/** C2-H-091: one backlink per reference of the note. */
function backlinksHtml(r: Render, note: Note): string {
  const label = r.settings.labels['footnoteBacklink'] ?? ''
  const single = note.refIds.length === 1
  return note.refIds.map((id, index) => {
    const ordinal = single ? '' : `<sup>${index + 1}</sup>`
    const text = escapeAttribute(single ? label : `${label} ${index + 1}`)
    return `<a href="#${escapeAttribute(id)}" role="doc-backlink" aria-label="${text}">↩${ordinal}</a>`
  }).join(' ')
}

function noteCarriers(r: Render, note: Note): string {
  if (!r.settings.roundtrip) return ''
  if (note.definition === null) return ' data-carve-inline-footnote'
  return ` data-carve-footnote-label="${escapeAttribute(note.definition.key)}"`
}

/** The body of a note. C2-H-090: that of an inline footnote is one paragraph. */
function noteBlocks(note: Note): Block[] {
  if (note.definition !== null) return note.definition.children
  return note.inline === null ? [] : [{ type: 'paragraph', children: [...note.inline.children] }]
}

function writeNote(r: Render, note: Note, level: number): void {
  const blocks = noteBlocks(note)
  const visible = blocks.filter(isVisible)
  const last = visible[visible.length - 1]
  r.backlinks = backlinksHtml(r, note)
  r.backlinkHost = isTextParagraph(last) ? last : null
  line(r, level, `<li id="fn${note.number}"${noteCarriers(r, note)}>`)
  writeBlocks(r, blocks, level + 1)
  if (r.backlinkHost === null) line(r, level + 1, `<p>${r.backlinks}</p>`)
  r.backlinkHost = null
  line(r, level, '</li>')
}

/**
 * C2-H-089: the footnotes in one section, in number order. C2-H-158: the title and the label of
 * the directive that places it are its first children, and a title names it.
 */
function writeNotes(r: Render, level: number, directive: DirectiveNode | null): void {
  const id = directive === null ? undefined : r.resolution.labelIds.get(directive)
  const label = r.settings.labels['endnotes'] ?? ''
  const name = id === undefined ? `aria-label="${escapeAttribute(label)}"` : `aria-labelledby="${escapeAttribute(id)}"`
  line(r, level, `<section role="doc-endnotes" ${name}>`)
  if (directive !== null) writeTitle(r, directive, level + 1, id ?? null)
  line(r, level + 1, '<hr>')
  line(r, level + 1, '<ol>')
  for (const note of r.resolution.notes) writeNote(r, note, level + 2)
  line(r, level + 1, '</ol>')
  line(r, level, '</section>')
}

// ---- the document ----

function isNotesDirective(node: Node): node is DirectiveNode {
  return node.type === 'directive' && node.kind === 'footnotes'
}

function closeSections(r: Render, open: number[], level: number): void {
  for (let top = open.at(-1); top !== undefined && top >= level; top = open.at(-1)) {
    open.pop()
    line(r, open.length, '</section>')
  }
}

function sectionAttributes(r: Render, node: HeadingNode, id: string | undefined): string {
  if (r.settings.roundtrip) return attributes(r, null, { structural: idCarriers(r, node), id: id ?? null })
  // Without the carriers of `roundtrip` a section carries its id and nothing else.
  return id === undefined ? '' : ` id="${escapeAttribute(id)}"`
}

/** C2-H-026, C2-H-027: a top-level heading opens a section that carries its id. */
function openSection(r: Render, node: HeadingNode, open: number[]): void {
  closeSections(r, open, node.level)
  const id = headingId(node)
  line(r, open.length, `<section${sectionAttributes(r, node, id)}>`)
  open.push(node.level)
  line(r, open.length, headingHtml(r, node, true))
}

/** Writes the blocks of the document; C2-H-093: the footnote section stands at a top-level directive or at the end. */
function writeDocument(r: Render, document: DocumentNode): void {
  const open: number[] = []
  const hasNotes = r.resolution.notes.length > 0
  let placed = false
  for (const node of document.children) {
    if (node.type === 'heading' && r.settings.sections) {
      openSection(r, node, open)
    } else if (isNotesDirective(node) && hasNotes && !placed) {
      placed = true
      // The blocks of the directive stand before the section, as in 0.1.
      writeBlocks(r, node.children, open.length)
      writeNotes(r, open.length, node)
    } else {
      writeBlock(r, node.type, node, open.length)
    }
  }
  closeSections(r, open, 0)
  if (hasNotes && !placed) writeNotes(r, 0, null)
}

interface RenderResult {
  html: string
  losses: Findings
}

/**
 * The HTML fragment of a resolved tree (C2-H-001). `losses` takes the losses of the render; `bidi` is
 * false where its text nodes are known to hold no bidirectional control (C2-H-172).
 */
export function renderDocument(
  document: DocumentNode, settings: Settings, resolution: Resolution, losses: Findings, bidi: boolean,
): RenderResult {
  const r: Render = {
    settings, resolution, out: '', count: 0, losses, linkRel: PROFILES.get(settings.profile)?.linkRel ?? '', linkDepth: 0, abbrDepth: 0,
    backlinkHost: null, backlinks: '', bidi,
  }
  writeDocument(r, document)
  return { html: r.out.slice(1), losses: r.losses }
}
