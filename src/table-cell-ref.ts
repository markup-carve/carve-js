import type { Attrs, Document, InlineNode, Table, TableCell, TableCellRef } from './ast.js'
import { inlineText } from './heading-ids.js'
import { resolveTableSpans } from './table-spans.js'
import type { SmartTypographyOption } from './smart-typography-mode.js'

function attributeSource(attrs: Attrs | undefined): string {
  if (!attrs) return ''
  const pieces: string[] = []
  const emitted = new Set<string>()
  const add = (key: string): void => {
    if (emitted.has(key)) return
    emitted.add(key)
    if (key === '#id' && attrs.id) pieces.push(`#${attrs.id}`)
    else if (key === '.class' && attrs.classes) pieces.push(...attrs.classes.map(name => `.${name}`))
    else if (attrs.keyValues && Object.hasOwn(attrs.keyValues, key)) {
      const value = attrs.keyValues[key]!
      pieces.push(value === '' ? key : `${key}=${/^[^\s{}"']+$/.test(value) ? value : JSON.stringify(value)}`)
    }
  }
  for (const key of attrs.order ?? []) add(key)
  add('#id')
  add('.class')
  for (const key of Object.keys(attrs.keyValues ?? {})) add(key)
  return pieces.length ? `{${pieces.join(' ')}}` : ''
}

export function tableCellRefFallback(ref: TableCellRef): string {
  return ref.source + attributeSource(ref.attrs)
}

function nodes(root: object): object[] {
  const found: object[] = []
  const seen = new WeakSet<object>()
  const stack: unknown[] = [root]
  while (stack.length) {
    const value = stack.pop()
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item)
      continue
    }
    const record = value as Record<string, unknown>
    if (typeof record.type === 'string') found.push(value)
    for (const [key, child] of Object.entries(record)) {
      if (key !== 'pos' && key !== 'attrs') stack.push(child)
    }
  }
  return found
}

function gridFor(table: Table): { grid: Array<Array<TableCell | undefined>>; spans: ReturnType<typeof resolveTableSpans> } {
  const grid: Array<Array<TableCell | undefined>> = table.rows.map(() => [])
  const spans = resolveTableSpans(table.rows)
  for (const [r, row] of spans.entries()) {
    for (const [c, entry] of row.entries()) {
      if (entry.skip) continue
      for (let dr = 0; dr < entry.rowspan; dr++) {
        for (let dc = 0; dc < entry.colspan; dc++) {
          if (grid[r + dr]) grid[r + dr]![c + dc] = entry.cell
        }
      }
    }
  }
  return { grid, spans }
}

