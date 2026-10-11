import { describe, expect, it } from 'vitest'
import { AstJsonSchemaError, fromAstJson } from '../src/index.js'

const ruby = {
  type: 'document', srcByteLength: 0,
  children: [{ type: 'paragraph', children: [{
    type: 'ruby', pairs: [{ base: [{ type: 'text', value: 'a' }], annotation: [] }],
  }] }],
}

describe('schema array length bounds', () => {
  it('rejects an empty node array', () => {
    const wire = structuredClone(ruby)
    wire.children[0]!.children[0]!.pairs = []
    expect(() => fromAstJson(wire as never)).toThrow(AstJsonSchemaError)
    expect(() => fromAstJson(wire as never)).toThrow(/pairs.*at least one/)
  })

  it('rejects an empty array in a nested record', () => {
    const wire = structuredClone(ruby)
    wire.children[0]!.children[0]!.pairs[0]!.base = []
    expect(() => fromAstJson(wire as never)).toThrow(/base.*at least one/)
  })

  it('allows an empty annotation without a bound', () => {
    expect(() => fromAstJson(ruby as never)).not.toThrow()
  })

  it('rejects an empty array nested inside a stanza map', () => {
    const wire = { type: 'document', srcByteLength: 0, children: [{
      type: 'line_block', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'a' }] }],
      lines: [[]],
    }] }
    expect(() => fromAstJson(wire as never)).toThrow(/lines\[0\].*at least one/)
  })

  it('allows an empty unbounded stanza list', () => {
    const wire = { type: 'document', srcByteLength: 0, children: [{
      type: 'line_block', children: [], lines: [],
    }] }
    expect(() => fromAstJson(wire as never)).not.toThrow()
  })
})
