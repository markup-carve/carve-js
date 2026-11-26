// C2-N-090 to C2-N-096: the snippet registry and the one expansion pass over the render view, after includes
// and before resolution and document transforms. The authored tree keeps its uses: the pass runs on the render's own tree.
import { AST_RESULTS } from './ast-tables.ts'
import {
  type Attrs, type DocumentNode, forEachSlot, type IncludeNode, type Node, type SnippetDefinitionNode, type SnippetUseNode,
} from './ast.ts'
import { derivedTextBudget } from './derived-text.ts'
import { harnessLimits } from './harness-limits.ts'
import { addFinding, type Findings } from './diagnostics.ts'
import { utf8Length } from './positions.ts'
import {
  COPY_SCOPE, SNIPPET_BUDGETS, type SnippetBudget, SNIPPET_CARRIERS, SNIPPET_DEFINITIONS, SNIPPET_MARKS, type SnippetCarrier,
} from './snippet-marks.ts'
import { snippetUseSpelling } from './snippets.ts'

/** C2-N-093: `snippet_depth` and `snippet_nodes` of data/limits.json. */
export const SNIPPET_DEPTH = 16
export const SNIPPET_NODES = 100_000

/** One winning definition, and the expanded include whose file holds it, or null for the top-level document. */
export interface SnippetEntry {
  definition: SnippetDefinitionNode
  include: IncludeNode | null
}

export { COPY_SCOPE, SNIPPET_BUDGETS, SNIPPET_CARRIERS, SNIPPET_DEFINITIONS, SNIPPET_MARKS } from './snippet-marks.ts'

/** C2-N-090: the registry of the expanded tree, in document order; each later definition of a name is passed to `duplicate`. */
export function snippetRegistry(document: DocumentNode, duplicate?: (node: SnippetDefinitionNode) => void): Map<string, SnippetEntry> {
  const registry = new Map<string, SnippetEntry>()
  const collect = (children: readonly Node[], include: IncludeNode | null): void => {
    for (const child of children) {
      if (child.type === 'snippet_definition') {
        if (registry.has(child.name)) duplicate?.(child)
        else registry.set(child.name, { definition: child, include })
      } else if (child.type === 'include') {
        if (child.children !== undefined) collect(child.children, child)
      } else if (!HOLDS_NO_INCLUDE.has(child.type)) {
        // An include may stand in a container, as `- {{ a.crv }}`; its definitions count where it stands.
        forEachSlot(child, (nodes) => { collect(nodes as Node[], include) }, undefined, document.extensions)
      }
    }
  }
  collect(document.children, null)
  return registry
}

/** The nodes no include stands inside, which the registry does not enter. */
const HOLDS_NO_INCLUDE: ReadonlySet<string> = new Set([
  'paragraph', 'heading', 'code_block', 'comment', 'raw_block', 'thematic_break', 'line_block', 'snippet_use',
  'cell_paragraph', 'link_reference_definition', 'abbreviation_def', 'citation_definition', 'frontmatter',
])

/** Whether `document` holds a snippet use anywhere, definitions included. */
export function holdsSnippetUse(document: DocumentNode, definitions = false): boolean {
  const pending: Node[] = [document]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === 'snippet_use' || (definitions && node.type === 'snippet_definition')) return true
    forEachSlot(node, (nodes) => { for (const child of nodes) pending.push(child) }, undefined, document.extensions)
  }
  return false
}

const NODE_COST = 32
/** The inline nodes that render as exactly one element whose attributes the renderer writes. */
const ONE_ELEMENT: ReadonlySet<string> = new Set([
  'emphasis', 'strong', 'underline', 'strike', 'highlight', 'superscript', 'subscript', 'insert', 'delete', 'span', 'code',
])
const DROPPED = new Set(['pos', 'segments'])

/**
 * Whether `node` renders as one element that can take the carriers: a link only where no note mark moves out behind
 * it. A link that renders no `<a>` gets the carrier span from the renderer.
 */
