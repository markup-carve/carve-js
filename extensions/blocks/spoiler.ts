import type { ExtensionBundle } from '../../src/extensions/standard/bundle.ts'
import type { ExtensionClaim, ExtensionDefinition, ExtensionRenderer, InlineExtensionNode } from '../../src/index.ts'
import { authorAttrs, withClass } from '../common/attrs.ts'
import { container, disclosureDefinition, nodeAttrs, renderDisclosure } from './details.ts'

function inlineTransform(claim: ExtensionClaim): InlineExtensionNode | null {
  if (claim.form !== 'inline') return null
  return { type: 'inline_extension', name: 'carve.spoiler', version: '1', children: [],
    slots: { content: claim.children }, fallback: structuredClone(claim.children) }
}

const inlineRenderer: ExtensionRenderer = {
  version: '1',
  render: (node, host) => `<span${authorAttrs(withClass(node.attrs, 'spoiler'), host)}>${host.inlines(node.slots?.['content'] ?? [])}</span>`,
  // Hiding means nothing offline, so static output is revealed.
  buildTime: (node, host) => `<span${authorAttrs(withClass(withClass(node.attrs, 'spoiler-revealed'), 'spoiler'), host)}>` +
    `${host.inlines(node.slots?.['content'] ?? [])}</span>`,
}

const blockRenderer: ExtensionRenderer = {
  version: '1',
  render: (node, host) => node.type === 'block_extension'
    ? renderDisclosure(node, host, host.labels['spoiler'] ?? 'Spoiler', 'spoiler') : '',
  buildTime(node, host) {
    if (node.type !== 'block_extension') return ''
    const summary = node.slots?.['summary'] ?? []
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
