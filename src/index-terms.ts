import type { Admonition, Attrs, BlockNode, Document, Extension, InlineNode } from './ast.js'
import { AbbrBudget, budgetForDocument, utf8ByteLength } from './abbr-budget.js'
import type {
  BlockExtensionRenderContext,
  CarveExtension,
  ExtensionRenderContext,
} from './extension.js'
import { deriveDisplayNodes, inlineText, slugify } from './heading-ids.js'

/**
 * Index terms (#91, Tier-3). Invisible `:index[term]` markers are collected
 * into a `::: index` block - a sorted `<ul class="index">` with one back-link
 * per occurrence. Reuses the `:name[…]` inline form; no new syntax. Off by
 * default, never corpus-pinned. See docs/extensions.md §8.
 */
export interface IndexOptions {
  /**
   * Leading words of a back-link's accessible name, so the k-th back-link for
   * `widget` is named `Back to widget 2`.
   *
   * Left unset, the string comes from the render's `labels` map under
   * `indexBackref` (default `'Back to'`), so ONE map localizes the whole
   * document - §16a forbids making a host configure the same text twice. Set
   * here to override the map for this extension instance.
   */
  backrefLabel?: string
}

export function index(opts: IndexOptions = {}): CarveExtension {
  const occ = new WeakMap<Extension, number>() // marker node → 1-based occurrence
  const counts = new Map<string, number>() // slug → total occurrences
  const display = new Map<string, InlineNode[]>() // slug → first occurrence's term nodes
  const containers = new WeakSet<BlockNode>()
  // Per-render output budget (DoS guard): K `::: index` blocks each re-emit the
  // full sorted backlink list, so raw output grows K x N x ~52 bytes and can
  // exhaust memory / V8's max string length. Mirrors AbbrBudget - reset per
  // render in `beforeRender`, capped at max(1MB, 8 x sourceByteLength), far
  // above any real document so the corpus is unaffected.
  let budget = new AbbrBudget(undefined)

  return {
    name: 'index',

    beforeRender(doc: Document) {
      // `occ` is a WeakMap keyed by node identity; stale entries (old document's
      // nodes) are unreachable, so only the per-slug tallies need resetting.
      counts.clear()
      display.clear()
      budget = budgetForDocument(doc)
      // Assign each `:index[…]` marker in the body a per-slug occurrence index
      // in document order. Only `doc.children` (body) is indexed: markers in
      // deferred content (footnote definitions, which the core renderer may
      // drop or reorder) render inert (no id, see renderMarker), so the index
      // never points at an anchor that was dropped or duplicated.
      for (const block of doc.children)
        walkExtensions(block, 'index', (ext) => {
          const slug = termSlug(ext.content)
          const n = (counts.get(slug) ?? 0) + 1
          counts.set(slug, n)
          occ.set(ext, n)
          if (!display.has(slug)) // `false`: an index list item is not an anchor - only the backrefs after the
            // display are - so an authored link in the term is kept.
            display.set(slug, deriveDisplayNodes(ext.content, false))
        })
      // Deep walk for containers too: a `::: index` may be nested in a
      // blockquote / list / div, where the core renderer still dispatches.
      walkBlocks(doc, (b) => {
        if (isIndex(b)) containers.add(b)
      })
      return doc
    },

    renderers: {
      index: (node, ctx) => renderMarker(node, ctx, occ),
    },

    blockRenderers: {
      admonition: (node, ctx) =>
        containers.has(node) && counts.size > 0
          ? renderIndexList(
              node as Admonition,
              ctx,
              counts,
              display,
              budget,
              // Precedence: the extension's own option, then the render's
              // `labels` map, then the English default the map carries.
              opts.backrefLabel ?? ctx.labels.indexBackref,
            )
          : undefined,
    },
  }
}

const termSlug = (term: InlineNode[]): string => slugify(inlineText(term), { lowercase: true })

function isIndex(b: BlockNode): boolean {
  return b.type === 'admonition' && (b as Admonition).kind === 'index'
}

function renderMarker(
  node: Extension,
  ctx: ExtensionRenderContext,
  occ: WeakMap<Extension, number>,
): string {
  const n = occ.get(node)
  // A marker outside the indexed body (e.g. inside a footnote definition) is
  // not counted: render it inert (no id) so the index never dangles.
  if (n === undefined) return `<span class="index-term"></span>`
  const slug = termSlug(node.content)
  // Invisible: an empty *span* anchor target (not an <a>, so it never nests
  // inside a link label); the generated index back-links to its id.
  return `<span id="idx-${ctx.escapeAttr(slug)}-${n}" class="index-term"></span>`
}

