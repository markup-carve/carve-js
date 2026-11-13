// The block elements of spec/0.2/html.md, the sections of C2-H-026 and the footnote section.
import {
  type AstNode, childrenOf, colspanOf, columnsOf, DEFINITION_TYPES, keyOf, levelOf, type Marker, rowspanOf, valueOf,
} from './ast.ts'
import { blockText } from './ast-text.ts'
import { type Findings } from './diagnostics.ts'
import {
  attributes, escapeAttribute, escapeText, loss, type Pair, type Render, type TagParts,
} from './html-attributes.ts'
import { inlineHtml } from './html-inline.ts'
import { type Settings } from './options.ts'
import { PROFILES } from './render-tables.ts'
import { hasAuthoredName, headMarks, type Note, type Resolution } from './resolve.ts'
import { LINE_BLOCK_CLASS, TASK_CHECKED, TASK_NO_STATE } from './tree-tables.ts'

type BlockWriter = (r: Render, node: AstNode, level: number) => void

const MAX_HEADING_ELEMENT = 6
const INVISIBLE = ['comment', 'frontmatter', ...DEFINITION_TYPES]
const ALPHA_STYLES = ['a', 'A', 'i', 'I']

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
function isPlain(r: Render, node: AstNode): boolean {
  return node.attrs === undefined && node.lang === undefined && !r.settings.sourceLines
}

function tag(r: Render, node: AstNode | null, parts: TagParts = NO_PARTS): string {
  // Most blocks carry no attribute and add none.
  if (parts === NO_PARTS && !r.settings.sourceLines && (node === null || (node.attrs === undefined && node.lang === undefined))) return ''
  return attributes(r, node, { ...parts, block: true })
}

function onlyComments(node: AstNode): boolean {
  for (const child of childrenOf(node)) if (child.type !== 'comment') return false
  return true
}

/** The blocks of `nodes` that write something: the list itself where all of them do. */
function visibleBlocks(nodes: readonly AstNode[]): readonly AstNode[] {
  for (const node of nodes) if (!isVisible(node)) return nodes.filter(isVisible)
  return nodes
}

/** A block that writes something. C2-H-019: a paragraph that holds only comments writes nothing. */
function isVisible(node: AstNode): boolean {
  if (INVISIBLE.includes(node.type)) return false
  return node.type !== 'paragraph' || !onlyComments(node)
}

/** C2-H-020: a block image is a bare `<img>`; one whose reference does not resolve is text and keeps its `<p>`. */
function isBareImage(node: AstNode): boolean {
  if (node.blockImage !== true) return false
  const image = childrenOf(node).find((child) => child.type === 'image')
  return image === undefined || image.key === undefined || image.src !== undefined
}

/** A paragraph that is written as `<p>`. */
function isTextParagraph(node: AstNode | undefined): node is AstNode {
  return node !== undefined && node.type === 'paragraph' && !isBareImage(node)
}

function writeBlocks(r: Render, nodes: readonly AstNode[], level: number): void {
  for (const node of nodes) BLOCKS.get(node.type)?.(r, node, level)
}

/** C2-H-008: a body that writes nothing keeps one empty line between its tags. */
function writeBody(r: Render, nodes: readonly AstNode[], level: number): void {
  const before = r.count
  writeBlocks(r, nodes, level)
  if (r.count === before) rawLine(r, '')
}

function container(name: string, parts: (r: Render, node: AstNode) => TagParts = () => ({})): BlockWriter {
  return (r, node, level) => {
    line(r, level, `<${name}${tag(r, node, parts(r, node))}>`)
    writeBody(r, childrenOf(node), level + 1)
    line(r, level, `</${name}>`)
  }
}

function paragraphHtml(r: Render, node: AstNode): string {
  const tail = r.backlinkHost === node ? r.backlinks : ''
  const open = isPlain(r, node) ? '<p>' : `<p${tag(r, node, { alignStyle: true })}>`
  return `${open}${inlineHtml(r, childrenOf(node))}${tail}</p>`
}

