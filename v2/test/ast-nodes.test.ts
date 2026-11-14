// The node interfaces of src/ast-nodes.ts are written from the node table the validator reads, so
// the interfaces and the validator name the same node types and fields.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { generateAstNodes, interfaceName } from '../scripts/generate-ast-nodes.ts'
import { NODE_TABLE } from '../src/ast-validate.ts'

const source = readFileSync(join(import.meta.dirname, '../src/ast-nodes.ts'), 'utf8')

it('src/ast-nodes.ts is what scripts/generate-ast-nodes.ts writes', () => {
  expect(source).toBe(generateAstNodes())
})

it('each node type of the validator has an interface with exactly its fields', () => {
  for (const [type, [content, required, optional]] of NODE_TABLE.RULES) {
    const body = new RegExp(`export interface ${interfaceName(type)} extends NodeBase \\{\\n([\\s\\S]*?)\\n\\}`).exec(source)
    expect(body, type).not.toBeNull()
    const fields = body![1]!.split('\n').map((line) => line.trim().split(':')[0]!)
    const expected = ['type', ...(content === 'none' ? [] : ['children']), ...required, ...optional.map((name) => `${name}?`)]
    expect(fields, type).toEqual(expected)
  }
})
