// A code include (C2-N-042 to C2-N-047): the child is the block an authored fence with the include's attribute line,
// its language and the selected payload gives, positioned in the included file.
import {
  type Block, type CodeBlockNode, forEachSlot, type IncludeNode, type Node, type Position, type TableCellNode, type TableNode,
  type TableRowNode,
} from './ast.ts'
import { buildSource, type ParseFacts } from './ast-blocks.ts'
import { plainText } from './ast-text.ts'
import { BACKTICK, BYTE_ORDER_MARK } from './chars.ts'
import { type FileLines, isMarkerLine, type LineRange, payloadOf, rangeBounds } from './include-source.ts'
import { utf8Length } from './positions.ts'
import { braceBlock } from './write-attributes.ts'

/** A failure of a selection: its cause and the values its message names. */
interface Failure {
  cause: string
  values?: Readonly<Record<string, string>>
}

const MIN_FENCE = 3

function longestRun(text: string, code: number): number {
  let longest = 0
  let run = 0
  for (let at = 0; at < text.length; at++) {
    run = text.charCodeAt(at) === code ? run + 1 : 0
    if (run > longest) longest = run
  }
  return longest
}

/** C2-N-042: the block that a fence with the include's attribute line, language and `payload` gives. */
function fencedBlock(node: IncludeNode, payload: string): { block: CodeBlockNode | TableNode, facts: ParseFacts | null } | null {
  const fence = '`'.repeat(Math.max(MIN_FENCE, longestRun(payload, BACKTICK) + 1))
  const code = node.options?.code
  const brace = braceBlock(node)
  const source = `${brace === '' ? '' : `${brace}\n`}${fence}${typeof code === 'string' ? code : ''}\n${payload}${fence}\n`
  const parsed = buildSource(source, false)
  const block = parsed.document.children[0]
  return block?.type === 'code_block' || block?.type === 'table' ? { block, facts: parsed.facts } : null
}

function codePoints(text: string): number {
  let count = 0
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    if (code < 0xdc00 || code > 0xdfff || at === 0 || text.charCodeAt(at - 1) < 0xd800 || text.charCodeAt(at - 1) > 0xdbff) count++
  }
  return count
}

/**
 * C2-N-044: from column 1 of the first selected line, after a leading U+FEFF, to the last character of the last one.
 * An empty selection is a zero-width span at the start of the file, or at the closing marker of an empty region.
 */
function payloadPosition(text: string, lines: FileLines, range: LineRange): Position {
  if (range.from >= range.to) {
    const at = lines.starts[range.from] ?? (text.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : 0)
    const line = range.from + 1
    const offset = utf8Length(text.slice(0, at))
    return { startLine: line, endLine: line, startColumn: 1, endColumn: 1, startOffset: offset, endOffset: offset }
  }
  const start = lines.starts[range.from]!
  const lastStart = lines.starts[range.to - 1]!
  const end = lines.ends[range.to - 1]!
  return {
    startLine: range.from + 1, endLine: range.to, startColumn: 1, endColumn: 1 + codePoints(text.slice(lastStart, end)),
    startOffset: utf8Length(text.slice(0, start)), endOffset: utf8Length(text.slice(0, end)),
  }
}

function rowsOf(table: TableNode, type: 'table_head' | 'table_body' | 'table_foot'): TableRowNode[] {
  const rows: TableRowNode[] = []
  for (const group of table.children) {
    if (group.type !== type) continue
    for (const row of group.children) if (row.type === 'table_row') rows.push(row)
  }
  return rows
}

/** C2-N-046: `rows` chooses body records by their number among all records; a head record is not repeated. */
function selectRows(table: TableNode, value: string): Failure | null {
  const head = rowsOf(table, 'table_head')
  const records = [...head, ...rowsOf(table, 'table_body'), ...rowsOf(table, 'table_foot')]
  const [first, last] = rangeBounds(value)
  if (first > records.length) return { cause: 'rows_past_end' }
  const chosen = records.slice(first - 1, last).slice(Math.max(0, head.length - first + 1))
  const groups: TableNode['children'] = table.children.filter((group) => group.type === 'table_head')
  groups.push({ type: 'table_body', children: chosen })
  table.children = groups
  return null
}

function cellName(cell: TableCellNode): string {
  const first = cell.children[0]
  return first?.type === 'cell_paragraph' ? plainText(first.children) : ''
}

