import { type Block, type BlockExtensionNode, type DivNode } from '../ast.ts'
import { plainText } from '../ast-text.ts'
import { divSource, remainingAttrs } from './claims.ts'
import { type ExtensionClaim, type ExtensionDefinition, type ExtensionRenderer } from './types.ts'

function tabNode(node: DivNode): BlockExtensionNode {
  const title = node.title ?? []
  const fallback: Block[] = []
  if (title.length > 0) fallback.push({ type: 'paragraph', children: [{ type: 'strong', children: title }] })
  fallback.push(...structuredClone(node.children))
  const result: BlockExtensionNode = {
    type: 'block_extension', name: 'carve.tab', version: '1', children: [],
    slots: { title, body: node.children }, fallback, source: divSource(node, 'tab'),
  }
  if (node.pos !== undefined) result.pos = node.pos
  const attrs = node.attrs === undefined ? undefined : remainingAttrs(node.attrs)
  if (attrs !== undefined) result.attrs = attrs
  return result
}

function isTab(node: Block, claim: Extract<ExtensionClaim, { form: 'div' }>): node is DivNode {
  return node.type === 'div' && claim.sourceName(node) === 'tab' && node.title !== undefined &&
    plainText(node.title).trim() !== ''
}

function tabsTransform(claim: ExtensionClaim): BlockExtensionNode | null {
  if (claim.form !== 'div' || claim.body.length === 0 || !claim.body.every((node) => isTab(node, claim))) return null
  const tabs = claim.body.filter((node): node is DivNode => isTab(node, claim)).map(tabNode)
  return { type: 'block_extension', name: 'carve.tabs', version: '1', children: [],
    slots: { tabs }, fallback: structuredClone(tabs.flatMap((tab) => tab.fallback)) }
}

/** C2-X-039 to C2-X-042: the standard extension uses the same registration shape as a host extension. */
export const tabExtension: ExtensionDefinition = {
  name: 'carve.tab', version: '1', parent: { name: 'carve.tabs', slot: 'tabs' }, props: {},
  children: 'none',
  slots: { title: { kind: 'inline', optional: true }, body: { kind: 'block' } },
}

export const tabsExtension: ExtensionDefinition = {
  name: 'carve.tabs', version: '1', matcher: { form: 'div', name: 'tabs' }, props: {},
  children: 'none',
  slots: { tabs: { kind: 'block_extension', name: 'carve.tab', minItems: 1 } }, transform: tabsTransform,
}

export const tabsExtensions: readonly ExtensionDefinition[] = [tabExtension, tabsExtension]

function renderTabs(node: BlockExtensionNode | { type: 'inline_extension' }, host: Parameters<ExtensionRenderer['render']>[1]): string {
  if (node.type !== 'block_extension') return ''
  const tabs = node.slots?.['tabs'] ?? []
  const group = host.nextId('tabs')
  let controls = ''
  let panels = ''
  for (let at = 0; at < tabs.length; at++) {
    const tab = tabs[at]
    if (tab?.type !== 'block_extension') continue
    const title = tab.slots?.['title'] ?? []
    const body = tab.slots?.['body'] ?? []
    const label = title.length === 0 ? `Tab ${at + 1}` : host.plainText(title)
    const id = `${group}-${at}`
    controls += `<input type="radio" name="${group}" id="${id}"${at === 0 ? ' checked' : ''}>`
    controls += `<label for="${id}">${title.length === 0 ? host.escapeText(label) : host.inlines(title)}</label>`
    panels += `<div class="tab-panel" role="group" aria-label="${host.escapeAttribute(label)}">${host.blocks(body)}</div>`
  }
  return `<div class="tabs" role="group" aria-label="Tabs">${controls}${panels}</div>`
}

/** C2-X-043 to C2-X-048: all panel content is present in static HTML. */
export const tabsRenderer: ExtensionRenderer = { version: '1', render: renderTabs }
