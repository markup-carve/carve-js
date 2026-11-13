// The rows of a delimited table (C2-B-180): a `csv` or `tsv` fence that the `table` attribute marks.
// Read on demand from the code node, not by the block pass. Cells are copied, because a quoted
// cell is not a span of the source: a doubled quote stands for one.
import { TAB } from './chars.ts'
import { attributeValueStart, decimalValue, digitRunEnd, isWord } from './lines.ts'
import type { BlockNode } from './tree.ts'

export interface DelimitedTable {
  rows: string[][]
  headRows: number
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
  const table: DelimitedTable = { rows: [], headRows: headRows(src, node), malformed: false }
  readRows(lines.join('\n'), separator, table)
  return table
}

/** C2-B-179: `header-rows` sets the number of head rows; without it there is one. */
function headRows(src: string, node: BlockNode): number {
  const attributes = node.attributes ?? []
  for (let at = 0; at < attributes.length; at += 2) {
    const value = attributeValueStart(src, attributes[at]!, attributes[at + 1]!, 'header-rows')
    if (value >= 0) return decimalValue(src, value, digitRunEnd(src, value, attributes[at + 1]!))
  }
  return 1
}

function readRows(body: string, separator: string, table: DelimitedTable): void {
  let row: string[] = []
  let at = 0
  while (at < body.length) {
    let cell = ''
    if (body[at] === '"') {
      at++
      for (;;) {
        const quote = body.indexOf('"', at)
        if (quote < 0) {
          cell += body.slice(at)
          at = body.length
          table.malformed = true
          break
        }
        cell += body.slice(at, quote)
        at = quote + 1
        if (body[at] !== '"') break
        cell += '"'
        at++
      }
    }
    const start = at
    while (at < body.length && body[at] !== separator && body[at] !== '\n') at++
    row.push(cell + body.slice(start, at))
    if (at >= body.length || body[at] === '\n') {
      table.rows.push(row)
      row = []
    }
    at++
  }
}
