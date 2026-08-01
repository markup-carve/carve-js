/*
 * Footnote numbering: the pass that turns references into numbers.
 *
 * It lived inside the HTML renderer, which is where the numbers were needed
 * first - but that made numbering a RENDERING step, and PART 12 section 5 says
 * the opposite:
 *
 *   Resolution results that a consumer can recompute - footnote numbering,
 *   caption numbers - ARE serialized, because recomputing them requires
 *   reimplementing PART 9R.
 *
 * A document serialized without ever being rendered therefore carried
 * `footnote_ref` nodes with no `number`, and a consumer reading the AST had to
 * reimplement the rule: document reference order, first definition wins,
 * unreferenced definitions dropped, repeated references sharing a number with
 * distinct backlink ids (markup-carve/carve-js#479).
 *
 * The pass is shared rather than duplicated, so the number a consumer reads off
 * the AST is the same number the HTML shows. It MUTATES the tree, which is what
 * lets both callers agree; running it twice is idempotent for the numbers and
 * rebuilds the same backref ids.
 */

import type { BlockNode, Document, InlineNode } from './ast.js'

export interface FootnoteEntry {
  /** Reference label, for a `[^label]` note; undefined for an inline note. */
  label?: string
  /** Inline content, for an `^[content]` note; undefined for a reference note. */
  inline?: InlineNode[]
  /** 1-based source line of the note body, when known. */
  sourceLine?: number
  /** Backlink-target ids in reference order. */
  backrefs: string[]
}

export interface FootnoteState {
  /** Note instances in document order; index + 1 = number. */
  order: FootnoteEntry[]
}

/** Visit every inline array under a block subtree (depth-first). */
function walkBlockInlines(node: BlockNode, visit: (xs: InlineNode[]) => void): void {
  switch (node.type) {
    case 'heading':
    case 'paragraph':
      visit(node.children)
      break
    case 'block_quote':
      if (node.attribution) visit(node.attribution)
      node.children.forEach((c) => walkBlockInlines(c, visit))
      break
    case 'list':
      for (const it of node.items) it.children.forEach((c) => walkBlockInlines(c, visit))
      break
    case 'admonition':
      if (node.title) visit(node.title)
      node.children.forEach((c) => walkBlockInlines(c, visit))
      break
    case 'div':
      node.children.forEach((c) => walkBlockInlines(c, visit))
      break
    case 'definition_list':
      for (const it of node.items) {
        for (const t of it.terms) visit(t)
        for (const d of it.definitions) for (const b of d) walkBlockInlines(b, visit)
      }
      break
    case 'table':
      if (node.caption) visit(node.caption)
      for (const row of node.rows) for (const cell of row.cells) visit(cell.children)
      break
    case 'figure':
      visit(node.caption)
      if (node.target.type === 'block_quote' || node.target.type === 'table')
        walkBlockInlines(node.target, visit)
      break
    default:
      break
  }
}

function visitInlineTree(nodes: InlineNode[], fn: (n: InlineNode) => void): void {
  for (const n of nodes) {
    fn(n)
    const kids =
      (n as { children?: InlineNode[]; content?: InlineNode[] }).children ??
      (n as { content?: InlineNode[] }).content
    if (Array.isArray(kids)) visitInlineTree(kids, fn)
  }
}

export function collectFootnotes(ast: Document): FootnoteState {
  const defs = ast.footnoteDefs ?? {}
  const order: FootnoteEntry[] = []
  const seen: Record<string, number> = {}
  const labelIndexes = new Map<string, number>()
  const onNode = (n: InlineNode): void => {
    if (n.type !== 'footnote_ref' && n.type !== 'inline_footnote') return
    // Inline footnote (`^[content]`): always a fresh, anonymous number.
    if (n.inline) {
      const number = order.length + 1
      const refId = `fnref${number}`
      const entry: FootnoteEntry = { inline: n.inline, backrefs: [refId] }
      if (n.pos?.startLine !== undefined) entry.sourceLine = n.pos.startLine
      order.push(entry)
      n.number = number
      n.refId = refId
      return
    }
    // Reference footnote (`[^label]`): numbered at first resolved reference.
    if (!n.id || !defs[n.id]) return
    let idx = labelIndexes.get(n.id)
    if (idx === undefined) {
      const entry: FootnoteEntry = { label: n.id, backrefs: [] }
      const sourceLine = defs[n.id]?.[0]?.pos?.startLine
      if (sourceLine !== undefined) entry.sourceLine = sourceLine
      order.push(entry)
      idx = order.length - 1
      labelIndexes.set(n.id, idx)
    }
    const number = idx + 1
    const occ = (seen[n.id] = (seen[n.id] ?? 0) + 1)
    const refId = occ === 1 ? `fnref${number}` : `fnref${number}-${occ}`
    n.number = number
    n.refId = refId
    order[idx]!.backrefs.push(refId)
  }
  for (const b of ast.children) walkBlockInlines(b, (xs) => visitInlineTree(xs, onNode))
  // Reference bodies may cite further reference footnotes; walk them in
  // discovery order (the queue grows as onNode appends entries). Inline-note
  // content lives in `.inline`, which visitInlineTree does not descend, so it
  // is never walked for footnotes (design §3.1: no footnotes inside notes).
  for (let k = 0; k < order.length; k++) {
    const label = order[k]!.label
    if (label === undefined) continue
    for (const b of defs[label] ?? []) walkBlockInlines(b, (xs) => visitInlineTree(xs, onNode))
  }
  return { order }
}
