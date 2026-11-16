import { coalesceText, fact, integer, list, nodeList, object, string, type Fields, type MigrationState,
  record } from './shared.ts'

function withPosition(type: string, children: Fields[], pos: unknown, attrs?: unknown): Fields {
  const group: Fields = { type, children }
  if (pos !== undefined) group['pos'] = pos
  if (attrs !== undefined) group['attrs'] = attrs
  return group
}

function takeRows(rows: Fields[], at: number, count: number): Fields[] {
  return rows.slice(at, at + count)
}

function group(type: string, rows: Fields[], fields: Fields = {}): Fields | undefined {
  if (rows.length === 0) return undefined
  return { ...withPosition(type, rows, rows[0]?.['pos']), ...Object.fromEntries(Object.entries(fields).filter((entry) => entry[1] !== undefined)) }
}

function pushGroup(groups: Fields[], value: Fields | undefined): void {
  if (value !== undefined) groups.push(value)
}

function declaredHeadRows(old: Fields): number | undefined {
  if (!object(old['attrs'])) return undefined
  const values = old['attrs']['keyValues']
  if (object(values)) return integer(Number(values['header-rows']))
  if (!Array.isArray(values)) return undefined
  const candidates: unknown[] = values
  const pair = candidates.find((value) => Array.isArray(value) && value[0] === 'header-rows')
  return Array.isArray(pair) && typeof pair[1] === 'string' ? integer(Number(pair[1])) : undefined
}

function explicitGroups(rows: Fields[], old: Fields): Fields[] | undefined {
  const groups = record(old['rowGroups'])
  if (groups === undefined) return undefined
  const output: Fields[] = []
  let at = 0
  const heads = integer(groups['headRows']) ?? 0
  pushGroup(output, group('table_head', takeRows(rows, at, heads), { attrs: groups['headAttrs'] }))
  at += heads
  for (const body of list(groups['bodies'])) {
    if (!object(body)) continue
    const headRows = integer(body['headRows']) ?? 0
    const bodyRows = integer(body['bodyRows']) ?? 0
    const taken = takeRows(rows, at, headRows + bodyRows)
    // T-053, C2-A-088: the groups hold the partition; a body carries no count of head rows.
    const value = group('table_body', taken, { rowHeadColumns: body['rowHeadColumns'], attrs: body['attrs'] })
    pushGroup(output, value)
    at += headRows + bodyRows
  }
  const foots = integer(groups['footRows']) ?? 0
  pushGroup(output, group('table_foot', takeRows(rows, at, foots), { attrs: groups['footAttrs'] }))
  if (at + foots < rows.length) pushGroup(output, group('table_body', rows.slice(at + foots)))
  return output
}

function consumeTableAttrs(node: Fields): void {
  if (!object(node['attrs']) || !Array.isArray(node['attrs']['keyValues'])) return
  const removed = new Set(['header-rows', 'footer-rows', 'row-head-columns', 'aligns', 'widths', 'table'])
  const pairs = node['attrs']['keyValues'].filter((pair) => Array.isArray(pair) && !removed.has(String(pair[0])))
  if (pairs.length > 0) node['attrs']['keyValues'] = pairs
  else delete node['attrs']['keyValues']
  if (Object.keys(node['attrs']).length === 0) delete node['attrs']
}

function implicitGroups(rows: Fields[]): Fields[] {
  let at = 0
  while (at < rows.length) {
    const cells = nodeList(rows[at]?.['children'])
    const visible = cells.filter((cell) => cell['span'] === undefined)
    if (visible.length === 0 || !visible.every((cell) => cell['header'] === true)) break
    at++
  }
  const output: Fields[] = []
  pushGroup(output, group('table_head', rows.slice(0, at)))
  pushGroup(output, group('table_body', rows.slice(at)))
  return output
}

function normalizeSpans(groups: Fields[]): void {
  for (const group of groups) {
    const rows = nodeList(group['children'])
    rows.forEach((row, rowIndex) => {
      nodeList(row['children']).forEach((cell, columnIndex) => {
        // C2-B-174: no span crosses from the body into the foot; 0.1 joined that mark, 0.2 reads it as text.
        if (rowIndex === 0 && group['type'] === 'table_foot' && cell['span'] === 'rowspan') return markText(cell, '^')
        if (!joinsNothing(cell, nodeList(row['children'])[columnIndex - 1], nodeList(rows[rowIndex - 1]?.['children'])[columnIndex])) {
          return
        }
        delete cell['span']
        if (nodeList(cell['children']).length === 0) cell['children'] = [{ type: 'cell_paragraph', children: [] }]
      })
    })
  }
}

