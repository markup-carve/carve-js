import { describe, expect, it } from 'vitest'
import { AstJsonSchemaError, fromAstJson } from '../src/index.js'
import { WIRE_VALUE_KINDS } from '../src/ast/wire-fields.js'

const cases = [
  { owner: 'admonition', field: 'kind', node: { type: 'admonition', children: [] } },
  {
    owner: 'image', field: 'resourceId',
    node: { type: 'image', src: '/a.png', alt: 'a' },
  },
  {
    owner: 'resource', field: 'id',
    node: { mediaType: 'image/png', digest: `sha256:${'0'.repeat(64)}` },
  },
  { owner: 'math', field: 'numberPrefix', node: { type: 'math', display: true, value: '' } },
]

function documentWith(spec: (typeof cases)[number], value: unknown) {
  const node = structuredClone(spec.node) as Record<string, unknown>
  node[spec.field] = value
  const child = spec.owner === 'math' || spec.owner === 'image' ? { type: 'paragraph', children: [node] } : node
  return {
    type: 'document', astVersion: '2.0',
    stages: ['blockImagePromotion', 'referenceResolution', 'tableAlignment'],
    srcByteLength: 0,
    children: spec.owner === 'resource' ? [] : [child],
    ...(spec.owner === 'resource' ? { resources: [node] } : {}),
  }
}

describe('a string minimum is checked at decode', () => {
  it('accepts an empty reference destination and rejects non-strings', () => {
    const wire = JSON.parse(`{
      "type": "document",
      "astVersion": "2.0",
      "stages": ["blockImagePromotion", "referenceResolution", "tableAlignment"],
      "srcByteLength": 0,
      "children": [{"type": "link_reference_definition", "key": "a", "namespace": "link", "href": ""}]
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
          spec.owner === 'resource' ? '.resources[0]'
            : spec.owner === 'math' || spec.owner === 'image' ? 'children[0].children[0]' : 'children[0]',
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
      type: 'document', astVersion: '2.0', stages: ['blockImagePromotion', 'referenceResolution', 'tableAlignment'], srcByteLength: 0,
      children: [
        { type: 'paragraph', children: [{ type: 'math', display: true, value: '' }] },
        { type: 'link_reference_definition', key: '', namespace: 'link', href: 'a', title: '' },
      ],
    })).not.toThrow()
  })
})
