import { describe, it, expect } from 'vitest'
import { parse } from '../src/parse.js'
import { toAstJson, fromAstJson } from '../src/ast-json.js'
import { carveToAstJson, carveToHtml, renderHtml, AstJsonSchemaError, AstJsonMigrationError } from '../src/index.js'
import { renderCarve } from '../src/render-carve.js'
import { AstEnvelopeVersionError } from '../src/ast-envelope.js'

describe('toAstJson (PART 12 §7 exchange shape)', () => {
  it.each([':kbd[Ctrl]', ':my_note[x *y*]'])('keeps source extension names in %s', (source) => {
    const parsed = parse(source)
    const wire = toAstJson(parsed)
    const extension = (wire.children[0] as unknown as { children: Record<string, unknown>[] }).children[0]
    expect(extension).toMatchObject({ type: 'inline_extension', name: source.slice(1, source.indexOf('[')) })
    expect(extension).not.toHaveProperty('fallback')
    expect(wire).not.toHaveProperty('extensions')
    const roundTrip = fromAstJson(wire)
    expect(renderHtml(roundTrip)).toBe(renderHtml(parsed))
    expect(renderCarve(roundTrip)).toBe(renderCarve(parsed))
  })

  it('refuses a qualified inline extension without a fallback', () => {
    const wire = toAstJson(parse(':kbd[Ctrl]'))
    const extension = (wire.children[0] as unknown as { children: Record<string, unknown>[] }).children[0]!
    extension.name = 'example.org.kbd'
    expect(() => fromAstJson(wire)).toThrow(AstJsonSchemaError)
  })
  it('emits the versioned root and completed stages', () => {
    const doc = parse('---\ntitle: T\n---\n\nPara[^a]\n\n[^a]: note\n')
    const json = toAstJson(doc)
    expect(Object.keys(json).sort()).toEqual(['astVersion', 'children', 'srcByteLength', 'stages', 'type'])
  })

  it('keeps an unmeasured source length absent through a round trip', () => {
    const json = toAstJson({ type: 'document', children: [] } as never)
    expect(json).not.toHaveProperty('srcByteLength')
    expect(toAstJson(fromAstJson(json))).not.toHaveProperty('srcByteLength')
  })

  it('keeps the runtime document untouched', () => {
    // The mapping is on the way out; renderers and downstream consumers still
    // read footnoteDefs and frontmatter from the root.
    const doc = parse('---\ntitle: T\n---\n\nPara[^a]\n\n[^a]: note\n')
    toAstJson(doc)
    // `pos` rides along on the root's frontmatter now: the serializer needs a
    // span for the node it builds, and §4 requires one (carve-js#480).
    expect(doc.frontmatter).toMatchObject({ format: 'yaml', content: 'title: T' })
    expect(Object.keys(doc.footnoteDefs ?? {})).toEqual(['a'])
  })

  it('makes frontmatter the first child, raw and with its format', () => {
    const src = '---toml\nx = 1\n---\n\nBody\n'
    const json = toAstJson(parse(src))
    expect(json.children[0]).toMatchObject({
      type: 'frontmatter',
      format: 'toml',
      value: 'x = 1',
    })
    // And it is placed - slicing the source with its span returns the block.
    const pos = (json.children[0] as { pos: { startOffset: number; endOffset: number } }).pos
    expect([...src].slice(pos.startOffset, pos.endOffset).join('')).toBe('---toml\nx = 1\n---')
  })

  it('defaults the frontmatter format to yaml when the fence carries none', () => {
    const json = toAstJson(parse('---\ntitle: T\n---\n\nBody\n'))
    expect(json.children[0]).toMatchObject({ type: 'frontmatter', format: 'yaml' })
  })

  it('emits a footnote definition as a document child carrying label', () => {
    // `label`, not `id` (PART 12 §7): PART 9 §16 calls it a label throughout and
    // `id` collides with the attribute of that name. This engine published `id`
    // first; fromAstJson still accepts it.
    const json = toAstJson(parse('Para[^a]\n\n[^a]: note\n'))
    const def = json.children.find((c) => c.type === 'footnote')
    expect(def).toBeDefined()
    expect(def).toMatchObject({ type: 'footnote', key: 'a', namespace: 'footnote' })
    expect(def).not.toHaveProperty('id')
  })

  it('lifts a definition authored inside a container up to the document', () => {
    // PART 9 §16: a definition is document-level metadata, collected out of the
    // container that held it, which then renders empty.
    const json = toAstJson(parse('Text[^a]\n\n> quoted\n>\n> [^a]: inside a quote\n'))
    const def = json.children.find((c) => c.type === 'footnote')
    expect(def).toMatchObject({ type: 'footnote', key: 'a', namespace: 'footnote' })
    const quote = json.children.find((c) => c.type === 'block_quote')
    expect(JSON.stringify(quote)).not.toContain('inside a quote')
  })

  it('omits both when the document has neither', () => {
    const json = toAstJson(parse('Just a paragraph.\n'))
    expect(json.children.every((c) => c.type !== 'frontmatter' && c.type !== 'footnote')).toBe(true)
  })

  it('carries no root field beyond the three, even with both present', () => {
    const json = toAstJson(parse('---\na: 1\n---\n\nP[^x]\n\n[^x]: d\n')) as unknown as Record<string, unknown>
    expect(json.frontmatter).toBeUndefined()
    expect(json.footnoteDefs).toBeUndefined()
  })
})

