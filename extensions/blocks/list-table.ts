import type { ExtensionBundle } from '../../src/extensions/standard/bundle.ts'
import type { Attrs, Block, ExtensionClaim, ExtensionDefinition, ExtensionRenderer, ExtensionRenderHost, ListItemNode, ListNode, Node } from '../../src/index.ts'
import { type ColumnLists, readColumnLists } from '../../src/ast-table.ts'
import { percentageText } from '../../src/decimal.ts'
import { attrValue, authorAttrs, withStyle } from '../common/attrs.ts'

interface Cell {
  item: ListItemNode
  marker: '<' | '^' | null
  rowspan: number
  colspan: number
  skip: boolean
}

interface TableData {
  rows: Cell[][]
  rowHeads: boolean[]
  title: Node[]
  label: string | undefined
  attrs: Attrs | undefined
}

function rowCells(row: ListItemNode): ListItemNode[] | null {
  // C2-X-078: a row item holds one list and nothing else.
  if (row.children.length !== 1 || row.children[0]?.type !== 'list') return null
  const items = row.children[0].children.map((item) => structuredClone(item))
  return items.length === 0 ? null : items
}

function tableList(body: Block[]): ListNode | null {
  if (body.length !== 1 || body[0]?.type !== 'list') return null
  if (body[0].children.length === 0 || body[0].children.length > 10_000) return null
  let total = 0
  let width = 0
  for (const row of body[0].children) {
    const cells = rowCells(row)
    if (cells === null || cells.length === 0) return null
    total += cells.length
    width = Math.max(width, cells.length)
    if (total > 100_000 || width * body[0].children.length > 100_000) return null
  }
  return body[0]
}

function transform(claim: ExtensionClaim) {
  if (claim.form !== 'div') return null
  const list = tableList(claim.body)
  if (list === null) return null
  const title = claim.node.title ?? []
  const label = claim.node.groupLabel
  return { type: 'block_extension' as const, name: 'carve.listTable', version: '1', children: [],
    slots: { rows: [list], caption: title }, fallback: structuredClone(claim.body),
    ...(label === undefined ? {} : { props: { label } }) }
}

export const listTableExtension: ExtensionDefinition = {
  name: 'carve.listTable', version: '1', matcher: { form: 'div', name: 'list-table' },
  props: { label: 'string' }, slots: { rows: { kind: 'block', minItems: 1 }, caption: { kind: 'inline', optional: true } },
  children: 'none', transform,
}

function headerCount(attrs: Attrs | undefined, key: string): number {
  // C2-X-078: a decimal integer above 0; any other value, the empty one included, has no effect.
  const value = attrValue(attrs, key)
  if (value === undefined || !/^[0-9]+$/.test(value)) return 0
  return Math.min(Number(value), 10_000)
}

function marker(item: ListItemNode): '<' | '^' | null {
  if (item.attrs !== undefined || item.children.length !== 1 || item.children[0]?.type !== 'paragraph') return null
  const inlines = item.children[0].children
  if (inlines.length !== 1 || inlines[0]?.type !== 'text') return null
  // C2-X-076: only a text node is a mark; a literal-text span `!`<`` is a cell holding `<`.
  const value = inlines[0].value
  return value === '^' || value === '<' ? value : null
}

function extract(node: Parameters<NonNullable<ExtensionRenderer['render']>>[0]): TableData | null {
  const list = node.slots?.['rows']?.[0]
  if (list?.type !== 'list') return null
  const rows: Cell[][] = []
  const rowHeads: boolean[] = []
  for (const row of list.children) {
    const items = rowCells(row)
    if (items === null) return null
    rowHeads.push(attrValue(items[0]?.attrs, 'header-row') !== undefined)
    rows.push(items.map((item) => ({ item, marker: marker(item), rowspan: 1, colspan: 1, skip: false })))
  }
  return { rows, rowHeads, title: node.slots?.['caption'] ?? [],
    label: typeof node.props?.['label'] === 'string' ? node.props['label'] : undefined,
    attrs: node.attrs }
}

