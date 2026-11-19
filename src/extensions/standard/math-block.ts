import type { BlockExtensionNode, InlineExtensionNode, Node } from '../../ast.ts'
import type { ExtensionClaim, ExtensionRenderer, ExtensionRenderHost } from '../types.ts'
import type { ExtensionBundle } from './bundle.ts'
import { bareFallback, fenceSource } from './fenced-render.ts'

export interface MathBlockOptions {
  /** Fence language that marks a display-math block. Default `math`. */
  language?: string
  /** C2-X-052: server-side math (MathML or HTML) for static mode; without it static mode writes the fallback. */
  build?: (tex: string, display: boolean) => string
}

function transform(claim: ExtensionClaim): BlockExtensionNode | null {
  if (claim.form !== 'fence') return null
  return { type: 'block_extension', name: 'carve.mathBlock', version: '1', children: [],
    payload: [{ format: 'application/x-tex', value: claim.value }], fallback: [bareFallback(claim.node)] }
}

function tex(node: BlockExtensionNode | InlineExtensionNode): string {
  const value = node.payload?.[0]?.value
  return typeof value === 'string' ? fenceSource(value) : ''
}

function open(node: Node, host: ExtensionRenderHost): string {
  const keyValues = [...(node.attrs?.keyValues ?? [])]
  if (!keyValues.some(([name]) => name.toLowerCase() === 'role')) keyValues.push(['role', 'math'])
  return `<div${host.attributes({ ...node, attrs: { ...node.attrs, classes: ['math', 'display', ...(node.attrs?.classes ?? [])],
    keyValues } } as Node,
    { block: true })}>`
}

/** A `math` fence as `<div class="math display">\[…\]</div>`, the delimiters KaTeX and MathJax read for `$$` math. */
export function mathBlock(options: MathBlockOptions = {}): ExtensionBundle {
  const language = options.language ?? 'math'
  const build = options.build
  const renderer: ExtensionRenderer = {
    version: '1',
    render: (node, host) => `${open(node, host)}\\[${host.escapeText(tex(node))}\\]</div>`,
    ...(build === undefined ? {} : {
      buildTime: (node: BlockExtensionNode | InlineExtensionNode, host: ExtensionRenderHost) =>
        `${open(node, host)}${build(tex(node), true)}</div>`,
    }),
  }
  return {
    extensions: [{ name: 'carve.mathBlock', version: '1', matcher: { form: 'fence', name: language }, props: {}, slots: {},
      children: 'none', transform }],
    renderers: { 'carve.mathBlock': renderer },
  }
}
