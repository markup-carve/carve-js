import { type ExtensionDefinition, type ExtensionRenderer } from '../../src/index.ts'

export const calloutExtension: ExtensionDefinition = {
  name: 'test.callout', version: '1', matcher: { form: 'inline', name: 'callout' },
  props: { tone: 'string' }, slots: { label: { kind: 'inline' } },
  transform: (claim) => claim.form === 'inline' ? {
    type: 'inline_extension', name: 'test.callout', version: '1', children: [], props: { tone: 'note' },
    slots: { label: claim.children }, fallback: structuredClone(claim.children),
  } : null,
}

export const diagramExtension: ExtensionDefinition = {
  name: 'test.diagram', version: '1', matcher: { form: 'fence', name: 'diagram' },
  props: { language: 'string' }, slots: {},
  transform: (claim) => claim.form === 'fence' ? {
    type: 'block_extension', name: 'test.diagram', version: '1', children: [], props: { language: claim.name },
    fallback: [{ type: 'code_block', syntax: claim.name, value: claim.value }],
    payload: [{ format: 'text/plain', value: claim.value }],
  } : null,
}

export const calloutRenderer: ExtensionRenderer = {
  version: '1', render: (node, host) => `<span class="callout">${host.inlines(node.slots?.['label'] ?? [])}</span>`,
}

export const diagramRenderer: ExtensionRenderer = {
  version: '1', render: (node, host) => `<figure class="diagram">${host.escapeText(
    node.payload?.[0]?.value === undefined ? '' : String(node.payload[0].value),
  )}</figure>`,
}