/** C2-H-122: in static mode a math block is its source as a code block. */
function staticMathBlock(r: Render, node: AstNode): string {
  const math = childrenOf(node).find((child) => child.type === 'math')
  const value = math?.value ?? ''
  return `<pre${tag(r, node)}><code class="language-math">${escapeText(value.endsWith('\n') ? value : `${value}\n`)}</code></pre>`
}

function paragraph(r: Render, node: AstNode, level: number): void {
  if (onlyComments(node)) return
  if (node.blockMath === true && r.settings.mode === 'static') {
    line(r, level, staticMathBlock(r, node))
    return
  }
  line(r, level, isBareImage(node) ? inlineHtml(r, childrenOf(node)) : paragraphHtml(r, node))
}

function headingId(node: AstNode): string | undefined {
  return node.attrs?.id ?? node.generatedId
}

/** C2-H-023: under `roundtrip` a carrier says whether the id of a heading was authored or generated. */
function idCarriers(r: Render, node: AstNode): Pair[] {
  if (!r.settings.roundtrip || headingId(node) === undefined) return []
  return [[node.attrs?.id === undefined ? 'data-carve-generated-id' : 'data-carve-explicit-id', null]]
}

/** C2-H-021: `h1` to `h6`, and above them a `div` that keeps the true level. `inSection`: the section carries the id. */
function headingHtml(r: Render, node: AstNode, inSection: boolean): string {
  const level = levelOf(node)
  const name = level <= MAX_HEADING_ELEMENT ? `h${level}` : 'div'
  // The heading of a section that carries no attribute of its own, which is the usual one.
  if (inSection && level <= MAX_HEADING_ELEMENT && isPlain(r, node)) return `<${name}>${inlineHtml(r, childrenOf(node))}</${name}>`
  const structural: Pair[] = level <= MAX_HEADING_ELEMENT ? [] : [['role', 'heading'], ['aria-level', String(level)]]
  if (!inSection) structural.push(...idCarriers(r, node))
  const parts: TagParts = { structural, id: inSection ? null : headingId(node) ?? null, alignStyle: true }
  return `<${name}${tag(r, node, parts)}>${inlineHtml(r, childrenOf(node))}</${name}>`
}

/** C2-H-006: a quote whose only visible child is one paragraph is written on one line. */
function quote(r: Render, node: AstNode, level: number): void {
  const visible = visibleBlocks(childrenOf(node))
  if (visible.length === 1 && isTextParagraph(visible[0])) {
    line(r, level, `<blockquote${tag(r, node)}>${paragraphHtml(r, visible[0])}</blockquote>`)
    return
  }
  container('blockquote')(r, node, level)
}

/** C2-H-030, C2-H-031: the attributes an ordered list derives from its marker. */
function orderedAttributes(marker: Marker): Pair[] {
  const structural: Pair[] = []
  if (marker.style !== undefined && ALPHA_STYLES.includes(marker.style)) structural.push(['type', marker.style])
  if (marker.start !== undefined && marker.start !== 1) structural.push(['start', String(marker.start)])
  if (marker.delimiter === ')') structural.push(['data-delim', ')'])
  return structural
}

function listParts(r: Render, node: AstNode): TagParts {
  const marker = node.marker
  const structural: Pair[] = marker?.kind === 'ordered' ? orderedAttributes(marker) : []
  if (r.settings.roundtrip) {
    if (marker?.kind === 'bullet' && marker.char !== undefined && marker.char !== '-') structural.push(['data-marker', marker.char])
    // C2-H-138.
    if (node.spacing === 'tight') structural.push(['data-carve-tight', null])
  }
  const tasks = childrenOf(node).some((item) => item.task !== undefined)
  return tasks ? { structural, base: ['task-list'] } : { structural }
}

