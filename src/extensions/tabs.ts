import { type Block, type BlockExtensionNode, type DivNode, type Node } from '../ast.ts'
import { plainText } from '../ast-text.ts'
import { divSource, remainingAttrs } from './claims.ts'
import { type ExtensionClaim, type ExtensionDefinition, type ExtensionRenderer, type ExtensionRenderHost } from './types.ts'
import { append } from '../append.ts'

function tabNode(node: DivNode): BlockExtensionNode {
  const title = node.title ?? []
  const fallback: Block[] = []
  if (title.length > 0) fallback.push({ type: 'paragraph', children: [{ type: 'strong', children: title }] })
  append(fallback, structuredClone(node.children))
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
  const attrs = claim.attrs === undefined ? undefined : remainingAttrs(claim.attrs)
  return { type: 'block_extension', name: 'carve.tabs', version: '1', children: [],
    slots: { tabs }, fallback: structuredClone(tabs.flatMap((tab) => tab.fallback)),
    ...(attrs === undefined ? {} : { attrs }) }
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

function selectedTab(tabs: readonly Node[]): number {
  const marked = tabs.findIndex((tab) => tab.attrs?.keyValues?.some(([key]) => key === 'selected') === true)
  return marked < 0 ? 0 : marked
}

/** C2-X-043: the interactive channel offers CSS radios or semantic ARIA controls. */
export function standardTabsRenderer(options: { mode?: 'css' | 'aria' } = {}): ExtensionRenderer {
  if (options.mode !== undefined && options.mode !== 'css' && options.mode !== 'aria') throw new Error('invalid tabs mode')
  return { version: '1', render: (node, host) => renderTabs(node, host, options.mode ?? 'css'), buildTime: renderStaticTabs }
}

function wrapper(node: BlockExtensionNode, host: ExtensionRenderHost, role: string): string {
  const keyValues: [string, string][] = [...(node.attrs?.keyValues ?? [])]
  const authored = (key: string): boolean => keyValues.some(([name]) => name.toLowerCase() === key)
  if (!authored('role')) keyValues.push(['role', role])
  if (!authored('aria-label') && !authored('aria-labelledby')) {
    const label = host.labels['tabsGroup'] ?? 'Tabs'
    if (label !== '') keyValues.push(['aria-label', label])
  }
  return host.attributes({
    ...node, attrs: { ...(node.attrs ?? {}), classes: ['tabs', ...(node.attrs?.classes ?? [])], keyValues },
  }, { block: true })
}

function renderTab(tab: Node, at: number, selected: number, group: string, mode: 'css' | 'aria', host: ExtensionRenderHost): {
  control: string, panel: string
} {
  if (tab.type !== 'block_extension') return { control: '', panel: '' }
  const title = tab.slots?.['title'] ?? []
  const body = tab.slots?.['body'] ?? []
  const label = title.length === 0 ? `Tab ${at + 1}` : host.plainText(title)
  const shownTitle = title.length === 0 ? host.escapeText(label) : host.inlines(title)
  const id = `${group}-${at}`
  if (mode === 'aria') return {
    control: `<button type="button" role="tab" id="${id}" aria-selected="${at === selected}" aria-controls="${id}-panel"` +
      `${at === selected ? '' : ' tabindex="-1"'}>${shownTitle}</button>`,
    panel: `<div class="tab-panel" role="tabpanel" id="${id}-panel" aria-labelledby="${id}"` +
      `${at === selected ? '' : ' hidden'}>${host.blocks(body)}</div>`,
  }
  return {
    control: `<input type="radio" name="${group}" id="${id}"${at === selected ? ' checked' : ''}>` +
      `<label for="${id}">${shownTitle}</label>`,
    panel: `<div class="tab-panel" role="group" aria-label="${host.escapeAttribute(label)}">${host.blocks(body)}</div>`,
  }
}

function renderTabs(node: BlockExtensionNode | { type: 'inline_extension' }, host: ExtensionRenderHost, mode: 'css' | 'aria'): string {
  if (node.type !== 'block_extension') return ''
  const tabs = node.slots?.['tabs'] ?? []
  const suffixes = tabs.flatMap((_, at) => mode === 'aria' ? [`-${at}`, `-${at}-panel`] : [`-${at}`])
  const group = host.nextId('tabs', suffixes)
  const selected = selectedTab(tabs)
  let controls = ''
  let panels = ''
  for (let at = 0; at < tabs.length; at++) {
    const tab = tabs[at]
    if (tab === undefined) continue
    const rendered = renderTab(tab, at, selected, group, mode, host)
    controls += rendered.control
    panels += rendered.panel
  }
  return `<div${wrapper(node, host, mode === 'aria' ? 'tablist' : 'group')}>${controls}${panels}</div>`
}

/** C2-X-043: static tabs render as self-contained sections without controls or generated ids. */
function renderStaticTabs(node: BlockExtensionNode | { type: 'inline_extension' }, host: ExtensionRenderHost): string {
  if (node.type !== 'block_extension') return ''
  const tabs = node.slots?.['tabs'] ?? []
  let sections = ''
  for (const tab of tabs) {
    if (tab?.type !== 'block_extension') continue
    const title = tab.slots?.['title'] ?? []
    const body = tab.slots?.['body'] ?? []
    sections += `<section class="tabs-panel"><h3 class="tabs-label">${host.inlines(title)}</h3>${host.blocks(body)}</section>`
  }
  return `<div${wrapper(node, host, 'group')}>${sections}</div>`
}

/** C2-X-043 to C2-X-048: both channels keep all panel content. */
export const tabsRenderer: ExtensionRenderer = standardTabsRenderer()
