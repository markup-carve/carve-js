/*
 * Structural diff over the PART 12 AST.
 *
 * A line diff of Carve source answers "which bytes changed". It cannot answer
 * "did this document change", which is the question a document store actually
 * has: reflowing a paragraph, renaming a footnote label, or reformatting a
 * table rewrites most of the lines and changes nothing a reader sees, while a
 * one-character edit to a link destination changes where a reader lands and
 * shows up as one modified line among many.
 *
 * This diffs the TREES. Two documents that parse to the same AST have no
 * changes, whatever their bytes look like; a change is reported against the
 * node it happened to, with the path a consumer needs to find it.
 *
 * It works on the exchange shape (`toAstJson`), not on the runtime tree, for
 * two reasons: the exchange shape is what a stored document IS, and it is the
 * shape every engine publishes - so the same diff runs over a tree carve-php or
 * carve-rs produced.
 *
 * The algorithm is a per-level longest-common-subsequence over a structural
 * KEY, then a recursive descent into the pairs it matched. That is
 * deliberately not a full tree-edit-distance: an optimal edit script is
 * O(n^3)-ish and answers a question nobody asked, while an LCS per sibling list
 * is linear-ish and produces the moves and edits a reviewer recognizes.
 */

import type { AstJsonDocument } from './ast-json.js'

/** What happened to one node. */
export type ChangeKind =
  /** A node the second document has and the first does not. */
  | 'added'
  /** A node the first document has and the second does not. */
  | 'removed'
  /** The same node, in a different position among its siblings. */
  | 'moved'
  /** Same node type and children, different scalar field (a link's href, a heading's level). */
  | 'changed'

export interface Change {
  kind: ChangeKind
  /** Node type, e.g. `paragraph`, `link`. */
  type: string
  /**
   * Where the node sits, as a `/`-separated path of `field[index]` steps from
   * the document root - the same walk a consumer does, so it can be followed
   * without knowing this module.
   */
  path: string
  /**
   * 1-based source line, when the node carries a position. Absent for a node
   * the producing engine could not place (PART 12 §4 permits that, and a
   * reconstructed region is the common case).
   */
  line?: number
  /** One-line description of what changed, for `changed` nodes. */
  detail?: string
}

interface Node {
  type: string
  [key: string]: unknown
}

/**
 * Fields that are not content: bookkeeping a reader never sees.
 *
 * `srcByteLength` is on the root and changes with every edit, so reporting it
 * would put a line on every diff saying only "the document is a different
 * length".
 */
const IGNORED = new Set(['pos', 'srcByteLength'])

/**
 * Fields whose value is a list of child nodes, in the order a walk should
 * follow. Kept as a list rather than "any array of objects with a type",
 * because a citation group's `items` and a definition list's `items` are arrays
 * of plain objects with no `type` at all - they are content, but they are not
 * nodes, and treating them as nodes produces paths that point at nothing.
 */
const CHILD_FIELDS = ['children', 'items', 'rows', 'cells', 'inline', 'content', 'caption', 'title']

function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

/**
 * Collapse a run of text and soft breaks into one text node.
 *
 * Removing soft breaks is not enough on its own: `that\nwraps` and
 * `that wraps` leave DIFFERENT text nodes either side of the break, so a reflow
 * still reads as one paragraph removed and another added. A soft break renders
 * as a space, so the run it separates is one piece of prose, and comparing it
 * as one piece is what makes rewrapping a no-op.
 *
 * Only text and soft breaks merge. An emphasis or a link between two text nodes
 * ends the run, because it is content in its own right - and a HARD break is
 * not a soft one: it is a construct the author wrote and the renderer honors,
 * so losing one changes the document and has to be reported.
 */
function mergeText(nodes: Node[]): Node[] {
  const out: Node[] = []
  let run: string[] = []
  let first: Node | undefined
  const flush = (): void => {
    if (first === undefined) return
    out.push({ ...first, value: run.join('') })
    run = []
    first = undefined
  }
  for (const node of nodes) {
    if (node.type === 'soft_break') {
      if (first !== undefined) run.push(' ')
      continue
    }
    if (node.type === 'text' && typeof node['value'] === 'string') {
      first ??= node
      run.push(node['value'])
      continue
    }
    flush()
    out.push(node)
  }
  flush()
  return out
}

