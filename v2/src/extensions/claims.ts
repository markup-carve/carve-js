import { type Attrs, type BlockExtensionNode, type CodeBlockNode, type DivNode, type DocumentNode, forEachSlot,
  type InlineExtensionNode,
  type Node } from '../ast.ts'
import { plainText } from '../ast-text.ts'
import { type ParsedTree } from '../ast-blocks.ts'
import { write } from '../write.ts'
import { type ExtensionClaim, type ExtensionDefinition, type ExtensionSource } from './types.ts'

function sourceBody(node: DivNode): string {
  const text = write({ type: 'document', astVersion: '2.0', children: [node] })
  const lines = text.split('\n')
  const opener = lines.findIndex((line) => line.startsWith(':::'))
  const body = lines.slice(opener + 1, -2).join('\n')
  return body === '' ? '' : `${body}\n`
}

export function divSource(node: DivNode, name: string): ExtensionSource {
  const source: ExtensionSource = { form: 'div', name, body: sourceBody(node) }
  if (node.title !== undefined) source.title = plainText(node.title)
  if (node.groupLabel !== undefined) source.groupLabel = node.groupLabel
  return source
}

function claim(node: Node, definition: ExtensionDefinition, sourceNames: ReadonlyMap<Node, string> | null): ExtensionClaim | null {
  const matcher = definition.matcher
  if (matcher === undefined) return null
  switch (matcher.form) {
    case 'div': return node.type === 'div' && sourceNames?.get(node) === matcher.name
      ? divClaim(node, matcher.name, sourceNames) : null
    case 'fence': return node.type === 'code_block' && sourceNames?.get(node) === matcher.name
      ? fenceClaim(node, matcher.name) : null
    case 'inline': return node.type === 'inline_extension' && node.name === matcher.name ? inlineClaim(node, matcher.name) : null
  }
}

function divClaim(node: DivNode, name: string, sourceNames: ReadonlyMap<Node, string>): ExtensionClaim {
  return { form: 'div', name, node, body: node.children,
    sourceName: (child) => sourceNames.get(child),
    ...(node.attrs === undefined ? {} : { attrs: node.attrs }),
    ...(node.title === undefined ? {} : { title: plainText(node.title) }),
    ...(node.groupLabel === undefined ? {} : { label: node.groupLabel }), source: divSource(node, name) }
}

function fenceClaim(node: CodeBlockNode, name: string): ExtensionClaim {
  const source: ExtensionSource = { form: 'fence', name, body: node.value }
  if (node.title !== undefined) source.title = plainText(node.title)
  if (node.groupLabel !== undefined) source.groupLabel = node.groupLabel
  return { form: 'fence', name, node, value: node.value, ...(node.attrs === undefined ? {} : { attrs: node.attrs }), source,
    ...(source.title === undefined ? {} : { title: source.title }),
    ...(source.groupLabel === undefined ? {} : { label: source.groupLabel }) }
}

function inlineClaim(node: InlineExtensionNode, name: string): ExtensionClaim {
  const core: InlineExtensionNode = { type: 'inline_extension', name, children: node.children }
  const document: DocumentNode = { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children: [core] }] }
  const written = write(document)
  const source: ExtensionSource = { form: 'inline', name, body: written.slice(name.length + 2, -2) }
  return { form: 'inline', name, node, children: node.children,
    ...(node.attrs === undefined ? {} : { attrs: node.attrs }), source }
}

function replace(node: Node, definitions: readonly ExtensionDefinition[], sourceNames: ReadonlyMap<Node, string> | null): Node {
  for (const definition of definitions) {
    const input = claim(node, definition, sourceNames)
    if (input === null || definition.transform === undefined) continue
    const transformed = definition.transform(input)
    if (transformed === null) continue
    attachClaim(transformed, input, node, definition)
    replaceChildren(transformed, definitions, sourceNames)
    return transformed
  }
  replaceChildren(node, definitions, sourceNames)
  return node
}

function attachClaim(transformed: BlockExtensionNode | InlineExtensionNode,
  input: ExtensionClaim, node: Node, definition: ExtensionDefinition): void {
  if (transformed.name !== definition.name || transformed.version !== definition.version ||
    transformed.type !== (input.form === 'inline' ? 'inline_extension' : 'block_extension')) {
    throw new Error(`invalid transform of ${definition.name}`)
  }
  transformed.source = input.source
  if (input.attrs !== undefined) {
    const attrs = input.form === 'div' ? remainingAttrs(input.attrs) : input.attrs
    if (attrs !== undefined) transformed.attrs = attrs
  }
  if (node.pos !== undefined) transformed.pos = node.pos
}

export function remainingAttrs(attrs: Attrs): Attrs | undefined {
  const classes = attrs.classes?.slice(1)
  if (attrs.id === undefined && attrs.keyValues === undefined && (classes?.length ?? 0) === 0) return undefined
  return { ...(attrs.id === undefined ? {} : { id: attrs.id }),
    ...(attrs.keyValues === undefined ? {} : { keyValues: attrs.keyValues }),
    ...(classes === undefined || classes.length === 0 ? {} : { classes }) }
}

function replaceChildren(node: Node, definitions: readonly ExtensionDefinition[], sourceNames: ReadonlyMap<Node, string> | null): void {
  forEachSlot(node, (nodes, step) => {
    if ((node.type === 'block_extension' || node.type === 'inline_extension') && step === 'fallback') return
    for (const [at, child] of nodes.entries()) Reflect.set(nodes, at, replace(child, definitions, sourceNames))
  })
}

/** C2-X-005: a separate pass claims core nodes after the core parse. */
export function applyExtensions(parsed: ParsedTree, definitions: readonly ExtensionDefinition[]): ParsedTree {
  if (definitions.length === 0) return parsed
  const document = parsed.document
  const sourceNames = parsed.facts?.sourceNames ?? null
  for (const [at, child] of document.children.entries()) Reflect.set(document.children, at, replace(child, definitions, sourceNames))
  const used = new Map<string, string>()
  forEachSlot(document, function collect(nodes) {
    for (const node of nodes) {
      if ((node.type === 'block_extension' || node.type === 'inline_extension') && node.name.includes('.') &&
        node.version !== undefined) used.set(node.name, node.version)
      forEachSlot(node, collect)
    }
  })
  if (used.size > 0) document.extensions = [...used].sort(([a], [b]) => a.localeCompare(b))
    .map(([name, version]) => ({ name, version, required: false }))
  return parsed
}
