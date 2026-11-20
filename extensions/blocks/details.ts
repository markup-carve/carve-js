import type { ExtensionBundle } from '../../src/extensions/standard/bundle.ts'
import type { Block, BlockExtensionNode, ExtensionClaim, ExtensionDefinition, ExtensionRenderer, ExtensionRenderHost, Inline } from '../../src/index.ts'
import { authorAttrs, withClass } from '../common/attrs.ts'

/** C2-X-042 precedent: the title as a `strong` paragraph, then the body. */
export function titledFallback(title: readonly Inline[], body: readonly Block[]): Block[] {
  const fallback: Block[] = title.length === 0 ? [] : [{ type: 'paragraph', children: [{ type: 'strong', children: structuredClone([...title]) }] }]
  return [...fallback, ...structuredClone([...body])]
}

export function disclosureTransform(name: string) {
  return (claim: ExtensionClaim): BlockExtensionNode | null => {
    if (claim.form !== 'div') return null
    const title = claim.node.title ?? []
    return { type: 'block_extension', name, version: '1', children: [],
      slots: { summary: title, body: claim.body }, fallback: titledFallback(title, claim.body) }
  }
}

export function disclosureDefinition(name: string, source: string): ExtensionDefinition {
  return { name, version: '1', matcher: { form: 'div', name: source }, props: {},
    slots: { summary: { kind: 'inline', optional: true }, body: { kind: 'block' } }, children: 'none',
    transform: disclosureTransform(name) }
}

/** Writes structural lines around a body already rendered at its actual depth. */
export function container(head: string, inner: string, body: string, tail: string, host: ExtensionRenderHost): string {
  const indent = '  '.repeat(host.blockDepth)
  const childIndent = `${indent}  `
  return `${head}\n${childIndent}${inner}` +
    (body === '' ? '' : `\n${childIndent}${body}`) +
    `\n${indent}${tail}`
}

function nodeAttrs(node: BlockExtensionNode, host: ExtensionRenderHost, base?: string): string {
  return authorAttrs(base === undefined ? node.attrs : withClass(node.attrs, base), host) +
    host.attributes(node, { block: true, bare: true })
}

/** The disclosure element of a titled div; `open` is added in static mode unless authored. */
export function renderDisclosure(node: BlockExtensionNode, host: ExtensionRenderHost, label: string, base?: string): string {
  const summary = node.slots?.['summary'] ?? []
  const text = summary.length === 0 ? '' : host.inlines(summary).trim()
  const authoredOpen = node.attrs?.keyValues?.some(([key]) => key.toLowerCase() === 'open') === true
  const open = host.mode === 'static' && !authoredOpen ? ' open' : ''
  return container(`<details${open}${nodeAttrs(node, host, base)}>`, `<summary>${text === '' ? host.escapeText(label) : text}</summary>`,
    host.blocks(node.slots?.['body'] ?? [], host.blockDepth + 1), '</details>', host)
}

export { nodeAttrs }

export const detailsRenderer: ExtensionRenderer = {
  version: '1',
  render: (node, host) => node.type === 'block_extension' ? renderDisclosure(node, host, host.labels['details'] ?? 'Details') : '',
  buildTime: (node, host) => node.type === 'block_extension' ? renderDisclosure(node, host, host.labels['details'] ?? 'Details') : '',
}

/** `::: details "Title"` as a native disclosure; static mode writes it expanded. */
export function details(): ExtensionBundle {
  return { extensions: [disclosureDefinition('carve.details', 'details')], renderers: { 'carve.details': detailsRenderer } }
}
