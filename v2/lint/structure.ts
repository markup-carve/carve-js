import { forEachSlot, INLINE_PARENTS, type Node, type TableCellNode, type TableColumnNode } from '../src/ast.ts'
import { NODE_SLOTS } from '../src/ast-tables.ts'
import { isAttributeLine } from '../src/lines.ts'
import { type LintContext, type Rule } from './types.ts'

function bounds(node: Node, context: LintContext): [number, number] | null {
  if (node.pos === undefined) return null
  return [context.chars[node.pos.startOffset] ?? 0, context.chars[node.pos.endOffset] ?? context.source.length]
}

function reportNode(id: Rule['id'], node: Node, path: string, context: LintContext,
  values?: Record<string, string>, message?: number): void {
  const range = bounds(node, context)
  if (range !== null) context.report(id, range[0], range[1], path, values, message)
}

function raw(node: Node, context: LintContext): string {
  const range = bounds(node, context)
  return range === null ? '' : context.source.slice(range[0], range[1])
}

function attributeRange(node: Node, context: LintContext, key: string, whole = false): [number, number] | null {
  const range = bounds(node, context)
  if (range === null) return null
  const source = context.source.slice(range[0], range[1])
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|[\\s{])(${escapedKey})(?:=("[^"]*"|'[^']*'|[^\\s}]+))?(?=[\\s}])`).exec(source)
  if (match === null) return null
  const start = range[0] + match.index + match[0].indexOf(key)
  return [start, start + key.length + (whole && match[2] !== undefined ? match[2].length + 1 : 0)]
}

function reportAttribute(id: Rule['id'], node: Node, path: string, context: LintContext, key: string,
  whole = false, values?: Record<string, string>): void {
  const range = attributeRange(node, context, key, whole)
  if (range !== null) context.report(id, range[0], range[1], path, values)
  else reportNode(id, node, path, context, values)
}

function isWord(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch)
}

// 0.1 read U+FEFF as content, which String.prototype.trim would strip.
const EDGE_SPACE = /^[\p{Zs}\t\n\r\f\v]|[\p{Zs}\t\n\r\f\v]$/u

/** Whether the character at `at` stands behind an odd run of backslashes, so 0.1 read it as text. */
function escaped(text: string, at: number): boolean {
  let slashes = 0
  while (text[at - 1 - slashes] === '\\') slashes++
  return slashes % 2 === 1
}

function nextCloser(text: string, mark: string, from: number): number {
  let end = text.indexOf(mark, from)
  while (end >= 0 && (/[\p{Zs}\t\n\r]/u.test(text[end - 1] ?? '') || escaped(text, end))) {
    end = text.indexOf(mark, end + mark.length)
  }
  return end
}

function validDjotPair(text: string, mark: string, start: number, end: number): boolean {
  return text[start - 1] !== '{' && text[end + mark.length] !== '}'
    && text[start - 1] !== mark && text[start + 1] !== mark
}

function validPair(text: string, mark: string, id: Rule['id'], start: number, end: number): boolean {
  const inside = text.slice(start + mark.length, end)
  if (escaped(text, start) || inside === '' || EDGE_SPACE.test(inside)) return false
  if (inside[0] === mark[0] || inside.at(-1) === mark[0]) return false
  if (mark === '**' && inside.includes('*')) return false
  if (id === 'djot-subscript-tilde' || id === 'djot-superscript-caret') return validDjotPair(text, mark, start, end)
  if (id === 'markdown-strong-double-star' || id === 'markdown-strikethrough-double-tilde') return true
  return !isWord(text[start - 1]) && !isWord(text[end + mark.length])
}

function paired(text: string, mark: string, id: Rule['id'], visit: (start: number, end: number) => void): void {
  let at = 0
  while (at < text.length) {
    const start = text.indexOf(mark, at)
    if (start < 0) return
    const end = nextCloser(text, mark, start + mark.length + 1)
    if (end < 0) return
    if (validPair(text, mark, id, start, end)) visit(start, end + mark.length)
    at = end + mark.length
  }
}

function textPair(mark: string, id: Rule['id']): (node: Node, path: string, context: LintContext) => void {
  return (node, path, context) => checkTextPair(node, path, context, mark, id)
}

function checkTextPair(node: Node, path: string, context: LintContext, mark: string, id: Rule['id']): void {
  if (!INLINE_PARENTS.includes(node.type as typeof INLINE_PARENTS[number]) || !('children' in node)) return
  if (path.includes('/title/') && context.nodeTypes.get(path.slice(0, path.indexOf('/title/'))) === 'code_block') return
  let first: number | undefined
  let last = 0
  const flush = (): void => {
    if (first === undefined) return
    const begin = first
    paired(context.source.slice(begin, last), mark, id, (start, end) => context.report(id, begin + start, begin + end, path))
    first = undefined
  }
  for (const child of node.children) {
    if (child.type !== 'text' && child.type !== 'soft_break') { flush(); continue }
    const range = bounds(child, context)
    if (range === null) continue
    first ??= range[0]
    last = range[1]
  }
  flush()
}

function imageAlt(node: Node, path: string, context: LintContext): void {
  if (node.type === 'image' && node.alt === '' && node.decorative !== true) {
    reportNode('a11y/image-alt', node, path, context)
  }
}

function emptyDestination(node: Node, path: string, context: LintContext): void {
  if (node.type === 'link' && node.href === '') reportNode('empty-link-destination', node, path, context)
}

function looseAttribute(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'list') return
  if (node.attrs?.keyValues?.some(([key]) => key === 'loose')) reportNode('deprecated-loose-attribute', node, path, context)
}

function tableAttribute(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table' || context.layouts.get(path)?.sourceFormat !== 'pipe') return
  if (attributeValue(node, context, 'header-rows') !== undefined) {
    reportNode('deprecated-table-attribute', node, path, context)
  }
}

const TABLE_KEYS = ['aligns', 'valigns', 'widths', 'header-rows', 'footer-rows', 'body-rows', 'body-header-rows', 'body-header-cols']

/** C2-B-227: a table keeps a key it reads in `attrs` only when the value is invalid, or `header-rows` on a pipe table. */
function keptTableKeys(node: Node): string[] {
  if (node.type !== 'table') return []
  return (node.attrs?.keyValues ?? []).map(([key]) => key).filter((key) => TABLE_KEYS.includes(key))
}

function invalidTableAttribute(node: Node, path: string, context: LintContext): void {
  const pipe = context.layouts.get(path)?.sourceFormat === 'pipe'
  for (const [key, value] of node.attrs?.keyValues ?? []) {
    if (!keptTableKeys(node).includes(key)) continue
    // C2-B-186: a valid count of `header-rows` on a pipe table is deprecated, not invalid.
    if (pipe && key === 'header-rows' && /^\d*$/.test(value)) continue
    reportAttribute('table-attribute-invalid', node, path, context, key, true, { key })
  }
}

/** The offset of a line comment behind the closing pipe of a row line, or -1. */
function trailingComment(text: string): number {
  const at = text.indexOf('%%', text.lastIndexOf('|') + 1)
  return at > 0 && (text[at - 1] === ' ' || text[at - 1] === '\t') ? at : -1
}

/** The comments read since the last row line of a table, and whether a row line stands above them. */
interface RowWalk {
  pending: [number, number][]
  afterRow: boolean
}

/** One line of a table for `comment-splits-table-row`: `start` is its offset, `text` its text behind the container prefixes. */
function walkRowLine(walk: RowWalk, start: number, text: string, path: string, context: LintContext): void {
  const end = start + text.trimEnd().length
  if (text.startsWith('%%')) {
    if (walk.afterRow) walk.pending.push([start, end])
    return
  }
  const row = text.startsWith('|') || text.startsWith('+')
  if (text.startsWith('+') && walk.afterRow) {
    for (const [from, to] of walk.pending) context.report('comment-splits-table-row', from, to, path)
  }
  walk.pending = []
  walk.afterRow = row
  const comment = row ? trailingComment(text) : -1
  if (comment >= 0) walk.pending.push([start + comment - 1, end])
}

/**
 * C2-W-137: a comment between a table row and its continuation row (C2-B-175), as a comment-only line or as the
 * trailing comment of the row, belongs after the whole row.
 */
