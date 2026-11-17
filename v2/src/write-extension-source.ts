import { type BlockExtensionNode, type Node } from './ast.ts'
import { isClaimableName } from './ast-validate.ts'
import { format } from './format.ts'

/** C2-X-023: a core readback of the source form is allowed only for its canonical content. */
export function sourceCoreEquivalent(expected: Node, actual: Node | undefined): boolean {
  if (expected.type !== 'block_extension' || actual === undefined) return false
  const source = expected.source
  if (source === undefined || source.form === 'inline' || !isClaimableName(source.form, source.name,
    source.title !== undefined || source.groupLabel !== undefined)) return false
  try { if (format(source.body) !== source.body) return false } catch { return false }
  if (source.form === 'div') return actual.type === 'div' && actual.attrs?.classes?.includes(source.name) === true
  return actual.type === 'code_block' && actual.syntax === source.name
}

export function canonicalExtensionBody(node: BlockExtensionNode): boolean {
  if (node.source === undefined) return false
  try { return format(node.source.body) === node.source.body } catch { return false }
}
