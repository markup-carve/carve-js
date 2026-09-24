import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parse } from '../src/parse.js'
import { renderHtml } from '../src/render-html.js'
import {
  AST_CONTRACT_VERSION,
  CORE_AST_VOCABULARY,
  AstEnvelopeExtensionError,
  AstEnvelopeShapeError,
  AstEnvelopeVersionError,
  AstEnvelopeVocabularyError,
  fromAstEnvelope,
  toAstEnvelope,
  type AstEnvelope,
} from '../src/ast-envelope.js'

const wrap = (src: string): AstEnvelope => toAstEnvelope(parse(src))

describe('toAstEnvelope (PART 12 §34)', () => {
  it('writes exactly the fields the schema names', () => {
    expect(Object.keys(wrap('Hi\n')).sort()).toEqual(['astVersion', 'document'])
  })

  it('emits the contract version, which is not the language version', () => {
    expect(wrap('Hi\n').astVersion).toBe('1.0')
    expect(AST_CONTRACT_VERSION).toBe('1.0')
  })

  it('leaves the tree exactly as toAstJson writes it', () => {
    const envelope = wrap('# H\n\nPara\n')
    expect(Object.keys(envelope.document).sort()).toEqual([
      'children',
      'srcByteLength',
      'type',
    ])
    expect(envelope.document.type).toBe('document')
  })

  it('omits an absent vocabulary rather than spelling the core one', () => {
    expect(wrap('Hi\n').vocabulary).toBeUndefined()
    expect(toAstEnvelope(parse('Hi\n'), { vocabulary: CORE_AST_VOCABULARY }).vocabulary).toBe(
      CORE_AST_VOCABULARY,
    )
  })

  it('carries the extensions it was given', () => {
    const envelope = toAstEnvelope(parse('Hi\n'), {
      extensions: [{ id: 'https://markup-carve.org/ext/citations', version: '1' }],
    })
    expect(envelope.extensions).toEqual([
      { id: 'https://markup-carve.org/ext/citations', version: '1' },
    ])
  })

  it('emits its own version rather than echoing what it read', () => {
    // §34: re-emitting an ingested `astVersion` republishes a claim the
    // producer cannot keep.
    const incoming: AstEnvelope = { ...wrap('Hi\n'), astVersion: '1.7' }
    expect(toAstEnvelope(fromAstEnvelope(incoming)).astVersion).toBe(AST_CONTRACT_VERSION)
  })
})

