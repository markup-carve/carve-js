import type { Attrs, Block, BlockExtensionNode, CodeBlockNode, InlineExtensionNode, Node } from '../../ast.ts'
import type { ExtensionClaim, ExtensionRenderer, ExtensionRenderHost } from '../types.ts'
import type { ExtensionBundle } from './bundle.ts'

export interface CodeGroupOptions {
  /** `css` (default): radio inputs, no script. `aria`: tab roles, needs a script to switch panels. */
  mode?: 'css' | 'aria'
  wrapperClass?: string
  panelClass?: string
  labelClass?: string
  radioClass?: string
  /** Prefix of the generated ids. Default `codegroup`. */
  idPrefix?: string
  /** Name of the group; default the `codeGroup` label (C2-H-125). */
  groupLabel?: string
  /** Replaces the core code block HTML of a panel. */
  highlighter?: (code: string, language: string | undefined) => string
}

/** `node` is what the panel renders: the code block, or a node a document transform put in its place. */
interface Panel { block: CodeBlockNode, node: Block, label: string, selected: boolean }

function transform(claim: ExtensionClaim): BlockExtensionNode | null {
  if (claim.form !== 'div') return null
  const panels = claim.body.filter((node) => node.type !== 'comment')
  // Like tabs (C2-X-040): other blocks keep the div, so no authored content is dropped.
  if (panels.length === 0 || !panels.every((node) => node.type === 'code_block')) return null
  return { type: 'block_extension', name: 'carve.codeGroup', version: '1', children: [], slots: { panels },
    fallback: structuredClone(claim.body) }
}

/** The code block of a panel; a transform such as codeCallouts may have replaced it by a node with it as fallback. */
function codeOf(node: Node): CodeBlockNode | null {
  if (node.type === 'code_block') return node
  const code = node.type === 'block_extension' && node.fallback.length === 1 ? node.fallback[0] : undefined
  return code?.type === 'code_block' ? { ...code, ...(node.attrs === undefined ? {} : { attrs: node.attrs }) } : null
}

function panelsOf(node: BlockExtensionNode | InlineExtensionNode, host: ExtensionRenderHost): Panel[] {
  const panels: Panel[] = []
  for (const child of node.slots?.['panels'] ?? []) {
    const block = codeOf(child)
    if (block === null) continue
    const title = block.title === undefined ? '' : host.plainText(block.title).trim()
    const label = block.groupLabel?.trim() || title || block.syntax || `Code ${panels.length + 1}`
    panels.push({ block, node: child as Block, label, selected: false })
  }
  const marked = panels.findIndex((panel) => panel.block.attrs?.keyValues?.some(([key]) => key === 'selected') === true)
  const selected = panels[marked < 0 ? 0 : marked]
  if (selected !== undefined) selected.selected = true
  return panels
}

function withoutSelected(node: Block): Block {
  const keyValues = node.attrs?.keyValues
  if (keyValues === undefined || !keyValues.some(([key]) => key === 'selected')) return node
  const rest = keyValues.filter(([key]) => key !== 'selected')
  const attrs: Attrs = { ...node.attrs }
  if (rest.length === 0) delete attrs.keyValues
  else attrs.keyValues = rest
  return { ...node, attrs }
}

function authored(attrs: Attrs | undefined, name: string): boolean {
  return attrs?.keyValues?.some(([key]) => key.toLowerCase() === name) === true
}

