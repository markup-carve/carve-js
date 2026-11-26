import type { ExtensionBundle } from '../../src/extensions/standard/bundle.ts'
import type { ExtensionClaim, ExtensionDefinition, ExtensionRenderer, ExtensionRenderHost, InlineExtensionNode } from '../../src/index.ts'
import { authorAttrs, withClass } from '../common/attrs.ts'
import { container, disclosureDefinition, disclosureTitle, nodeAttrs, renderDisclosure } from './details.ts'

function inlineTransform(claim: ExtensionClaim): InlineExtensionNode | null {
  if (claim.form !== 'inline') return null
  return { type: 'inline_extension', name: 'carve.spoiler', version: '1', children: [],
    slots: { content: claim.children }, fallback: structuredClone(claim.children) }
}

// The catalog's `carve.spoiler` has no slots; its fallback is the content (C2-X-064).
function content(node: Parameters<NonNullable<ExtensionRenderer['render']>>[0], host: ExtensionRenderHost): string {
  return host.inlines(node.slots?.['content'] ?? (node.type === 'inline_extension' ? node.fallback ?? [] : []))
}

const inlineRenderer: ExtensionRenderer = {
  version: '1',
  render: (node, host) => `<span${authorAttrs(withClass(node.attrs, 'spoiler'), host)}>${content(node, host)}</span>`,
  // Hiding means nothing offline, so static output is revealed.
  buildTime: (node, host) => `<span${authorAttrs(withClass(withClass(node.attrs, 'spoiler-revealed'), 'spoiler'), host)}>` +
    `${content(node, host)}</span>`,
}

const blockRenderer: ExtensionRenderer = {
  version: '1',
  render: (node, host) => node.type === 'block_extension'
    ? renderDisclosure(node, host, host.labels['spoiler'] ?? 'Spoiler', 'spoiler') : '',
  buildTime(node, host) {
    if (node.type !== 'block_extension') return ''
    const summary = disclosureTitle(node)
    const title = summary.length === 0 ? '' : host.inlines(summary).trim()
    const heading = `<h3 class="spoiler-title">${title === '' ? host.escapeText(host.labels['spoiler'] ?? 'Spoiler') : title}</h3>`
    const base = { ...node, attrs: withClass(node.attrs, 'spoiler-revealed') }
    return container(`<section${nodeAttrs(base, host, 'spoiler')}>`, heading,
      host.blocks(node.slots?.['body'] ?? [], host.blockDepth + 1), '</section>', host)
  },
}

/** `:spoiler[text]` and `::: spoiler "Title"`: hidden by the host stylesheet or a disclosure, revealed in static mode. */
export function spoiler(): ExtensionBundle {
  const inline: ExtensionDefinition = { name: 'carve.spoiler', version: '1', matcher: { form: 'inline', name: 'spoiler' }, props: {},
    slots: { content: { kind: 'inline' } }, children: 'none', transform: inlineTransform }
  return { extensions: [inline, disclosureDefinition('carve.spoilerBlock', 'spoiler')],
    renderers: { 'carve.spoiler': inlineRenderer, 'carve.spoilerBlock': blockRenderer } }
}
