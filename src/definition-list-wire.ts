/*
 * The definition list's wire shape (PART 12).
 */

import type { BlockNode, DefinitionItem, InlineNode, Position } from './ast.js'

/** A `<dt>`: inline content, on the wire as a node of its own. */
export interface DefinitionTermNode {
  type: 'definition_term'
  children: InlineNode[]
  pos?: Position
}

/** A `<dd>`: block content, on the wire as a node of its own. */
export interface DefinitionDescriptionNode {
  type: 'definition_description'
  children: BlockNode[]
  pos?: Position
}

export type DefinitionEntryNode = DefinitionTermNode | DefinitionDescriptionNode

/** The span covering a run of nodes, when every one of them carries one. */
function span(nodes: { pos?: Position }[]): Position | undefined {
  if (nodes.length === 0) return undefined
  const first = nodes[0]?.pos
  const last = nodes[nodes.length - 1]?.pos
  if (first === undefined || last === undefined) return undefined

  // Derived, not invented: the union of spans the parser actually recorded, so
  // it covers exactly the content of the term or description and nothing else.
  // A single missing child span yields no span at all rather than a shorter one
  // that looks complete (§4: absent beats wrong).
  const pos: Position = { startLine: first.startLine, endLine: last.endLine }
  if (first.startColumn !== undefined) pos.startColumn = first.startColumn
  if (last.endColumn !== undefined) pos.endColumn = last.endColumn
  if (first.startOffset !== undefined) pos.startOffset = first.startOffset
  if (last.endOffset !== undefined) pos.endOffset = last.endOffset
  return pos
}

/** Runtime entries to the flat wire sequence. */
export function entriesToWire(items: DefinitionItem[]): DefinitionEntryNode[] {
  const out: DefinitionEntryNode[] = []
  for (const item of items) {
    for (const [index, term] of (item.terms ?? []).entries()) {
      const node: DefinitionTermNode = { type: 'definition_term', children: term }
      const recorded = item.termSpans?.[index]
      const derived = span(term)
      const pos = recorded ? { ...recorded } : derived
      if (pos && recorded && derived) {
        pos.endLine = derived.endLine
        if (derived.endColumn !== undefined) pos.endColumn = derived.endColumn
        if (derived.endOffset !== undefined) pos.endOffset = derived.endOffset
      }
      if (pos !== undefined) node.pos = pos
      out.push(node)
    }
    ;(item.definitions ?? []).forEach((definition, index) => {
      const node: DefinitionDescriptionNode = {
        type: 'definition_description',
        children: definition,
      }
      const recorded = item.definitionSpans?.[index]
      const derived = span(definition)
      const pos = recorded ? { ...recorded } : derived
      if (pos && recorded && derived) {
        pos.endLine = derived.endLine
        if (derived.endColumn !== undefined) pos.endColumn = derived.endColumn
        if (derived.endOffset !== undefined) pos.endOffset = derived.endOffset
      }
      if (pos !== undefined) node.pos = pos
      out.push(node)
    })
  }
  return out
}

/** A wire position, when the payload carries a usable one. */
function readPos(value: unknown): Position | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const pos = value as Position
  if (typeof pos.startLine !== 'number' || typeof pos.endLine !== 'number') return undefined

  return pos
}

/**
 * The flat wire sequence back to runtime entries.
 */
export function entriesFromWire(nodes: unknown[]): DefinitionItem[] {
  const items: DefinitionItem[] = []
  let current: DefinitionItem | undefined

  const open = (): DefinitionItem => {
    const item: DefinitionItem = {
      terms: [],
      definitions: [],
      termSpans: [],
      definitionLines: [],
      definitionSpans: [],
    }
    items.push(item)

    return item
  }

  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) continue
    const entry = node as { type?: unknown; children?: unknown; pos?: unknown }
    if (!Array.isArray(entry.children)) continue

    if (entry.type === 'definition_term') {
      // A term after a description starts a new entry; consecutive terms share
      // one, which is what `:: a` / `:: b` on adjacent lines means.
      if (current === undefined || current.definitions.length > 0) current = open()
      current.terms.push(entry.children as InlineNode[])
      current.termSpans!.push(readPos(entry.pos))
      continue
    }

    if (entry.type === 'definition_description') {
      if (current === undefined) current = open()
      current.definitions.push(entry.children as BlockNode[])
      // Parallel to `definitions`, so a payload where only some descriptions
      // carry a position keeps the rest of them lined up. Pushed unconditionally
      // for that reason - a skipped `undefined` would shift every later index.
      const pos = readPos(entry.pos)
      current.definitionSpans!.push(pos)
      current.definitionLines!.push(pos?.startLine)
    }
  }

  return items
}

/** Is this the runtime entry form (a plain object), rather than the wire one? */
export function isRuntimeEntry(value: unknown): value is DefinitionItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { terms?: unknown }).terms)
  )
}
