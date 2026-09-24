import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fromAstJson, AstJsonSchemaError, AstJsonUnknownNodeTypeError } from '../src/ast-json.js'
import { NODE_POSITION_KIND, NODE_POSITION_TYPES } from '../src/wire-fields.js'

/**
 * `line_block.lines` (markup-carve/carve#2226) is an array of ARRAYS of inline
 * nodes, which the kind map had no vocabulary for: every node position that was
 * an array read as `"nodes"`, so the §12(d) walk looked for a node one level
 * too shallow, found an array, and refused the schema's own shape.
 *
 * The spec names the role `node-matrix` in `node-roles.json` for the same
 * reason, and says why: "A walker that only knows node-sequence descends one
 * level and finds arrays where it expects nodes."
 */
describe('a node-matrix position', () => {
  const root = resolve(import.meta.dirname, '..')
  const payload = (lines: unknown) =>
    ({
      type: 'document',
      srcByteLength: 0,
      children: [
        {
          type: 'line_block',
          children: [
            {
              type: 'paragraph',
              children: [
                { type: 'text', value: 'Roses are red' },
                { type: 'hard_break' },
                { type: 'text', value: 'Violets are blue' },
              ],
            },
          ],
          lines,
        },
      ],
    }) as never

  it('is the role the schema gives line_block.lines', () => {
    expect(NODE_POSITION_KIND['line_block.lines']).toBe('node-matrix')
  })

  it('agrees with the role the spec publishes beside the schema', () => {
    // Two derivations of one fact, from the same pinned schema: this engine's
    // generator and the spec's own `node-roles.json`. They cannot be allowed to
    // disagree about which positions hold a matrix.
    const roles = JSON.parse(
      readFileSync(resolve(root, 'spec/resources/node-roles.json'), 'utf8'),
    ) as { roles: Record<string, Record<string, { role: string }>> }
    const fromSpec: string[] = []
    for (const [type, fields] of Object.entries(roles.roles)) {
      for (const [field, role] of Object.entries(fields)) {
        if (role.role === 'node-matrix') fromSpec.push(`${type}.${field}`)
      }
    }
    const here = Object.entries(NODE_POSITION_KIND)
      .filter(([, kind]) => kind === 'node-matrix')
      .map(([position]) => position)
    expect(fromSpec.length).toBeGreaterThan(0)
    expect([...here].sort()).toEqual([...fromSpec].sort())
  })

  it('admits the inline types at the INNER level, not the outer one', () => {
    // The member set is about what a LINE holds. Reading it against the outer
    // array would be asking whether an array is an `emphasis`.
    expect(NODE_POSITION_TYPES['line_block.lines']).toContain('hard_break')
    expect(NODE_POSITION_TYPES['line_block.lines']).toContain('text')
    expect(NODE_POSITION_TYPES['line_block.lines']).not.toContain('paragraph')
  })

  it('ingests the shape the schema names', () => {
    const doc = fromAstJson(
      payload([
        [{ type: 'text', value: 'Roses are red' }],
        [{ type: 'text', value: 'Violets are blue' }],
      ]),
    )
    const block = doc.children[0] as unknown as Record<string, unknown>
    expect(block['type']).toBe('line_block')
    expect(block['lines']).toEqual([
      [{ type: 'text', value: 'Roses are red' }],
      [{ type: 'text', value: 'Violets are blue' }],
    ])
  })

  it('keeps an authored hard break inside a line', () => {
    // The whole point of the field: a `hard_break` a line CARRIES, distinct
    // from the boundary between two lines. Splitting `children` cannot say
    // which of the two it is looking at; this can.
    const doc = fromAstJson(
      payload([
        [
          { type: 'text', value: 'Roses are red' },
          { type: 'hard_break' },
          { type: 'text', value: 'Violets are blue' },
        ],
      ]),
    )
    const lines = (doc.children[0] as unknown as Record<string, unknown>)['lines']
    expect(lines).toHaveLength(1)
    expect((lines as unknown[][])[0]).toHaveLength(3)
  })

  it('refuses an unknown node type inside a line, at its own path', () => {
    let thrown: unknown
    try {
      fromAstJson(payload([[{ type: 'no_such_node' }]]))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(AstJsonUnknownNodeTypeError)
    expect((thrown as Error).message).toContain('children[0].lines[0][0]')
  })

  it('refuses a node the schema does not admit in a line, at its own path', () => {
    // The check that could not fire while the position read as `nodes`: the
    // walk refused the enclosing array before it ever reached the node, so the
    // member set was never consulted.
    let thrown: unknown
    try {
      fromAstJson(payload([[{ type: 'paragraph', children: [] }]]))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(AstJsonSchemaError)
    expect((thrown as Error).message).toContain('lines[0][0]')
    expect((thrown as Error).message).not.toContain('an array sits where a node belongs')
  })

  it('refuses a scalar inside a line', () => {
    expect(() => fromAstJson(payload([['not a node']]))).toThrow(AstJsonSchemaError)
  })

  it('leaves every other node position reading as it did', () => {
    // The control on the generator change: exactly one position moved, so a
    // classifier that started calling ordinary arrays a matrix fails here.
    const matrices = Object.entries(NODE_POSITION_KIND).filter(
      ([, kind]) => kind === 'node-matrix',
    )
    expect(matrices).toEqual([['line_block.lines', 'node-matrix']])
    expect(NODE_POSITION_KIND['line_block.children']).toBe('nodes')
    expect(NODE_POSITION_KIND['paragraph.children']).toBe('nodes')
    expect(NODE_POSITION_KIND['figure.target']).toBe('node')
    expect(NODE_POSITION_KIND['citation_group.items']).toBe('nodes')
    expect(NODE_POSITION_KIND['ruby.pairs']).toBe('records')
  })
})
