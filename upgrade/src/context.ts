import { type BlockMap, mapBlocks } from './blocks.ts'
import { type Edit } from './edits.ts'
import { type Node01, parse01 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { type Lines, lineOf, lineStart, readLines } from './source.ts'

/** A node of the 0.1 tree with its place in it. */
export interface Visit {
  node: Node01
  parent: Visit | null
  /** The list the node stands in, and its index there. */
  siblings: Node01[]
  index: number
}

/** A record with the offset it is about, in the text of the pass that made it. */
export interface Finding {
  record: ReportRecord
  offset: number
  edit: Edit | null
}

/** What one pass over one text collects. No state outlives the pass. */
export interface Context {
  src: string
  lines: Lines
  doc: Node01
  /** Every node, in document order. */
  visits: Visit[]
  blocks: BlockMap
  findings: Finding[]
}

export type Rule = (ctx: Context) => void

function isNode(value: unknown): value is Node01 {
  return typeof value === 'object' && value !== null && typeof (value as Node01).type === 'string'
}

/** How far a field is searched for nodes: a description list holds them three lists deep. */
const FIELD_DEPTH = 4

function gather(value: unknown, depth: number, lists: Node01[][]): void {
  if (isNode(value)) {
    lists.push([value])
    return
  }
  if (typeof value !== 'object' || value === null || depth > FIELD_DEPTH) return
  if (!Array.isArray(value)) {
    for (const inner of Object.values(value)) gather(inner, depth + 1, lists)
    return
  }
  const nodes = (value as unknown[]).filter(isNode)
  // The list itself when it holds only nodes, so that two visits of one list share it.
  if (nodes.length > 0) lists.push(nodes.length === value.length ? (value as Node01[]) : nodes)
  else for (const inner of value as unknown[]) gather(inner, depth + 1, lists)
}

/** The lists of nodes `node` holds, in the order of its fields. */
function childLists(node: Node01): Node01[][] {
  const lists: Node01[][] = []
  for (const key of Object.keys(node)) {
    if (key !== 'pos' && key !== 'attrs') gather(node[key], 0, lists)
  }
  return lists
}

/** Every node of the tree in document order, read off an explicit stack so depth costs no calls. */
function visitAll(doc: Node01): Visit[] {
  const visits: Visit[] = []
  const stack: Visit[] = [{ node: doc, parent: null, siblings: [doc], index: 0 }]
  while (stack.length > 0) {
    const visit = stack.pop()!
    visits.push(visit)
    const lists = childLists(visit.node)
    for (let list = lists.length - 1; list >= 0; list--) {
      const siblings = lists[list]!
      for (let index = siblings.length - 1; index >= 0; index--) {
        stack.push({ node: siblings[index]!, parent: visit, siblings, index })
      }
    }
  }
  return visits
}

export function makeContext(src: string): Context {
  const doc = parse01(src)
  const lines = readLines(src)
  const visits = visitAll(doc)
  return { src, lines, doc, visits, blocks: mapBlocks(visits, lines.count), findings: [] }
}

/** Collects the change of `start` to `end` into `text` for the entry `id`. */
export function change(ctx: Context, id: string, start: number, end: number, text: string, message: string): void {
  const edit: Edit = { start, end, text, entry: id, sequence: ctx.findings.length }
  ctx.findings.push({ record: recordOf(id, lineOf(ctx.lines, start), message), offset: start, edit })
}

/** Collects a report of the entry `id` at `line`. */
export function note(ctx: Context, id: string, line: number, message: string): void {
  ctx.findings.push({ record: recordOf(id, line, message), offset: lineStart(ctx.lines, line), edit: null })
}
