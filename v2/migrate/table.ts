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

function explicitGroups(rows: Fields[], old: Fields, declared: number | undefined): Fields[] | undefined {
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
    const value = group('table_body', taken, { headRows: declared === undefined && headRows === 0 ? undefined :
      headRows === 0 ? heads : headRows,
      rowHeadColumns: body['rowHeadColumns'], attrs: body['attrs'] })
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
  let prior: Fields | undefined
  for (const group of groups) {
    const rows = nodeList(group['children'])
    rows.forEach((row, rowIndex) => {
      nodeList(row['children']).forEach((cell, columnIndex) => {
        const previousRow = rowIndex === 0 && group['type'] === 'table_foot' ? prior : rows[rowIndex - 1]
        const previous = nodeList(previousRow?.['children'])[columnIndex]
        const left = nodeList(row['children'])[columnIndex - 1]
        const invalid = cell['span'] === 'colspan' && (columnIndex === 0 || left?.['span'] === 'rowspan') ||
          cell['span'] === 'rowspan' && (previous === undefined || previous['span'] === 'colspan' ||
            (integer(previous?.['colspan']) ?? 1) > 1)
        if (!invalid) return
        delete cell['span']
        if (nodeList(cell['children']).length === 0) cell['children'] = [{ type: 'cell_paragraph', children: [] }]
      })
    })
    prior = rows[rows.length - 1] ?? prior
  }
}

function countRowspan(rows: Fields[], at: number, column: number): number {
  let count = 1
  while (nodeList(rows[at + count]?.['children'])[column]?.['span'] === 'rowspan') count++
  return count
}

function recountRowspans(groups: Fields[]): void {
  groups.forEach((group, index) => {
    const own = nodeList(group['children'])
    const foot = group['type'] === 'table_body' && groups[index + 1]?.['type'] === 'table_foot' ?
      nodeList(groups[index + 1]?.['children']) : []
    const rows = [...own, ...foot]
    own.forEach((row, at) => nodeList(row['children']).forEach((cell, column) => {
      if (integer(cell['rowspan']) !== undefined) cell['rowspan'] = countRowspan(rows, at, column)
    }))
  })
}

function column(value: unknown): Fields {
  if (!object(value)) return { type: 'table_column' }
  const result: Fields = { type: 'table_column' }
  for (const name of ['align', 'valign', 'width']) if (value[name] !== undefined) result[name] = value[name]
  if (Object.keys(result).length > 1) result['authored'] = true
  return result
}

export function migrateTable(node: Fields, old: Fields, state: MigrationState): void {
  const rows = nodeList(node['rows'])
  const columns = list(node['columns'])
  const width = rows.reduce((largest, row) => Math.max(largest, nodeList(row['children']).length), 0)
  node['columns'] = Array.from({ length: Math.max(width, columns.length) }, (_, index) => column(columns[index]))
  const declared = declaredHeadRows(old)
  node['children'] = explicitGroups(rows, old, declared) ??
    (declared !== undefined && (declared === 0 || declared >= rows.length) && rows.length > 0 ?
      [{ type: 'table_body', children: rows, headRows: declared }] : implicitGroups(rows))
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