describe('fromAstJson (PART 12 §6 round trip)', () => {
  const samples = [
    'Just a paragraph.\n',
    '---toml\nx = 1\n---\n\n# H\n\nBody with /em/ and *strong*.\n',
    'Para[^a] and ^[inline note]\n\n[^a]: note body\n',
    '> quoted\n>\n> - a\n> - b\n\n| h | h2 |\n|---|----|\n| a | b  |\n',
    'Text[^a]\n\n> quoted\n>\n> [^a]: inside a quote\n',
  ]

  for (const source of samples) {
    it(`round trips ${JSON.stringify(source.slice(0, 24))}`, () => {
      const json = toAstJson(parse(source))
      const back = toAstJson(fromAstJson(JSON.parse(JSON.stringify(json))))
      expect(back).toEqual(json)
    })
  }

  it('preserves structural short captions without rendering them', () => {
    const json = toAstJson(parse('![alt](/i.png)\n^ Full caption\n'))
    const figure = json.children[0] as typeof json.children[number] & {
      caption: { short?: Array<{ type: 'text'; value: string }> }
    }
    figure.caption.short = [{ type: 'text', value: 'Navigation label' }]

    const back = fromAstJson(JSON.parse(JSON.stringify(json)))
    expect(toAstJson(back)).toEqual(json)
    expect(renderHtml(back)).toContain('<figcaption>Full caption</figcaption>')
    expect(renderHtml(back)).not.toContain('Navigation label')
  })

  it('restores frontmatter and footnote definitions onto the runtime root', () => {
    // The runtime shape is what renderers, extensions and the profile filter
    // read; the exchange shape puts both in the tree. Decoding has to undo that,
    // or a decoded document renders without its footnotes.
    const doc = fromAstJson(toAstJson(parse('---\na: 1\n---\n\nP[^x]\n\n[^x]: d\n')))
    expect(doc.frontmatter).toMatchObject({ format: 'yaml', content: 'a: 1' })
    expect(Object.keys(doc.footnoteDefs ?? {})).toEqual(['x'])
    // The spans come back too, or the round trip is not identity: they are on
    // the tree nodes in the exchange shape and on the root in the runtime one.
    expect(doc.frontmatter?.pos).toBeDefined()
    expect(doc.footnoteDefPos?.x).toBeDefined()
    expect(doc.children.every((c) => !['frontmatter', 'footnote'].includes(c.type))).toBe(true)
  })

  it('REFUSES a footnote definition spelled `id`', () => {
    // The spelling this engine and carve-php published before PART 12 §7 settled
    // the field as `label`. carve#743 rules ingest strict and §3 makes field
    // names spec surface, so a second accepted spelling of one is the
    // interchange break the clause exists against: carve-php refused this
    // payload while this engine took it (carve-js#907).
    expect(() =>
      fromAstJson({
        type: 'document', astVersion: '2.0',
        srcByteLength: 0,
        children: [
          { type: 'paragraph', children: [{ type: 'text', value: 'x' }] },
          { type: 'footnote', id: 'a', children: [] } as never,
        ],
      }),
    ).toThrow(/"id"/)
  })

  it('accepts the same definition with a qualified key', () => {
    // The CONTROL on the row above: the refusal has to be about the spelling,
    // not about the node.
    const doc = fromAstJson({
      type: 'document', astVersion: '2.0',
      srcByteLength: 0,
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'x' }] },
        { type: 'footnote', key: 'a', namespace: 'footnote', children: [] } as never,
      ],
    })
    expect(Object.keys(doc.footnoteDefs ?? {})).toEqual(['a'])
  })

  it('refuses a footnote definition the schema does not describe', () => {
    // This asserted that an unusable definition was DROPPED. §12(d) refuses it
    // at decode instead (carve#881): the schema requires `label` and gives
    // `children` an array, so neither shape below is a `footnote` at all.
    // Dropping was the better of the two answers available before the clause -
    // it avoided a renderer crash - and refusing is what the clause asks for.
    for (const child of [
      { type: 'footnote', children: [] },
      { type: 'footnote', key: 'b', namespace: 'footnote', children: 'bad' },
    ]) {
      expect(() =>
        fromAstJson({ type: 'document', astVersion: '2.0', srcByteLength: 0, children: [child] } as never),
      ).toThrow()
    }

    // A definition the schema DOES describe still decodes, and still drops out
    // of `children` into `footnoteDefs` - which is what the rest of this
    // assertion was for.
    const doc = fromAstJson({
      type: 'document', astVersion: '2.0',
      srcByteLength: 0,
      children: [{ type: 'footnote', key: 'b', namespace: 'footnote', children: [] } as never],
    })
    // It is a real definition now, so it goes to `footnoteDefs` rather than
    // being dropped - and it leaves `children` either way, which is the part
    // this assertion was always about: a `footnote` is a definition, and a
    // definition renders where its REFERENCE appears, never in place.
    expect(doc.footnoteDefs).toEqual({ b: [] })
    expect(doc.children).toHaveLength(0)
  })

  it('keeps only the FIRST frontmatter node', () => {
    const doc = fromAstJson({
      type: 'document', astVersion: '2.0',
      srcByteLength: 0,
      children: [
        { type: 'frontmatter', format: 'yaml', value: 'a: 1' },
        { type: 'frontmatter', format: 'toml', value: 'b = 2' },
      ],
    })
    expect(doc.frontmatter).toEqual({ format: 'yaml', content: 'a: 1' })
    expect(doc.children).toHaveLength(1)
  })
})

