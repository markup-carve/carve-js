/*
 * Shared footnote-numbering pass (carve-js#479).
 *
 * A footnote's `number` is document reference order - a value that is
 * renderer-independent and always recomputable from the parsed AST alone.
 * PART 12 §5 keeps a resolution result like this OUT of a consumer's hands to
 * reimplement, so `resolve()` calls this pass to fill `number` before a
 * document is serialized.
 *
 * `renderHtml()` is ALSO a public entry point callable without `resolve()`
 * having run, so it must number footnotes standalone - and must land on the
 * exact same numbers `resolve()` would have, or the two code paths silently
 * disagree. Rather than keep two implementations of the numbering rule in
 * sync by hand, both call sites share this one. Re-running it against an
 * already-numbered document is a no-op (same document order, same numbers),
 * never a renumbering - PROVIDED the set of definitions has not moved. When it
 * has, re-running is exactly what is wanted, and the pass clears the number of
 * any reference that no longer resolves rather than leaving the old one in
 * place (carve-js#698).
 *
 * `refId` (the backlink anchor id) is deliberately NOT assigned here - it is
 * a rendering concern, format chosen by whichever renderer builds the
 * endnotes section, and must not leak into a serialized parse-only AST.
 */

import type { BlockNode, Document, FootnoteRef, InlineFootnote, InlineNode } from './ast.js'
import { MAX_RENDER_DEPTH, RenderDepthError } from './render-depth.js'
import { ownValue } from './own-property.js'
import { isUnresolvedReference } from './unresolved-reference.js'

/** A footnote instance in document order; index + 1 = its assigned number. */
export interface FootnoteOrderEntry {
  /** Reference label, for a `[^label]` note; undefined for an inline note. */
  label?: string
  /** Inline content, for an `^[content]` note; undefined for a reference note. */
  inline?: InlineNode[]
  /** 1-based source line of the note body, when known. */
  sourceLine?: number
}

/** A single `footnote_ref` / `inline_footnote` node, as visited. */
export interface FootnoteRefVisit {
  node: FootnoteRef | InlineFootnote
  /** Index into `order` (== assigned number - 1) this reference belongs to. */
  orderIndex: number
}

export interface FootnoteNumbering {
  /** Footnote instances in document order; index + 1 = number. */
  order: FootnoteOrderEntry[]
  /** Every reference node visited, in traversal order (queue grows as
   *  reference-body walks discover further references). */
  refs: FootnoteRefVisit[]
}

/**
 * Visit every inline array under a block subtree (depth-first).
 *
 * Bounded by `MAX_RENDER_DEPTH`, like the renderers this pass runs ahead of.
 * §25 requires recursive RENDER / RESOLVE / FILTER passes to be bounded, not
 * only the parse path - and a pre-pass that overflows the host stack refuses
 * nothing, it crashes, which is what `renderHtml` did on a 2000-deep tree
 * before the renderer's own ceiling was ever reached (carve#526).
 */
function walkBlockInlines(
  node: BlockNode,
  visit: (xs: InlineNode[]) => void,
  depth = 0,
): void {
  if (depth >= MAX_RENDER_DEPTH) throw new RenderDepthError('numberFootnotes', MAX_RENDER_DEPTH)
  switch (node.type) {
    case 'heading':
    case 'paragraph':
    // A bibliography entry's inlines are rendered - in the references list -
    // so a footnote reference in one is numbered like any other. It reached
    // this walk as a paragraph before PART 12 §18 made the line its own node,
    // and skipping it here would have unnumbered the reference and left it
    // rendering as its own source text.
    case 'citation_definition':
      visit(node.children)
      break
    case 'block_quote':
      node.children.forEach((c) => walkBlockInlines(c, visit, depth + 1))
      break
    case 'list':
      for (const it of node.items) it.children.forEach((c) => walkBlockInlines(c, visit, depth + 1))
      break
    case 'admonition':
      if (node.title) visit(node.title)
      node.children.forEach((c) => walkBlockInlines(c, visit, depth + 1))
      break
    case 'div':
      node.children.forEach((c) => walkBlockInlines(c, visit, depth + 1))
      break
    case 'definition_list':
      for (const it of node.items) {
        for (const t of it.terms) visit(t)
        for (const d of it.definitions) for (const b of d) walkBlockInlines(b, visit, depth + 1)
      }
      break
    case 'table':
      if (node.caption) visit(node.caption)
      for (const row of node.rows) for (const cell of row.cells) visit(cell.children)
      break
    case 'figure':
      visit(node.caption)
      if (node.target.type === 'block_quote' || node.target.type === 'table')
        walkBlockInlines(node.target, visit, depth + 1)
      break
    case 'figure_group':
      if (node.caption) visit(node.caption)
      node.children.forEach((c) => walkBlockInlines(c, visit, depth + 1))
      break
    default:
      break
  }
}