function list(r: Render, node: AstNode, level: number): void {
  const name = node.marker?.kind === 'ordered' ? 'ol' : 'ul'
  line(r, level, `<${name}${tag(r, node, listParts(r, node))}>`)
  for (const item of childrenOf(node)) listItem(r, item, level + 1, node.spacing === 'tight')
  line(r, level, `</${name}>`)
}

/** C2-H-032, C2-H-033: the opening tag of an item, with the box of a task item. */
function itemOpen(r: Render, node: AstNode): string {
  const task = node.task
  if (task === undefined) return `<li${tag(r, node)}>`
  const state: Pair[] = TASK_NO_STATE.includes(task.mark) ? [] : [['data-task-state', task.mark]]
  const checked = TASK_CHECKED.includes(task.mark) ? ' checked' : ''
  const label = escapeAttribute(blockText(childrenOf(node)))
  return `<li${tag(r, node, { structural: state })}><input type="checkbox"${checked} disabled aria-label="${label}"> `
}

/** C2-H-007, C2-H-034, C2-H-035: the first paragraph stands on the line of `<li>`, bare in a tight list. */
function listItem(r: Render, node: AstNode, level: number, tight: boolean): void {
  const blocks = visibleBlocks(childrenOf(node))
  const first = blocks[0]
  let open = itemOpen(r, node)
  let rest = blocks
  if (isTextParagraph(first)) {
    // A bare paragraph has no element for attributes of its own, so one that carries any keeps its `<p>`.
    const bare = tight && first.attrs === undefined && first.lang === undefined
    open += bare ? inlineHtml(r, childrenOf(first)) : paragraphHtml(r, first)
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

/** C2-H-040: a description with one block writes a paragraph bare. */
function description(r: Render, node: AstNode, level: number): void {
  const blocks = childrenOf(node).filter(isVisible)
  if (blocks.length <= 1 && (blocks.length === 0 || isTextParagraph(blocks[0]))) {
    const text = blocks.length === 0 ? '' : inlineHtml(r, childrenOf(blocks[0]!))
    line(r, level, `<dd${tag(r, node)}>${text}</dd>`)
    return
  }
  line(r, level, `<dd${tag(r, node)}>`)
  writeBlocks(r, blocks, level + 1)
  line(r, level, '</dd>')
}

/** C2-H-154: the title of the opener and then its label, each only when the author wrote it. */
function writeTitle(r: Render, node: AstNode, level: number, id: string | null): void {
  if (Array.isArray(node.title)) {
    line(r, level, `<p class="admonition-title"${id === null ? '' : ` id="${escapeAttribute(id)}"`}>${inlineHtml(r, node.title)}</p>`)
  }
  if (node.groupLabel !== undefined) line(r, level, `<p class="div-label">${escapeText(node.groupLabel)}</p>`)
}

/** C2-H-042, C2-H-157, C2-H-158: a div, and a directive that places nothing, are `<div>` with no name. */
function div(r: Render, node: AstNode, level: number): void {
  const base = node.type === 'directive' && node.kind !== undefined ? [node.kind] : []
  const attrs = tag(r, node, { base, alignStyle: true })
  // C2-H-114: a div with no other attribute.
  line(r, level, `<div${attrs === '' && r.settings.roundtrip ? ' data-carve-div' : attrs}>`)
  const before = r.count
  writeTitle(r, node, level + 1, null)
  writeBlocks(r, childrenOf(node), level + 1)
  if (r.count === before) rawLine(r, '')
  line(r, level, '</div>')
}

function capitalized(word: string): string {
  return word === '' ? word : word[0]!.toUpperCase() + word.slice(1)
}

/** C2-H-155: the title names the element, or else the `labels` string of the kind; an authored name stops both. */
function admonitionName(r: Render, node: AstNode, id: string | null): Pair[] {
  if (id !== null) return [['aria-labelledby', id]]
  if (hasAuthoredName(node)) return []
  const kind = capitalized(node.kind ?? '')
  return [['aria-label', r.settings.labels[`admonition${kind}`] ?? kind]]
}

/** C2-H-154: an admonition is `<aside>` with the classes `admonition` and its kind. */
function admonition(r: Render, node: AstNode, level: number): void {
  const id = r.resolution.labelIds.get(node) ?? null
  line(r, level, `<aside${tag(r, node, { base: ['admonition', node.kind ?? ''], generated: admonitionName(r, node, id) })}>`)
  const before = r.count
  writeTitle(r, node, level + 1, id)
  writeBlocks(r, childrenOf(node), level + 1)
  if (r.count === before) rawLine(r, '')
  line(r, level, '</aside>')
}

/** C2-H-065: a caption with one paragraph writes it bare; with several blocks every paragraph gets `<p>`. */
function captionLine(r: Render, caption: AstNode, name: string, level: number): void {
  const blocks = childrenOf(caption).filter(isVisible)
  if (blocks.length === 1 && isTextParagraph(blocks[0])) {
    line(r, level, `<${name}>${inlineHtml(r, childrenOf(blocks[0]))}</${name}>`)
    return
  }
  line(r, level, `<${name}>`)
  writeBlocks(r, blocks, level + 1)
  line(r, level, `</${name}>`)
}

function figureOf(r: Render, node: AstNode, level: number, base: string[]): void {
  line(r, level, `<figure${tag(r, node, { base })}>`)
  const before = r.count
  for (const child of childrenOf(node)) {
    // C2-H-064: each panel of a group.
    if (base.includes('carve-figure-group') && child.type === 'figure') figureOf(r, child, level + 1, ['carve-figure-panel'])
    else BLOCKS.get(child.type)?.(r, child, level + 1)
  }
  if (node.caption !== undefined) captionLine(r, node.caption, 'figcaption', level + 1)
  if (r.count === before) rawLine(r, '')
  line(r, level, '</figure>')
}

/** C2-H-047, C2-H-048: the attributes go on `<pre>`, and an authored `title` key wins over the title of the opener. */
function preHtml(r: Render, node: AstNode, language: string | undefined, title: string | undefined): string {
  const structural: Pair[] = []
  const authored = node.attrs?.keyValues?.some(([key]) => key.toLowerCase() === 'title') === true
  if (title !== undefined && !authored) structural.push(['title', title])
  if (r.settings.roundtrip && node.groupLabel !== undefined) structural.push(['data-carve-label', node.groupLabel])
  const code = language === undefined ? '<code>' : `<code class="language-${escapeAttribute(language)}">`
  return `<pre${tag(r, node, { structural })}>${code}${escapeText(valueOf(node))}</code></pre>`
}

function codeBlock(r: Render, node: AstNode, level: number): void {
  const title = Array.isArray(node.title) ? node.title.map((part) => valueOf(part)).join('') : undefined
  line(r, level, preHtml(r, node, node.syntax, title))
}

/** C2-H-050, C2-H-053, C2-H-054, C2-H-134. */
function rawBlock(r: Render, node: AstNode, level: number): void {
  if (node.format !== 'html') {
    loss(r, node, 'raw-format-dropped', `raw content in the format ${node.format ?? ''} is not written to HTML`)
    return
  }
  if (!r.settings.rawHtml) {
    line(r, level, preHtml(r, node, 'html', undefined))
    return
  }
  const value = valueOf(node)
  rawLine(r, value.endsWith('\n') ? value.slice(0, -1) : value)
}

function leadingSpaces(text: string): number {
  let count = 0
  while (text[count] === ' ') count++
  return count
}

/** C2-H-043: the leading spaces of a line are written as `&nbsp;`, one per space. */
function lineHtml(r: Render, node: AstNode): string {
  const children = childrenOf(node)
  const first = children[0]
  if (first?.type !== 'text') return inlineHtml(r, children)
  const spaces = leadingSpaces(valueOf(first))
  return '&nbsp;'.repeat(spaces) + inlineHtml(r, [{ ...first, value: valueOf(first).slice(spaces) }, ...children.slice(1)])
}

/** C2-H-043: one `<p>` per stanza, and every line break in it is `<br>`. */
function lineBlock(r: Render, node: AstNode, level: number): void {
  const structural: Pair[] = r.settings.roundtrip ? [['data-carve-line-block', null]] : []
  line(r, level, `<div${tag(r, node, { last: [LINE_BLOCK_CLASS], structural })}>`)
  const before = r.count
  let stanza: string[] = []
  const flush = (): void => {
    if (stanza.length > 0) line(r, level + 1, `<p>${stanza.join('<br>\n')}</p>`)
    stanza = []
  }
  for (const child of childrenOf(node)) {
    if (childrenOf(child).length === 0) flush()
    else stanza.push(lineHtml(r, child))
  }
  flush()
  if (r.count === before) rawLine(r, '')
  line(r, level, '</div>')
}

/** C2-W-058: a value in double quotes, with a backslash before a quote and a backslash. */
function quoted(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

const BARE_PATH_ENDS = [' ', '#', '@', '}', '"', '“']
const BARE_VALUE_ENDS = [' ', '\t', '@', '}']

function holdsAny(value: string, characters: readonly string[]): boolean {
  return characters.some((character) => value.includes(character))
}

/** One option of a directive: the key alone for no value, and a value quoted where the bare form does not hold it. */
function includeOption(name: string, value: string): string {
  if (value === '') return `@${name}`
  // C2-A-181: a list of column names keeps the quotes it was written in.
  const bare = !holdsAny(value, BARE_VALUE_ENDS) || (name === 'cols' && value.startsWith('"'))
  return `@${name}:${bare ? value : quoted(value)}`
}

/** C2-H-133: an include directive that was not expanded is a paragraph that holds the directive as text, written as in C2-W-058. */
function include(r: Render, node: AstNode, level: number): void {
  const path = node.path ?? ''
  const parts = [holdsAny(path, BARE_PATH_ENDS) ? quoted(path) : path]
  if (node.section !== undefined) parts.push(`#${node.section}`)
  for (const [name, value] of node.options ?? []) parts.push(includeOption(name, value))
  loss(r, node, 'include-unresolved', `the include of ${path} was not expanded`)
  line(r, level, `<p>${escapeText(`{{ ${parts.join(' ')} }}`)}</p>`)
}

/** C2-A-127: an extension this engine does not know renders through its fallback. */
function blockExtension(r: Render, node: AstNode, level: number): void {
  loss(r, node, 'extension-fallback-rendered', `the extension ${node.name ?? ''} is rendered through its fallback`)
  writeBlocks(r, node.fallback ?? [], level)
}

// ---- tables ----

/** C2-B-213: each axis on its own: the mark of the cell, then that of the head cell of its column, then the column. */
function cellStyle(cell: AstNode, column: AstNode | undefined, headValign: string | undefined): string {
  const align = cell.align ?? column?.resolvedAlign ?? column?.align
  const valign = cell.valign ?? headValign ?? column?.valign
  let declarations = align === undefined ? '' : `text-align: ${align};`
  if (valign !== undefined) declarations += `${declarations === '' ? '' : ' '}vertical-align: ${valign};`
  return declarations
}

function cellContent(r: Render, cell: AstNode): string {
  const blocks = childrenOf(cell)
  if (blocks.every((block) => block.type === 'cell_paragraph')) return blocks.map((block) => inlineHtml(r, childrenOf(block))).join(' ')
  // C2-A-175: blocks in a cell, which only a supplied tree holds.
  const inner: Render = { ...r, out: '', count: 0 }
  writeBlocks(inner, blocks, 0)
  return inner.out.slice(1)
}

/** C2-H-056 to C2-H-058. */
function cellHtml(r: Render, cell: AstNode, column: AstNode | undefined, headValign: string | undefined, inHead: boolean): string {
  const name = cell.header === true ? 'th' : 'td'
  const structural: Pair[] = []
  if ((rowspanOf(cell)) > 1) structural.push(['rowspan', String(cell.rowspan)])
  if ((colspanOf(cell)) > 1) structural.push(['colspan', String(cell.colspan)])
  if (cell.header === true) structural.push(['scope', inHead ? 'col' : 'row'])
  return `<${name}${attributes(r, cell, { structural, style: cellStyle(cell, column, headValign) })}>${cellContent(r, cell)}</${name}>`
}

/** The columns of a table, and the vertical mark each takes from the head (C2-B-213). */
interface TableLayout {
  columns: readonly AstNode[]
  headValign: (string | undefined)[]
}

/**
 * The cells of one row with their columns. A row with span marks holds one cell per column
 * (C2-A-092); a row with counts alone covers the positions its counts give (C2-A-093).
 */
function rowHtml(r: Render, row: AstNode, layout: TableLayout, covered: number[], inHead: boolean): string {
  const cells = childrenOf(row)
  const marked = cells.some((cell) => cell.span !== undefined)
  let html = ''
  let column = 0
  for (const cell of cells) {
    while (!marked && (covered[column] ?? 0) > 0) covered[column++]!--
    if (cell.span === undefined) {
      html += cellHtml(r, cell, layout.columns[column], layout.headValign[column], inHead)
      if (!marked) for (let more = 0; more < (colspanOf(cell)); more++) covered[column + more] = (rowspanOf(cell)) - 1
    }
    column += marked ? 1 : colspanOf(cell)
  }
  return `<tr${tag(r, row)}>${html}</tr>`
}

function writeRows(r: Render, layout: TableLayout, group: AstNode, level: number, covered: number[]): void {
  for (const row of childrenOf(group)) {
    if (row.type === 'table_row') line(r, level, rowHtml(r, row, layout, covered, group.type === 'table_head'))
  }
}

/** C2-H-060: true when a row span crosses the end of its group. */
function spanCrossesGroup(groups: AstNode[]): boolean {
  for (const group of groups) {
    const rows = childrenOf(group).filter((row) => row.type === 'table_row')
    const crosses = rows.some((row, index) => childrenOf(row).some((cell) => index + (rowspanOf(cell)) > rows.length))
    if (crosses) return true
  }
  return false
}

const GROUP_ELEMENTS = new Map([['table_head', 'thead'], ['table_body', 'tbody'], ['table_foot', 'tfoot']])

function writeGroups(r: Render, layout: TableLayout, groups: AstNode[], level: number): void {
  if (spanCrossesGroup(groups)) {
    const covered: number[] = []
    line(r, level, '<tbody>')
    for (const group of groups) writeRows(r, layout, group, level + 1, covered)
    line(r, level, '</tbody>')
    return
  }
  for (const group of groups) {
    // C2-H-055: an empty group is not written.
    if (!childrenOf(group).some((row) => row.type === 'table_row')) continue
    const name = GROUP_ELEMENTS.get(group.type)!
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
function writeColumnGroup(r: Render, columns: readonly AstNode[], level: number): void {
  if (!columns.some((column) => column.width !== undefined)) return
  line(r, level, '<colgroup>')
  for (const column of columns) {
    line(r, level + 1, column.width === undefined ? '<col>' : `<col style="width: ${percentText(column.width)}%;">`)
  }
  line(r, level, '</colgroup>')
}

function table(r: Render, node: AstNode, level: number): void {
  line(r, level, `<table${tag(r, node)}>`)
  if (node.caption !== undefined) captionLine(r, node.caption, 'caption', level + 1)
  const layout: TableLayout = { columns: columnsOf(node), headValign: headMarks(node, 'valign') }
  writeColumnGroup(r, layout.columns, level + 1)
  writeGroups(r, layout, childrenOf(node).filter((group) => GROUP_ELEMENTS.has(group.type)), level + 1)
  line(r, level, '</table>')
}

const BLOCKS = new Map<string, BlockWriter>([
  ['paragraph', paragraph],
  ['heading', (r, node, level) => line(r, level, headingHtml(r, node, false))],
  ['block_quote', quote],
  ['list', list],
  ['definition_list', container('dl')],
  ['definition_term', (r, node, level) => line(r, level, `<dt${tag(r, node)}>${inlineHtml(r, childrenOf(node))}</dt>`)],
  ['definition_description', description],
  ['div', div],
  ['directive', div],
  ['admonition', admonition],
  ['figure', (r, node, level) => figureOf(r, node, level, [])],
  ['figure_group', (r, node, level) => figureOf(r, node, level, ['carve-figure-group'])],
  ['table', table],
  ['code_block', codeBlock],
  ['raw_block', rawBlock],
  ['line_block', lineBlock],
  // C2-H-046.
  ['thematic_break', (r, node, level) => line(r, level, `<hr${tag(r, node)}>`)],
  ['include', include],
  // C2-H-142.
  ['section', container('section')],
  ['block_extension', blockExtension],
])

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
  return ` data-carve-footnote-label="${escapeAttribute(keyOf(note.definition))}"`
}

function writeNote(r: Render, note: Note, level: number): void {
  // C2-H-090: the body of an inline footnote is one paragraph.
  const blocks = note.definition?.children ?? [{ type: 'paragraph', children: [...childrenOf(note.inline!)] }]
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
function writeNotes(r: Render, level: number, directive: AstNode | null): void {
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

function isNotesDirective(node: AstNode): boolean {
  return node.type === 'directive' && node.kind === 'footnotes'
}

function closeSections(r: Render, open: number[], level: number): void {
  while (open.length > 0 && open[open.length - 1]! >= level) {
    open.pop()
    line(r, open.length, '</section>')
  }
}

function sectionAttributes(r: Render, node: AstNode, id: string | undefined): string {
  if (r.settings.roundtrip) return attributes(r, null, { structural: idCarriers(r, node), id: id ?? null })
  // Without the carriers of `roundtrip` a section carries its id and nothing else.
  return id === undefined ? '' : ` id="${escapeAttribute(id)}"`
}

/** C2-H-026, C2-H-027: a top-level heading opens a section that carries its id. */
function openSection(r: Render, node: AstNode, open: number[]): void {
  closeSections(r, open, levelOf(node))
  const id = headingId(node)
  line(r, open.length, `<section${sectionAttributes(r, node, id)}>`)
  open.push(levelOf(node))
  line(r, open.length, headingHtml(r, node, true))
}

/** Writes the blocks of the document; C2-H-093: the footnote section stands at a top-level directive or at the end. */
function writeDocument(r: Render, document: AstNode): void {
  const open: number[] = []
  const hasNotes = r.resolution.notes.length > 0
  let placed = false
  for (const node of childrenOf(document)) {
    if (node.type === 'heading' && r.settings.sections) {
      openSection(r, node, open)
    } else if (isNotesDirective(node) && hasNotes && !placed) {
      placed = true
      // The blocks of the directive stand before the section, as in 0.1.
      writeBlocks(r, childrenOf(node), open.length)
      writeNotes(r, open.length, node)
    } else {
      BLOCKS.get(node.type)?.(r, node, open.length)
    }
  }
  closeSections(r, open, 0)
  if (hasNotes && !placed) writeNotes(r, 0, null)
}

interface RenderResult {
  html: string
  losses: Findings
}

/** The HTML fragment of a resolved tree (C2-H-001). `losses` takes the losses of the render. */
export function renderDocument(document: AstNode, settings: Settings, resolution: Resolution, losses: Findings): RenderResult {
  const r: Render = {
    settings, resolution, out: '', count: 0, losses, linkRel: PROFILES.get(settings.profile)?.linkRel ?? '', linkDepth: 0, abbrDepth: 0,
    backlinkHost: null, backlinks: '',
  }
  writeDocument(r, document)
  return { html: r.out.slice(1), losses: r.losses }
}