function commentSplitsRow(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table' || node.pos === undefined) return
  const walk: RowWalk = { pending: [], afterRow: false }
  for (let number = node.pos.startLine; number <= node.pos.endLine; number++) {
    const line = context.lines[number - 1]
    if (line === undefined) continue
    const offset = line.text.length - line.text.replace(/^[\t >]*/u, '').length
    walkRowLine(walk, line.start + offset, line.text.slice(offset), path, context)
  }
}

function groupRows(node: Node, type: string): number {
  if (node.type !== 'table') return 0
  let rows = 0
  for (const group of node.children) {
    if (group.type !== 'comment' && group.type === type) rows += group.children.filter((row) => row.type === 'table_row').length
  }
  return rows
}

/** C2-B-187, C2-B-209: a valid count larger than the rows it can take is clamped, and the hint names the count to write. */
function rowCountClamped(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table' || node.pos === undefined) return
  const head = groupRows(node, 'table_head')
  const below = groupRows(node, 'table_body') + groupRows(node, 'table_foot')
  const limits: [string, number][] = [['footer-rows', below]]
  if (context.layouts.get(path)?.sourceFormat !== 'pipe') limits.unshift(['header-rows', head + below])
  const line = context.lines[node.pos.startLine - 1]
  for (const [key, limit] of limits) {
    const value = attributeValue(node, context, key)
    if (line === undefined || value === undefined || !/^\d+$/.test(value) || Number(value) <= limit) continue
    const at = line.text.indexOf(`${key}=`)
    context.report('table-row-count-clamped', line.start + at, line.start + at + key.length + 1 + value.length, path,
      { key, count: value, effective: String(limit) })
  }
}

function attributeValue(node: Node, context: LintContext, key: string): string | undefined {
  if (node.pos === undefined) return undefined
  const line = context.lines[node.pos.startLine - 1]?.text.trim()
  if (line === undefined || !line.startsWith('{') || !line.endsWith('}')) return undefined
  const at = line.indexOf(key)
  if (at < 0 || (at > 0 && line[at - 1] !== '{' && line[at - 1] !== ' ')) return undefined
  const equals = at + key.length
  if (line[equals] !== '=') return ''
  return readAttributeValue(line, equals + 1)
}

function readAttributeValue(line: string, offset: number): string {
  let end = offset
  const quoted = line[end] === '"'
  if (quoted) end++
  const start = end
  while (end < line.length && line[end] !== (quoted ? '"' : ' ') && line[end] !== '}') end++
  return line.slice(start, end)
}

function headingLevel(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'heading') return
  const previous = context.state.headingLevel
  if (previous > 0 && node.level > previous + 1) {
    reportNode('heading-level-skip', node, path, context, { previous: String(previous), level: String(node.level) })
  }
  context.state.headingLevel = node.level
}

function headingKind(node: Node, _path: string, context: LintContext): void {
  if (node.type !== 'heading') return
  const source = raw(node, context)
  const kind = source.trimStart()[0]
  if (kind === '#' || kind === '=') {
    context.state.headingKinds.add(kind)
    if (context.state.headingKinds.size === 2 && !context.state.mixedReported) {
      context.report('heading-marker-mixed', 0, 1, '')
      context.state.mixedReported = true
    }
  }
}

function headingClosing(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'heading') return
  const source = raw(node, context)
  if (!source.trimStart().startsWith('#')) return
  const end = source.trimEnd()
  const hash = end.lastIndexOf(' #')
  if (hash >= 0 && isHashRun(end.slice(hash + 1))) {
    const range = bounds(node, context)
    if (range !== null) context.report('heading-closing-hashes', range[0] + hash + 1, range[0] + end.length,
      path, { run: end.slice(hash + 1) })
  }
}

function headingTrailing(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'heading') return
  const end = raw(node, context).trimEnd()
  const brace = end.lastIndexOf(' {')
  if (brace >= 0 && /^\{\s*[.#][^{}]*\}$/.test(end.slice(brace + 1))) {
    const block = end.slice(brace + 1)
    const range = bounds(node, context)
    if (range !== null) context.report('heading-trailing-attribute', range[0] + brace + 1, range[0] + end.length,
      path, { block })
  }
}

function isHashRun(text: string): boolean {
  if (text.length === 0) return false
  for (const ch of text) if (ch !== '#') return false
  return true
}

function duplicateReferenceUrl(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'link_reference_definition') return
  if (context.state.referenceUrls.has(node.href)) reportNode('duplicate-reference-url', node, path, context)
  else context.state.referenceUrls.add(node.href)
}

function separatorRow(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table_row' || node.children.length === 0) return
  if (!path.endsWith('/children/1')) return
  const line = raw(node, context).trim()
  if (!line.startsWith('|') || !line.endsWith('|')) return
  const cells = line.slice(1, -1).split('|')
  if (cells.length < 1 || !cells.every(isSeparatorCell)) return
  const previous = context.lines[(node.pos?.startLine ?? 1) - 2]?.text.trim() ?? ''
  if (!previous.startsWith('|') || previous.slice(1, -1).split('|').every(isSeparatorCell)) return
  reportNode('deprecated-separator-row', node, path, context)
}

function isSeparatorCell(value: string): boolean {
  const text = value.trim()
  if (text.length < 1) return false
  let hyphens = 0
  for (const ch of text) {
    if (ch === '-') hyphens++
    else if (ch !== ':') return false
  }
  return hyphens >= 1
}

function tableRows(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table') return
  let width = -1
  for (let outer = 0; outer < node.children.length; outer++) {
    const section = node.children[outer]
    if (section?.type !== 'table_head' && section?.type !== 'table_body' && section?.type !== 'table_foot') continue
    for (let inner = 0; inner < section.children.length; inner++) {
      const row = section.children[inner]
      if (row?.type !== 'table_row') continue
      if (width < 0) width = row.children.length
      else if (row.children.length !== width) {
        reportNode('table-row-cell-count', row, `${path}/children/${outer}/children/${inner}`, context,
          { cells: String(row.children.length), width: String(width) })
      }
    }
  }
}

/** C2-A-084: a child of a group that carries a caption; C2-B-127: a nested figure group is a group of its own, no panel. */
function isPanel(child: Node): boolean {
  return child.type === 'table' || (child.type !== 'figure_group' && 'caption' in child && child.caption !== undefined)
}

function panelCount(node: Node): number {
  if (node.type !== 'figure_group') return 0
  return node.children.filter(isPanel).length
}

function figureEmpty(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'figure_group') return
  if (panelCount(node) === 0) reportNode('figure-group-empty', node, path, context)
}

function figureSingle(node: Node, path: string, context: LintContext): void {
  if (node.type === 'figure_group' && panelCount(node) === 1) reportNode('figure-group-single-panel', node, path, context)
}

function substitutionArrow(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'strike') return
  for (const child of node.children) {
    if (child.type !== 'text') continue
    const range = bounds(child, context)
    if (range === null) continue
    const source = raw(child, context)
    for (let at = source.indexOf('~>'); at >= 0; at = source.indexOf('~>', at + 2)) {
      if (!escaped(source, at)) return reportNode('deprecated-substitution-arrow', node, path, context)
    }
  }
}

function frontmatterBreak(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'frontmatter') return
  if (!raw(node, context).startsWith('---\n')) return
  const value = node.value.trim()
  const first = node.value.split('\n', 1)[0]?.trim() ?? ''
  if (first === '' || value === '' || !value.includes(':')) reportNode('frontmatter-shaped-thematic-break', node, path, context)
}

function frontmatterQuote(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'frontmatter' || node.pos === undefined) return
  for (let number = node.pos.startLine; number <= node.pos.endLine; number++) {
    const line = context.lines[number - 1]
    if (line === undefined || !/^>[^ ]/.test(line.text) || line.text.length < 2) continue
    context.report('blockquote-marker-without-space', line.start, line.start + 1, path,
      { text: line.text.slice(1) }, 1)
  }
}

function isBidiControl(code: number): boolean {
  return (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
}

function bidiControl(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text' && node.type !== 'code' && node.type !== 'code_block' && node.type !== 'math') return
  if (node.type === 'text' && path.includes('/title/')
    && context.nodeTypes.get(path.slice(0, path.indexOf('/title/'))) === 'code_block') return
  const range = bounds(node, context)
  if (range === null) return
  const text = context.source.slice(range[0], range[1])
  const from = node.type === 'code_block' && context.layouts.size > 0 ? text.indexOf('\n') + 1 : 0
  for (let at = from; at < text.length; at++) {
    const code = text.charCodeAt(at)
    if (isBidiControl(code)) {
      context.report('bidi-control-in-source', range[0] + at, range[0] + at + 1, path,
        { code: code.toString(16).toUpperCase().padStart(4, '0') })
    }
  }
}

function multilineTerm(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'definition_term' || node.pos === undefined || node.pos.endLine <= node.pos.startLine) return
  const line = context.lines[node.pos.startLine]
  if (line !== undefined) {
    const text = line.text.trimStart()
    const start = line.start + line.text.length - text.length
    context.report('description-term-multi-line', start, line.end, path)
  }
}

