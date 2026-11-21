import { type Node } from '../src/ast.ts'
import { type LintContext } from './types.ts'

/** The table fields of the line model (C2-W-149): layout facts of a table that its tree does not hold. */

interface Body { readonly raw_body: string }

const GROUPS: ReadonlySet<string> = new Set(['table_head', 'table_body', 'table_foot'])

const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/children/')))
const indexOf = (path: string): number => Number(path.slice(path.lastIndexOf('/') + 1))

/** The path of the row that a `table_row` or `table_cell` record stands for or sits in. */
function rowPath(type: string, path: string): string | undefined {
  if (type === 'table_row') return path
  return type === 'table_cell' ? parentOf(path) : undefined
}

/** The source format of the table of a table, row or cell record. */
export function sourceFormatOf(type: string, path: string, context: LintContext): string | undefined {
  const row = rowPath(type, path)
  const table = type === 'table' ? path : row === undefined ? undefined : parentOf(parentOf(row))
  return table === undefined ? undefined : context.layouts.get(table)?.sourceFormat
}

/** The type of the group that holds the row of a row or cell record. */
export function groupOf(type: string, path: string, context: LintContext): string | undefined {
  const row = rowPath(type, path)
  if (row === undefined) return undefined
  const group = context.nodeTypes.get(parentOf(row))
  return group !== undefined && GROUPS.has(group) ? group : undefined
}

/** The position of the row of a row or cell record among the rows of its group, from 0: a comment is no row. */
export function rowIndexOf(type: string, path: string, context: LintContext): number | undefined {
  const row = rowPath(type, path)
  if (row === undefined) return undefined
  const group = parentOf(row)
  let rows = 0
  for (let at = 0; at < indexOf(row); at++) if (context.nodeTypes.get(`${group}/children/${at}`) === 'table_row') rows++
  return rows
}

/**
 * For each line of the source of a pipe table, the index of the nearest line above and below it in that table whose
 * raw body does not start with `%%`, or -1.
 */
export class TableLines {
  private above: Int32Array | undefined = undefined
  private below: Int32Array | undefined = undefined
  private readonly tables: [number, number, string][]
  private readonly lines: { readonly count: number, at(index: number): Body | undefined }

  constructor(tables: [number, number, string][], lines: { readonly count: number, at(index: number): Body | undefined }) {
    this.tables = tables
    this.lines = lines
  }

  private build(): void {
    const count = this.lines.count
    const above = new Int32Array(count).fill(-1)
    const below = new Int32Array(count).fill(-1)
    for (const [first, last] of this.tables) {
      let seen = -1
      for (let index = first; index <= last && index < count; index++) {
        above[index] = seen
        if (!this.lines.at(index)!.raw_body.startsWith('%%')) seen = index
      }
      seen = -1
      for (let index = Math.min(last, count - 1); index >= first; index--) {
        below[index] = seen
        if (!this.lines.at(index)!.raw_body.startsWith('%%')) seen = index
      }
    }
    this.above = above
    this.below = below
  }

  /** The path of the pipe table whose source holds the line, which names the node of a finding on it (C2-W-138). */
  pathOf(index: number): string | undefined {
    for (const [first, last, path] of this.tables) if (index >= first && index <= last) return path
    return undefined
  }

  aboveOf(index: number): number {
    if (this.above === undefined) this.build()
    return this.above![index] ?? -1
  }

  belowOf(index: number): number {
    if (this.below === undefined) this.build()
    return this.below![index] ?? -1
  }
}

/** The line ranges, as indexes from 0, of the pipe tables among the walked nodes. */
export function pipeTables(walked: readonly { node: Node, path: string }[], context: LintContext): [number, number, string][] {
  const out: [number, number, string][] = []
  for (const { node, path } of walked) {
    if (node.type !== 'table' || node.pos === undefined || context.layouts.get(path)?.sourceFormat !== 'pipe') continue
    out.push([node.pos.startLine - 1, node.pos.endLine - 1, path])
  }
  return out
}
