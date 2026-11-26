// C2-M-112: with `listTable` on, a table whose cells hold blocks a pipe row cannot spell becomes the list table that
// `carve.listTable` reads (C2-B-188).
import type { DefaultTreeAdapterTypes as Html } from 'parse5'
import type {
  Block, DivNode, ListItemNode, ListNode, TableCellNode, TableNode, TableRowNode,
} from '../../src/index.ts'
import type { Attrs } from '../../src/ast.ts'
import { addSpanMarks } from '../../src/write-spans.ts'
import { report, type HtmlContext } from './html-dom.ts'

const BULLET = { kind: 'bullet', char: '-' } as const
const COUNT_KEYS = ['header-rows', 'header-cols', 'footer-rows']

/** C2-M-112: a cell of two or more blocks, or of one block that is not a paragraph. */
function holdsBlocks(cell: TableCellNode): boolean {
  const only = cell.children.length === 1 ? cell.children[0] : undefined
  return only === undefined || (only.type !== 'cell_paragraph' && only.type !== 'paragraph')
}

export function wantsListTable(table: TableNode): boolean {
  return table.children.some((group) => group.type !== 'comment'
    && group.children.some((row) => row.type === 'table_row' && row.children.some(holdsBlocks)))
}

interface Slot { cell: TableCellNode, mark: '<' | '^' | undefined }

/** The rows of the table in group order, each with its slots: a cell, or the cell a span mark continues (C2-W-145). */
function slotRows(table: TableNode, node: Html.Element, context: HtmlContext): { rows: Slot[][], head: number, foot: number } {
  const originals = new Map<TableCellNode, TableCellNode>()
  const copy = (row: TableRowNode): TableRowNode => ({ ...row, children: row.children.map((cell) => {
    const shallow: TableCellNode = { ...cell, children: [] }
    originals.set(shallow, cell)
    return shallow
  }) })
  // A shallow copy, so the marks reach neither the cells' blocks nor a nested table.
  const groups = table.children.flatMap((group) => {
    if (group.type !== 'comment') {
      return [{ ...group, children: group.children.flatMap((row) => row.type === 'table_row' ? [copy(row)] : []) }]
    }
    report(context, node, 'import-structure-repaired', 'A comment between the groups of a list table dropped')
    return []
  })
  const marks = addSpanMarks({ ...table, children: groups } as TableNode)
  for (const lost of marks?.unspelled ?? []) {
    report(context, node, 'import-structure-repaired', 'A row span that no span mark of a list table can spell dropped')
    delete lost.rowspan
  }
  const rows: Slot[][] = []
  let head = 0
  let foot = 0
  for (const group of groups) {
    for (const row of group.children) {
      if (row.type !== 'table_row') continue
      rows.push(row.children.map((cell) => {
        const own = originals.get(cell)
        if (own !== undefined) return { cell: own, mark: undefined }
        const covering = marks?.covering.get(cell)
        return { cell: originals.get(covering!) ?? cell, mark: cell.span === 'colspan' ? '<' : '^' }
      }))
      if (group.type === 'table_head') head++
      else if (group.type === 'table_foot') foot++
    }
  }
  return { rows, head, foot }
}

/** The smallest number of leading header slots over the rows below the head, a covered slot counting as its cell. */
function headerColumns(rows: Slot[][], head: number): number {
  let result = Infinity
  for (let index = head; index < rows.length; index++) {
    const slots = rows[index]!
    let leading = 0
    while (leading < slots.length && slots[leading]!.cell.header) leading++
    result = Math.min(result, leading)
  }
  return result === Infinity ? 0 : result
}

function textItem(value: string): ListItemNode {
  return { type: 'list_item', children: [{ type: 'paragraph', children: [{ type: 'text', value }] }] }
}

function withKeys(attrs: Attrs | undefined, keys: [string, string][]): Attrs | undefined {
  if (keys.length === 0) return attrs
  return { ...attrs, keyValues: [...attrs?.keyValues ?? [], ...keys] }
}

/** C2-M-112: a cell of only the text `<` or `^` is a literal-text span, which C2-X-076 never reads as a mark. */
function literalMark(children: Block[]): void {
  const only = children.length === 1 && children[0]?.type === 'paragraph' ? children[0] : undefined
  const text = only?.children.length === 1 && only.children[0]?.type === 'text' ? only.children[0].value : undefined
  if (only !== undefined && (text === '<' || text === '^')) children[0] = { ...only, children: [{ type: 'literal_inline', value: text }] }
}