function rendersAsOne(node: Node, extensions: DocumentNode['extensions']): boolean {
  if (ONE_ELEMENT.has(node.type)) return true
  if (node.type !== 'link') return false
  const pending: Node[] = [node]
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.type === 'footnote_ref' || next.type === 'inline_footnote') return false
    forEachSlot(next, (nodes) => { for (const child of nodes) pending.push(child) }, undefined, extensions)
  }
  return true
}
const OPAQUE = new Set(['data', 'metadata', 'props', 'payload'])

/** The resolution fields of each node type (C2-A-158, AST_RESULTS), which a copy drops. */
function droppedField(node: Node, field: string): boolean {
  if (DROPPED.has(field)) return true
  const entry = AST_RESULTS.get(node.type)?.find((result) => result.field === field)
  if (entry === undefined) return false
  if (entry.when === 'reference use') return (node as { key?: string }).key !== undefined
  if (entry.when === 'derived from authored span mark') return (node as { span?: string }).span !== undefined
  return true
}

/** The bytes of every string and, inside opaque values, every key (C2-N-094). */
function opaqueBytes(value: unknown, keys: boolean): number {
  if (typeof value === 'string') return utf8Length(value)
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + opaqueBytes(item, keys), 0)
  if (value === null || typeof value !== 'object') return 0
  let sum = 0
  for (const [key, item] of Object.entries(value)) sum += (keys ? utf8Length(key) : 0) + opaqueBytes(item, keys)
  return sum
}

interface Copy {
  nodes: Node[]
  count: number
  bytes: number
}

function copyAttrs(copy: Copy, value: Record<string, unknown>): Record<string, unknown> | undefined {
  const attrs = { ...value }
  delete attrs['id']
  if (Object.keys(attrs).length === 0) return undefined
  copy.bytes += opaqueBytes(attrs['classes'], false)
  for (const pair of (attrs['keyValues'] ?? []) as [string, string][]) copy.bytes += utf8Length(pair[1])
  return attrs
}

function copyData(copy: Copy, value: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = { ...value }
  const annotation = data['carve.annotation'] as Record<string, unknown> | undefined
  if (annotation !== undefined) {
    const { ids: _ids, ...rest } = annotation
    if (Object.keys(rest).length === 0) delete data['carve.annotation']
    else data['carve.annotation'] = rest
  }
  if (Object.keys(data).length === 0) return undefined
  copy.bytes += opaqueBytes(data, true)
  return structuredClone(data)
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'type' in value
}

/** The copy of one field of a node, or undefined where the copy leaves the field out. */
function copyField(copy: Copy, field: string, value: unknown, clone: (node: Node) => Node): unknown {
  if (field === 'attrs') return copyAttrs(copy, value as Record<string, unknown>)
  if (field === 'data') return copyData(copy, value as Record<string, unknown>)
  // The slots of an extension node hold nodes of the copy; the names of the slots are no string of the tree.
  if (field === 'slots') {
    const slots = value as Record<string, Node[]>
    return Object.fromEntries(Object.entries(slots).map(([name, nodes]) => [name, nodes.map(clone)]))
  }
  if (!OPAQUE.has(field)) {
    if (Array.isArray(value) && value.every(isNode)) return value.map(clone)
    if (isNode(value)) return clone(value)
  }
  copy.bytes += opaqueBytes(value, OPAQUE.has(field))
  return structuredClone(value)
}

/**
 * C2-N-092: a copy of `nodes` with no positions, no authored ids, no annotation ids and no resolution fields, with
 * its node count and the bytes of its strings (C2-N-094). `authored` maps each copied use to the use it came from.
 */