describe('carveToAstJson', () => {
  it('serializes with positions even when the caller asked for none', () => {
    // PART 12 §4: tracking MAY be gated behind an option, serialization may not.
    // Parsing them is opt-OUT here, not opt-in - the default is on, and
    // `positions: false` is what the option suppresses (carve-js#1263) - so the
    // clause bites on the explicit false, which this call forces back on.
    expect(carveToAstJson('# Title\n').children[0]).toHaveProperty('pos')
    expect(carveToAstJson('# Title\n', { positions: false }).children[0]).toHaveProperty('pos')
  })

  it('carries resolution results the consumer would have to recompute', () => {
    // PART 12 §5. Caption numbers are assigned by resolve(), so they are here.
    // Footnote numbering is too (carve-js#479): `resolve()` assigns
    // `footnote_ref` / `inline_footnote` `.number` via the same shared pass
    // `renderHtml()` uses standalone, so a serialized tree already carries it
    // and a consumer never has to reimplement PART 9R to get one. See
    // test/footnote-numbering.test.ts for the footnote-specific coverage.
    const json = carveToAstJson('![a](/i.png)\n\n^ Figure #: caption\n')
    const figure = json.children[0] as unknown as { caption: { children: Array<{ children: Array<{ type: string; n?: number }> }> } }
    const number = figure.caption.children[0]?.children.find((c) => c.type === 'caption_number')
    expect(number?.n).toBe(1)
  })
})