function headingContinuation(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'heading' || node.pos === undefined || node.pos.endLine <= node.pos.startLine) return
  const first = context.lines[node.pos.startLine - 1]
  // C2-B-137: the line that continues the heading may stand below comment-only lines.
  let next = node.pos.startLine
  while (next < node.pos.endLine && context.lines[next]?.text.trimStart().startsWith('%%') === true) next++
  const second = next < node.pos.endLine ? context.lines[next] : undefined
  if (first === undefined || second === undefined) return
  const marker = first.text.trimStart()
  const column = first.text.indexOf(marker[0]!)
  let indent = 0
  while (second.text[indent] === ' ') indent++
  if (indent > column) context.report('deprecated-indented-line-under-heading', second.start, second.end, path)
}

/** C2-B-127: a bare `::: figure` in the body of a figure group, which opens a plain div. */
function figureNested(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'div' || !/^\s*:{3,}\s*figure\s*$/.test(raw(node, context).split('\n', 1)[0] ?? '')) return
  for (let split = path.lastIndexOf('/children/'); split > 0; split = path.lastIndexOf('/children/', split - 1)) {
    if (context.nodeTypes.get(path.slice(0, split)) === 'figure_group') return reportNode('figure-group-nested', node, path, context)
  }
}

function hasCaptionNumber(node: Node): boolean {
  if (node.type === 'caption_number') return true
  let found = false
  forEachSlot(node, (children) => { if (children.some(hasCaptionNumber)) found = true })
  return found
}

function figurePanelNumber(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'figure_group') return
  for (let at = 0; at < node.children.length; at++) {
    const panel = node.children[at]
    if (panel === undefined || !isPanel(panel) || !('caption' in panel) || panel.caption === undefined) continue
    if (hasCaptionNumber(panel.caption)) {
      reportNode('figure-group-panel-number', panel, `${path}/children/${at}`, context)
    }
  }
}

function footnotePlacement(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'directive' || path.split('/').length <= 3) return
  if (node.kind === 'footnotes') reportNode('footnotes-placement-in-container', node, path, context)
}

function referencesPlacement(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'directive' || path.split('/').length <= 3) return
  if (node.kind === 'references') reportNode('references-placement-in-container', node, path, context)
}

function semanticOutside(node: Node, path: string, context: LintContext): void {
  if (node.type === 'span' || node.attrs?.keyValues === undefined) return
  for (const name of ['abbr', 'time', 'kbd']) {
    const value = node.attrs.keyValues.find(([key]) => key.toLowerCase() === name)?.[1]
    if (value !== undefined) {
      const range = attributeRange(node, context, name)
      if (range === null) continue
      context.report('semantic-attribute-outside-span', range[0], range[1], path, { name, type: node.type, value })
    }
  }
}

function semanticValue(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'span') return
  for (const [name, value] of node.attrs?.keyValues ?? []) {
    if (value !== '' && name === 'kbd') {
      reportAttribute('semantic-attribute-value-ignored', node, path, context, name, true, { name })
    }
  }
}

function tableColumnArity(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table') return
  for (const key of ['aligns', 'valigns', 'widths']) {
    const value = attributeValue(node, context, key)
    // C2-B-211: an invalid list sets no column, and table-attribute-invalid reports it.
    if (value === undefined || keptTableKeys(node).includes(key)) continue
    const count = value.split(',').length
    if (count < node.columns.length) reportAttribute('table-column-arity', node, path, context, key, false,
      { key, count: String(count), widest: String(node.columns.length) })
  }
}

function tableWidth(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table') return
  let total = 0
  for (const column of node.columns) total += column.width ?? 0
  if (total > 1) reportAttribute('table-width-total', node, path, context, 'widths')
}

function rowAttributeCell(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table_row') return
  if (node.children.at(-1)?.attrs !== undefined) return
  const source = raw(node, context)
  const last = source.lastIndexOf('|')
  const before = source.lastIndexOf('|', last - 1)
  if (last < 0 || before < 0) return
  const cell = source.slice(before + 1, last).trim()
  if (cell.startsWith('{') && cell.endsWith('}')) reportNode('table-row-attribute-as-cell', node, path, context)
}

function emphasizedHeading(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'paragraph') return
  const visible = node.children.filter((child) => child.type !== 'comment' && (child.type !== 'text' || child.value.trim() !== ''))
  if (visible.length !== 1 || (visible[0]?.type !== 'emphasis' && visible[0]?.type !== 'strong')) return
  reportNode('emphasis-as-heading', node, path, context)
}

function commentEmphasis(node: Node, path: string, context: LintContext): void {
  const source = raw(node, context)
  if ((node.type === 'emphasis' && (source.startsWith('/*') || source.endsWith('*/')))
    || (node.type === 'strong' && (source.startsWith('*/') || source.endsWith('/*')))) {
    reportNode('comment-shaped-emphasis', node, path, context)
  }
}

function multilineHtmlComment(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'paragraph') return
  const range = bounds(node, context)
  if (range === null) return
  const source = raw(node, context)
  for (let at = source.indexOf('<!--'); at >= 0; at = source.indexOf('<!--', at + 4)) {
    const end = source.indexOf('-->', at + 4)
    if (end < 0 || !source.slice(at, end).includes('\n') || escaped(source, at)) continue
    context.report('html-comment-renders-as-text', range[0] + at, range[0] + end + 3, path)
  }
}

function globStrong(node: Node, path: string, context: LintContext): void {
  if (node.type === 'strong' && raw(node, context).startsWith('*.') && raw(node, context).endsWith('*')) {
    reportNode('glob-shaped-strong', node, path, context)
  }
}

function djotBracedStrike(node: Node, path: string, context: LintContext): void {
  if (node.type === 'strike' && raw(node, context).startsWith('{~')) {
    reportNode('djot-subscript-tilde-braced', node, path, context)
  }
}

function djotBracedHighlight(node: Node, path: string, context: LintContext): void {
  if (node.type === 'highlight' && raw(node, context).startsWith('{=')) {
    reportNode('djot-highlight-braces', node, path, context)
  }
}

function unattachedInline(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const parent = path.slice(0, path.lastIndexOf('/children/'))
  if (context.nodeTypes.get(parent) !== 'paragraph') return
  const source = raw(node, context)
  const range = bounds(node, context)
  if (range === null) return
  for (let at = source.indexOf('{'); at >= 0; at = source.indexOf('{', at + 1)) {
    const end = source.indexOf('}', at + 1)
    if (at < 1 || end < 0 || escaped(source, at)) continue
    const block = source.slice(at, end + 1)
    if (isAttributeLine(block, 0, block.length)) context.report('unattached-inline-attribute',
      range[0] + at, range[0] + end + 1, path)
    at = end
  }
}

/** The 0.1.13 glued alignment prefix of a cell: a horizontal mark or `?`, then an optional vertical mark (C2-B-182). */
function oldAlignmentPrefix(source: string): string {
  const vertical = source[1] === '^' || source[1] === 'v' || source[1] === '~'
  if (source[0] === '<' || source[0] === '>' || source[0] === '~') return vertical ? source.slice(0, 2) : source[0]
  return source[0] === '?' && vertical ? source.slice(0, 2) : ''
}

function deprecatedCellAlignment(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table_cell') return
  let source = raw(node, context)
  // C2-B-171: the header mark stands before the prefix.
  if (node.header && source.startsWith('=')) source = source.slice(1)
  source = source.trimStart()
  const prefix = oldAlignmentPrefix(source)
  if (prefix === '') return
  const after = source[prefix.length]
  if (after !== ' ' && after !== '\t') return
  if (source.slice(prefix.length).trim() === '') return
  const range = bounds(node, context)
  if (range !== null) {
    const at = raw(node, context).indexOf(prefix)
    context.report('deprecated-cell-alignment', range[0] + at, range[0] + at + prefix.length, path, { prefix, braced: `{${prefix}}` })
  }
}