function copyNodes(nodes: readonly Node[], authored: Map<Node, Node>): Copy {
  const copy: Copy = { nodes: [], count: 0, bytes: 0 }
  const clone = (node: Node): Node => {
    copy.count++
    const out: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(node)) {
      if (droppedField(node, field) || value === undefined) continue
      const copied = copyField(copy, field, value, clone)
      if (copied !== undefined) out[field] = copied
    }
    if (node.type === 'snippet_use') authored.set(out as unknown as Node, authored.get(node) ?? node)
    return out as unknown as Node
  }
  for (const node of nodes) copy.nodes.push(clone(node))
  return copy
}

/** The settings the pass reads. */
export interface ExpandSettings {
  roundtrip: boolean
  source: string | number | undefined
}

interface Pass {
  registry: Map<string, SnippetEntry>
  stack: SnippetDefinitionNode[]
  depth: number
  limit: number
  total: number
  budget: SnippetBudget
  admitted: number
  findings: Findings
  authored: Map<Node, Node>
  settings: ExpandSettings
  /** The `N` of the innermost expanded use the walk is in, or 0. */
  current: number
  /** The nodes whose content a copy went into, which resolution must walk. */
  touched: Set<Node>
  /** The nodes from the document down to the list the walk is in: a copy in a link still sits in the leaf above it. */
  ancestors: Node[]
  extensions: DocumentNode['extensions']
}

const MESSAGES: Record<string, (name: string) => string> = {
  'snippet-unresolved': (name) => `No snippet definition carries the name ${name}; the use is written as its source text`,
  'snippet-cycle': (name) => `The snippet ${name} uses itself; the use is written as its source text`,
  'snippet-depth': (name) => `The snippet ${name} is nested deeper than the snippet depth limit; the use is written as its source text`,
  'snippet-node-budget': (name) =>
    `The copy of the snippet ${name} would pass the snippet node limit of the render; the use is written as its source text`,
}

/** Writes the use at `list[at]` as its source text and reports `code` at the authored use, or at the text in its place. */
function refuse(pass: Pass, list: Node[], at: number, use: SnippetUseNode, code: string, message: string): void {
  const out = spelled(use)
  list[at] = out
  addFinding(pass.findings, pass.authored.get(use) ?? out, { code, severity: 'warning', channel: 'render-loss', message })
}

/** C2-N-093: the use written as its source spelling; an authored use keeps its position for its finding. */
function spelled(use: SnippetUseNode): Node {
  const text: Node = { type: 'text', value: snippetUseSpelling(use.name) } as Node
  if (use.pos !== undefined) text.pos = use.pos
  if (use.mode === 'inline') return text
  const paragraph = { type: 'paragraph', children: [text] } as unknown as Node
  if (use.pos !== undefined) paragraph.pos = use.pos
  return paragraph
}

/** The code of a use that is not expanded, or null where it passes all four tests (C2-N-093, C2-N-094). */
function refusal(pass: Pass, entry: SnippetEntry | undefined): string | null {
  if (entry === undefined) return 'snippet-unresolved'
  if (pass.stack.includes(entry.definition)) return 'snippet-cycle'
  if (pass.stack.length + 1 > pass.depth) return 'snippet-depth'
  return null
}

interface Shape {
  attrs: Attrs | undefined
  /** The one copy node that carries the carriers itself, or null. */
  single: Node | null
  wraps: boolean
  count: number
  bytes: number
}

/** How the copy of `definition` stands at `use`: on its own, or in a wrapper, with its count and bytes (C2-N-094). */
function shapeOf(pass: Pass, use: SnippetUseNode, definition: SnippetDefinitionNode, copy: Copy): Shape {
  const attrs = definition.attrs === undefined ? undefined : { ...definition.attrs }
  // C2-H-215: under roundtrip a copy that renders as one element carries the carriers itself; any other gets a span.
  const single = use.mode === 'inline' && attrs === undefined && pass.settings.roundtrip && copy.nodes.length === 1 &&
    rendersAsOne(copy.nodes[0]!, pass.extensions) ? copy.nodes[0]! : null
  const wraps = use.mode === 'block' || attrs !== undefined || (pass.settings.roundtrip && single === null)
  const bytes = copy.bytes + (wraps ? wrapperBytes(use, attrs) : 0)
  return { attrs, single, wraps, count: copy.count + (wraps ? 1 : 0), bytes }
}

