import { type Attrs, type Block, type BlockExtensionNode, type CodeBlockNode, type DivNode,
  type Inline, type InlineExtensionNode, type Node } from '../ast.ts'
import { type Profile, type UrlPolicy } from '../options.ts'

export interface ExtensionSource {
  form: 'inline' | 'div' | 'fence'
  name: string
  body: string
  title?: string
  groupLabel?: string
}

export interface ExtensionSlot {
  kind: 'block' | 'inline' | 'block_extension' | 'inline_extension'
  name?: string
  optional?: boolean
  minItems?: number
}

export type ExtensionClaim =
  | { form: 'div', name: string, title?: string, label?: string, attrs?: Attrs, body: Block[], node: DivNode,
    source: ExtensionSource, sourceName: (node: Block) => string | undefined }
  | { form: 'fence', name: string, title?: string, label?: string, attrs?: Attrs, value: string, node: CodeBlockNode,
    source: ExtensionSource }
  | { form: 'inline', name: string, attrs?: Attrs, children: Inline[], node: InlineExtensionNode,
    source: ExtensionSource }

export interface ExtensionDefinition {
  name: string
  version: string
  matcher?: { form: ExtensionSource['form'], name: string }
  props: Readonly<Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array'>>
  slots: Readonly<Record<string, ExtensionSlot>>
  children?: 'none'
  transform?: (claim: ExtensionClaim) => BlockExtensionNode | InlineExtensionNode | null
  parent?: { name: string, slot: string }
}

export interface ExtensionRenderHost {
  blocks(nodes: readonly Node[]): string
  inlines(nodes: readonly Node[]): string
  plainText(nodes: readonly Node[]): string
  escapeText(value: string): string
  escapeAttribute(value: string): string
  nextId(prefix: string): string
  profile: Profile
  urlPolicy: UrlPolicy
}

export interface ExtensionRenderer {
  version: string
  render: (node: BlockExtensionNode | InlineExtensionNode, host: ExtensionRenderHost) => string
}