function colsInvalid(reason: string): Failure {
  return { cause: 'cols_invalid', values: { reason } }
}

/** C2-N-047: the column of each name in the first head record, or why the names select none. */
function namedColumns(table: TableNode, names: readonly string[]): number[] | Failure {
  const head = rowsOf(table, 'table_head')[0]
  if (head === undefined) return colsInvalid('names columns of a table without a head row')
  const heads = head.children.map(cellName)
  const columns: number[] = []
  for (const name of names) {
    const at = heads.indexOf(name)
    if (name === '' || at < 0) return colsInvalid(`names the column ${name}, which the head lacks`)
    if (heads.indexOf(name, at + 1) >= 0) return colsInvalid(`names the column ${name}, which the head holds twice`)
    columns.push(at)
  }
  const twice = names.find((name, at) => names.indexOf(name) !== at)
  return twice === undefined ? columns : { cause: 'cols_duplicate', values: { name: twice } }
}

function hasNoHead(node: IncludeNode): boolean {
  return node.attrs?.keyValues?.some(([key, value]) => key === 'header-rows' && value === '0') === true
}

/** C2-N-047: a range of columns by number, valid only with `header-rows=0` and within the width of the table. */
function rangeColumns(node: IncludeNode, table: TableNode, value: string): number[] | Failure {
  if (!hasNoHead(node)) return colsInvalid('takes a range only with header-rows=0')
  const [first, last] = rangeBounds(value)
  if (last > table.columns.length) return colsInvalid(`reaches past the last column, ${table.columns.length}`)
  return Array.from({ length: last - first + 1 }, (_, at) => first - 1 + at)
}

/** C2-N-047: projects the columns `cols` chooses, in its order. */
function selectColumns(node: IncludeNode, table: TableNode, cols: string | string[]): Failure | null {
  const columns = Array.isArray(cols) ? namedColumns(table, cols) : rangeColumns(node, table, cols)
  if (!Array.isArray(columns)) return columns
  for (const group of table.children) {
    if (group.type === 'comment') continue
    for (const row of group.children) {
      if (row.type === 'table_row') row.children = columns.flatMap((at) => row.children[at] ?? [])
    }
  }
  table.columns = columns.flatMap((at) => table.columns[at] ?? [])
  return null
}

function selectRecords(node: IncludeNode, table: TableNode): Failure | null {
  const rows = node.options?.rows
  const failure = rows === undefined ? null : selectRows(table, rows)
  const cols = node.options?.cols
  return failure ?? (cols === undefined ? null : selectColumns(node, table, cols))
}

/** C2-N-045: a `csv` or `tsv` code include whose attributes carry the `table` flag. */
export function isTableInclude(node: IncludeNode): boolean {
  const code = node.options?.code
  return (code === 'csv' || code === 'tsv') && node.attrs?.keyValues?.some(([key]) => key === 'table') === true
}

function withoutPositions<N extends Node>(root: N): N {
  const pending: Node[] = [root]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    delete node.pos
    forEachSlot(node, (list) => { for (const child of list) pending.push(child) })
  }
  return root
}

/** C2-N-046: a line that is a well-formed marker is no record of a table include. */
function skipped(node: IncludeNode, text: string, lines: FileLines): (index: number) => boolean {
  if (!isTableInclude(node)) return () => false
  return (index) => isMarkerLine(text, lines, index)
}

/** C2-N-042 to C2-N-047: the one child of a code include, or the failure of its record selection. */
export function codeChildren(
  node: IncludeNode, text: string, lines: FileLines, range: LineRange, positions: boolean,
): { children: Block[], facts: ParseFacts | null } | Failure {
  const fenced = fencedBlock(node, payloadOf(text, lines, range, skipped(node, text, lines)))
  if (fenced === null) return { children: [], facts: null }
  const child = fenced.block
  const failure = child.type === 'table' ? selectRecords(node, child) : null
  if (failure !== null) return failure
  if (positions) child.pos = payloadPosition(text, lines, range)
  // C2-N-073: the child carries a copy of the caption, which is numbered and written in place of the include's own.
  // The copy was not produced by the included file, so it carries no position of it (C2-N-019).
  if (node.caption !== undefined) child.caption = withoutPositions(structuredClone(node.caption))
  // C2-B-181: the findings of the fence, such as malformed quoting, are those of the child.
  return { children: [child], facts: fenced.facts }
}
