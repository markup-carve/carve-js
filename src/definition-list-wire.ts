/*
 * The definition list's wire shape (PART 12).
 *
 * This engine models an entry as a plain object - `{terms, definitions}`, arrays
 * of arrays - which is convenient in memory and the wrong thing to publish, for
 * three reasons that only became visible once every engine was measured against
 * one schema:
 *
 * 1. §4 requires a position on every node but the root, and a plain object
 *    cannot carry one. A term was the only content in a serialized document an
 *    editor could not navigate to - the same argument §7 used to move
 *    frontmatter and footnote definitions out of root FIELDS and into the tree.
 * 2. `definition_term` and `definition_description` are in the normative block
 *    vocabulary (profiles.md). Under the object form those two entries named
 *    nothing, so a profile denying either was a silent no-op - the specific
 *    failure a normative vocabulary exists to prevent.
 * 3. The grouping was not agreed. Given `:: a` / `:: b` / `:  x` / `:  y`,
 *    carve-js published one entry with two terms and two definitions and
 *    carve-rs published three entries split differently - while all three
 *    engines rendered the same `<dl>`. A structure two producers disagree about,
 *    which no output depends on, is an internal.
 *
 * So the wire carries what the renderers agree on: a FLAT sequence of
 * `definition_term` and `definition_description` nodes, in document order,
 * exactly as `<dt>` and `<dd>` appear in the rendered list. The grouping is
 * recovered on the way in by the rule the renderers already use - a run of
 * descriptions belongs to the run of terms before it.
 *
 * The runtime shape is deliberately left alone (§1: an implementation whose
 * internals differ MAPS on the way out), so renderers and extensions that read
 * `items[].terms` keep working.
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
    for (const term of item.terms ?? []) {
      const node: DefinitionTermNode = { type: 'definition_term', children: term }
      const pos = span(term)
      if (pos !== undefined) node.pos = pos
      out.push(node)
    }
    ;(item.definitions ?? []).forEach((definition, index) => {
      const node: DefinitionDescriptionNode = {
        type: 'definition_description',
        children: definition,
      }
      // A description whose only content HOISTED to the document root - a link
      // reference, footnote or abbreviation definition, PART 12 §7 - has no
      // children left, so `span` derives nothing and the `<dd>` was the one
      // thing in the document an editor could not navigate to
      // (markup-carve/carve-js#813).
      //
      // That is not §4's exemption. §4 exempts a node the producer REASSEMBLED,
      // because its value is not a slice of the source at any offset. These
      // lines are contiguous, unmoved and still in the source; the parser
      // recorded exactly which ones it consumed, and `definitionSpans` carries
      // that. docs/ast-json.md:116-117 narrows the exemption to "nodes that
      // *cannot* be placed, not nodes that have not been placed yet".
      //
      // The derived span still wins when there is one, so the placed `<dd>`s
      // this engine already publishes do not move. Whether a `<dd>`'s span
      // should cover its `:  ` marker in the NON-empty case too is the extent
      // convention, markup-carve/carve#913, tracked for all node types and all
      // three engines in the spec's resources/ast-span-divergence.txt - not
      // settled one node type at a time here.
      const pos = span(definition) ?? item.definitionSpans?.[index]
      if (pos !== undefined) node.pos = pos
      out.push(node)
    })
  }
  return out
}

/**
 * The flat wire sequence back to runtime entries.
 *
 * The grouping rule is the renderer's: a run of terms opens an entry, the
 * descriptions that follow belong to it, and the next term after a description
 * starts the next entry. A description with no term before it - which the parser
 * cannot produce but a hand-built payload can - opens an entry with no terms
 * rather than being dropped.
 */
export function entriesFromWire(nodes: unknown[]): DefinitionItem[] {
  const items: DefinitionItem[] = []
  let current: DefinitionItem | undefined

  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) continue
    const entry = node as { type?: unknown; children?: unknown }
    if (!Array.isArray(entry.children)) continue

    if (entry.type === 'definition_term') {
      // A term after a description starts a new entry; consecutive terms share
      // one, which is what `:: a` / `:: b` on adjacent lines means.
      if (current === undefined || current.definitions.length > 0) {
        current = { terms: [], definitions: [] }
        items.push(current)
      }
      current.terms.push(entry.children as InlineNode[])
      continue
    }

    if (entry.type === 'definition_description') {
      if (current === undefined) {
        current = { terms: [], definitions: [] }
        items.push(current)
      }
      current.definitions.push(entry.children as BlockNode[])
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
