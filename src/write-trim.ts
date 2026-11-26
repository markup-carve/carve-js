// C2-W-151: spaces and tabs that would end a source line in text are insignificant. They are taken out of the
// supplied tree while the writer runs, so neither the write nor its comparison sees them, and put back after it.
// Nodes keep their identity, so a loss is still located in the tree as supplied. An empty text that coalesces into
// a nonempty neighbor is taken out the same way (C2-A-040, C2-A-161).
import { pushAll } from './arrays.ts'
import { forEachSlot, type Node, type TableNode, type TextNode } from './ast.ts'

/** The block nodes whose inline content ends at a line end. */
const LINE_HOLDERS: ReadonlySet<string> = new Set([
  'paragraph', 'heading', 'definition_term', 'cell_paragraph', 'line', 'citation_definition',
])

function trimmedEnd(value: string): number {
  let end = value.length
  while (end > 0 && (value.charCodeAt(end - 1) === 32 || value.charCodeAt(end - 1) === 9)) end--
  return end
}

interface Trimming {
  readonly pending: Node[]
  readonly values: [TextNode, string][]
  /** Each list that lost a text, with its nodes as they were. */
  readonly removed: [Node[], Node[]][]
  /** The same for empty texts that coalesce away, shared with the cells of a table, which a table form never restores. */
  readonly coalesced: [Node[], Node[]][]
}

// The attribute block of a text follows it, so a field dropped with the node is a loss.
function isPlainText(node: Node): node is TextNode {
  return node.type === 'text' && !('attrs' in node || 'data' in node || 'lang' in node || 'dir' in node || 'metadata' in node)
}

/** The end of the run of plain texts from `start`, and whether it holds an empty and a nonempty text. */
function textRun(nodes: readonly Node[], start: number): [number, boolean] {
  let end = start
  let filled = false
  let empty = false
  for (; end < nodes.length && isPlainText(nodes[end]!); end++) {
    if ((nodes[end] as TextNode).value === '') empty = true
    else filled = true
  }
  return [end, filled && empty]
}

function holdsEmptyText(nodes: readonly Node[]): boolean {
  for (const node of nodes) if (node.type === 'text' && node.value === '') return true
  return false
}

/** Drops each empty text of a run of plain texts that holds a nonempty one: coalescing leaves nothing of it. */
function dropEmptyTexts(nodes: Node[], coalesced: [Node[], Node[]][]): void {
  if (!holdsEmptyText(nodes)) return
  // By position, not by node: a supplied tree may hold one node object at two places.
  const original = [...nodes]
  let kept = 0
  for (let start = 0; start < original.length;) {
    const [end, mixed] = textRun(original, start)
    if (end === start) {
      nodes[kept++] = original[start++]!
      continue
    }
    for (let at = start; at < end; at++) if (!mixed || (original[at] as TextNode).value !== '') nodes[kept++] = original[at]!
    start = end
  }
  if (kept === nodes.length) return
  nodes.length = kept
  coalesced.push([nodes, original])
}

/** Every list below the groups of a table. */
function dropCellEmptyTexts(groups: Node[], coalesced: [Node[], Node[]][]): void {
  dropEmptyTexts(groups, coalesced)
  const pending = [...groups]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === 'text') continue
    forEachSlot(node, (list, _, single) => {
      if (!single) dropEmptyTexts(list as Node[], coalesced)
      for (const child of list) pending.push(child as Node)
    })
  }
}

/** Right to left, so a text before a dropped text sees what follows it then. The list is compacted once. */
function trimList(nodes: Node[], atLineEnd: boolean, single: boolean, run: Trimming): void {
  let next: Node | undefined
  let dropped: Set<Node> | undefined
  for (let i = nodes.length - 1; i >= 0; i--) {
    const child = nodes[i]!
    const after = next
    next = child
    if (child.type !== 'text') {
      run.pending.push(child)
      continue
    }
    // The attribute block of a text follows it, so its spaces end no line.
    if (!isPlainText(child)) continue
    if (single || (after === undefined ? !atLineEnd : after.type !== 'soft_break')) continue
    const end = trimmedEnd(child.value)
    if (end === child.value.length) continue
    if (end > 0) {
      run.values.push([child, child.value])
      child.value = child.value.slice(0, end)
      continue
    }
    next = after
    dropped ??= new Set()
    dropped.add(child)
  }
  if (dropped !== undefined) dropTexts(nodes, dropped, run)
}

function dropTexts(nodes: Node[], dropped: ReadonlySet<Node>, run: Trimming): void {
  run.removed.push([nodes, [...nodes]])
  let kept = 0
  for (const child of nodes) if (!dropped.has(child)) nodes[kept++] = child
  nodes.length = kept
}

function drain(run: Trimming, delimited: (table: TableNode) => boolean): void {
  for (;;) {
    const node = run.pending.pop()
    if (node === undefined) return
    if (node.type === 'text') continue
    const holder = LINE_HOLDERS.has(node.type)
    forEachSlot(node, (list, step, single) => {
      if (!single) dropEmptyTexts(list as Node[], run.coalesced)
      if (node.type === 'table' && step === 'children') trimCells(node, list as Node[], run, delimited)
      else trimList(list as Node[], holder && step === 'children', single, run)
    })
  }
}

/** A table that trimming would turn delimited keeps its cells as they are, as one that is delimited already. */
function trimCells(table: TableNode, groups: Node[], run: Trimming, delimited: (table: TableNode) => boolean): void {
  // Before the form is chosen: the cells of a tree and of its coalesced tree pick the same form.
  dropCellEmptyTexts(groups, run.coalesced)
  if (delimited(table)) return
  const cells: Trimming = { pending: [...groups].reverse(), values: [], removed: [], coalesced: run.coalesced }
  drain(cells, delimited)
  if (delimited(table)) {
    restore(cells)
    return
  }
  pushAll(run.values, cells.values)
  pushAll(run.removed, cells.removed)
}

function restoreLists(removed: readonly [Node[], Node[]][]): void {
  for (let list = removed.length - 1; list >= 0; list--) {
    const [nodes, original] = removed[list]!
    nodes.length = original.length
    for (let at = 0; at < original.length; at++) nodes[at] = original[at]!
  }
}

function restore({ values, removed }: Trimming): void {
  restoreLists(removed)
  for (const [text, value] of values) text.value = value
}

/**
 * Drops the spaces and tabs at the end of each text node that stands before a soft break or at the end of the
 * content of a line holder, the text nodes that hold nothing else, and the empty texts that coalesce away.
 * `delimited` says whether a table is written in a delimited form, where a cell keeps them as data (C2-W-066) while
 * its caption is still trimmed. Returns the function that restores the tree, or null where nothing changed.
 */
export function trimLineEnds(document: Node, delimited: (table: TableNode) => boolean): (() => void) | null {
  const run: Trimming = { pending: [document], values: [], removed: [], coalesced: [] }
  drain(run, delimited)
  if (run.values.length === 0 && run.removed.length === 0 && run.coalesced.length === 0) return null
  return () => {
    restore(run)
    restoreLists(run.coalesced)
  }
}
