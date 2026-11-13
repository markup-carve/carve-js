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

function readRows(body: string, separator: string, table: DelimitedTable): void {
  if (body.length === 0) return
  let row: string[] = []
  let at = 0
  for (;;) {
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
    // A separator always starts another cell, so a row ending in one keeps its empty last cell.
    if (at < body.length && body[at] === separator) {
      at++
      continue
    }
    table.rows.push(row)
    row = []
    at++
    if (at >= body.length) return
  }
}