function bodyBoundaries(rowHeads: boolean[], start: number, end: number): number[] {
  const boundaries = [start]
  let hasData = false
  for (let row = start; row < end; row++) {
    if (rowHeads[row] && hasData) {
      boundaries.push(row)
      hasData = false
    }
    if (!rowHeads[row]) hasData = true
  }
  boundaries.push(end)
  return boundaries
}

function groupIds(count: number, head: number, foot: number, boundaries: number[]): number[] {
  const ids: number[] = []
  for (let row = 0; row < count; row++) {
    if (row < head) ids.push(0)
    else if (row >= count - foot) ids.push(boundaries.length)
    else ids.push(boundaries.findIndex((end) => end > row))
  }
  return ids
}

function resolveSpans(rows: Cell[][], groups: number[]): void {
  const occupied: Array<Array<Cell | undefined>> = []
  for (let row = 0; row < rows.length; row++) {
    const above = occupied[row - 1] ?? []
    const current: Array<Cell | undefined> = []
    const sameGroup = row > 0 && groups[row] === groups[row - 1]
    for (let col = 0; col < (rows[row]?.length ?? 0); col++) {
      const cell = rows[row]?.[col]
      if (cell === undefined) continue
      // C2-X-076: a `<` whose left cell a row span covers from above joins nothing.
      const left = col > 0 && rows[row]?.[col - 1]?.marker === '^' && current[col - 1] !== rows[row]?.[col - 1]
        ? undefined : current[col - 1]
      current[col] = mergeCell(cell, left, above[col], sameGroup)
    }
    occupied.push(current)
  }
}

function mergeCell(cell: Cell, left: Cell | undefined, up: Cell | undefined, sameGroup: boolean): Cell {
  if (cell.marker === '<' && left !== undefined) {
    cell.skip = true
    left.colspan += 1
    return left
  }
  if (cell.marker === '^' && sameGroup && up !== undefined && up.colspan === 1) {
    cell.skip = true
    up.rowspan += 1
    return up
  }
  return cell
}

function cellContent(item: ListItemNode, host: ExtensionRenderHost): string {
  if (item.children.length === 1 && item.children[0]?.type === 'paragraph') return host.inlines(item.children[0].children)
  return item.children.map((block) => host.blocks([block])).join('\n')
}

const CELL_ALIGNS = ['left', 'right', 'center']
const CELL_VALIGNS = ['top', 'middle', 'bottom', 'baseline']

/** C2-X-078: a cell value read as C2-H-015 reads `align`; another value is no mark. */
function cellMark(value: string | undefined, allowed: readonly string[]): string | undefined {
  if (value === undefined) return undefined
  const folded = value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '').replace(/[A-Z]/g, (letter) => letter.toLowerCase())
  return allowed.includes(folded) ? folded : undefined
}

function cellStyle(cell: Cell, col: number, columns: ColumnLists): string {
  const h = cellMark(attrValue(cell.item.attrs, 'align'), CELL_ALIGNS) ?? columns.aligns?.[col]
  const v = cellMark(attrValue(cell.item.attrs, 'valign'), CELL_VALIGNS) ?? columns.valigns?.[col]
  return `${h === undefined ? '' : `text-align: ${h};`}${h !== undefined && v !== undefined ? ' ' : ''}` +
    `${v === undefined ? '' : `vertical-align: ${v};`}`
}

function cellHtml(cell: Cell, col: number, row: number, head: number, headCols: number, rowHead: boolean,
  columns: ColumnLists, host: ExtensionRenderHost): string {
  if (cell.skip) return ''
  const heading = row < head || rowHead || col < headCols || attrValue(cell.item.attrs, 'header') !== undefined
  const tag = heading ? 'th' : 'td'
  const scope = heading ? ` scope="${row < head || rowHead ? 'col' : 'row'}"` : ''
  const spans = `${cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : ''}${cell.colspan > 1 ? ` colspan="${cell.colspan}"` : ''}`
  const attrs = authorAttrs(withStyle(cell.item.attrs, cellStyle(cell, col, columns)), host,
    ['rowspan', 'colspan', 'scope', 'header', 'header-row', 'align', 'valign'])
  return `<${tag}${scope}${spans}${attrs}>` +
    `${cellContent(cell.item, host)}</${tag}>`
}