describe('definition lists on the wire (PART 12)', () => {
  const source = ':: Term one\n:: Term two\n:  Def A\n:  Def B\n\n:: Second\n:  Only\n'

  it('publishes a flat sequence of nodes, not a grouping object', () => {
    // The grouping was an internal, and not an agreed one: given this document
    // carve-js published one entry with two terms and two definitions while
    // carve-rs published three entries split differently - and all three
    // engines rendered the same <dl>. The wire carries what the renderers
    // agree on.
    const list = carveToAstJson(source).children[0] as unknown as {
      type: string
      children: { type: string }[]
    }

    expect(list.type).toBe('definition_list')
    expect(list.children.map((i) => i.type)).toEqual([
      'definition_term',
      'definition_term',
      'definition_description',
      'definition_description',
      'definition_term',
      'definition_description',
    ])
  })

  it('gives a term a position, which a plain object could not carry', () => {
    // §4's point: a term is content an editor navigates to and a language
    // server renames. PART 12 §4 includes the term marker that opens it.
    const list = carveToAstJson(source).children[0] as unknown as {
      children: { type: string; pos?: { startLine: number; startColumn: number } }[]
    }

    expect(list.children[0]?.pos).toMatchObject({ startLine: 1, startColumn: 1 })
    expect(list.children[1]?.pos).toMatchObject({ startLine: 2 })
  })

  it('round trips back to the runtime grouping', () => {
    // §6. The grouping rule is the renderer's: a run of terms opens an entry,
    // the descriptions after it belong to it.
    const json = carveToAstJson(source)
    const doc = fromAstJson(JSON.parse(JSON.stringify(json))) as unknown as {
      children: { items: { terms: unknown[]; definitions: unknown[] }[] }[]
    }

    expect(doc.children[0]?.items.map((i) => [i.terms.length, i.definitions.length])).toEqual([
      [2, 2],
      [1, 1],
    ])
    expect(toAstJson(doc as never)).toEqual(json)
  })

  it('rewrites a definition list wherever it sits, not only at the top level', () => {
    const nested = carveToAstJson('> :: T\n> :  D\n\n- item\n  :: A\n  :  B\n')
    const wire = JSON.stringify(nested)

    expect(wire.match(/definition_term/g)).toHaveLength(2)
    expect(wire).not.toContain('"terms"')
  })

  it('renders a decoded document identically', () => {
    const doc = fromAstJson(JSON.parse(JSON.stringify(carveToAstJson(source))))

    expect(renderHtml(doc)).toBe(carveToHtml(source))
  })

  it('refuses the older grouping form, which needs migrating', () => {
    expect(() => fromAstJson({
      type: 'document', astVersion: '2.0',
      srcByteLength: 0,
      children: [
        {
          type: 'definition_list',
          items: [
            { terms: [[{ type: 'text', value: 'T' }]], definitions: [[{ type: 'paragraph', children: [] }]] },
          ],
        } as never,
      ],
    })).toThrow(AstJsonMigrationError)
  })

  it('leaves the runtime document untouched', () => {
    const doc = parse(source)
    carveToAstJson(source)
    toAstJson(doc)

    expect(Array.isArray((doc.children[0] as { items: { terms: unknown }[] }).items[0]?.terms)).toBe(true)
  })
})

