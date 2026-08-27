/*
 * Shared footnote-numbering pass (carve-js#479).
 */

import type { BlockNode, Document, FootnoteRef, InlineFootnote, InlineNode } from './ast.js'
import { MAX_RENDER_DEPTH, RenderDepthError } from './render-depth.js'
import { ownValue } from './own-property.js'
import { isUnresolvedReference } from './unresolved-reference.js'
import { normalizeRefLabel } from './label-key.js'

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
    // A LINE BLOCK HOLDS ORDINARY BLOCKS and differs from a div only in that
    // its newlines are hard breaks (§4.4), so its inlines are numbered like any
    // other. Falling to `default` here did not degrade the note, it deleted it:
    // an inline footnote carries no `id`, so an unnumbered one renders as the
    // literal `[^]` and its body reaches no endnotes section - the content is
    // gone from the document rather than merely unlinked
    // (markup-carve/carve-js#1117).
    case 'line_block':
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
  const definitionByKey = new Map<string, string>()
  for (const label of Object.keys(defs)) {
    const key = normalizeRefLabel(label)
    if (!definitionByKey.has(key)) definitionByKey.set(key, label)
  }
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
    const definitionLabel = n.id && !/[\r\n]/.test(n.id)
      ? definitionByKey.get(normalizeRefLabel(n.id))
      : undefined
    if (!n.id || definitionLabel === undefined) {
      // DELETE rather than skip. Re-running this pass is a no-op only while
      // `defs` is unchanged; the profile filter can take a definition away
      // AFTER the document was numbered, and a skip would leave the number of
      // a footnote that no longer exists (carve-js#698).
      delete n.number
      return
    }
    const key = normalizeRefLabel(n.id)
    let idx = labelIndexes.get(key)
    if (idx === undefined) {
      const entry: FootnoteOrderEntry = { label: definitionLabel }
      const sourceLine = ownValue(defs, definitionLabel)?.[0]?.pos?.startLine
      if (sourceLine !== undefined) entry.sourceLine = sourceLine
      order.push(entry)
      idx = order.length - 1
      labelIndexes.set(key, idx)
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

/*
 * Every footnote definition a document collected, in SOURCE ORDER.
 *
 * `Document.footnoteDefs` is keyed insertion order, and insertion happens when
 * a definition's body is finalized - not when the definition opens. A
 * definition nested inside another note's body therefore lands in the map
 * BEFORE the note that contains it, because the inner body closes first. On
 * carve#1802's document
 *
 *     [^outer]: intro
 *
 *          [^inner]: note
 *
 *          see[^inner]
 *
 *     see[^outer]
 *
 * the map reads `["inner", "outer"]` while the HTML numbers `outer` as 1 and
 * `inner` as 2 - both definitions are hoisted to the document (§7), so the
 * nesting that produced the insertion order is gone from the tree by the time a
 * writer sees it.
 *
 * The HTML writer never noticed because it emits its endnotes in NUMBERING
 * order, and the canonical writer never noticed because it writes each
 * definition back at its own source line. The three degradation writers
 * (markdown, plain, ansi) walked the map directly, so they alone reordered the
 * definitions - and, because a multi-block body renders its later blocks after
 * the marker line, `outer`'s second paragraph came out below `inner`'s
 * definition where it reads as document text rather than as part of the note.
 *
 * Numbering order cannot be the fix here: these writers emit every DEFINED
 * footnote, including one nothing references, and an unreferenced definition
 * has no number. Source order covers both and agrees with the numbering
 * wherever a number exists.
 *
 * The sort is STABLE and positions are optional, so a document parsed without
 * positions - or ingested from AST JSON, which carries no `footnoteDefPos` -
 * keeps the map's own order rather than being reshuffled arbitrarily.
 */
export function footnoteDefsInSourceOrder(ast: Document): Array<[string, BlockNode[]]> {
  const entries = Object.entries(ast.footnoteDefs ?? {})
  const pos = ast.footnoteDefPos
  if (!pos) return entries
  const keyed = entries.map((entry, index) => {
    const p = ownValue(pos, entry[0])
    return { entry, index, line: p?.startLine, column: p?.startColumn ?? 0 }
  })
  // ALL OR NOTHING, so the comparator stays a total order. Mixing "compare by
  // line" with "keep the map's order" inside one comparator is intransitive
  // once a positionless entry sits between two positioned ones, and an
  // intransitive comparator makes `sort` implementation-defined - a silent
  // cross-engine divergence of exactly the kind this function exists to close.
  if (keyed.some((k) => k.line === undefined)) return entries
  keyed.sort((a, b) => a.line! - b.line! || a.column - b.column || a.index - b.index)
  return keyed.map((k) => k.entry)
}
