import { type BlockExtensionNode, type Node } from './ast.ts'
import { treesEqual } from './ast-json.ts'
import { isClaimableName } from './ast-validate.ts'
import { parse } from './api.ts'
import { format } from './format.ts'

/** C2-X-023: a core readback of the source form is allowed only for its canonical content. */
export function sourceCoreEquivalent(expected: Node, actual: Node | undefined): boolean {
  if (expected.type !== 'block_extension' || actual === undefined) return false
  const source = expected.source
  if (source === undefined || source.form === 'inline' || !isClaimableName(source.form, source.name,
    source.title !== undefined || source.groupLabel !== undefined)) return false
  try { if (format(source.body) !== source.body) return false } catch { return false }
  return sameCoreNode(source, actual)
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

export function canonicalExtensionBody(node: BlockExtensionNode): boolean {
  if (node.source === undefined) return false
  try { return format(node.source.body) === node.source.body } catch { return false }
}