function markerRunPadding(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table_cell') return
  const source = raw(node, context).trimStart()
  if (!source.startsWith('{')) return
  const close = source.indexOf('}')
  const marker = source[close + 1]
  if (close < 2 || marker === undefined || !'<>~'.includes(marker)) return
  const block = source.slice(0, close + 1)
  const range = bounds(node, context)
  if (range === null) return
  const start = range[0] + raw(node, context).indexOf(block)
  context.report('table-marker-run-padding', start, start + block.length + 1, path,
    { spelling: block + marker, marker, block, correctedPrefix: `{${marker} ${block.slice(1, -1)}}` })
}

function fenceCloserIndent(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'code_block' || node.pos === undefined || node.pos.endLine <= node.pos.startLine) return
  const first = context.lines[node.pos.startLine - 1]
  const last = context.lines[node.pos.endLine - 1]
  if (first === undefined || last === undefined) return
  const opener = first.text.indexOf('```')
  const closer = last.text.indexOf('```')
  if (opener < 0 || closer < 0 || opener === closer) return
  if (last.text.slice(0, closer).trim() !== '' || !/^`{3,}[ \t]*$/.test(last.text.slice(closer))) return
  context.report('fence-closer-indented', last.start + closer, last.end, path)
}

function figureOpenerMetadata(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'div' || !node.attrs?.classes?.includes('figure')) return
  const first = context.lines[node.pos?.startLine === undefined ? 0 : node.pos.startLine - 1]
  if (first === undefined || !first.text.trimStart().startsWith('::: figure ')) return
  if (first.text.includes('"') || first.text.includes('[')) {
    context.report('figure-group-opener-metadata', first.start, first.end, path)
  }
}

function commentInLineBlock(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'line' || !raw(node, context).trimStart().startsWith('%%')) return
  reportNode('comment-line-in-line-block', node, path, context)
}

function brokenCrossref(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'xref' || node.namespace !== 'heading' || node.href !== undefined) return
  context.state.crossrefs.push({ node, path })
}

function collectFragment(node: Node, path: string, context: LintContext): void {
  if (node.type === 'link' && node.href?.startsWith('#')) context.state.fragmentLinks.push({ node, path })
}

function platformIssue(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  const range = bounds(node, context)
  if (range === null) return
  for (let at = 0; at < source.length; at++) {
    if (source[at] !== '#' || isWord(source[at - 1]) || !isDigit(source[at + 1])) continue
    let end = at + 1
    while (isDigit(source[end])) end++
    context.report('platform-issue-reference', range[0] + at, range[0] + end, path,
      { host: 'GitHub', text: source.slice(at, end) })
    at = end - 1
  }
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9'
}

function platformMention(node: Node, path: string, context: LintContext): void {
  if (node.type === 'mention') {
    reportNode('platform-mention-token', node, path, context,
      { host: 'GitHub', text: raw(node, context) })
    return
  }
  if (node.type !== 'text') return
  const source = raw(node, context)
  const range = bounds(node, context)
  if (range === null) return
  for (let at = 0; at < source.length; at++) {
    if (source[at] !== '@' || isWord(source[at - 1]) || !isWord(source[at + 1])) continue
    let end = at + 1
    while (isWord(source[end]) || source[end] === '-') end++
    context.report('platform-mention-token', range[0] + at, range[0] + end, path,
      { host: 'GitHub', text: source.slice(at, end) })
    at = end - 1
  }
}

function delimitedWideRow(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table') return
  const format = context.layouts.get(path)?.sourceFormat
  if (format !== 'csv' && format !== 'tsv') return
  const state = { width: -1, wide: false }
  for (let sectionIndex = 0; sectionIndex < node.children.length; sectionIndex++) {
    const section = node.children[sectionIndex]
    if (section !== undefined) checkWideSection(section, state)
  }
  if (!state.wide) return
  const range = bounds(node, context)
  if (range === null) return
  context.report('delimited-table-wide-row', range[0], range[1], path)
}

function checkWideSection(section: Node, state: { width: number, wide: boolean }): void {
  if (section.type !== 'table_body' && section.type !== 'table_head' && section.type !== 'table_foot') return
  for (let rowIndex = 0; rowIndex < section.children.length; rowIndex++) {
    const row = section.children[rowIndex]
    if (row?.type !== 'table_row') continue
    if (state.width < 0) state.width = row.children.length
    else if (row.children.length > state.width) state.wide = true
  }
}

function intrawordUnderscore(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  const range = bounds(node, context)
  if (range === null) return
  for (let at = 1; at < source.length - 2; at++) {
    if (source[at] !== '_' || !isWord(source[at - 1])) continue
    const end = source.indexOf('_', at + 2)
    if (end < 0 || !isWord(source[at + 1]) || !isWord(source[end - 1]) || !isWord(source[end + 1])) continue
    context.report('djot-intraword-underscore', range[0] + at, range[0] + end + 1, path)
    at = end
  }
}

function emphasisBeforeAttrs(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  if (!source.includes('{')) return
  const range = bounds(node, context)
  if (range === null) return
  for (let at = 0; at < source.length - 2; at++) {
    const ch = source[at] ?? ''
    if (!'*_/~='.includes(ch) || source[at + 1] !== '{' || escaped(source, at)) continue
    const end = source.indexOf('}', at + 2)
    if (end < 0) continue
    context.report('emphasis-marker-before-attributes', range[0] + at, range[0] + end + 1,
      path, { ch }, 0)
    at = end
  }
}

function hasUnescapedMarker(source: string, marker: string, close: number): boolean {
  for (let at = 1; at < close; at++) if (source[at] === marker && !escaped(source, at)) return true
  return false
}

function spanMarkerBeforeAttrs(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'strong' && node.type !== 'emphasis') return
  const source = raw(node, context)
  const marker = node.type === 'strong' ? '*' : '/'
  const attrs = /\{(?:[.#_]|[A-Za-z])[^}]*\}$/.exec(source)
  if (attrs === null) return
  const close = attrs.index - 1
  if (source[0] !== marker || source[close] !== marker || escaped(source, close)
    || !hasUnescapedMarker(source, marker, close)) return
  const range = bounds(node, context)
  if (range !== null) context.report('emphasis-marker-before-attributes', range[0] + close,
    range[0] + close + 1, path, { marker, name: node.type, line: String(node.pos?.startLine ?? 1),
      column: String(node.pos?.startColumn ?? 1) }, 1)
}

function carveVersion(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'frontmatter') return
  const range = bounds(node, context)
  if (range === null) return
  const source = raw(node, context)
  for (const match of source.matchAll(/^[ \t]*(?:carve|carve-version):[ \t]*([^\s]+)[ \t]*$/gm)) {
    const version = match[1]!
    const parts = /^\d+(?:\.\d+)*$/.test(version) ? version.split('.').map(Number) : null
    if (parts !== null && parts[0] === 0 && (parts[1] ?? 0) <= 2 && parts.slice(2).every((part) => part === 0)) continue
    const start = range[0] + match.index + match[0].indexOf(version)
    context.report('carve-version-unsupported', start, start + version.length, path,
      { version: jsonText(version), SPEC_VERSION: '0.2' }, parts === null ? 0 : 1)
    return
  }
}

function commentFenceCloserText(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'comment' || node.form !== 'block' || node.pos === undefined) return
  const opener = context.lines[node.pos.startLine - 1]?.text.trimStart() ?? ''
  let width = 0
  while (opener[width] === '%') width++
  if (width < 3) return
  for (let lineNumber = node.pos.startLine + 1; lineNumber <= node.pos.endLine; lineNumber++) {
    const line = context.lines[lineNumber - 1]
    if (line === undefined) continue
    const text = line.text.trimStart()
    let run = 0
    while (text[run] === '%') run++
    if (run >= width && text.slice(run).trim() !== '') {
      context.report('comment-fence-closer-with-text', line.start, line.end, path)
    }
  }
}

function commentInLabel(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'comment' || node.form !== 'line' || node.pos === undefined) return
  const line = context.lines[node.pos.startLine - 1]
  const range = bounds(node, context)
  if (line === undefined || range === null) return
  const before = context.source.slice(line.start, range[0])
  const open = before.lastIndexOf('[')
  if (open < 0 || before.indexOf(']', open) >= 0) return
  // C2-I-077: only a comment that takes the label's closer leaves the label unclosed; `[ %%` had none to take.
  if (!context.source.slice(range[0], line.end).includes(']')) return
  context.report('comment-in-reference-label', range[0], range[1], path)
}

/** A value as it stands inside a JSON string, its quotes and backslashes escaped. */
function jsonText(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

function footnoteWhitespace(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'footnote') return
  const source = raw(node, context)
  const close = source.indexOf(']')
  if (!source.startsWith('[^') || close < 0) return
  const label = source.slice(2, close)
  const twin = context.state.footnoteLabels.get(node.key)
  if (twin !== undefined && twin !== label) {
    reportNode('footnote-labels-differ-only-in-whitespace', node, path, context,
      { label, twin, key: jsonText(node.key) })
  } else if (twin === undefined) context.state.footnoteLabels.set(node.key, label)
}

/** C2-B-213: a head mark and an `aligns` or `valigns` entry that set the same axis of a column. */
function tableColumnOverlap(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table') return
  if (attributeValue(node, context, 'aligns') === undefined && attributeValue(node, context, 'valigns') === undefined) return
  const head = node.children.find((child) => child.type === 'table_head')
  const first = head?.type === 'table_head' ? head.children.find((child) => child.type === 'table_row') : undefined
  if (first?.type !== 'table_row') return
  node.columns.forEach((column, at) => {
    // C2-A-095: the column fields carry the fact that `aligns` or `valigns` wrote them.
    if (overlaps(column, first.children[at])) {
      const key = column.align !== undefined && first.children[at]?.align !== undefined ? 'aligns' : 'valigns'
      reportAttribute('table-column-overlap', node, path, context, key, false, { n: String(at + 1) })
    }
  })
}

function overlaps(column: TableColumnNode, cell: TableCellNode | undefined): boolean {
  if (cell === undefined) return false
  return (column.align !== undefined && cell.align !== undefined) || (column.valign !== undefined && cell.valign !== undefined)
}

function tightBlankLine(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'list' || node.spacing !== 'tight') return
  for (let at = 0; at < node.children.length; at++) {
    const item = node.children[at]
    if (item === undefined || !item.children.some((child) => child.type === 'paragraph')) continue
    for (let inner = 0; inner < item.children.length - 1; inner++) {
      const childPath = `${path}/children/${at}/children/${inner}`
      if ((context.layouts.get(childPath)?.blankLinesAfter ?? 0) > 0
        && item.children.slice(inner + 1).some((child) => child.type !== 'comment')) {
        reportNode('tight-list-item-with-blank-line', node, path, context)
        return
      }
    }
  }
}

function templateComment(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'comment' || node.form !== 'braced') return
  const source = raw(node, context)
  const content = source.startsWith('{%') ? source.slice(2, -2).trim() : ''
  if (['raw', 'endraw', 'endif', 'endfor', 'endblock'].includes(content)
    || /^(?:if|for|block)\s+\S/.test(content)) {
    reportNode('braced-comment-in-a-template-source', node, path, context)
  }
}

function regionComment(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'comment' || node.form !== 'line' || !/^#(?:end)?region(?![A-Za-z0-9_])/i.test(node.value)) return
  if (/^#(?:end)?region(?![A-Za-z0-9_])/.test(node.value)) return
  reportNode('region-marker-renders-as-text', node, path, context, {}, 1)
}

function unclosedBracedComment(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  const at = source.indexOf('{%')
  const range = bounds(node, context)
  if (at < 0 || source.indexOf('%}', at + 2) >= 0 || range === null) return
  // C2-B-141: the comment is left unclosed by an interrupter line before its closer; with no closer at all nothing split it.
  if (context.source.indexOf('%}', range[1]) >= 0) context.report('unclosed-braced-comment', range[0] + at, range[1], path)
}

const OPENER_BEFORE = /[\s([{]/

function unclosedEmphasis(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  if (!source.includes('*') && !source.includes('/')) return
  const range = bounds(node, context)
  if (range === null) return
  for (let at = 0; at < source.length - 1; at++) {
    const ch = source[at]!
    if ((ch !== '*' && ch !== '/') || !isWord(source[at + 1]) || source[at - 1] === '{'
      || !OPENER_BEFORE.test(source[at - 1] ?? ' ')) continue
    if (source.indexOf(ch, at + 1) >= 0) continue
    context.report('unclosed-inline-emphasis', range[0] + at, range[0] + at + 1, path, { span: ch === '*' ? 'strong' : 'emphasis' })
    return
  }
}

const NOT_SPAN = [...NODE_SLOTS.keys()].filter((type) => type !== 'span') as Node['type'][]
// C2-I-079: a footnote label, a full reference's label or a definition label of only whitespace.
const BLANK_LABEL = /\[\^[ \t\n]+\]|(?<=\])\[[ \t\n]+\]|^\[[ \t]+\]:/gm

function blankReferenceLabel(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  if (!source.includes('[')) return
  const range = bounds(node, context)
  if (range === null) return
  for (const match of source.matchAll(BLANK_LABEL)) {
    const end = match.index + match[0].length
    context.report('blank-reference-label', range[0] + match.index, range[0] + end, path, { text: match[0] })
  }
}

const ROMAN_LETTER = /^[ivxlcdmIVXLCDM][.)]/
const LETTER_STYLES = new Map([['i', 'a'], ['a', 'i'], ['I', 'A'], ['A', 'I']])

/** C2-B-044: a one-item list of a one-roman-letter marker, then a list of the other letter style, fewer than three blank lines apart. */
function orderedKindSplit(node: Node, path: string, context: LintContext): void {
  if (!('children' in node) || !Array.isArray(node.children)) return
  const children = node.children as Node[]
  for (let at = 1; at < children.length; at++) {
    const before = children[at - 1]
    const after = children[at]
    if (before?.type !== 'list' || after?.type !== 'list' || before.children.length !== 1) continue
    if (after.marker.style !== LETTER_STYLES.get(before.marker.style ?? '')) continue
    const first = bounds(before, context)
    const next = bounds(after, context)
    if (first === null || next === null || !ROMAN_LETTER.test(context.source.slice(first[0]).trimStart())) continue
    if (context.source.slice(first[1], next[0]).split('\n').length - 2 >= 3) continue
    reportNode('ordered-list-kind-split', before, `${path}/children/${at - 1}`, context)
  }
}

function sigilAfterLetter(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  if (!source.includes('@') && !source.includes('#')) return
  const range = bounds(node, context)
  if (range === null) return
  for (let at = 1; at < source.length - 1; at++) {
    const sigil = source[at]
    if (sigil !== '@' && sigil !== '#') continue
    const before = source.charCodeAt(at - 1)
    if (before < 128 || !/[\p{L}\p{N}]/u.test(source[at - 1]!) || !isWord(source[at + 1])) continue
    const name = /^[\p{L}\p{N}_-]+/u.exec(source.slice(at + 1))?.[0] ?? ''
    if (/[\p{L}]/u.test(name)) {
      context.report('sigil-after-letter', range[0] + at, range[0] + at + 1, path)
    }
  }
}

/**
 * The column of `child` in the container of `item`, as the layout counts the item's columns: positions count from the
 * start of the line, so a quote mark before the item would otherwise read as indentation.
 */
function itemColumn(item: Node, marker: number, child: Node): number | undefined {
  if (item.pos === undefined || child.pos === undefined) return undefined
  return child.pos.startColumn - item.pos.startColumn + marker
}

/** C2-W-106 table: a block of an item, after its first, that starts past the marker and short of the content column. */
function listItemBodyColumn(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'list_item') return
  const layout = context.layouts.get(path)
  const marker = layout?.markerColumn
  const content = layout?.contentColumn
  if (marker === undefined || content === undefined) return
  for (const child of node.children.slice(1)) {
    const line = child.pos === undefined ? undefined : context.lines[child.pos.startLine - 1]
    const column = itemColumn(node, marker, child)
    if (line === undefined || column === undefined || column <= marker || column >= content) continue
    const at = line.start + (child.pos?.startColumn ?? 1) - 1
    context.report('list-item-body-below-content-column', at, line.end, path)
  }
}

/** Each block of a list item, other than a paragraph, that starts past the item's content column. */
function overindentedBlocks(node: Node, path: string, context: LintContext,
  visit: (at: number, child: Node, start: number, end: number, past: number, content: number) => void): void {
  if (node.type !== 'list_item') return
  const layout = context.layouts.get(path)
  const content = layout?.contentColumn
  const marker = layout?.markerColumn
  if (content === undefined || marker === undefined) return
  for (let at = 0; at < node.children.length; at++) {
    const child = node.children[at]
    if (child === undefined || child.type === 'paragraph' || child.type === 'list' || child.pos === undefined) continue
    const line = context.lines[child.pos.startLine - 1]
    const column = itemColumn(node, marker, child)
    if (line === undefined || column === undefined || column <= content) continue
    visit(at, child, line.start + child.pos.startColumn - 1, line.end, column - content, content)
  }
}

function listItemBlockIndent(node: Node, path: string, context: LintContext): void {
  overindentedBlocks(node, path, context, (at, _child, start, end, _past, content) => context.report(
    'list-item-block-overindented', start, end, `${path}/children/${at}`, { contentColumn: String(content + 1) }))
}

/** The marker column of the list item that holds the list at `path`, or undefined at the top of a container. */
function outerMarkerColumn(path: string, context: LintContext): number | undefined {
  const split = path.lastIndexOf('/children/')
  if (split < 0) return undefined
  const parent = path.slice(0, split)
  return context.nodeTypes.get(parent) === 'list_item' ? context.layouts.get(parent)?.markerColumn : undefined
}

/**
 * Each later item of `node` whose marker stands left of the item before it, with `between` true where it stands right of
 * the item that holds the list: C2-B-055 then read it between two open lists, and otherwise C2-B-054 left of them all.
 */
function leftMarkers(node: Node, path: string, context: LintContext,
  visit: (at: number, column: number, deeper: number, outer: number | undefined) => void): void {
  if (node.type !== 'list') return
  const outer = outerMarkerColumn(path, context)
  for (let at = 1; at < node.children.length; at++) {
    const deeper = context.layouts.get(`${path}/children/${at - 1}`)?.markerColumn
    const column = context.layouts.get(`${path}/children/${at}`)?.markerColumn
    if (deeper !== undefined && column !== undefined && column < deeper) visit(at, column, deeper, outer)
  }
}

function listMarkerBelowColumn(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'list') return
  const split = path.lastIndexOf('/children/')
  const owner = path.slice(0, split)
  const index = Number(path.slice(split + '/children/'.length))
  if (context.nodeTypes.get(owner) === 'list_item' && index > 0) {
    const previous = `${owner}/children/${index - 1}`
    const outer = context.layouts.get(owner)?.markerColumn
    const deeper = context.layouts.get(`${previous}/children/0`)?.markerColumn
    const column = context.layouts.get(`${path}/children/0`)?.markerColumn
    if (outer !== undefined && deeper !== undefined && column !== undefined && outer < column && column < deeper) {
      reportNode('list-marker-below-content-column', node.children[0]!, `${path}/children/0`, context,
        { column: String(column + 1), contentColumn: String(deeper + 1), baseColumn: String(outer + 1) })
    }
  }
  leftMarkers(node, path, context, (at, column, deeper, outer) => {
    const item = node.type === 'list' ? node.children[at] : undefined
    if (item === undefined || outer === undefined || column <= outer) return
    reportNode('list-marker-below-content-column', item, `${path}/children/${at}`, context,
      { column: String(column + 1), contentColumn: String(deeper + 1), baseColumn: String(outer + 1) })
  })
}

function ownerContentColumn(ownerPath: string, ownerType: string, context: LintContext): number {
  const ownerLayout = context.layouts.get(ownerPath)
  if (ownerType !== 'block_quote') return ownerLayout?.contentColumn ?? 0
  const ownerStart = context.chars[ownerLayout?.startByte ?? 0] ?? 0
  const ownerLine = context.lines[(context.offsetLines[ownerStart] ?? 1) - 1]
  return ownerStart - (ownerLine?.start ?? ownerStart) + 2
}

function blockOverindent(node: Node, path: string, context: LintContext): void {
  if (node.pos === undefined) return
  const split = path.lastIndexOf('/children/')
  const ownerPath = split < 0 ? '' : path.slice(0, split)
  const ownerType = context.nodeTypes.get(ownerPath) ?? 'document'
  if (ownerType === 'list_item') return
  const start = context.chars[node.pos.startOffset] ?? 0
  const line = context.lines[node.pos.startLine - 1]
  if (line === undefined) return
  const column = start - line.start
  const content = ownerContentColumn(ownerPath, ownerType, context)
  if (column <= content) return
  const kind = node.type === 'block_quote' ? 'quote' : node.type.replaceAll('_', ' ')
  const width = node.type === 'definition_term' ? 2 : node.type === 'div' ? 3 : 1
  const past = column - content
  context.report('block-opener-overindented', start, start + width, path,
    { kind, past: String(past), columns: past === 1 ? 'column' : 'columns', owner: ownerType.replaceAll('_', ' ') })
}

function bracedSpanAsText(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const split = path.lastIndexOf('/children/')
  if (split < 0) return
  const parent = context.nodeTypes.get(path.slice(0, split))
  if (parent !== 'strong' && parent !== 'emphasis') return
  const source = raw(node, context)
  const openers = [source.indexOf('{*'), source.indexOf('{/')].filter((at) => at >= 0)
  const at = openers.length === 0 ? -1 : Math.min(...openers)
  const range = bounds(node, context)
  const closer = source[at + 1] === '*' ? '*}' : '/}'
  const after = range === null ? '' : context.source.slice(range[0] + at + 2)
  if (at >= 0 && range !== null && after.includes(closer)) context.report('braced-span-opener-as-text', range[0] + at,
    range[0] + at + 2, path)
}

function nearTable(word: string): boolean {
  const lower = word.toLowerCase()
  if (lower === 'table') return word !== 'table'
  if (Math.abs(lower.length - 5) > 1) return false
  if (lower.length === 5) {
    const wrong = [...lower].filter((char, index) => char !== 'table'[index]).length
    if (wrong === 1) return true
    for (let at = 0; at < 4; at++) {
      const swapped = `${lower.slice(0, at)}${lower[at + 1]}${lower[at]}${lower.slice(at + 2)}`
      if (swapped === 'table') return true
    }
    return false
  }
  const short = lower.length < 5 ? lower : 'table'
  const long = lower.length < 5 ? 'table' : lower
  for (let at = 0; at < long.length; at++) if (long.slice(0, at) + long.slice(at + 1) === short) return true
  return false
}

function consumedNearMiss(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'code_block' || (node.syntax !== 'csv' && node.syntax !== 'tsv')) return
  const range = bounds(node, context)
  if (range === null) return
  const opener = /^`{3,}/m.exec(context.source.slice(range[0], range[1]))
  if (opener === null) return
  for (const [word, value] of node.attrs?.keyValues ?? []) {
    if (value === '' && nearTable(word)) context.report('consumed-key-near-miss', range[0] + opener.index,
      range[1], path, { word, key: 'table' })
  }
}

function orderedRightAligned(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'list' || node.marker.kind !== 'ordered' || node.children.length < 2) return
  const first = context.layouts.get(`${path}/children/0`)
  const second = context.layouts.get(`${path}/children/1`)
  if (first?.markerColumn === undefined || second?.markerColumn === undefined) return
  if (first.markerColumn > second.markerColumn && first.contentColumn === second.contentColumn) {
    reportNode('ordered-marker-right-aligned', node.children[1]!, `${path}/children/1`, context)
  }
}