/** C2-B-172, C2-B-173: a `<` with no cell to its left or behind a row span, a `^` with no cell above or below a column span. */
function joinsNothing(cell: Fields, left: Fields | undefined, above: Fields | undefined): boolean {
  if (cell['span'] === 'colspan') return left === undefined || left['span'] === 'rowspan'
  if (cell['span'] !== 'rowspan') return false
  return above === undefined || above['span'] === 'colspan' || (integer(above['colspan']) ?? 1) > 1
}

/** C2-B-173: a span mark that joins nothing is an ordinary cell that holds the mark as text. */
function markText(cell: Fields, mark: string): void {
  delete cell['span']
  cell['children'] = [{ type: 'cell_paragraph', children: [{ type: 'text', value: mark }] }]
}

function countRowspan(rows: Fields[], at: number, column: number): number {
  let count = 1
  while (nodeList(rows[at + count]?.['children'])[column]?.['span'] === 'rowspan') count++
  return count
}

function recountRowspans(groups: Fields[]): void {
  for (const group of groups) {
    const rows = nodeList(group['children'])
    rows.forEach((row, at) => nodeList(row['children']).forEach((cell, column) => {
      if (integer(cell['rowspan']) === undefined) return
      const count = countRowspan(rows, at, column)
      if (count > 1) cell['rowspan'] = count
      else delete cell['rowspan']
    }))
  }
}

function column(value: unknown): Fields {
  if (!object(value)) return { type: 'table_column' }
  const result: Fields = { type: 'table_column' }
  for (const name of ['align', 'valign', 'width']) if (value[name] !== undefined) result[name] = value[name]
  return result
}

export function migrateTable(node: Fields, old: Fields, state: MigrationState): void {
  const rows = nodeList(node['rows'])
  const columns = list(node['columns'])
  const width = rows.reduce((largest, row) => Math.max(largest, nodeList(row['children']).length), 0)
  node['columns'] = Array.from({ length: Math.max(width, columns.length) }, (_, index) => column(columns[index]))
  const declared = declaredHeadRows(old)
  // T-053, C2-A-088: the groups hold the partition, and a declared count goes to the sidecar (C2-L-057).
  node['children'] = explicitGroups(rows, old) ??
    (declared === 0 && rows.length > 0 ? [{ type: 'table_body', children: rows }] : implicitGroups(rows))
  if (declared !== undefined) fact(state, node, 'headerRows', declared)
  const groups = nodeList(node['children'])
  normalizeSpans(groups)
  recountRowspans(groups)
  delete node['rows']
  delete node['rowGroups']
  fact(state, node, 'sourceFormat', old['sourceFormat'] === undefined ? 'pipe' : old['sourceFormat'])
  delete node['sourceFormat']
  delete node['separatorWidths']
  consumeTableAttrs(node)
}

function cellWrapFacts(node: Fields, old: Fields, state: MigrationState): void {
  const wraps: { line: number, path: string, offset: number }[] = []
  let offset = 0
  for (const child of nodeList(old['children'])) {
    if (child['type'] === 'cell_wrap') {
      if (offset > 0) offset += 1
      wraps.push({ line: integer(child['line']) ?? wraps.length + 1, path: '$', offset })
    } else offset += new TextEncoder().encode(string(child['value']) ?? '').length
  }
  if (wraps.length > 0) fact(state, node, 'wraps', wraps)
}

function wrapInlineCell(node: Fields): void {
  coalesceText(node)
  const children = nodeList(node['children'])
  if (children.length > 0 && node['span'] !== undefined) delete node['span']
  if (children.length === 0 && node['span'] === undefined) node['children'] = [{ type: 'cell_paragraph', children: [] }]
  if (children.length > 0 && children.every((child) => child['type'] !== 'paragraph' && child['type'] !== 'cell_paragraph'
    && child['type'] !== 'list' && child['type'] !== 'block_quote' && child['type'] !== 'code_block')) {
    const first = children[0]
    const last = children[children.length - 1]
    const begin = object(first?.['pos']) ? first['pos'] : undefined
    const end = object(last?.['pos']) ? last['pos'] : undefined
    const pos = begin === undefined || end === undefined ? undefined : { ...begin, endLine: end['endLine'],
      endColumn: end['endColumn'], endOffset: end['endOffset'] }
    node['children'] = [withPosition('cell_paragraph', children, pos)]
  }
}

export function migrateCell(node: Fields, old: Fields, state: MigrationState): void {
  cellWrapFacts(node, old, state)
  const original = nodeList(old['children'])
  let leading = 0
  while (original[leading]?.['type'] === 'cell_wrap') leading++
  if (leading > 0) node['children'] = nodeList(node['children']).slice(leading)
  wrapInlineCell(node)
  delete node['sourceContent']
}

export function migrateRow(node: Fields, old: Fields, state: MigrationState): void {
  fact(state, node, 'continuationLines', old['continuationLines'])
  delete node['continuationLines']
}