function wrapperBytes(use: SnippetUseNode, attrs: Attrs | undefined): number {
  let bytes = utf8Length(use.mode === 'block' ? 'paragraph' : 'span') + opaqueBytes(attrs?.classes, false)
  for (const pair of attrs?.keyValues ?? []) bytes += utf8Length(pair[1])
  return bytes
}

/** Whether the node and text budgets admit the copy; where not, the use is refused in place (C2-N-094, C2-H-201). */
function admits(pass: Pass, list: Node[], at: number, use: SnippetUseNode, shape: Shape): boolean {
  if (pass.total + shape.count > pass.limit) {
    refuse(pass, list, at, use, 'snippet-node-budget', MESSAGES['snippet-node-budget']!(use.name))
    return false
  }
  const cost = NODE_COST * shape.count + shape.bytes
  if (cost <= pass.budget.left) {
    pass.total += shape.count
    pass.budget.left -= cost
    return true
  }
  if (pass.budget.reported) {
    list[at] = spelled(use)
  } else {
    pass.budget.reported = true
    refuse(pass, list, at, use, 'derived-text-budget',
      `Wrote a snippet use as its source text: the derived text of this render reached its budget of ${pass.budget.budget} bytes`)
  }
  return false
}

/** The nodes that stand in place of `use`, the carriers set on the node that holds them. */
function placedNodes(pass: Pass, use: SnippetUseNode, entry: SnippetEntry, copy: Copy, shape: Shape, n: number): Node[] {
  const carrier: SnippetCarrier = { n, mode: use.mode as 'inline' | 'block', name: use.name, include: entry.include !== null,
    carrierOnly: use.mode === 'inline' && shape.attrs === undefined }
  if (!shape.wraps) {
    if (shape.single !== null) SNIPPET_CARRIERS.set(shape.single, carrier)
    return copy.nodes
  }
  const wrapper = { type: use.mode === 'block' ? 'paragraph' : 'span', children: copy.nodes } as unknown as Node
  if (shape.attrs !== undefined) wrapper.attrs = shape.attrs
  if (pass.settings.roundtrip) SNIPPET_CARRIERS.set(wrapper, carrier)
  return [wrapper]
}

/** Expands the use at `list[at]` and returns how many nodes now stand in its place, the copy expanded too. */
function expandUse(pass: Pass, list: Node[], at: number, use: SnippetUseNode): number {
  const entry = pass.registry.get(use.name)
  const code = refusal(pass, entry)
  if (code !== null) {
    refuse(pass, list, at, use, code, MESSAGES[code]!(use.name))
    return 1
  }
  const definition = entry!.definition
  const copy = copyNodes(definition.children, pass.authored)
  const shape = shapeOf(pass, use, definition, copy)
  if (!admits(pass, list, at, use, shape)) return 1
  const n = ++pass.admitted
  const placed = placedNodes(pass, use, entry!, copy, shape, n)
  for (const node of placed) COPY_SCOPE.set(node, entry!.include)
  for (const node of pass.ancestors) pass.touched.add(node)
  for (const node of placed) pass.touched.add(node)
  list.splice(at, 1, ...placed)
  pass.stack.push(definition)
  const outer = pass.current
  pass.current = n
  for (const node of copy.nodes) markNotes(pass, node)
  let length = 1
  if (shape.wraps) {
    pass.ancestors.push(placed[0]!)
    walkRange(pass, copy.nodes, 0, copy.nodes.length)
    pass.ancestors.pop()
  } else {
    length = walkRange(pass, list, at, copy.nodes.length)
  }
  pass.current = outer
  pass.stack.pop()
  return length
}