/** C2-B-173: a span mark that joins nothing is the text of its cell, whatever prefix the cell has. */
function blockedSpanVariant(marker: string, cellIndex: number, rowIndex: number): number {
  if (marker === '<') return cellIndex === 0 ? 0 : 1
  return rowIndex === 0 ? 2 : 3
}

function spanMarkerBlocked(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table_cell' || node.span !== undefined) return
  const content = node.children[0]
  const only = content?.type === 'cell_paragraph' && content.children.length === 1 ? content.children[0] : undefined
  const marker = only?.type === 'text' ? only.value : ''
  if (marker !== '<' && marker !== '^') return
  // An escaped mark is text by the author's choice.
  if (raw(node, context).trimEnd().endsWith(`\\${marker}`)) return
  const parts = path.split('/children/')
  const cellIndex = Number(parts.at(-1) ?? 0)
  const rowIndex = Number(parts.at(-2) ?? 0)
  const variant = blockedSpanVariant(marker, cellIndex, rowIndex)
  reportNode('table-span-marker-blocked', node, path, context, {}, variant)
}

/**
 * C2-B-174: the brace block in the prefix of a span mark that joins a cell applies to no cell, and fmt drops it; so does
 * a header mark on it whose row is no head row.
 */
function spanMarkerAttribute(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table_cell' || node.span === undefined) return
  const prefix = raw(node, context)
  const header = prefix.startsWith('=')
  const braced = (header ? prefix.slice(1) : prefix).startsWith('{')
  if (!braced && (!header || context.nodeTypes.get(groupPath(path)) === 'table_head')) return
  const marker = node.span === 'rowspan' ? '^' : '<'
  const values = { marker, direction: marker === '^' ? 'above it' : 'to its left' }
  reportNode('table-span-marker-attribute', node, path, context, values, braced ? 0 : 1)
}

