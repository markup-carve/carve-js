import type { Admonition, Attrs, BlockNode, Document, Extension, InlineNode } from './ast.js'
import type {
  BlockExtensionRenderContext,
  CarveExtension,
  ExtensionRenderContext,
} from './extension.js'
import { inlineText, slugify } from './heading-ids.js'

/**
 * Index terms (#91, Tier-3). Invisible `:index[term]` markers are collected
 * into a `::: index` block - a sorted `<ul class="index">` with one back-link
 * per occurrence. Reuses the `:name[…]` inline form; no new syntax. Off by
 * default, never corpus-pinned. See docs/extensions.md §8.
 */
export function index(): CarveExtension {
  const occ = new WeakMap<Extension, number>() // marker node → 1-based occurrence
  const counts = new Map<string, number>() // slug → total occurrences
  const display = new Map<string, string>() // slug → first occurrence's term text
  const containers = new WeakSet<BlockNode>()

  return {
    name: 'index',

    beforeRender(doc: Document) {
      // `occ` is a WeakMap keyed by node identity; stale entries (old document's
      // nodes) are unreachable, so only the per-slug tallies need resetting.
      counts.clear()
      display.clear()
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
          if (!display.has(slug)) display.set(slug, inlineText(ext.content))
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
          ? renderIndexList(node as Admonition, ctx, counts, display)
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
  display: Map<string, string>,
): string {
  const pad = ctx.indent(ctx.level)
  const inner = ctx.indent(ctx.level + 1)
  const slugs = [...counts.keys()].sort(byCodepoint)
  const items = slugs.map((slug) => {
    const links: string[] = []
    for (let m = 1; m <= counts.get(slug)!; m++)
      links.push(`<a href="#idx-${ctx.escapeAttr(slug)}-${m}" class="index-backref">↩</a>`)
    return `${inner}<li>${ctx.escapeHtml(display.get(slug)!)} ${links.join(' ')}</li>`
  })
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
 *  so every implementation sorts identically. */
function byCodepoint(a: string, b: string): number {
  const ca = Array.from(a)
  const cb = Array.from(b)
  const n = Math.min(ca.length, cb.length)
  for (let i = 0; i < n; i++) {
    const d = ca[i]!.codePointAt(0)! - cb[i]!.codePointAt(0)!
    if (d !== 0) return d
  }
  return ca.length - cb.length
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
  if ((node as { type?: string }).type === 'extension' && (node as Extension).name === name) {
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
