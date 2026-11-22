import { type BlockExtensionNode, type Inline, type InlineExtensionNode, type Node } from './ast.ts'
import { treesEqual } from './ast-json.ts'
import { isClaimableName } from './ast-validate.ts'
import { parse } from './api.ts'
import { format } from './format.ts'
import { buildSource } from './ast-blocks.ts'
import { writeWithLinkKeys } from './write.ts'

/** C2-X-023: a core readback of the source form is allowed only for its canonical content. */
export function sourceCoreEquivalent(expected: Node, actual: Node | undefined): boolean {
  if (actual === undefined) return false
  if (expected.type === 'inline_extension') return inlineSourceEquivalent(expected, actual)
  if (expected.type !== 'block_extension') return false
  const source = expected.source
  if (source === undefined || source.form === 'inline' || !isClaimableName(source.form, source.name,
    source.title !== undefined || source.groupLabel !== undefined)) return false
  try { if (format(source.body) !== source.body) return false } catch { return false }
  return sameCoreNode(source, actual)
}

function inlineSourceEquivalent(expected: InlineExtensionNode, actual: Node): boolean {
  const core = coreInline(expected)
  return core !== undefined && treesEqual(core, actual)
}

/** The inline source form reads back as the core inline extension of that name, with the attributes and the body. */
function coreInline(node: InlineExtensionNode): InlineExtensionNode | undefined {
  const source = node.source
  if (source?.form !== 'inline') return undefined
  const children = bodyInlines(source.body)
  if (children === undefined) return undefined
  return { type: 'inline_extension', name: source.name, children, ...(node.attrs === undefined ? {} : { attrs: node.attrs }) }
}

/** `tree` with each inline extension that has an inline source form replaced by its core readback, if there is one. */
export function withCoreInlines(tree: Node): Node | undefined {
  let changed = false
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk)
    if (value === null || typeof value !== 'object') return value
    const node = value as Record<string, unknown>
    if (node['type'] === 'inline_extension') {
      const core = coreInline(node as unknown as InlineExtensionNode)
      if (core !== undefined) { changed = true; return core }
    }
    return Object.fromEntries(Object.entries(node).map(([key, field]) => [key, walk(field)]))
  }
  const result = walk(tree) as Node
  return changed ? result : undefined
}

const BODIES = new Map<string, Inline[] | undefined>()

/** The readback asks for one body many times, so the last few are kept. */
function bodyInlines(body: string): Inline[] | undefined {
  if (BODIES.has(body)) return BODIES.get(body)
  let content: Inline[] | undefined
  try {
    const blocks = parse(body, { positions: false }).children
    const [first] = blocks
    content = blocks.length === 0 ? [] : blocks.length === 1 && first?.type === 'paragraph' ? first.children : undefined
  } catch { content = undefined }
  if (BODIES.size === 64) BODIES.delete(BODIES.keys().next().value!)
  BODIES.set(body, content)
  return content
}

function sameCoreNode(source: BlockExtensionNode['source'], actual: Node): boolean {
  if (source === undefined) return false
  if (source.form !== 'div') return actual.type === 'code_block' && actual.syntax === source.name && actual.value === source.body
  return actual.type === 'div' && actual.attrs?.classes?.includes(source.name) === true
    && divBodyEquals(source.body, actual.children)
}

function divBodyEquals(body: string, actual: readonly Node[]): boolean {
  try {
    const children = parse(body, { positions: false }).children
    return children.length === actual.length && children.every((child, at) => treesEqual(child, actual[at]!))
  } catch { return false }
}

export function canonicalExtensionBody(node: BlockExtensionNode, linkKeys: ReadonlySet<string>): boolean {
  if (node.source === undefined) return false
  try {
    if (linkKeys.size === 0) return format(node.source.body) === node.source.body
    const body = buildSource(node.source.body, false, null, null, false, linkKeys).document
    return writeWithLinkKeys(body, linkKeys) === node.source.body
  } catch { return false }
}