/** The path of the group of the cell at `path`: head, body or foot. */
function groupPath(path: string): string {
  const row = path.slice(0, path.lastIndexOf('/children/'))
  return row.slice(0, row.lastIndexOf('/children/'))
}

function unevenListIndent(node: Node, path: string, context: LintContext): void {
  leftMarkers(node, path, context, (at, column, _deeper, outer) => {
    const item = node.type === 'list' ? node.children[at] : undefined
    if (item !== undefined && (outer === undefined || column <= outer)) reportNode('uneven-list-indent', item, `${path}/children/${at}`, context)
  })
}

function nonDescriptiveLink(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'link' || node.children.length !== 1) return
  const child = node.children[0]
  if (child?.type !== 'text') return
  const value = child.value.toLowerCase().trim().replace(/\s+/g, ' ')
  if (value === 'here' || value === 'click here' || value === 'read more') {
    reportNode('non-descriptive-link-text', node, path, context)
  }
}

function unresolvedReference(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'link' && node.type !== 'image') return
  if (node.key === undefined) return
  const resolved = node.type === 'link' ? node.href !== undefined : node.src !== undefined
  if (resolved) return
  context.state.unresolvedReferences.push({ node, path })
}

function unusedReference(node: Node, path: string, context: LintContext): void {
  if (node.type === 'link_reference_definition') context.state.referenceDefinitions.push({ node, path })
  else if ((node.type === 'link' || node.type === 'image') && node.key !== undefined) {
    context.state.usedReferences.add(node.key)
  }
}