describe('fromAstEnvelope (PART 12 §34)', () => {
  it('round-trips a document through the envelope', () => {
    const doc = fromAstEnvelope(wrap('# H\n\n*Body*\n'))
    expect(renderHtml(doc)).toBe(renderHtml(parse('# H\n\n*Body*\n')))
  })

  it('refuses a higher major, naming both versions', () => {
    const envelope: AstEnvelope = { ...wrap('Hi\n'), astVersion: '2.0' }
    let thrown: unknown
    try {
      fromAstEnvelope(envelope)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(AstEnvelopeVersionError)
    expect((thrown as AstEnvelopeVersionError).found).toBe('2.0')
    expect((thrown as AstEnvelopeVersionError).implemented).toBe('1.0')
    expect((thrown as Error).message).toContain('2.0')
    expect((thrown as Error).message).toContain('1.0')
  })

  it('accepts a higher minor when nothing required is missing', () => {
    const envelope: AstEnvelope = { ...wrap('Hi\n'), astVersion: '1.9' }
    expect(fromAstEnvelope(envelope).type).toBe('document')
  })

  it('refuses a higher minor whose required extension it does not implement', () => {
    const envelope: AstEnvelope = {
      ...wrap('Hi\n'),
      astVersion: '1.9',
      extensions: [{ id: 'https://example.org/ext/tables-2' }],
    }
    expect(() => fromAstEnvelope(envelope)).toThrow(AstEnvelopeExtensionError)
  })

  it('names the required extension it does not implement', () => {
    const envelope: AstEnvelope = {
      ...wrap('Hi\n'),
      extensions: [{ id: 'https://example.org/ext/diagram', required: true }],
    }
    let thrown: unknown
    try {
      fromAstEnvelope(envelope)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(AstEnvelopeExtensionError)
    expect((thrown as AstEnvelopeExtensionError).extension).toBe(
      'https://example.org/ext/diagram',
    )
    expect((thrown as Error).message).toContain('https://example.org/ext/diagram')
  })

  it('reads an absent `required` as true', () => {
    const envelope: AstEnvelope = {
      ...wrap('Hi\n'),
      extensions: [{ id: 'https://example.org/ext/diagram' }],
    }
    expect(() => fromAstEnvelope(envelope)).toThrow(AstEnvelopeExtensionError)
  })

  it('ignores an extension the payload marks optional', () => {
    const envelope: AstEnvelope = {
      ...wrap('Hi\n'),
      extensions: [{ id: 'https://example.org/ext/diagram', required: false }],
    }
    expect(fromAstEnvelope(envelope).type).toBe('document')
  })

  it('accepts a required extension the reader declares', () => {
    const envelope: AstEnvelope = {
      ...wrap('Hi\n'),
      extensions: [{ id: 'https://example.org/ext/diagram' }],
    }
    expect(
      fromAstEnvelope(envelope, { extensions: ['https://example.org/ext/diagram'] }).type,
    ).toBe('document')
  })

  it('reads an absent vocabulary as the core one', () => {
    const envelope = wrap('Hi\n')
    expect(envelope.vocabulary).toBeUndefined()
    expect(fromAstEnvelope(envelope).type).toBe('document')
    expect(fromAstEnvelope({ ...envelope, vocabulary: CORE_AST_VOCABULARY }).type).toBe('document')
  })

  it('refuses a vocabulary it does not know, naming it', () => {
    const envelope: AstEnvelope = { ...wrap('Hi\n'), vocabulary: 'https://example.org/ast/other' }
    let thrown: unknown
    try {
      fromAstEnvelope(envelope)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(AstEnvelopeVocabularyError)
    expect((thrown as AstEnvelopeVocabularyError).vocabulary).toBe('https://example.org/ast/other')
    expect(
      fromAstEnvelope(envelope, { vocabularies: ['https://example.org/ast/other'] }).type,
    ).toBe('document')
  })

  it('reports the contract before the tree', () => {
    // A higher major is refused whatever the tree looks like: the caller hears
    // about the contract it cannot read rather than about a node type.
    const envelope = {
      astVersion: '2.0',
      document: { type: 'document', children: [{ type: 'no_such_node' }], srcByteLength: 0 },
    } as unknown as AstEnvelope
    expect(() => fromAstEnvelope(envelope)).toThrow(AstEnvelopeVersionError)
  })

  describe('the envelope is closed', () => {
    it('refuses a property the schema does not name', () => {
      const envelope = { ...wrap('Hi\n'), profile: 'strict' } as unknown as AstEnvelope
      expect(() => fromAstEnvelope(envelope)).toThrow(AstEnvelopeShapeError)
    })

    it('refuses an extension property the schema does not name', () => {
      const envelope = {
        ...wrap('Hi\n'),
        extensions: [{ id: 'https://example.org/ext/x', level: 2 }],
      } as unknown as AstEnvelope
      expect(() => fromAstEnvelope(envelope)).toThrow(AstEnvelopeShapeError)
    })

    it.each([
      ['a missing astVersion', { document: wrap('Hi\n').document }],
      ['a missing document', { astVersion: '1.0' }],
      ['a leading zero', { ...wrap('Hi\n'), astVersion: '01.0' }],
      ['a bare major', { ...wrap('Hi\n'), astVersion: '1' }],
      ['a three-part version', { ...wrap('Hi\n'), astVersion: '1.0.0' }],
      ['a minor with a leading zero', { ...wrap('Hi\n'), astVersion: '1.01' }],
      ['a non-string vocabulary', { ...wrap('Hi\n'), vocabulary: 7 }],
      ['a non-array extensions', { ...wrap('Hi\n'), extensions: {} }],
      ['a non-object extension', { ...wrap('Hi\n'), extensions: ['x'] }],
      ['an extension with no id', { ...wrap('Hi\n'), extensions: [{ version: '1' }] }],
      ['a non-boolean required', { ...wrap('Hi\n'), extensions: [{ id: 'x', required: 'yes' }] }],
      ['an array', []],
      ['null', null],
    ])('refuses %s', (_label, value) => {
      expect(() => fromAstEnvelope(value as unknown as AstEnvelope)).toThrow(AstEnvelopeShapeError)
    })

    it('refuses a JSON string with an error naming the call, not the document', () => {
      expect(() => fromAstEnvelope(JSON.stringify(wrap('Hi\n')) as unknown as AstEnvelope)).toThrow(
        TypeError,
      )
    })

    it('does not read the envelope fields off the prototype chain', () => {
      const envelope = Object.create({ astVersion: '1.0', document: wrap('Hi\n').document })
      expect(() => fromAstEnvelope(envelope as AstEnvelope)).toThrow(AstEnvelopeShapeError)
    })
  })
})

describe('the envelope this engine writes matches the pinned schema', () => {
  // A drift canary, not a restatement: the shape lives in
  // `spec/resources/ast-envelope-schema.json`, and the module above hard-codes
  // the field names, the version pattern and the closed-ness. The schema moving
  // without this module moving is what this fails on.
  const schema = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '..', 'spec/resources/ast-envelope-schema.json'),
      'utf8',
    ),
  ) as {
    required: string[]
    additionalProperties: boolean
    properties: Record<string, { pattern?: string }>
  }
  const extensionItems = (
    schema.properties['extensions'] as unknown as {
      items: { required: string[]; additionalProperties: boolean; properties: Record<string, unknown> }
    }
  ).items

  it('writes every field the schema requires and nothing it does not name', () => {
    const written = Object.keys(wrap('Hi\n'))
    // Sorted on BOTH sides, so the assertion is about membership rather than
    // about the order two unrelated files happen to list things in.
    expect([...written].sort()).toEqual(['astVersion', 'document'])
    expect([...schema.required].sort()).toEqual(['astVersion', 'document'])
    for (const field of written) expect(Object.keys(schema.properties)).toContain(field)
  })

  it('names the same envelope fields the schema does', () => {
    const full = toAstEnvelope(parse('Hi\n'), {
      vocabulary: CORE_AST_VOCABULARY,
      extensions: [{ id: 'https://example.org/ext/x', version: '1', required: false }],
    })
    expect(Object.keys(full).sort()).toEqual(Object.keys(schema.properties).sort())
    expect(Object.keys(full.extensions![0]!).sort()).toEqual(
      Object.keys(extensionItems.properties).sort(),
    )
  })

  it('keeps both objects closed, which is what the refusals above rest on', () => {
    expect(schema.additionalProperties).toBe(false)
    expect(extensionItems.additionalProperties).toBe(false)
    expect(extensionItems.required).toEqual(['id'])
  })

  it('refuses exactly the versions the schema pattern refuses', () => {
    const pattern = new RegExp(schema.properties['astVersion']!.pattern!)
    expect(pattern.test(AST_CONTRACT_VERSION)).toBe(true)
    // Well-formed under the pattern: read as a CONTRACT question, so a higher
    // major is a version refusal and never a shape one.
    for (const good of ['1.0', '1.9', '2.0', '10.11']) {
      expect(pattern.test(good)).toBe(true)
      expect(() => fromAstEnvelope({ ...wrap('Hi\n'), astVersion: good })).not.toThrow(
        AstEnvelopeShapeError,
      )
    }
    // Ill-formed: a shape refusal, because there is no contract to compare.
    for (const bad of ['01.0', '1.01', '1', '1.0.0', '0.1', '']) {
      expect(pattern.test(bad)).toBe(false)
      expect(() => fromAstEnvelope({ ...wrap('Hi\n'), astVersion: bad })).toThrow(
        AstEnvelopeShapeError,
      )
    }
  })
})