function renderIndexList(
  node: Admonition,
  ctx: BlockExtensionRenderContext,
  counts: Map<string, number>,
  display: Map<string, InlineNode[]>,
  budget: AbbrBudget,
  backrefLabel: string,
): string {
  const pad = ctx.indent(ctx.level)
  const inner = ctx.indent(ctx.level + 1)
  const slugs = [...counts.keys()].sort(byCodepoint)
  const items: string[] = []
  // Charge cumulative emitted bytes against the per-render budget; once the
  // next item/backlink would overflow, stop emitting further index content
  // (graceful, no throw, no giant allocation). Re-emitted across K blocks, so
  // the cap bounds K x N amplification.
  for (const slug of slugs) {
    const li = `${inner}<li>${ctx.renderInlines(display.get(slug)!)} `
    if (!budget.charge(utf8ByteLength(li))) break
    const links: string[] = []
    let truncated = false
    const total = counts.get(slug)!
    // THE BACK-LINK SAYS WHERE IT GOES (carve#1469). `↩` alone is announced as
    // "leftwards arrow with hook", or skipped - the sentence PART 9 §16 exists
    // to prevent, on the identical element. §16's rule is mirrored rather than
    // reinvented: the name is the label plus WHAT THE LINK VISIBLY SAYS. One
    // occurrence shows `↩` and is named by label + term; the k-th of several
    // shows `↩<sup>k</sup>` and takes that k, so a row of otherwise identical
    // arrows is distinguishable BOTH by sight and by ear (WCAG 2.5.3).
    const term = inlineText(display.get(slug)!)
    for (let m = 1; m <= total; m++) {
      const name = total === 1 ? `${backrefLabel} ${term}` : `${backrefLabel} ${term} ${m}`
      const body = total === 1 ? '↩' : `↩<sup>${m}</sup>`
      const link =
        `<a href="#idx-${ctx.escapeAttr(slug)}-${m}" class="index-backref"` +
        ` aria-label="${ctx.escapeAttr(name)}">${body}</a>`
      if (!budget.charge(utf8ByteLength(link))) {
        truncated = true
        break
      }
      links.push(link)
    }
    items.push(`${li}${links.join(' ')}</li>`)
    if (truncated) break
  }
  // Carry the author's `{#id .class}` onto the <ul>, `index` stays leading.
  const ul = `${pad}<ul${ctx.renderAttrs(withBaseClass(node.attrs, 'index'))}>\n${items.join('\n')}\n${pad}</ul>`
  // Preserve any authored content inside the placeholder before the list -
  // never silently drop authored blocks.
  if (node.children.length === 0) return ul
  return `${ctx.renderChildren(node.children, ctx.level)}\n${ul}`
}

function withBaseClass(attrs: Attrs | undefined, base: string): Attrs {
  const a: Attrs = attrs ? { ...attrs } : {}
  a.classes = [base, ...(a.classes ?? [])]
  return a
}

/** Ascending Unicode-codepoint order (== UTF-8 byte order), locale-independent
 *  so every implementation sorts identically. Walks code points in place so it
 *  is O(min(len_a,len_b)) time with O(1) allocation - no per-comparison
 *  `Array.from` (which made sorting many long-common-prefix terms quadratic). */
function byCodepoint(a: string, b: string): number {
  let i = 0
  let j = 0
  const la = a.length
  const lb = b.length
  while (i < la && j < lb) {
    const ca = a.codePointAt(i)!
    const cb = b.codePointAt(j)!
    if (ca !== cb) return ca - cb
    // Advance by the code point's UTF-16 width so surrogate pairs compare by
    // their full code point (astral chars sort after the BMP, not by unit).
    i += ca > 0xffff ? 2 : 1
    j += cb > 0xffff ? 2 : 1
  }
  // Equal common prefix: the shorter (fewer remaining units) sorts first. Both
  // strings agreed code point by code point, so remaining-unit comparison
  // matches remaining-code-point comparison.
  return la - i - (lb - j)
}

/** Depth-first visit of every typed node, so a `::: index` nested in a
 *  blockquote / list / div is found too. Skips `pos` metadata. */
function walkBlocks(node: unknown, fn: (b: BlockNode) => void): void {
  if (!node || typeof node !== 'object') return
  if (typeof (node as { type?: string }).type === 'string') fn(node as BlockNode)
  for (const key of Object.keys(node as Record<string, unknown>)) {
    if (key === 'pos') continue
    const v = (node as Record<string, unknown>)[key]
    if (Array.isArray(v)) for (const el of v) walkBlocks(el, fn)
    else if (v && typeof v === 'object') walkBlocks(v, fn)
  }
}

/** Depth-first visit of every `extension` node with the given name, in document
 *  order. Generic field walk; skips `pos` metadata. */
function walkExtensions(node: unknown, name: string, fn: (ext: Extension) => void): void {
  if (!node || typeof node !== 'object') return
  if ((node as { type?: string }).type === 'inline_extension' && (node as Extension).name === name) {
    fn(node as Extension)
    return
  }
  for (const key of Object.keys(node as Record<string, unknown>)) {
    if (key === 'pos') continue
    const v = (node as Record<string, unknown>)[key]
    if (Array.isArray(v)) for (const el of v) walkExtensions(el, name, fn)
    else if (v && typeof v === 'object') walkExtensions(v, name, fn)
  }
}