/** `::: code-group` of code blocks as one switcher with a panel per block. */
export function codeGroup(options: CodeGroupOptions = {}): ExtensionBundle {
  const mode = options.mode ?? 'css'
  if (mode !== 'css' && mode !== 'aria') throw new Error(`codeGroup: unknown mode ${String(mode)}`)
  const wrapperClass = options.wrapperClass ?? 'code-group'
  const panelClass = options.panelClass ?? 'code-group-panel'
  const labelClass = options.labelClass ?? 'code-group-label'
  const radioClass = options.radioClass ?? 'code-group-radio'
  const idPrefix = options.idPrefix ?? 'codegroup'

  const wrapper = (node: Node, host: ExtensionRenderHost, role: string): string => {
    const attrs = node.attrs
    const name = options.groupLabel ?? host.labels['codeGroup'] ?? 'Code examples'
    const keyValues: [string, string][] = [...(attrs?.keyValues ?? [])]
    if (!authored(attrs, 'role')) keyValues.push(['role', role])
    if (name !== '' && !authored(attrs, 'aria-label') && !authored(attrs, 'aria-labelledby')) keyValues.push(['aria-label', name])
    const classes = [wrapperClass, ...(attrs?.classes ?? []).filter((name) => name !== wrapperClass)]
    return `<div${host.attributes({ ...node, attrs: { ...(attrs?.id === undefined ? {} : { id: attrs.id }), classes, keyValues } } as Node,
      { block: true })}>`
  }
  const code = (panel: Panel, host: ExtensionRenderHost): string => {
    if (options.highlighter !== undefined) {
      return options.highlighter(panel.block.value.replace(/\n+$/, ''), panel.block.syntax)
    }
    return host.blocks([withoutSelected(panel.node)])
  }
  const attr = (host: ExtensionRenderHost, value: string): string => host.escapeAttribute(value)

  const renderCss = (node: BlockExtensionNode | InlineExtensionNode, host: ExtensionRenderHost): string => {
    const panels = panelsOf(node, host)
    const group = host.nextId(idPrefix)
    let controls = ''
    let bodies = ''
    for (const [at, panel] of panels.entries()) {
      const id = `${group}-tab-${at + 1}`
      controls += `<input type="radio" name="${attr(host, group)}" id="${attr(host, id)}" class="${attr(host, radioClass)}"` +
        `${panel.selected ? ' checked' : ''}><label for="${attr(host, id)}" class="${attr(host, labelClass)}">` +
        `${host.escapeText(panel.label)}</label>`
      bodies += `<div class="${attr(host, panelClass)}" role="group" aria-label="${attr(host, panel.label)}">` +
        `${code(panel, host)}</div>`
    }
    return `${wrapper(node, host, 'group')}${controls}${bodies}</div>`
  }

  const renderAria = (node: BlockExtensionNode | InlineExtensionNode, host: ExtensionRenderHost): string => {
    const panels = panelsOf(node, host)
    const group = host.nextId(idPrefix)
    let controls = ''
    let bodies = ''
    for (const [at, panel] of panels.entries()) {
      const tab = `${group}-tab-${at + 1}`
      const body = `${group}-panel-${at + 1}`
      // `type="button"`: a bare button inside a form would submit it.
      controls += `<button type="button" role="tab" id="${attr(host, tab)}" aria-selected="${String(panel.selected)}" ` +
        `aria-controls="${attr(host, body)}" class="${attr(host, labelClass)}"${panel.selected ? '' : ' tabindex="-1"'}>` +
        `${host.escapeText(panel.label)}</button>`
      bodies += `<div role="tabpanel" id="${attr(host, body)}" aria-labelledby="${attr(host, tab)}" ` +
        `class="${attr(host, panelClass)}"${panel.selected ? '' : ' hidden'}>${code(panel, host)}</div>`
    }
    return `${wrapper(node, host, 'tablist')}${controls}${bodies}</div>`
  }

  /** C2-X-052: self-contained; one section per panel headed by its label, no controls and no generated ids. */
  const renderStatic = (node: BlockExtensionNode | InlineExtensionNode, host: ExtensionRenderHost): string => {
    let sections = ''
    for (const panel of panelsOf(node, host)) {
      sections += `<section class="${attr(host, panelClass)}"><h3 class="${attr(host, labelClass)}">` +
        `${host.escapeText(panel.label)}</h3>${code(panel, host)}</section>`
    }
    return `${wrapper(node, host, 'group')}${sections}</div>`
  }

  const renderer: ExtensionRenderer = { version: '1', render: mode === 'aria' ? renderAria : renderCss, buildTime: renderStatic }
  return {
    extensions: [{ name: 'carve.codeGroup', version: '1', matcher: { form: 'div', name: 'code-group' }, props: {},
      slots: { panels: { kind: 'block', minItems: 1 } }, children: 'none', transform }],
    renderers: { 'carve.codeGroup': renderer },
  }
}