function unresolvedFootnote(node: Node, path: string, context: LintContext): void {
  if (node.type === 'footnote_ref' && node.number === undefined) {
    reportNode('unresolved-footnote', node, path, context, { id: node.key })
  }
}

function unusedFootnote(node: Node, path: string, context: LintContext): void {
  if (node.type === 'footnote') context.state.footnoteDefinitions.push({ node, path })
  else if (node.type === 'footnote_ref') context.state.usedFootnotes.add(node.key)
}

function fragmentNames(href: string): [string, string] {
  const fragment = href.slice(1).split(':~:', 1)[0] ?? ''
  try { return [fragment, decodeURIComponent(fragment)] }
  catch { return [fragment, fragment] }
}

function brokenFragment(item: { node: Node, path: string }, context: LintContext): void {
  if (item.node.type !== 'link' || item.node.href === undefined) return
  const href = item.node.href
  const [fragment, decoded] = fragmentNames(href)
  if (fragment === '' || fragment.toLowerCase() === 'top') return
  if (context.state.ids.has(fragment) || context.state.ids.has(decoded)) return
  const caseOnly = [...context.state.ids].find((id) => id.toLowerCase() === fragment.toLowerCase()
    || id.toLowerCase() === decoded.toLowerCase())
  reportNode('broken-fragment-link', item.node, item.path, context, { href, caseOnly: caseOnly ?? '' },
    caseOnly === undefined ? 1 : 0)
}

function finishFragments(context: LintContext): void {
  if (context.options.rules?.['broken-fragment-link'] === 'off' || (context.options.extensions?.length ?? 0) > 0) return
  for (const item of context.state.fragmentLinks) brokenFragment(item, context)
}

function finishCrossrefs(context: LintContext): void {
  for (const item of context.state.crossrefs) {
    if (item.node.type !== 'xref') continue
    const target = item.node.key
    const exact = context.state.idOwners.get(target)
    if (exact !== undefined && exact !== 'heading' && exact !== 'caption') {
      reportNode('broken-crossref', item.node, item.path, context, { target, id: target, kind: exact }, 0)
      continue
    }
    const caseOnly = [...context.state.idOwners].filter(([id, type]) => (type === 'heading' || type === 'caption')
      && id.toLowerCase() === target.toLowerCase()).map(([id]) => id)
    const phrase = caseOnly.length === 1 ? `the id ${caseOnly[0]} differs only in case`
      : `the ids ${caseOnly.join(', ')} differ only in case`
    reportNode('broken-crossref', item.node, item.path, context,
      { target, caseOnlyPhrase: phrase }, caseOnly.length === 0 ? 2 : 1)
  }
}

function reportUnresolvedReference(item: { node: Node, path: string }, context: LintContext): void {
  const { node } = item
  if (node.type !== 'link' && node.type !== 'image') return
  const rawRef = context.layouts.get(item.path)?.rawRef ?? raw(node, context)
  const key = node.key ?? ''
  const matches = context.state.referenceDefinitions.filter(({ node: definition }) =>
    definition.type === 'link_reference_definition' && definition.key.toLowerCase() === key.toLowerCase())
  const headings = node.type === 'link' ? [...context.state.idOwners.keys()].filter((id) =>
    id.toLowerCase() === key.toLowerCase()) : []
  const caseOnly = [...matches.map(({ node: definition }) => definition.type === 'link_reference_definition'
    ? definition.key : ''), ...headings].filter((value) => value !== key)
  const index = node.type === 'link' ? (caseOnly.length > 0 ? 0 : 1) : (caseOnly.length > 0 ? 2 : 3)
  reportNode('unresolved-reference-link', node, item.path, context,
    { rawRef, caseOnlyPhrase: `the label ${caseOnly[0] ?? ''} differs only in case` }, index)
}

function reportUnusedReferences(context: LintContext): void {
  if (context.options.rules?.['unused-link-reference-definition'] === 'off') return
  for (const item of context.state.referenceDefinitions) {
    if (item.node.type === 'link_reference_definition' && !context.state.usedReferences.has(item.node.key)) {
      reportNode('unused-link-reference-definition', item.node, item.path, context)
    }
  }
}

function finishReferences(context: LintContext): void {
  for (const item of context.state.unresolvedReferences) reportUnresolvedReference(item, context)
  reportUnusedReferences(context)
}

function finishFootnotes(context: LintContext): void {
  if (context.options.rules?.['unused-footnote-definition'] !== 'off') {
    for (const item of context.state.footnoteDefinitions) {
      if (item.node.type === 'footnote' && !context.state.usedFootnotes.has(item.node.key)) {
        const range = bounds(item.node, context)
        if (range === null) continue
        const key = `[^${item.node.key}]`
        const at = context.source.slice(range[0], range[1]).indexOf(key)
        if (at >= 0) context.report('unused-footnote-definition', range[0] + at,
          range[0] + at + key.length, item.path, { label: item.node.key })
      }
    }
  }
}

export function finishStructure(context: LintContext): void {
  finishFragments(context)
  finishCrossrefs(context)
  finishReferences(context)
  finishFootnotes(context)
  for (let at = context.diagnostics.length - 1; at >= 0; at--) {
    const entry = context.diagnostics[at]!
    if (entry.code !== 'platform-issue-reference' && entry.code !== 'platform-mention-token') continue
    const footnote = [...context.state.footnoteKeys].find(([path]) => entry.path?.startsWith(`${path}/`))
    if (footnote === undefined || context.state.usedFootnotes.has(footnote[1])) continue
    context.diagnostics.splice(at, 1)
    context.findingLines.splice(at, 1)
  }
}

/** C2-N-072: the attribute line above an include without `code` applies to nothing. */
function includeAttributesUnused(node: Node, path: string, context: LintContext): void {
  if (node.type === 'include' && node.attrs !== undefined && node.options?.code === undefined) {
    reportNode('include-attributes-unused', node, path, context)
  }
}

/** C2-N-088: `lines` on a delimited table include counts physical lines, where `rows` counts records. */
function includeLinesTableRows(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'include' || node.options?.lines === undefined) return
  const code = node.options.code
  const table = node.attrs?.keyValues?.some(([key]) => key === 'table') === true
  if (table && (code === 'csv' || code === 'tsv')) {
    const range = bounds(node, context)
    if (range === null) return
    const source = raw(node, context)
    const start = source.indexOf('@lines:')
    if (start >= 0) context.report('include-lines-table-rows-hint', range[0] + start,
      range[0] + start + source.slice(start).split(/[\s}]/, 1)[0]!.length, path)
  }
}

