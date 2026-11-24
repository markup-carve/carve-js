import { type DocumentNode, type Inline, type Node } from '../../ast.ts'
import { type ExtensionDefinition } from '../types.ts'
import { chrome, declare, derivedInlines, freezeCrossReferences, freezeReferences, headingId, headingReferences, headingTexts, pinId,
  rewriteTree, visitTree } from './common.ts'

/** Options of {@link headingPermalinks}. */
export interface HeadingPermalinksOptions {
  /** Anchor text. Default `'¶'`. */
  symbol?: string
  /** Class of the anchor. Default `'permalink'`. */
  cssClass?: string
  /** `aria-label` of the anchor. Default `'Permalink'`. */
  ariaLabel?: string
  /** Heading levels that get an anchor. Default all. */
  levels?: number[]
  /** Puts the anchor before the heading text. Default false. */
  prepend?: boolean
  /** Wraps the anchor in `<span class="permalink-wrapper permalink-hover">` for a hover style. Default false. */
  showOnHover?: boolean
  /** Adds a `data-permalink-copy` hook for host script. Default false. */
  copyToClipboard?: boolean
}

const PERMALINKS = 'carve.headingPermalinks'

/** Adds a link to its own id to each heading that has one. The anchor is a core link, so no renderer is needed. */
export function headingPermalinks(options: HeadingPermalinksOptions = {}): ExtensionDefinition {
  const levels = options.levels ?? [1, 2, 3, 4, 5, 6]
  return {
    name: PERMALINKS, version: '1', props: {}, slots: {},
    documentTransform(view: DocumentNode): DocumentNode {
      declare(view, PERMALINKS)
      freezeReferences(view, PERMALINKS)
      const texts = headingTexts(view)
      visitTree(view, (node) => {
        if (node.type !== 'heading' || !levels.includes(node.level)) return
        const id = headingId(node)
        if (id === undefined) return
        pinId(node)
        const pairs: [string, string][] = [['aria-label', options.ariaLabel ?? 'Permalink']]
        if (options.copyToClipboard === true) pairs.push(['data-permalink-copy', ''])
        let anchor: Inline = { type: 'link', href: `#${id}`, attrs: { classes: [options.cssClass ?? 'permalink'], keyValues: pairs },
          children: [{ type: 'text', value: options.symbol ?? '¶' }] }
        if (options.showOnHover === true) {
          anchor = { type: 'span', attrs: { classes: ['permalink-wrapper', 'permalink-hover'] }, children: [anchor] }
        }
        const space = chrome({ type: 'text', value: ' ' } as Inline, PERMALINKS)
        chrome(anchor, PERMALINKS)
        if (options.prepend === true) node.children.unshift(anchor, space)
        else node.children.push(space, anchor)
      }, true)
      freezeCrossReferences(view, texts)
      return view
    },
  }
}

/** Options of {@link headingNumbers}. */
export interface HeadingNumbersOptions {
  /** Top numbered heading level (1-6). Default 1; 2 where `#` is the title. */
  minLevel?: number
  /** Word before the number in a cross-reference. Default `'Section'`. */
  label?: string
  /** Text of a cross-reference to a numbered heading. Default `'number-title'`. */
  crossref?: 'number' | 'number-title' | 'title'
}

const NUMBERS = 'carve.headingNumbers'

function hasClass(node: Node, name: string): boolean {
  return node.attrs?.classes?.includes(name) === true
}

/**
 * Numbers the sections, `1`, `1.1` and so on, in a `<span class="section-number">` before the heading text, and writes
 * a cross-reference `</#id>` to a numbered heading as "Section 1.2 - Title". Headings in a quote, with the class
 * `unnumbered` or above `minLevel` take no number.
 */
export function headingNumbers(options: HeadingNumbersOptions = {}): ExtensionDefinition {
  const minLevel = options.minLevel ?? 1
  const label = options.label ?? 'Section'
  const crossref = options.crossref ?? 'number-title'
  return {
    name: NUMBERS, version: '1', props: {}, slots: {},
    documentTransform(view: DocumentNode): DocumentNode {
      declare(view, NUMBERS)
      freezeReferences(view, NUMBERS)
      const texts = headingTexts(view)
      const levels: number[] = []
      const numbers: number[] = []
      const byId = new Map<string, { number: string, title: Inline[] }>()
      // carve#6531: only top-level headings, the ones a section wraps (C2-H-026), and a number counts depth, not level.
      for (const node of view.children) {
        if (node.type !== 'heading' || hasClass(node, 'unnumbered') || node.level < minLevel) continue
        let closed: number | undefined
        while (levels.length > 0 && levels[levels.length - 1]! > node.level) {
          levels.pop()
          closed = numbers.pop()
        }
        if (levels.length > 0 && levels[levels.length - 1] === node.level) numbers[numbers.length - 1]!++
        else {
          levels.push(node.level)
          numbers.push(closed === undefined ? 1 : closed + 1)
        }
        const number = numbers.join('.')
        const id = headingId(node)
        if (id !== undefined && !byId.has(id)) byId.set(id, { number, title: derivedInlines(node.children) })
        pinId(node)
        const span = chrome({ type: 'span', attrs: { classes: ['section-number'] }, children: [{ type: 'text', value: number }] } as Inline,
          NUMBERS)
        node.children.unshift(span, chrome({ type: 'text', value: ' ' } as Inline, NUMBERS))
      }
      if (crossref !== 'title' && byId.size > 0) rewriteTree(view, (node) => {
        if (node.type !== 'xref' || node.namespace !== 'heading') return undefined
        if (node.display !== undefined && node.display !== 'title') return undefined
        const target = byId.get(node.key)
        if (target === undefined) return undefined
        const children: Inline[] = crossref === 'number'
          ? [{ type: 'text', value: `${label} ${target.number}` }]
          : [{ type: 'text', value: `${label} ${target.number} - ` }, ...structuredClone(target.title)]
        const link: Inline = { type: 'link', href: `#${node.key}`, children }
        if (node.attrs !== undefined) link.attrs = node.attrs
        return [link]
      }, true)
      freezeCrossReferences(view, texts)
      return view
    },
  }
}

/** Options of {@link headingReference}. */
export interface HeadingReferenceOptions {
  /** Classes of a link that a heading resolves. Default `'heading-ref'`. */
  cssClass?: string
}

/**
 * Gives the class `heading-ref` to each reference link that a heading resolves (`[Heading][]`, `[text][Heading]`,
 * C2-H-083). The 0.1 `[[Heading]]` spelling is gone: 0.2 adds no delimiter for it (C2-X-013, C2-X-057).
 */
export function headingReference(options: HeadingReferenceOptions = {}): ExtensionDefinition {
  const classes = (options.cssClass ?? 'heading-ref').split(' ').filter((name) => name !== '')
  return {
    name: 'carve.headingReference', version: '1', props: {}, slots: {},
    documentTransform(view: DocumentNode): DocumentNode {
      for (const link of headingReferences(view)) {
        const own = link.attrs?.classes ?? []
        link.attrs = { ...link.attrs, classes: [...own, ...classes.filter((name) => !own.includes(name))] }
      }
      return view
    },
  }
}
