import type { BlockNode, Document, Heading, Link, Span, Text } from './ast.js'
import type { CarveExtension } from './extension.js'
import { inlineText } from './heading-ids.js'

/** Options for the {@link headingNumbers} extension (#198). */
export interface HeadingNumbersOptions {
  /** Top numbered heading level (1-6). Default 1; set 2 when `#` is the title. */
  minLevel?: number
  /** Cross-reference prefix word. Default `'Section'` (use `'§'`, a locale word, …). */
  label?: string
  /** Auto-filled cross-reference text. Default `'number-title'`. */
  crossref?: 'number' | 'number-title' | 'title'
}

/**
 * HeadingNumbers (#198, Tier-3). Auto-number sections and rewrite auto-filled
 * `</#id>` cross-references to "Section 1.2 - Title". Render-stage, opt-in, no
 * new syntax (reads headings + the `{.unnumbered}` class). Off by default,
 * never corpus-pinned. See docs/extensions.md §9.
 */
export function headingNumbers(opts: HeadingNumbersOptions = {}): CarveExtension {
  const minLevel = opts.minLevel ?? 1
  const label = opts.label ?? 'Section'
  const crossref = opts.crossref ?? 'number-title'
  // Idempotency: decorating mutates the document, so re-running over the same
  // already-processed doc (a parse-once / render-twice flow) must be a no-op -
  // otherwise spans stack up.
  const processed = new WeakSet<Document>()

  return {
    name: 'headingNumbers',

    beforeRender(doc: Document) {
      if (processed.has(doc)) return doc
      processed.add(doc)
      // Pass 1: number headings in document order, decorate each `<h*>` with a
      // section-number span, and remember number + original title per id.
      // Gap-free stack numbering: `levels`/`numbers` track the current dotted
      // number and the heading level of each part, so skipping a structural
      // level (## -> ####) does not emit empty `0` segments.
      const levels: number[] = []
      const numbers: number[] = []
      const byId = new Map<string, { number: string; title: string }>()
      const seenIds = new Set<string>() // every heading id, for first-id-wins

      walkHeadings(doc.children, false, (h, inBlockquote) => {
        const id = h.attrs?.id
        // An id already claimed by an earlier heading - including a quoted or
        // unnumbered one, both still valid `</#id>` targets - stays the target,
        // matching resolveHeadingIds; don't let a later same-id heading
        // overwrite the rewrite entry.
        const taken = id !== undefined && seenIds.has(id)
        if (id !== undefined) seenIds.add(id)
        // Quoted headings are not the document's own sections: id recorded
        // above (for first-id-wins), but never numbered.
        if (inBlockquote || hasClass(h, 'unnumbered') || h.level < minLevel) return

        const lvl = h.level
        while (levels.length && levels[levels.length - 1]! > lvl) {
          levels.pop()
          numbers.pop()
        }
        if (levels.length && levels[levels.length - 1] === lvl) numbers[numbers.length - 1]!++
        else {
          levels.push(lvl)
          numbers.push(1)
        }
        const number = numbers.join('.')

        const title = inlineText(h.children) // capture BEFORE injecting the span
        if (id !== undefined && !taken) byId.set(id, { number, title })
        const span: Span = {
          type: 'span',
          attrs: { classes: ['section-number'] },
          children: [{ type: 'text', value: number } as Text],
        } as Span
        h.children = [span, { type: 'text', value: ' ' } as Text, ...h.children]
      })

      // Pass 2: rewrite auto-filled cross-references. Only links resolve()
      // tagged as `</#id>` crossrefs are touched (via the non-rendered
      // `fromCrossref` flag), so ordinary `[text](#id)` links and implicit
      // `[label][]` references keep their text. Skipped for `crossref: 'title'`.
      if (crossref !== 'title')
        walkLinks(doc, (link) => {
          if (!link.fromCrossref || !link.href.startsWith('#')) return
          const entry = byId.get(link.href.slice(1))
          if (!entry) return // crossref to an unnumbered heading: leave the title
          const text =
            crossref === 'number'
              ? `${label} ${entry.number}`
              : `${label} ${entry.number} - ${entry.title}`
          link.children = [{ type: 'text', value: text } as Text]
        })

      return doc
    },
  }
}

function hasClass(h: Heading, cls: string): boolean {
  return !!h.attrs?.classes?.includes(cls)
}

/** Visit every heading in document order, descending into containers but
 *  flagging blockquote descent so quoted headings are skipped (they are not the
 *  document's own sections). */
function walkHeadings(
  nodes: BlockNode[],
  inBlockquote: boolean,
  fn: (h: Heading, inBlockquote: boolean) => void,
): void {
  const descend = (kids: unknown, bq: boolean): void => {
    if (Array.isArray(kids)) walkHeadings(kids as BlockNode[], bq, fn)
  }
  for (const b of nodes) {
    switch (b.type) {
      case 'heading':
        // Quoted headings are passed too (with the flag) so the callback can
        // record their ids for first-id-wins; it skips numbering them.
        fn(b as Heading, inBlockquote)
        break
      case 'blockquote':
        descend((b as { children?: unknown }).children, true)
        break
      case 'list': {
        for (const item of (b as { items?: { children?: unknown }[] }).items ?? [])
          descend(item.children, inBlockquote)
        break
      }
      case 'div':
      case 'admonition':
        descend((b as { children?: unknown }).children, inBlockquote)
        break
      case 'definition-list': {
        for (const item of (b as { items?: { definitions?: unknown[] }[] }).items ?? [])
          for (const def of item.definitions ?? []) descend(def, inBlockquote)
        break
      }
      case 'figure': {
        // The only figure target that can hold a heading is a blockquote; the
        // resolver assigns its heading an id (as a quoted heading), so mirror
        // that descent for first-id-wins. Other targets have no headings.
        const target = (b as { target?: { type?: string; children?: unknown } }).target
        if (target?.type === 'blockquote') descend(target.children, true)
        break
      }
    }
  }
}

/** Depth-first visit of every `link` node anywhere in the tree. Generic field
 *  walk; skips `pos` metadata. */
function walkLinks(node: unknown, fn: (l: Link) => void): void {
  if (!node || typeof node !== 'object') return
  if ((node as { type?: string }).type === 'link') fn(node as Link)
  for (const key of Object.keys(node as Record<string, unknown>)) {
    if (key === 'pos') continue
    const v = (node as Record<string, unknown>)[key]
    if (Array.isArray(v)) for (const el of v) walkLinks(el, fn)
    else if (v && typeof v === 'object') walkLinks(v, fn)
  }
}
