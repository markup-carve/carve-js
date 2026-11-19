import { type Attrs, type Block, type BlockExtensionNode, type CodeBlockNode, type DivNode, type DocumentNode,
  type Inline, type InlineExtensionNode, type Node } from '../ast.ts'
import { type Mode, type Profile, type UrlPolicy } from '../options.ts'

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
  /**
   * Provisional (carve-js#5060): the semantic span keys from inside out, each with the attribute a value maps to.
   * The list holds `abbr`, `time` and `kbd` and replaces their order (C2-H-075).
   */
  semanticKeys?: readonly (readonly [string, string | null])[]
  /** Provisional: the opening and closing double, then single, quote glyphs that smart typography writes. */
  quotes?: readonly [string, string, string, string]
  /** C2-X-053: a document transform the extension registers; it runs in registration order on the render view. */
  documentTransform?: (view: DocumentNode) => DocumentNode
}

export interface ExtensionRenderHost {
  blocks(nodes: readonly Node[]): string
  inlines(nodes: readonly Node[]): string
  plainText(nodes: readonly Node[]): string
  escapeText(value: string): string
  escapeAttribute(value: string): string
  /** C2-X-033: writes authored attributes and the generated source line of a block element. */
  attributes(node: Node | null, options?: { block?: boolean; bare?: boolean }): string
  nextId(prefix: string, writtenSuffixes?: readonly string[]): string
  labels: Readonly<Record<string, string>>
  profile: Profile
  mode: Mode
  urlPolicy: UrlPolicy
  sourceLines: boolean
  /** C2-H-042: indentation level of the current block, in two-space units. */
  blockDepth: number
}

export interface ExtensionRenderer {
  version: string
  /** C2-X-034: trusted host code; returned HTML is inserted unchanged. Hosts register trusted renderers for untrusted input. */
  render?: (node: BlockExtensionNode | InlineExtensionNode, host: ExtensionRenderHost) => string
  /** C2-X-052: explicitly registered self-contained output for static mode. */
  buildTime?: (node: BlockExtensionNode | InlineExtensionNode, host: ExtensionRenderHost) => string
}