/**
 * Visit an inline subtree, telling `fn` whether the node it is looking at sits
 * in text the document DISCARDS.
 *
 * An unresolved reference degrades to its literal source (PART 9R R1), so the
 * link text built for it never reaches the reader. Everything under such a node
 * is therefore visited but marked discarded, rather than skipped outright: a
 * footnote reference in there must have any stale `number` cleared, the same
 * way a reference whose definition went away does (carve-js#698).
 */
function visitInlineTree(
  nodes: InlineNode[],
  fn: (n: InlineNode, discarded: boolean) => void,
  depth = 0,
  discarded = false,
): void {
  if (depth >= MAX_RENDER_DEPTH) throw new RenderDepthError('numberFootnotes', MAX_RENDER_DEPTH)
  for (const n of nodes) {
    fn(n, discarded)
    const kids =
      (n as { children?: InlineNode[]; content?: InlineNode[] }).children ??
      (n as { content?: InlineNode[] }).content
    if (Array.isArray(kids))
      visitInlineTree(kids, fn, depth + 1, discarded || isUnresolvedReference(n))
  }
}

/**
 * Assign `number` to every footnote reference, in document order (first
 * definition wins; a definition that is never referenced contributes no
 * entry and no number).
 */
export function numberFootnotes(ast: Document): FootnoteNumbering {
  const defs = ast.footnoteDefs ?? {}
  const order: FootnoteOrderEntry[] = []
  const refs: FootnoteRefVisit[] = []
  const labelIndexes = new Map<string, number>()
  const onNode = (n: InlineNode, discarded: boolean): void => {
    if (n.type !== 'footnote_ref' && n.type !== 'inline_footnote') return
    // A NOTE INSIDE AN UNRESOLVED REFERENCE IS NOT A REFERENCE (PART 9R R2,
    // markup-carve/carve#1198). The reference degraded to its literal source,
    // so the text holding this note was discarded: it draws no number, a
    // definition it was the only use of stays unreferenced and is dropped, and
    // no endnotes section is written on its account. Numbering it anyway is
    // what a pipeline does when it resolves footnotes before it knows the
    // reference failed, and the numbering says so - the note a reader can see
    // then reads as a repeat of a reference the document does not contain.
    if (discarded) {
      delete n.number
      return
    }
    // Inline footnote (`^[content]`): always a fresh, anonymous entry.
    if (n.inline) {
      const orderIndex = order.length
      const entry: FootnoteOrderEntry = { inline: n.inline }
      if (n.pos?.startLine !== undefined) entry.sourceLine = n.pos.startLine
      order.push(entry)
      n.number = orderIndex + 1
      refs.push({ node: n, orderIndex })
      return
    }
    // Reference footnote (`[^label]`): numbered at first resolved reference.
    if (!n.id || ownValue(defs, n.id) === undefined) {
      // DELETE rather than skip. Re-running this pass is a no-op only while
      // `defs` is unchanged; the profile filter can take a definition away
      // AFTER the document was numbered, and a skip would leave the number of
      // a footnote that no longer exists (carve-js#698).
      delete n.number
      return
    }
    let idx = labelIndexes.get(n.id)
    if (idx === undefined) {
      const entry: FootnoteOrderEntry = { label: n.id }
      const sourceLine = ownValue(defs, n.id)?.[0]?.pos?.startLine
      if (sourceLine !== undefined) entry.sourceLine = sourceLine
      order.push(entry)
      idx = order.length - 1
      labelIndexes.set(n.id, idx)
    }
    n.number = idx + 1
    refs.push({ node: n, orderIndex: idx })
  }
  for (const b of ast.children) walkBlockInlines(b, (xs) => visitInlineTree(xs, onNode))
  // Reference bodies may cite further reference footnotes; walk them in
  // discovery order (the queue grows as onNode appends entries). Inline-note
  // content lives in `.inline`, which visitInlineTree does not descend, so it
  // is never walked for footnotes (design §3.1: no footnotes inside notes).
  for (let k = 0; k < order.length; k++) {
    const label = order[k]!.label
    if (label === undefined) continue
    for (const b of ownValue(defs, label) ?? [])
      walkBlockInlines(b, (xs) => visitInlineTree(xs, onNode))
  }
  return { order, refs }
}
