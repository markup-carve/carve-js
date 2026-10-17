import type { Attrs, CodeBlock, Table, TableCell, TableRow } from './ast.js'

export function parseDelimitedRows(source: string, separator: ',' | '\t'): string[][] | null {
  if (source === '') return []
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let closed = false
  let atStart = true
  const finishField = (): void => {
    row.push(field)
    field = ''
    quoted = false
    closed = false
    atStart = true
  }
  const finishRow = (): void => {
    finishField()
    rows.push(row)
    row = []
  }
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
          closed = true
        }
      } else field += ch
      continue
    }
    if (ch === separator) finishField()
    else if (ch === '\n') finishRow()
    else if (ch === '"') {
      if (!atStart || closed) return null
      quoted = true
      atStart = false
    } else {
      if (closed) return null
      field += ch
      atStart = false
    }
  }
  if (quoted) return null
  if (source.at(-1) !== '\n') finishRow()
  return rows
}

function rowCount(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  if (raw.trim() === '') return 1
  if (!/^\d+$/.test(raw.trim())) return undefined
  const count = Number(raw.trim())
  return Number.isSafeInteger(count) ? count : undefined
}

export function delimitedTable(code: CodeBlock, attrs: Attrs): Table | null {
  if (code.lang !== 'csv' && code.lang !== 'tsv') return null
  const data = parseDelimitedRows(code.content, code.lang === 'csv' ? ',' : '\t')
  if (data === null) return null
  const width = data.reduce((max, row) => Math.max(max, row.length), 0)
  const declared = attrs.keyValues?.['header-rows']
  const footDeclared = attrs.keyValues?.['footer-rows']
  const footRows = rowCount(footDeclared) ?? 0
  const defaultHeaders = Math.min(1, Math.max(0, data.length - footRows))
  const headerRows = declared === undefined ? defaultHeaders : rowCount(declared) ?? defaultHeaders
  const rows: TableRow[] = data.map((row, index) => ({
    type: 'table_row',
    cells: Array.from({ length: width }, (_, column): TableCell => ({
      type: 'table_cell',
      header: index < headerRows,
      children: [{ type: 'text', value: row[column] ?? '' }],
    })),
  }))
  const keyValues = { ...attrs.keyValues }
  delete keyValues.table
  const tableAttrs: Attrs = { ...attrs, keyValues }
  if (attrs.order) tableAttrs.order = attrs.order.filter(key => key !== 'table')
  const hasAttrs = tableAttrs.id !== undefined || (tableAttrs.classes?.length ?? 0) > 0 || Object.keys(keyValues).length > 0
  return { type: 'table', sourceFormat: code.lang, rows,
    ...(hasAttrs ? { attrs: tableAttrs } : {}), ...(code.pos ? { pos: code.pos } : {}) }
}

export function delimitedSource(table: Table): string | null {
  const separator = table.sourceFormat === 'csv' ? ',' : table.sourceFormat === 'tsv' ? '\t' : null
  if (!separator) return null
  const declared = table.attrs?.keyValues?.['header-rows']
  const footer = rowCount(table.attrs?.keyValues?.['footer-rows']) ?? 0
  const defaultHeaders = Math.min(1, Math.max(0, table.rows.length - footer))
  const expectedHeaders = declared === undefined ? defaultHeaders : rowCount(declared) ?? defaultHeaders
  if (!Number.isInteger(expectedHeaders) || expectedHeaders < 0) return null
  const quote = (value: string): string =>
    value.includes(separator) || value.includes('"') || value.includes('\n')
      ? `"${value.replaceAll('"', '""')}"` : value
  const lines: string[] = []
  for (const [rowIndex, row] of table.rows.entries()) {
    if (row.attrs) return null
    const fields: string[] = []
    for (const cell of row.cells) {
      if (cell.span || cell.blocks || cell.attrs || cell.align || cell.valign ||
          cell.header !== (rowIndex < expectedHeaders) || cell.children?.some(child => child.type !== 'text')) return null
      const value = cell.children?.map(child => child.type === 'text' ? child.value : '').join('') ?? ''
      if (value.includes('\r')) return null
      fields.push(quote(value))
    }
    lines.push(fields.join(separator))
  }
  const source = lines.join('\n')
  return source === '' && lines.length > 0 ? '""' : source
}
