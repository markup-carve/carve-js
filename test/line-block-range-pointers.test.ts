import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fromAstJson, AstJsonSchemaError } from '../src/ast-json.js'
import { NODE_POSITION_KIND } from '../src/wire-fields.js'

const payload = (lines: unknown) => ({
  type: 'document',
  srcByteLength: 0,
  children: [{
    type: 'line_block',
    children: [{ type: 'paragraph', children: [
      { type: 'text', value: 'a' },
      { type: 'hard_break' },
      { type: 'text', value: 'b' },
    ] }],
    lines,
  }],
}) as never

describe('line block range pointers', () => {
  it('agrees with the spec node roles', () => {
    const roles = JSON.parse(readFileSync(resolve(import.meta.dirname, '../spec/resources/node-roles.json'), 'utf8')) as {
      roles: Record<string, Record<string, { role: string }>>
    }
    expect(roles.roles['line_block']?.['lines']).toBeUndefined()
    expect(NODE_POSITION_KIND['line_block.lines']).toBeUndefined()
    expect(NODE_POSITION_KIND['line_block.children']).toBe('nodes')
  })

  it('accepts a boundary and stanza end', () => {
    const doc = fromAstJson(payload([['/children/1', '/children/-']]))
    expect((doc.children[0] as { lines?: string[][] }).lines).toEqual([['/children/1', '/children/-']])
  })

  it.each([
    [['/children/9', '/children/-']],
    [['/children/1', '/children/1', '/children/-']],
    [['/children/-', '/children/1']],
    [['/children/1']],
    [[{ type: 'text', value: 'a' }]],
    [['not/a/pointer', '/children/-']],
  ])('refuses malformed ranges', (lines) => {
    expect(() => fromAstJson(payload(lines))).toThrow(AstJsonSchemaError)
  })
})