describe('author-choice list fields on the wire (PART 12)', () => {
  // `resources/ast-schema.json` pins each node with `additionalProperties:
  // false`, so a field this engine keeps for itself - one the schema does not
  // name and carve-php / carve-rs do not publish - cannot ride along.
  it('publishes the bareMarker a list carries', () => {
    // PART 12 §1a's neighbour: `bareMarker` is an AUTHOR-CHOICE field beside
    // `delim` and `bulletChar`, so it belongs on the wire (carve#480). It used
    // to be stripped here only because the schema had no field to hold it.
    const wire = carveToAstJson('. a\n. b\n')

    expect((wire.children[0] as unknown as { marker: { bare?: boolean } }).marker.bare).toBe(true)
  })

  it('omits it when the author numbered the list', () => {
    // Absent at the default, exactly like `delim` and `bulletChar`.
    const wire = carveToAstJson('1. a\n2. b\n')

    expect((wire.children[0] as unknown as { marker: { bare?: boolean } }).marker.bare).toBeUndefined()
  })

  it('still records it on the runtime tree, so fmt keeps the spelling', () => {
    // Which is the point of the field: source -> fmt round-trips both
    // spellings, because the writer reads the runtime tree, not the wire.
    expect(renderCarve(parse('. a\n. b\n'))).toBe('. a\n. b\n')
    expect(renderCarve(parse('1. a\n2. b\n'))).toBe('1. a\n2. b\n')
  })

  it('keeps the spelling through a JSON round trip', () => {
    // The loss this used to assert is what carve#480 was about: with no field
    // on the wire, `. a` came back as `1. a` and no engine could do better.
    const back = fromAstJson(carveToAstJson('. a\n. b\n'))

    expect(renderCarve(back)).toBe('. a\n. b\n')
  })
})


describe('unknown input at the AST boundary', () => {
  it.each([null, undefined, false, 1, [], 'document'])('refuses %j at the decoder', (input: unknown) => {
    expect(() => fromAstJson(input)).toThrow()
  })

  it('validates an unknown object before decoding', () => {
    const input: unknown = { type: 'document', astVersion: '2.0', srcByteLength: 0, children: [] }
    expect(fromAstJson(input).children).toEqual([])
  })
})

