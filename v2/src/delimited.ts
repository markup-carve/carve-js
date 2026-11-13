// The rows of a delimited table (C2-B-180): a `csv` or `tsv` fence that the `table` attribute marks.
// Read on demand from the code node, not by the block pass. Cells are copied, because a quoted
// cell is not a span of the source: a doubled quote stands for one.
import { TAB } from './chars.ts'
import { attributeKeyValue, countValue, isWord } from './lines.ts'
import type { BlockNode } from './tree.ts'

export interface DelimitedTable {
  rows: string[][]
  // C2-B-209, C2-B-210: the count `header-rows` gives, or 1 when it is absent or no count.
  headRows: number
  // C2-A-088: true when `header-rows` gives a count.
  declared: boolean
  // C2-B-181: a quote that never closes. Its cell holds the rest of the body.
  malformed: boolean
}

export function readDelimitedTable(src: string, node: BlockNode): DelimitedTable {
  const lineEnd = src.indexOf('\n', node.start)
  const tsv = isWord(src, node.start + node.aux, lineEnd < 0 ? src.length : lineEnd, 'tsv')
  const separator = tsv ? String.fromCharCode(TAB) : ','
  const spans = node.spans!
  const lines: string[] = []
  for (let at = 0; at < spans.length; at += 2) lines.push(src.slice(spans[at], spans[at + 1]))
  const count = headRows(src, node)
  const table: DelimitedTable = { rows: [], headRows: count < 0 ? 1 : count, declared: count >= 0, malformed: false }
  readRows(lines.join('\n'), separator, table)
  return table
}

/** C2-B-179: the count of the last `header-rows` on the attribute lines, or -1. */
function headRows(src: string, node: BlockNode): number {
  const attributes = node.attributes ?? []
  let value: string | null = null
  for (let at = 0; at < attributes.length; at += 2) {
    value = attributeKeyValue(src, attributes[at]!, attributes[at + 1]!, 'header-rows') ?? value
  }
  return countValue(value)
}

/** A position in the body of a delimited table. */
interface Cursor {
  body: string
  at: number
}

/** The quoted part of the cell at the cursor, which stands on its opening quote. A doubled quote is one quote. */
function quotedPart(cursor: Cursor, table: DelimitedTable): string {
  const body = cursor.body
  let cell = ''
  let at = cursor.at + 1
  for (;;) {
    const quote = body.indexOf('"', at)
    if (quote < 0) {
      table.malformed = true
      cursor.at = body.length
      return cell + body.slice(at)
    }
    cell += body.slice(at, quote)
    at = quote + 1
    if (body[at] !== '"') break
    cell += '"'
    at++
  }
  cursor.at = at
  return cell
}

/** The cell at the cursor, up to the next separator or line end. */
function readCell(cursor: Cursor, separator: string, table: DelimitedTable): string {
  const body = cursor.body
  const quoted = body[cursor.at] === '"' ? quotedPart(cursor, table) : ''
  const start = cursor.at
  while (cursor.at < body.length && body[cursor.at] !== separator && body[cursor.at] !== '\n') cursor.at++
  return quoted + body.slice(start, cursor.at)
}

function readRows(body: string, separator: string, table: DelimitedTable): void {
  if (body.length === 0) return
  const cursor: Cursor = { body, at: 0 }
  let row: string[] = []
  for (;;) {
    row.push(readCell(cursor, separator, table))
    // A separator always starts another cell, so a row ending in one keeps its empty last cell.
    if (cursor.at < body.length && body[cursor.at] === separator) {
      cursor.at++
      continue
    }
    table.rows.push(row)
    row = []
    cursor.at++
    if (cursor.at >= body.length) return
  }
}