function cellItem(cell: TableCellNode, header: boolean, node: Html.Element, context: HtmlContext): ListItemNode {
  const children: Block[] = cell.children.flatMap((block): Block[] => {
    if (block.type !== 'cell_paragraph') return [block]
    // C2-M-069: an empty cell paragraph gives no paragraph.
    return block.children.length === 0 ? [] : [{ type: 'paragraph', children: block.children }]
  })
  literalMark(children)
  if (cell.scope !== undefined) report(context, node, 'import-attribute-dropped', 'The scope of a list table cell dropped')
  if (cell.headerIds !== undefined) report(context, node, 'import-attribute-dropped', 'The headers of a list table cell dropped')
  const own = new Set(cell.attrs?.keyValues?.map(([key]) => key))
  const keys: [string, string][] = []
  if (header && !own.has('header')) keys.push(['header', ''])
  if (cell.align !== undefined && !own.has('align')) keys.push(['align', cell.align])
  if (cell.valign !== undefined && !own.has('valign')) keys.push(['valign', cell.valign])
  const attrs = withKeys(cell.attrs, keys)
  return { type: 'list_item', children, ...(attrs ? { attrs } : {}), ...(cell.lang !== undefined ? { lang: cell.lang } : {}),
    ...(cell.dir !== undefined ? { dir: cell.dir } : {}) }
}

function dropGroupFacts(table: TableNode, node: Html.Element, context: HtmlContext): void {
  let bodies = 0
  for (const group of table.children) {
    if (group.type === 'comment') continue
    if (group.type === 'table_body') bodies++
    if (group.attrs !== undefined || group.lang !== undefined || group.dir !== undefined) {
      report(context, node, 'import-attribute-dropped', `The attributes of a ${group.type} of a list table dropped`)
    }
    for (const row of group.children) {
      if (row.type === 'table_row' && (row.attrs !== undefined || row.lang !== undefined || row.dir !== undefined)) {
        report(context, node, 'import-attribute-dropped', 'The attributes of a list table row dropped')
      }
    }
  }
  if (bodies > 1) report(context, node, 'import-structure-repaired', 'The boundary between two bodies of a list table dropped')
  if (table.columns.some((column) => column.width !== undefined)) {
    report(context, node, 'import-attribute-dropped', 'A column width of a list table dropped')
  }
}

function divAttrs(table: TableNode, counts: [string, number][], node: Html.Element, context: HtmlContext): Attrs {
  const keyValues = (table.attrs?.keyValues ?? []).filter(([key]) => {
    if (!COUNT_KEYS.includes(key)) return true
    report(context, node, 'import-attribute-dropped', `A ${key} attribute of a list table dropped`)
    return false
  })
  for (const [key, count] of counts) if (count > 0) keyValues.push([key, String(count)])
  return { ...(table.attrs?.id !== undefined ? { id: table.attrs.id } : {}), classes: ['list-table', ...table.attrs?.classes ?? []],
    ...(keyValues.length > 0 ? { keyValues } : {}) }
}

/** C2-M-112: the table as a list table: one tight item per row, each a list of one item per cell slot. */
export function listTable(table: TableNode, node: Html.Element, context: HtmlContext): DivNode {
  dropGroupFacts(table, node, context)
  const { rows, head, foot } = slotRows(table, node, context)
  const headerCols = headerColumns(rows, head)
  const items: ListItemNode[] = []
  rows.forEach((slots, index) => {
    if (slots.length === 0) {
      report(context, node, 'import-structure-repaired', 'A list table row with no cell dropped')
      return
    }
    const cells = slots.map((slot, column) => slot.mark !== undefined ? textItem(slot.mark)
      : cellItem(slot.cell, slot.cell.header && index >= head && column >= headerCols, node, context))
    // C2-B-062: a list with one item is tight.
    const loose = cells.length > 1 && cells.some((item) => item.children.length > 1)
    const list: ListNode = { type: 'list', marker: BULLET, spacing: loose ? 'loose' : 'tight', children: cells }
    items.push({ type: 'list_item', children: [list] })
  })
  const caption = table.caption
  const only = caption?.children.length === 1 ? caption.children[0] : undefined
  const title = only?.type === 'paragraph' ? only.children : undefined
  if (caption !== undefined && title === undefined) {
    report(context, node, 'import-element-dropped', 'A caption of a list table that is not one paragraph dropped')
  }
  const attrs = divAttrs(table, [['header-rows', head], ['header-cols', headerCols], ['footer-rows', foot]], node, context)
  return { type: 'div', children: [{ type: 'list', marker: BULLET, spacing: 'tight', children: items }],
    ...(title !== undefined ? { title } : {}), attrs, ...(table.lang !== undefined ? { lang: table.lang } : {}),
    ...(table.dir !== undefined ? { dir: table.dir } : {}) }
}