function nodeRule(id: Rule['id'], nodes: readonly Node['type'][] , checkNode: NonNullable<Rule['checkNode']>): Rule {
  return { id, nodes, checkNode }
}

export const NODE_RULES: readonly Rule[] = [
  nodeRule('include-attributes-unused', ['include'], includeAttributesUnused),
  nodeRule('include-lines-table-rows-hint', ['include'], includeLinesTableRows),
  nodeRule('deprecated-bare-underline', INLINE_PARENTS, textPair('_', 'deprecated-bare-underline')),
  nodeRule('deprecated-bare-strike', INLINE_PARENTS, textPair('~', 'deprecated-bare-strike')),
  nodeRule('deprecated-bare-highlight', INLINE_PARENTS, textPair('=', 'deprecated-bare-highlight')),
  nodeRule('markdown-strong-double-star', INLINE_PARENTS, textPair('**', 'markdown-strong-double-star')),
  nodeRule('markdown-strikethrough-double-tilde', INLINE_PARENTS, textPair('~~', 'markdown-strikethrough-double-tilde')),
  nodeRule('djot-emphasis-underscore', INLINE_PARENTS, textPair('_', 'djot-emphasis-underscore')),
  nodeRule('djot-subscript-tilde', INLINE_PARENTS, textPair('~', 'djot-subscript-tilde')),
  nodeRule('djot-superscript-caret', INLINE_PARENTS, textPair('^', 'djot-superscript-caret')),
  nodeRule('a11y/image-alt', ['image'], imageAlt),
  nodeRule('empty-link-destination', ['link'], emptyDestination),
  nodeRule('deprecated-loose-attribute', ['list'], looseAttribute),
  nodeRule('deprecated-table-attribute', ['table'], tableAttribute),
  nodeRule('heading-level-skip', ['heading'], headingLevel),
  nodeRule('heading-marker-mixed', ['heading'], headingKind),
  nodeRule('heading-closing-hashes', ['heading'], headingClosing),
  nodeRule('heading-trailing-attribute', ['heading'], headingTrailing),
  nodeRule('duplicate-reference-url', ['link_reference_definition'], duplicateReferenceUrl),
  nodeRule('deprecated-separator-row', ['table_row'], separatorRow),
  nodeRule('table-row-cell-count', ['table'], tableRows),
  nodeRule('figure-group-empty', ['figure_group'], figureEmpty),
  nodeRule('figure-group-single-panel', ['figure_group'], figureSingle),
  nodeRule('deprecated-substitution-arrow', ['strike'], substitutionArrow),
  nodeRule('frontmatter-shaped-thematic-break', ['frontmatter'], frontmatterBreak),
  nodeRule('blockquote-marker-without-space', ['frontmatter'], frontmatterQuote),
  nodeRule('html-comment-renders-as-text', ['paragraph'], multilineHtmlComment),
  nodeRule('bidi-control-in-source', ['text', 'code', 'code_block', 'math'], bidiControl),
  nodeRule('description-term-multi-line', ['definition_term'], multilineTerm),
  nodeRule('deprecated-indented-line-under-heading', ['heading'], headingContinuation),
  nodeRule('figure-group-nested', ['div'], figureNested),
  nodeRule('figure-group-panel-number', ['figure_group'], figurePanelNumber),
  nodeRule('footnotes-placement-in-container', ['directive'], footnotePlacement),
  nodeRule('references-placement-in-container', ['directive'], referencesPlacement),
  nodeRule('semantic-attribute-outside-span', NOT_SPAN, semanticOutside),
  nodeRule('semantic-attribute-value-ignored', ['span'], semanticValue),
  nodeRule('table-column-arity', ['table'], tableColumnArity),
  nodeRule('table-attribute-invalid', ['table'], invalidTableAttribute),
  nodeRule('table-row-count-clamped', ['table'], rowCountClamped),
  nodeRule('comment-splits-table-row', ['table'], commentSplitsRow),
  nodeRule('table-width-total', ['table'], tableWidth),
  nodeRule('table-row-attribute-as-cell', ['table_row'], rowAttributeCell),
  nodeRule('emphasis-as-heading', ['paragraph'], emphasizedHeading),
  nodeRule('comment-shaped-emphasis', ['emphasis', 'strong'], commentEmphasis),
  nodeRule('glob-shaped-strong', ['strong'], globStrong),
  nodeRule('djot-subscript-tilde-braced', ['strike'], djotBracedStrike),
  nodeRule('djot-highlight-braces', ['highlight'], djotBracedHighlight),
  nodeRule('unattached-inline-attribute', ['text'], unattachedInline),
  nodeRule('deprecated-cell-alignment', ['table_cell'], deprecatedCellAlignment),
  nodeRule('table-marker-run-padding', ['table_cell'], markerRunPadding),
  nodeRule('fence-closer-indented', ['code_block'], fenceCloserIndent),
  nodeRule('figure-group-opener-metadata', ['div'], figureOpenerMetadata),
  nodeRule('comment-line-in-line-block', ['line'], commentInLineBlock),
  nodeRule('broken-crossref', ['xref'], brokenCrossref),
  nodeRule('broken-fragment-link', ['link'], collectFragment),
  nodeRule('platform-issue-reference', ['text'], platformIssue),
  nodeRule('platform-mention-token', ['text', 'mention'], platformMention),
  nodeRule('delimited-table-wide-row', ['table'], delimitedWideRow),
  nodeRule('djot-intraword-underscore', ['text'], intrawordUnderscore),
  nodeRule('emphasis-marker-before-attributes', ['text'], emphasisBeforeAttrs),
  nodeRule('emphasis-marker-before-attributes', ['strong', 'emphasis'], spanMarkerBeforeAttrs),
  nodeRule('carve-version-unsupported', ['frontmatter'], carveVersion),
  nodeRule('blank-reference-label', ['text'], blankReferenceLabel),
  nodeRule('comment-fence-closer-with-text', ['comment'], commentFenceCloserText),
  nodeRule('comment-in-reference-label', ['comment'], commentInLabel),
  nodeRule('footnote-labels-differ-only-in-whitespace', ['footnote'], footnoteWhitespace),
  nodeRule('table-column-overlap', ['table'], tableColumnOverlap),
  nodeRule('tight-list-item-with-blank-line', ['list'], tightBlankLine),
  nodeRule('braced-comment-in-a-template-source', ['comment'], templateComment),
  nodeRule('region-marker-renders-as-text', ['comment'], regionComment),
  nodeRule('unclosed-braced-comment', ['text'], unclosedBracedComment),
  nodeRule('unclosed-inline-emphasis', ['text'], unclosedEmphasis),
  nodeRule('ordered-list-kind-split', ['document', 'block_quote', 'list_item', 'div', 'footnote', 'admonition'], orderedKindSplit),
  nodeRule('sigil-after-letter', ['text'], sigilAfterLetter),
  nodeRule('list-item-body-below-content-column', ['list_item'], listItemBodyColumn),
  nodeRule('list-item-block-overindented', ['list_item'], listItemBlockIndent),
  nodeRule('list-marker-below-content-column', ['list'], listMarkerBelowColumn),
  nodeRule('block-opener-overindented', ['block_quote', 'div', 'code_block', 'line_block', 'definition_term', 'heading',
    'thematic_break', 'table'], blockOverindent),
  nodeRule('braced-span-opener-as-text', ['text'], bracedSpanAsText),
  nodeRule('consumed-key-near-miss', ['code_block'], consumedNearMiss),
  nodeRule('ordered-marker-right-aligned', ['list'], orderedRightAligned),
  nodeRule('table-span-marker-blocked', ['table_cell'], spanMarkerBlocked),
  nodeRule('table-span-marker-attribute', ['table_cell'], spanMarkerAttribute),
  nodeRule('uneven-list-indent', ['list'], unevenListIndent),
  nodeRule('non-descriptive-link-text', ['link'], nonDescriptiveLink),
  nodeRule('unresolved-reference-link', ['link', 'image'], unresolvedReference),
  nodeRule('unused-link-reference-definition', ['link', 'image', 'link_reference_definition'], unusedReference),
  nodeRule('unresolved-footnote', ['footnote_ref'], unresolvedFootnote),
  nodeRule('unused-footnote-definition', ['footnote', 'footnote_ref'], unusedFootnote),
]