describe('AST contract 2.0 migration', () => {
  it.each(['[t][r]\n\n[r]:\n', '![a][r]\n\n[r]:\n'])('preserves resolved empty references through JSON: %s', source => {
    const doc = parse(source)
    const json = toAstJson(doc)
    const use = (json.children[0] as unknown as { children: Array<Record<string, unknown>> }).children[0]!
    expect(use).toMatchObject({ [use.type === 'image' ? 'src' : 'href']: '', namespace: 'link' })
    expect(renderCarve(fromAstJson(json))).toEqual(renderCarve(doc))
  })

  it('restores a resolved empty reference inside a footnote body', () => {
    const doc = parse('x[^n]\n\n[^n]: [t][r]\n\n[r]:\n')
    const wire = JSON.stringify(toAstJson(doc))
    expect(wire).toContain('"href":""')
    expect(renderHtml(fromAstJson(JSON.parse(wire)))).toEqual(renderHtml(doc))
    expect(JSON.stringify(toAstJson(fromAstJson(JSON.parse(wire))))).toEqual(wire)
    // The marker becomes runtime state; none is left on a footnote body's node.
    expect(JSON.stringify(fromAstJson(JSON.parse(wire)).footnoteDefs)).not.toContain('"resolved"')
  })

  it.each(['[t][missing]', '![a][missing]'])('keeps unresolved references unresolved: %s', source => {
    const doc = parse(source)
    const json = toAstJson(doc)
    const use = (json.children[0] as unknown as { children: Array<Record<string, unknown>> }).children[0]!
    expect(use).not.toHaveProperty('resolved')
    expect(renderCarve(fromAstJson(json))).toEqual(renderCarve(doc))
  })

  it('refuses invalid resolution markers', () => {
    const json = toAstJson(parse('[t][r]\n\n[r]:\n'))
    const use = (json.children[0] as unknown as { children: Array<Record<string, unknown>> }).children[0]!
    use.resolved = false
    expect(() => fromAstJson(json)).toThrow(AstJsonMigrationError)
    delete use.resolved
    use.namespace = 'invalid'
    expect(() => fromAstJson(json)).toThrow(AstJsonSchemaError)
  })

  it('checks bare root versions and stays closed', () => {
    const base = toAstJson(parse('x'))
    for (const astVersion of ['1.0', '1.1', '1.2']) {
      expect(() => fromAstJson({ ...base, astVersion })).toThrow(AstJsonMigrationError)
    }
    expect(() => fromAstJson(base)).not.toThrow()
    expect(() => fromAstJson({ ...base, astVersion: '2.1' })).not.toThrow()
    for (const astVersion of ['3.0']) {
      expect(() => fromAstJson({ ...base, astVersion })).toThrow(AstEnvelopeVersionError)
    }
    expect(() => fromAstJson({ ...base, astVersion: '01.2' })).toThrow()
    expect(() => fromAstJson({ ...base, extra: true })).toThrow()
  })

  it('publishes comment forms and refuses an unknown form', () => {
    for (const [source, form] of [['%%%\nx\n%%%\n', 'block'], ['a {% x %}\n', 'braced'], ['a %% x\n', 'line']]) {
      const json = toAstJson(parse(source))
      const node = form === 'block' ? json.children[0] : (json.children[0] as { children: unknown[] }).children[1]
      expect(node).toMatchObject({ type: 'comment', form })
      const invalid = structuredClone(json)
      const comment = form === 'block' ? invalid.children[0] : (invalid.children[0] as { children: unknown[] }).children[1]
      ;(comment as { form: string }).form = 'unknown'
      expect(() => fromAstJson(invalid)).toThrow(AstJsonSchemaError)
    }
  })
})

describe('task status (contract 2.0)', () => {
  it.each([
    [' ', 'todo'], ['_', 'todo'], ['x', 'done'], ['-', 'cancelled'],
    ['/', 'in-progress'], ['!', 'blocked'], ['>', 'partial'], ['?', 'other'],
  ])('writes [%s] as %s and reads it back', (mark, status) => {
    const source = `- [${mark}] a\n`
    const wire = toAstJson(parse(source))
    const item = (wire.children[0] as unknown as { children: Record<string, unknown>[] }).children[0]
    expect(item.task).toEqual({ mark, status })
    expect(renderCarve(fromAstJson(wire))).toBe(source)
  })

  it('reads an uppercase done mark as checked', () => {
    const item = (fromAstJson({
      type: 'document', astVersion: '2.0', children: [{
        type: 'list', marker: { kind: 'bullet', char: '-' }, spacing: 'tight',
        children: [{ type: 'list_item', task: { mark: 'X', status: 'done' }, children: [] }],
      }],
    } as never).children[0] as unknown as { items: Record<string, unknown>[] }).items[0]
    expect(item.checked).toBe(true)
    expect(item.taskState).toBeUndefined()
  })
})

describe('wire offsets are UTF-8 bytes (contract 2.0)', () => {
  it('slices the source bytes exactly after astral and two-byte characters', () => {
    const source = '😀 *b*\n\nä x'
    const json = toAstJson(parse(source)) as unknown as { children: { pos: { startOffset: number, endOffset: number }, children: { pos: { startOffset: number, endOffset: number } }[] }[] }
    const bytes = Buffer.from(source)
    const slice = (pos: { startOffset: number, endOffset: number }) => bytes.subarray(pos.startOffset, pos.endOffset).toString()
    expect(slice(json.children[0]!.children[1]!.pos)).toBe('*b*')
    expect(slice(json.children[1]!.pos)).toBe('ä x')
  })
})