function markNotes(pass: Pass, node: Node): void {
  // A link is marked too: its mark moves out of a use only where the link stands outside that copy (C2-H-215).
  if (node.type === 'footnote_ref' || node.type === 'link') SNIPPET_MARKS.set(node, pass.current)
  forEachSlot(node, (nodes) => { for (const child of nodes) markNotes(pass, child) }, undefined, pass.extensions)
}

/** Walks `count` nodes of `list` from `from` and returns how many stand there after their uses expanded. */
function walkRange(pass: Pass, list: Node[], from: number, count: number): number {
  let end = from + count
  for (let at = from; at < end;) {
    const node = list[at]!
    if (node.type === 'snippet_use') {
      const length = expandUse(pass, list, at, node)
      end += length - 1
      at += length
      continue
    }
    if (node.type !== 'snippet_definition') walkNode(pass, node)
    at++
  }
  return end - from
}

function walkNode(pass: Pass, node: Node): void {
  pass.ancestors.push(node)
  forEachSlot(node, (nodes) => { walkRange(pass, nodes as Node[], 0, nodes.length) }, undefined, pass.extensions)
  pass.ancestors.pop()
}

/**
 * C2-N-091: expands the snippet uses of `document` in place, which must be the render's own tree. The findings go
 * to `findings`; the budget left goes on in the renderer (C2-H-201).
 */
export function expandSnippets(document: DocumentNode, findings: Findings, settings: ExpandSettings,
  budgetOf: DocumentNode = document): Set<Node> {
  const registry = snippetRegistry(document)
  const budget = derivedTextBudget(budgetOf, settings.source)
  const pass: Pass = {
    registry, stack: [], depth: harnessLimits()?.snippetDepth ?? SNIPPET_DEPTH, limit: harnessLimits()?.snippetNodes ?? SNIPPET_NODES,
    total: 0, budget: { budget, left: budget, reported: false }, admitted: 0, findings, authored: new Map(), settings, current: 0,
    extensions: document.extensions, touched: new Set(), ancestors: [],
  }
  walkNode(pass, document)
  SNIPPET_BUDGETS.set(document, pass.budget)
  SNIPPET_DEFINITIONS.set(document, definitionKeys(document))
  return pass.touched
}

function definitionKeys(document: DocumentNode): string[] {
  const keys: string[] = []
  snippetRegistry(document, (node) => keys.push(JSON.stringify(node)))
  for (const entry of snippetRegistry(document).values()) keys.push(JSON.stringify(entry.definition))
  return keys
}

/**
 * C2-N-095: in a view a document transform returned, a snippet use is written as its source text and a snippet
 * definition the transform added enters no registry; each reports `snippet-unexpanded-transform`.
 */
export function refuseTransformSnippets(view: DocumentNode, before: readonly string[], findings: Findings): void {
  const known = [...before]
  const message = 'A document transform inserted a snippet node, which is not expanded'
  const visitList = (list: Node[], top: boolean): void => {
    for (let at = 0; at < list.length; at++) {
      const node = list[at]!
      if (node.type === 'snippet_use') {
        const out = spelled(node)
        list[at] = out
        addFinding(findings, out, { code: 'snippet-unexpanded-transform', severity: 'warning', channel: 'render-loss', message })
        continue
      }
      if (node.type === 'snippet_definition') {
        const key = JSON.stringify(node)
        const index = top ? known.indexOf(key) : -1
        if (index >= 0) known.splice(index, 1)
        else addFinding(findings, node, { code: 'snippet-unexpanded-transform', severity: 'warning', channel: 'render-loss', message })
        continue
      }
      forEachSlot(node, (nodes) => { visitList(nodes as Node[], node.type === 'include') }, undefined, view.extensions)
    }
  }
  visitList(view.children, true)
}

/** Whether `document` holds a snippet use or a snippet definition. */
export function holdsSnippetNode(document: DocumentNode): boolean {
  return holdsSnippetUse(document, true)
}