/** Resolve read-only table projections on the assembled tree. Safe to rerun. */
export function resolveTableCellRefs(document: Document, onDiagnostic?: (ref: TableCellRef, reason: string) => void, typography?: SmartTypographyOption): Document {
  const all = nodes(document)
  const tables = new Map<string, Table | null>()
  for (const node of all) {
    const table = node as Table
    if (table.type === 'table' && table.attrs?.id) {
      const id = table.attrs.id
      tables.set(id, tables.has(id) ? null : table)
    }
  }
  const grids = new Map<Table, ReturnType<typeof gridFor>>()
  const keysByTable = new Map<Table, Map<string, number> | undefined>()
  const values = new Map<TableCell, string | undefined>()
  const active = new Set<TableCell>()
  const diagnosed = new WeakSet<TableCellRef>()
  const valueOf = (cell: TableCell | undefined): string | undefined => {
    if (!cell || cell.blocks || !cell.children) return undefined
    if (active.has(cell)) return undefined
    if (values.has(cell)) return values.get(cell)
    active.add(cell)
    let valid = true
    for (const node of nodes({ children: cell.children })) {
      if ((node as InlineNode).type !== 'table_cell_ref') continue
      const ref = node as TableCellRef
      const resolved = resolve(ref)
      if (resolved === undefined) delete ref.value
      else ref.value = resolved
      if (ref.value === undefined) valid = false
    }
    const result = valid ? inlineText(cell.children, typography) : undefined
    active.delete(cell)
    values.set(cell, result)
    return result
  }
  const nameOf = (cell: TableCell | undefined): string | undefined =>
    valueOf(cell) === undefined || !cell?.children ? undefined : inlineText(cell.children, false)
  const resolve = (ref: TableCellRef): string | undefined => {
    const fail = (reason: string): undefined => {
      if (!diagnosed.has(ref)) {
        diagnosed.add(ref)
        onDiagnostic?.(ref, reason)
      }
      return undefined
    }
    const table = tables.get(ref.target)
    if (!table) return fail(tables.has(ref.target) ? 'table id is ambiguous' : 'table id is absent')
    let tableGrid = grids.get(table)
    if (!tableGrid) { tableGrid = gridFor(table); grids.set(table, tableGrid) }
    const { grid, spans } = tableGrid
    const head = table.rowGroups?.headRows ?? table.rows.findIndex(row => !row.cells.every(cell => cell.header))
    const headRows = head < 0 ? table.rows.length : head
    const footRows = table.rowGroups?.footRows ?? 0
    const bodyEnd = table.rows.length - footRows
    const bodyRows: number[] = []
    if (table.rowGroups) {
      let offset = headRows
      for (const group of table.rowGroups.bodies) {
        offset += group.headRows
        for (let i = 0; i < group.bodyRows; i++) bodyRows.push(offset + i)
        offset += group.bodyRows
      }
    } else {
      for (let i = headRows; i < bodyEnd; i++) {
        if (!table.rows[i]!.cells.every(cell => cell.header)) bodyRows.push(i)
      }
    }
    const header = headRows > 0 ? grid[headRows - 1] : undefined
    const columnName = (name: string): number | undefined => {
      if (!header) return undefined
      const matches = header.flatMap((cell, index) => nameOf(cell) === name && name !== '' ? [index] : [])
      return matches.length === 1 ? matches[0] : undefined
    }
    const col = typeof ref.column === 'number' ? ref.column - 1 : columnName(ref.column)
    if (col === undefined || col < 0) return fail('column is absent or ambiguous')
    let row: number
    if (typeof ref.row === 'number') row = bodyRows[ref.row - 1] ?? -1
    else {
      const keyName = table.attrs?.keyValues?.['row-key']
      const keyCol = keyName === undefined ? 0 : columnName(keyName)
      if (keyCol === undefined) return fail('row-key column is absent or ambiguous')
      let keys = keysByTable.get(table)
      if (!keysByTable.has(table)) {
        keys = new Map<string, number>()
        for (const r of bodyRows) {
          const cell = grid[r]?.[keyCol]
          const span = cell && spans[r]?.find(entry => entry.cell === cell)
          const plain = cell?.children?.every(node => node.type === 'text' || node.type === 'escaped_text' || node.type === 'smart_punctuation') ?? false
          const key = cell && plain && span?.rowspan === 1 && span.colspan === 1 ? nameOf(cell) : undefined
          if (!key || keys.has(key)) { keys = undefined; break }
          keys.set(key, r)
        }
        keysByTable.set(table, keys)
      }
      if (!keys) return fail('row keys are empty, duplicate, spanned or contain markup')
      const found = keys.get(ref.row)
      if (found === undefined) return fail('row key is absent')
      row = found
    }
    if (!bodyRows.includes(row)) return fail('body row is out of range')
    const cell = grid[row]?.[col]
    if (!cell) return fail('cell is absent')
    if (active.has(cell)) return fail('cell references form a cycle')
    if (cell.blocks) return fail('cell contains blocks')
    return valueOf(cell) ?? fail('cell value could not resolve')
  }
  for (const node of all) {
    const ref = node as TableCellRef
    if (ref.type === 'table_cell_ref') {
      const resolved = resolve(ref)
      if (resolved === undefined) delete ref.value
      else ref.value = resolved
    }
  }
  return document
}
