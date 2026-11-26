// C2-N-090 to C2-N-096: the snippet registry and the one expansion pass over the render view, after includes
// and before resolution and document transforms. The authored tree keeps its uses: the pass runs on the render's own tree.
import { AST_RESULTS } from './ast-tables.ts'
import { type DocumentNode, forEachSlot, type IncludeNode, type Node, type SnippetDefinitionNode, type SnippetUseNode } from './ast.ts'
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
      if (child.type === 'include' && child.children !== undefined) collect(child.children, child)
      if (child.type !== 'snippet_definition') continue
      if (registry.has(child.name)) duplicate?.(child)
      else registry.set(child.name, { definition: child, include })
    }
  }
  collect(document.children, null)
  return registry
}

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
const DROPPED = new Set(['pos', 'segments'])
const OPAQUE = new Set(['data', 'metadata', 'props', 'payload'])

/** The resolution fields of each node type (C2-A-158, AST_RESULTS), which a copy drops. */
function droppedField(type: string, field: string): boolean {
  if (DROPPED.has(field)) return true
  return AST_RESULTS.get(type)?.some((entry) => entry.field === field) ?? false
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
      if (droppedField(node.type, field) || value === undefined) continue
      if (field === 'attrs') {
        const attrs = { ...(value as Record<string, unknown>) }
        delete attrs['id']
        if (Object.keys(attrs).length === 0) continue
        copy.bytes += opaqueBytes(attrs['classes'], false)
        for (const pair of (attrs['keyValues'] ?? []) as [string, string][]) copy.bytes += utf8Length(pair[1])
        out[field] = attrs
      } else if (field === 'data') {
        const data = { ...(value as Record<string, unknown>) }
        const annotation = data['carve.annotation'] as Record<string, unknown> | undefined
        if (annotation !== undefined) {
          const { ids: _ids, ...rest } = annotation
          if (Object.keys(rest).length === 0) delete data['carve.annotation']
          else data['carve.annotation'] = rest
        }
        if (Object.keys(data).length === 0) continue
        copy.bytes += opaqueBytes(data, true)
        out[field] = structuredClone(data)
      } else if (OPAQUE.has(field)) {
        copy.bytes += opaqueBytes(value, true)
        out[field] = structuredClone(value)
      } else if (Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null && 'type' in item)) {
        out[field] = (value as Node[]).map(clone)
      } else if (typeof value === 'object' && value !== null && 'type' in value) {
        out[field] = clone(value as Node)
      } else {
        copy.bytes += opaqueBytes(value, false)
        out[field] = structuredClone(value)
      }
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
  parent: Node
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

/** Expands the use at `list[at]` and returns the nodes now in its place. */
function expandUse(pass: Pass, list: Node[], at: number, use: SnippetUseNode): Node[] {
  const entry = pass.registry.get(use.name)
  const code = refusal(pass, entry)
  if (code !== null) {
    refuse(pass, list, at, use, code, MESSAGES[code]!(use.name))
    return []
  }
  const definition = entry!.definition
  const copy = copyNodes(definition.children, pass.authored)
  const attrs = definition.attrs === undefined ? undefined : { ...definition.attrs }
  const wraps = use.mode === 'block' || attrs !== undefined || pass.settings.roundtrip
  const count = copy.count + (wraps ? 1 : 0)
  let bytes = copy.bytes
  if (wraps) {
    bytes += utf8Length(use.mode === 'block' ? 'paragraph' : 'span')
    bytes += opaqueBytes(attrs?.classes, false)
    for (const pair of attrs?.keyValues ?? []) bytes += utf8Length(pair[1])
  }
  if (pass.total + count > pass.limit) {
    refuse(pass, list, at, use, 'snippet-node-budget', MESSAGES['snippet-node-budget']!(use.name))
    return []
  }
  const cost = NODE_COST * count + bytes
  if (cost > pass.budget.left) {
    if (pass.budget.reported) {
      list[at] = spelled(use)
      return []
    }
    pass.budget.reported = true
    refuse(pass, list, at, use, 'derived-text-budget',
      `Wrote a snippet use as its source text: the derived text of this render reached its budget of ${pass.budget.budget} bytes`)
    return []
  }
  pass.total += count
  pass.budget.left -= cost
  const n = ++pass.admitted
  const carrier: SnippetCarrier = { n, mode: use.mode as 'inline' | 'block', name: use.name, include: entry!.include !== null,
    carrierOnly: use.mode === 'inline' && attrs === undefined }
  let placed: Node[]
  if (wraps) {
    const wrapper = { type: use.mode === 'block' ? 'paragraph' : 'span', children: copy.nodes } as unknown as Node
    if (attrs !== undefined) wrapper.attrs = attrs
    if (pass.settings.roundtrip) SNIPPET_CARRIERS.set(wrapper, carrier)
    placed = [wrapper]
  } else {
    placed = copy.nodes
  }
  for (const node of placed) COPY_SCOPE.set(node, entry!.include)
  pass.touched.add(pass.parent)
  for (const node of placed) pass.touched.add(node)
  list.splice(at, 1, ...placed)
  pass.stack.push(definition)
  const outer = pass.current
  pass.current = n
  for (const node of copy.nodes) markNotes(pass, node)
  const parent = pass.parent
  if (wraps) pass.parent = placed[0]!
  walkList(pass, copy.nodes)
  pass.parent = parent
  pass.current = outer
  pass.stack.pop()
  return placed
}

function markNotes(pass: Pass, node: Node): void {
  if (node.type === 'footnote_ref') SNIPPET_MARKS.set(node, pass.current)
  forEachSlot(node, (nodes) => { for (const child of nodes) markNotes(pass, child) }, undefined, pass.extensions)
}

function walkList(pass: Pass, list: Node[]): void {
  for (let at = 0; at < list.length; at++) {
    const node = list[at]!
    if (node.type === 'snippet_use') {
      const placed = expandUse(pass, list, at, node)
      // The walk went into the copy already; it goes on after it.
      at += Math.max(placed.length, 1) - 1
      continue
    }
    if (node.type === 'snippet_definition') continue
    walkNode(pass, node)
  }
}

function walkNode(pass: Pass, node: Node): void {
  const parent = pass.parent
  pass.parent = node
  forEachSlot(node, (nodes) => { walkList(pass, nodes as Node[]) }, undefined, pass.extensions)
  pass.parent = parent
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
    extensions: document.extensions, touched: new Set(), parent: document,
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