function childrenOf(node: Node): { field: string; nodes: Node[] }[] {
  const out: { field: string; nodes: Node[] }[] = []
  for (const field of CHILD_FIELDS) {
    const value = node[field]
    if (!Array.isArray(value)) continue
    // A partially-node array (a definition list's `items`) is skipped rather
    // than half-walked: reporting a path into it would name a position the
    // consumer cannot resolve.
    if (!value.every(isNode)) continue
    const nodes = mergeText(value.filter(isNode))
    if (nodes.length > 0) out.push({ field, nodes })
  }
  // `target` is a single child, not a list (a figure's captioned block).
  if (isNode(node['target'])) out.push({ field: 'target', nodes: [node['target']] })
  return out
}

/** The scalar fields that make a node what it is, ordered for a stable key. */
function scalars(node: Node): [string, unknown][] {
  return Object.entries(node)
    .filter(([key, value]) => {
      if (IGNORED.has(key) || key === 'type') return false
      if (CHILD_FIELDS.includes(key) && Array.isArray(value)) return false
      if (key === 'target' && isNode(value)) return false
      return true
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * A key that identifies a node across the two documents.
 *
 * The whole subtree, minus positions: two nodes with the same key ARE the same
 * content, so a pair that matches on it needs no further comparison, and a
 * `removed` that shares a key with an `added` is a MOVE rather than a deletion
 * and an insertion. Positions are excluded because everything after an inserted
 * paragraph shifts down a line, and reporting those as changes would bury the
 * one edit that matters.
 */
function key(node: Node): string {
  const parts = [node.type]
  for (const [name, value] of scalars(node)) parts.push(`${name}=${JSON.stringify(value)}`)
  for (const { field, nodes } of childrenOf(node)) {
    parts.push(`${field}(${nodes.map(key).join(',')})`)
  }
  return parts.join('|')
}

/**
 * Are these two the same node, edited - or two different nodes?
 *
 * Same type is the whole rule, applied to the leftovers IN ORDER after the LCS
 * has already matched everything identical. It is the same call a line diff
 * makes when it shows a modified line instead of a deletion and an insertion.
 *
 * Counting shared children instead was tried and is worse: a paragraph with one
 * text child shares nothing with the same paragraph after its wording changed,
 * so the single most ordinary edit - retyping a sentence - reported as a
 * paragraph removed and a paragraph added. Turning a soft break into a hard one
 * has the same problem from the other direction, taking a paragraph from one
 * child to three.
 *
 * The cost is that two unrelated same-type siblings, one deleted and one added
 * in the same place, pair up and report their inner differences rather than a
 * clean remove/add pair. That is the trade a line diff already makes, and the
 * content is still fully described.
 */
function similar(a: Node, b: Node): boolean {
  return a.type === b.type
}

function line(node: Node): number | undefined {
  const pos = node['pos']
  if (typeof pos !== 'object' || pos === null) return undefined
  const start = (pos as { startLine?: unknown }).startLine
  return typeof start === 'number' ? start : undefined
}

function change(kind: ChangeKind, node: Node, path: string, detail?: string): Change {
  const out: Change = { kind, type: node.type, path }
  const at = line(node)
  if (at !== undefined) out.line = at
  if (detail !== undefined) out.detail = detail
  return out
}

/** Longest common subsequence over two key lists, as index pairs. */
function lcs(a: string[], b: string[]): [number, number][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  const pairs: [number, number][] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      i++
    } else {
      j++
    }
  }
  return pairs
}

/** Describe what differs between two nodes of the same type, in one line. */
function describe(before: Node, after: Node): string | undefined {
  const a = new Map(scalars(before))
  const b = new Map(scalars(after))
  const parts: string[] = []
  for (const [name, value] of b) {
    if (!a.has(name)) {
      parts.push(`${name} added (${JSON.stringify(value)})`)
    } else if (JSON.stringify(a.get(name)) !== JSON.stringify(value)) {
      parts.push(`${name}: ${JSON.stringify(a.get(name))} -> ${JSON.stringify(value)}`)
    }
  }
  for (const [name] of a) if (!b.has(name)) parts.push(`${name} removed`)
  return parts.length > 0 ? parts.join(', ') : undefined
}

function diffLevel(
  before: Node[],
  after: Node[],
  path: string,
  field: string,
  out: Change[],
): void {
  const beforeKeys = before.map(key)
  const afterKeys = after.map(key)
  const matched = new Set<number>()
  const matchedAfter = new Set<number>()
  const pairs = lcs(beforeKeys, afterKeys)
  for (const [i, j] of pairs) {
    matched.add(i)
    matchedAfter.add(j)
  }

  // Unmatched on both sides: pair them up by shape so an edited node reports as
  // one `changed` rather than as a removal and an insertion, and detect a MOVE
  // when the exact same content turns up elsewhere.
  const leftovers = before.map((n, i) => [n, i] as const).filter(([, i]) => !matched.has(i))
  const additions = after.map((n, j) => [n, j] as const).filter(([, j]) => !matchedAfter.has(j))
  const takenAdditions = new Set<number>()

  for (const [node, i] of leftovers) {
    const nodeKey = beforeKeys[i]!
    // Same content, different place.
    const moved = additions.find(([, j]) => !takenAdditions.has(j) && afterKeys[j] === nodeKey)
    if (moved) {
      takenAdditions.add(moved[1])
      out.push(change('moved', node, `${path}/${field}[${i}]`, `now at index ${moved[1]}`))
      continue
    }
    // The same node, edited: recurse so the report names what changed inside
    // rather than declaring the whole subtree gone and a new one arrived.
    const edited = additions.find(([other, j]) => !takenAdditions.has(j) && similar(node, other))
    if (edited) {
      takenAdditions.add(edited[1])
      diffNode(node, edited[0], `${path}/${field}[${i}]`, out)
      continue
    }
    out.push(change('removed', node, `${path}/${field}[${i}]`))
  }

  for (const [node, j] of additions) {
    if (takenAdditions.has(j)) continue
    out.push(change('added', node, `${path}/${field}[${j}]`))
  }

  // Matched pairs are identical by key, so their subtrees are identical too -
  // nothing to recurse into. That is the point of keying on the whole subtree.
}

function diffNode(before: Node, after: Node, path: string, out: Change[]): void {
  if (key(before) === key(after)) return

  const detail = describe(before, after)
  if (detail !== undefined) out.push(change('changed', after, path, detail))

  const beforeChildren = new Map(childrenOf(before).map((c) => [c.field, c.nodes]))
  const afterChildren = new Map(childrenOf(after).map((c) => [c.field, c.nodes]))
  for (const field of new Set([...beforeChildren.keys(), ...afterChildren.keys()])) {
    diffLevel(beforeChildren.get(field) ?? [], afterChildren.get(field) ?? [], path, field, out)
  }
}

/**
 * Compare two serialized documents and report what changed.
 *
 * Order matters: `before` is the original, `after` the revision. An empty
 * result means the two documents are the same document - not that they have the
 * same bytes.
 */
export function diffAst(before: AstJsonDocument, after: AstJsonDocument): Change[] {
  const out: Change[] = []
  diffNode(before as unknown as Node, after as unknown as Node, '', out)
  return out
}

/** Render changes the way the CLI prints them: one line each. */
export function formatChanges(changes: Change[]): string {
  if (changes.length === 0) return 'no structural changes\n'
  const lines = changes.map((c) => {
    const where = c.line !== undefined ? `line ${c.line}` : c.path || '/'
    const detail = c.detail !== undefined ? ` (${c.detail})` : ''
    return `${c.kind.padEnd(8)} ${c.type} at ${where}${detail}`
  })
  const noun = changes.length === 1 ? 'change' : 'changes'
  return `${lines.join('\n')}\n${changes.length} structural ${noun}\n`
}
