import { describe, expect, it } from 'vitest'
import { AstJsonSchemaError, fromAstJson } from '../src/index.js'
import { WIRE_VALUE_KINDS } from '../src/wire-fields.js'

const cases = [
  { owner: 'admonition', field: 'kind', node: { type: 'admonition', children: [] } },
  {
    owner: 'block_extension', field: 'name',
    node: { type: 'block_extension', fallback: { type: 'paragraph', children: [] } },
  },
  {
    owner: 'block_extension.payload', field: 'format',
    node: {
      type: 'block_extension', name: 'org.example.test',
      fallback: { type: 'paragraph', children: [] }, payload: {},
    },
  },
  { owner: 'math', field: 'label', node: { type: 'math', display: true, content: '' } },
]

function documentWith(spec: (typeof cases)[number], value: unknown) {
  const node = structuredClone(spec.node) as Record<string, unknown>
  const target = spec.owner === 'block_extension.payload'
    ? node.payload as Record<string, unknown>
    : node
  target[spec.field] = value
  const child = spec.owner === 'math' ? { type: 'paragraph', children: [node] } : node
  return { type: 'document', srcByteLength: 0, children: [child] }
}

describe('a string minimum is checked at decode', () => {
  it('accepts an empty reference destination and rejects non-strings', () => {
    const wire = JSON.parse(`{
      "type": "document",
      "srcByteLength": 0,
      "children": [{"type": "link_reference_definition", "label": "a", "href": ""}]
    }`)
    expect(() => fromAstJson(wire)).not.toThrow()
    expect(WIRE_VALUE_KINDS.link_reference_definition.href).toBe('string')
    for (const href of [1, null, []]) {
      wire.children[0].href = href
      expect(() => fromAstJson(wire)).toThrow(AstJsonSchemaError)
    }
  })

  it.each(cases)('carries the minimum for $owner / $field', (spec) => {
    expect(WIRE_VALUE_KINDS[spec.owner][spec.field]).toBe('string>=1')
  })

  it.each(cases)('refuses empty and non-string values for $owner / $field', (spec) => {
    for (const value of ['', 1, null, []]) {
      const decode = () => fromAstJson(documentWith(spec, value))
      expect(decode).toThrow(AstJsonSchemaError)
      expect(decode).toThrow(new RegExp(`"${spec.field}".*string>=1`))
      try {
        decode()
      } catch (error) {
        expect((error as AstJsonSchemaError).path).toBe(
          spec.owner === 'block_extension.payload' ? 'children[0].payload'
            : spec.owner === 'math' ? 'children[0].children[0]' : 'children[0]',
        )
      }
    }
  })

  it.each(cases)('accepts one character for $owner / $field', (spec) => {
    for (const value of ['a', '😀']) {
      expect(() => fromAstJson(documentWith(spec, value))).not.toThrow()
    }
  })

  it('keeps optional labels optional and unconstrained strings empty', () => {
    expect(() => fromAstJson({
      type: 'document', srcByteLength: 0,
      children: [
        { type: 'paragraph', children: [{ type: 'math', display: true, content: '' }] },
        { type: 'link_reference_definition', label: '', href: 'a', title: '' },
      ],
    })).not.toThrow()
  })
})
