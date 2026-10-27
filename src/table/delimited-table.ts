import type { Attrs, CodeBlock, Position, Table, TableCell, TableRow } from '../ast.js'

const sourceRecordWidths = new WeakMap<Table, number[]>()
interface PayloadLine { offset: number; line: number; column: number; text: string }
const payloadLines = new WeakMap<CodeBlock, PayloadLine[]>()

export function setDelimitedPayloadLines(code: CodeBlock, lines: PayloadLine[]): void {
  payloadLines.set(code, lines)
}

export function delimitedRecordWidths(table: Table): readonly number[] | undefined {
  return sourceRecordWidths.get(table)
}

export function parseDelimitedRows(
  source: string, separator: ',' | '\t',
  onField?: (start: number, end: number, quoted: boolean, escaped: boolean) => void,
  onRow?: (start: number, end: number) => void,
  onMalformed?: (start: number) => void,
): string[][] | null {
  if (source === '') return []
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let closed = false
  let atStart = true
  let fieldStart = 0
  let rowStart = 0
  let wasQuoted = false
  let escaped = false
  const finishField = (end: number): void => {
    row.push(field)
    onField?.(fieldStart, end, wasQuoted, escaped)
    field = ''
    quoted = false
    closed = false
    atStart = true
    fieldStart = end + 1
    wasQuoted = false
    escaped = false
  }
  const finishRow = (end: number): void => {
    finishField(end)
    rows.push(row)
    onRow?.(rowStart, end)
    row = []
    rowStart = end + 1
  }
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          escaped = true
          i++
        } else {
          quoted = false
          closed = true
        }
      } else field += ch
      continue
    }
    if (ch === separator) finishField(i)
    else if (ch === '\n') finishRow(i)
    else if (ch === '"') {
      if (!atStart || closed) { onMalformed?.(rowStart); return null }
      quoted = true
      atStart = false
      wasQuoted = true
    } else {
      if (closed) { onMalformed?.(rowStart); return null }
      field += ch
      atStart = false
    }
  }
  if (quoted) { onMalformed?.(rowStart); return null }
  if (source.at(-1) !== '\n') finishRow(source.length)
  return rows
}

export function delimitedRecordLocations(source: string, separator: ',' | '\t'): { rows: { line: number; fields: number }[]; malformedLine?: number } {
  const rows: { line: number; fields: number }[] = []
  // Record starts only move forward, so the line count is carried rather than recounted.
  let counted = 0
  let line = 1
  const lineAt = (offset: number): number => {
    for (; counted < offset; counted++) if (source[counted] === '\n') line++
    return line
  }
  let malformedLine: number | undefined
  const parsed = parseDelimitedRows(source, separator, undefined, (start) => {
    rows.push({ line: lineAt(start), fields: 0 })
  }, (start) => { malformedLine = lineAt(start) })
  if (parsed) parsed.forEach((row, index) => { rows[index]!.fields = row.length })
  return { rows, ...(malformedLine === undefined ? {} : { malformedLine }) }
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
  const fieldRanges: { start: number; end: number; textStart: number; textEnd: number; textPlaceable: boolean }[][] = []
  const rowRanges: { start: number; end: number }[] = []
  let fields: (typeof fieldRanges)[number] = []
  const data = parseDelimitedRows(
    code.content, code.lang === 'csv' ? ',' : '\t',
    (start, end, quoted, escaped) => fields.push({
      start, end, textStart: start + Number(quoted), textEnd: end - Number(quoted),
      textPlaceable: !escaped,
    }),
    (start, end) => { fieldRanges.push(fields); fields = []; rowRanges.push({ start, end }) },
  )
  if (data === null) return null
  const lines = payloadLines.get(code)
  const point = (index: number): { line: number; column: number; offset: number } | undefined => {
    if (!lines) return undefined
    let cursor = 0
    for (const line of lines) {
      const end = cursor + line.text.length
      if (index <= end) {
        const prefix = line.text.slice(0, index - cursor)
        const width = [...prefix].length
        return { line: line.line, column: line.column + width, offset: line.offset + width }
      }
      cursor = end + 1
    }
    return undefined
  }
  const position = (start: number, end: number): Position | undefined => {
    const a = point(start)
    const b = point(end)
    return a && b ? {
      startLine: a.line, endLine: b.line,
      startColumn: a.column, endColumn: b.column,
      startOffset: a.offset, endOffset: b.offset,
    } : undefined
  }
  const width = data.reduce((max, row) => Math.max(max, row.length), 0)
  const declared = attrs.keyValues?.['header-rows']
  const footDeclared = attrs.keyValues?.['footer-rows']
  const footRows = rowCount(footDeclared) ?? 0
  const defaultHeaders = Math.min(1, Math.max(0, data.length - footRows))
  const headerRows = declared === undefined ? defaultHeaders : rowCount(declared) ?? defaultHeaders
  const rows: TableRow[] = data.map((row, index) => {
    const rowRange = rowRanges[index]
    const emptyRecord = rowRange !== undefined && rowRange.start === rowRange.end
    const rowPos = rowRange && !emptyRecord ? position(rowRange.start, rowRange.end) : undefined
    return {
      type: 'table_row',
      ...(rowPos ? { pos: rowPos } : {}),
      cells: Array.from({ length: width }, (_, column): TableCell => {
        const range = fieldRanges[index]?.[column]
        const textPos = !emptyRecord && range?.textPlaceable ? position(range.textStart, range.textEnd) : undefined
        const cellPos = !emptyRecord && range ? position(range.start, range.end) : undefined
        return {
          type: 'table_cell', header: index < headerRows,
          children: [{ type: 'text', value: row[column] ?? '', ...(textPos ? { pos: textPos } : {}) }],
          ...(cellPos ? { pos: cellPos } : {}),
        }
      }),
    }
  })
  const keyValues = { ...attrs.keyValues }
  delete keyValues.table
  const tableAttrs: Attrs = { ...attrs }
  if (Object.keys(keyValues).length) tableAttrs.keyValues = keyValues
  else delete tableAttrs.keyValues
  if (attrs.order) tableAttrs.order = attrs.order.filter(key => key !== 'table')
  const hasAttrs = tableAttrs.id !== undefined || (tableAttrs.classes?.length ?? 0) > 0 || Object.keys(keyValues).length > 0
  const table: Table = { type: 'table', sourceFormat: code.lang, rows,
    ...(hasAttrs ? { attrs: tableAttrs } : {}), ...(code.pos ? { pos: code.pos } : {}) }
  sourceRecordWidths.set(table, data.map(row => row.length))
  return table
}

export function delimitedSource(table: Table): string | null {
  const separator = table.sourceFormat === 'csv' ? ',' : table.sourceFormat === 'tsv' ? '\t' : null
  if (!separator) return null
  if (table.shortCaption || table.separatorWidths || table.rows.some(row => row.continuationLines)) return null
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
      if (cell.span || 'colspan' in cell || 'rowspan' in cell || cell.blocks || cell.attrs || cell.align || cell.valign ||
          cell.header !== (rowIndex < expectedHeaders) || cell.children?.some(child => child.type !== 'text')) return null
      const value = cell.children?.map(child => child.type === 'text' ? child.value : '').join('') ?? ''
      if (value.includes('\r')) return null
      fields.push(quote(value))
    }
    const line = fields.join(separator)
    lines.push(line === '' ? '""' : line)
  }
  return lines.join('\n')
}