function rowHtml(cells: Cell[], row: number, head: number, headCols: number, rowHead: boolean, width: number,
  columns: ColumnLists, host: ExtensionRenderHost): string {
  const content = cells.map((cell, col) => cellHtml(cell, col, row, head, headCols, rowHead, columns, host)).join('')
  const padding = Array.from({ length: Math.max(0, width - cells.length) }, () => '<td></td>').join('')
  const annotation = host.attributes(cells[0]?.item ?? null, { block: true, bare: true })
  return `    <tr${annotation}>${content}${padding}</tr>`
}

function groupHtml(table: TableData, start: number, end: number, name: string, head: number, headCols: number,
  width: number, columns: ColumnLists, host: ExtensionRenderHost): string {
  if (start >= end) return ''
  const rendered = table.rows.slice(start, end).map((cells, index) =>
    rowHtml(cells, start + index, head, headCols, table.rowHeads[start + index] ?? false, width, columns, host)).join('\n')
  const annotation = host.attributes(table.rows[start]?.[0]?.item ?? null, { block: true, bare: true })
  return `  <${name}${annotation}>\n${rendered}\n  </${name}>\n`
}

/** C2-H-152: one `<col>` per column once any column of the table has a width. */
function columnsHtml(widths: number[] | null, count: number): string {
  if (widths === null || count === 0) return ''
  const columns = Array.from({ length: count }, (_, at) => {
    const width = widths[at]
    return width === undefined ? '    <col>' : `    <col style="width: ${percentageText(width)}%;">`
  }).join('\n')
  return `  <colgroup>\n${columns}\n  </colgroup>\n`
}

export const listTableRenderer: ExtensionRenderer = { version: '1', render(node, host) {
  const table = extract(node)
  if (table === null) return host.blocks(node.fallback ?? [])
  const head = Math.min(headerCount(table.attrs, 'header-rows'), table.rows.length)
  const foot = Math.min(headerCount(table.attrs, 'footer-rows'), table.rows.length - head)
  const headCols = headerCount(table.attrs, 'header-cols')
  const width = Math.max(...table.rows.map((row) => row.length))
  const bodyEnd = table.rows.length - foot
  const boundaries = bodyBoundaries(table.rowHeads, head, bodyEnd)
  resolveSpans(table.rows, groupIds(table.rows.length, head, foot, boundaries))
  const label = table.label === undefined || table.label === '' ? '' :
    `<p class="div-label">${host.escapeText(table.label)}</p>\n`
  const caption = table.title.length === 0 ? '' : `  <caption>${host.inlines(table.title)}</caption>\n`
  const columns = readColumnLists((name) => attrValue(table.attrs, name) ?? null)
  const consumed = ['header-rows', 'header-cols', 'footer-rows', 'aligns', 'valigns', 'widths']
  if (host.sourceLines) consumed.push('data-source-line')
  const attrs = authorAttrs(table.attrs, host, consumed) + host.attributes(node, { block: true, bare: true })
  const bodies = boundaries.slice(0, -1).map((start, index) =>
    groupHtml(table, start, boundaries[index + 1] ?? start, 'tbody', head, headCols, width, columns, host)).join('')
  const html = `${label}<table${attrs}>\n${caption}${columnsHtml(columns.widths, width)}` +
    groupHtml(table, 0, head, 'thead', head, headCols, width, columns, host) +
    bodies +
    groupHtml(table, bodyEnd, table.rows.length, 'tfoot', head, headCols, width, columns, host) + '</table>'
  const indent = '  '.repeat(host.blockDepth)
  return indent === '' ? html : html.replaceAll('\n', `\n${indent}`)
} }

/** `::: list-table` with its renderer, in both channels. */
export function listTable(): ExtensionBundle {
  return { extensions: [listTableExtension], renderers: { 'carve.listTable': { ...listTableRenderer, buildTime: listTableRenderer.render! } } }
}
