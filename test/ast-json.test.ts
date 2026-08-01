import { describe, it, expect } from 'vitest'
import { parse } from '../src/parse.js'
import { toAstJson, fromAstJson } from '../src/ast-json.js'
import { carveToAstJson, carveToHtml, Profile } from '../src/index.js'

describe('toAstJson (PART 12 §7 exchange shape)', () => {
  it('emits a root of exactly type, children and srcByteLength', () => {
    const doc = parse('---\ntitle: T\n---\n\nPara[^a]\n\n[^a]: note\n')
    const json = toAstJson(doc)
    expect(Object.keys(json).sort()).toEqual(['children', 'srcByteLength', 'type'])
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
      content: 'x = 1',
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
    expect(def).toMatchObject({ type: 'footnote', label: 'a' })
    expect(def).not.toHaveProperty('id')
  })

  it('lifts a definition authored inside a container up to the document', () => {
    // PART 9 §16: a definition is document-level metadata, collected out of the
    // container that held it, which then renders empty.
    const json = toAstJson(parse('Text[^a]\n\n> quoted\n>\n> [^a]: inside a quote\n'))
    const def = json.children.find((c) => c.type === 'footnote')
    expect(def).toMatchObject({ type: 'footnote', label: 'a' })
    const quote = json.children.find((c) => c.type === 'block_quote')
    expect(JSON.stringify(quote)).not.toContain('inside a quote')
  })

  it('omits both when the document has neither', () => {
    const json = toAstJson(parse('Just a paragraph.\n'))
    expect(json.children.every((c) => c.type !== 'frontmatter' && c.type !== 'footnote')).toBe(true)
  })

  it('carries no root field beyond the three, even with both present', () => {
    const json = toAstJson(parse('---\na: 1\n---\n\nP[^x]\n\n[^x]: d\n')) as Record<string, unknown>
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
    expect(doc.children.every((c) => c.type !== 'frontmatter' && c.type !== 'footnote')).toBe(true)
  })

  it('accepts a footnote definition spelled `id`, which older trees carry', () => {
    const doc = fromAstJson({
      type: 'document',
      srcByteLength: 0,
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'x' }] },
        { type: 'footnote', id: 'a', children: [] } as never,
      ],
    })
    expect(Object.keys(doc.footnoteDefs ?? {})).toEqual(['a'])
  })

  it('drops a footnote definition it cannot use rather than passing it on', () => {
    // A definition with no label, or a body that is not a list of blocks, cannot
    // become an entry - and `footnote` is a type no renderer has a case for,
    // since a definition renders where its reference appears and never in place.
    // Keeping it would trade a decode-time refusal for a renderer crash.
    const doc = fromAstJson({
      type: 'document',
      srcByteLength: 0,
      children: [
        { type: 'footnote', children: [] } as never,
        { type: 'footnote', label: 'b', children: 'bad' } as never,
      ],
    })
    expect(doc.footnoteDefs).toBeUndefined()
    expect(doc.children).toHaveLength(0)
  })

  it('keeps only the FIRST frontmatter node', () => {
    const doc = fromAstJson({
      type: 'document',
      srcByteLength: 0,
      children: [
        { type: 'frontmatter', format: 'yaml', content: 'a: 1' },
        { type: 'frontmatter', format: 'toml', content: 'b = 2' },
      ],
    })
    expect(doc.frontmatter).toEqual({ format: 'yaml', content: 'a: 1' })
    expect(doc.children).toHaveLength(1)
  })
})

describe('carveToAstJson', () => {
  it('serializes with positions even though parsing them is opt-in', () => {
    // PART 12 §4: tracking MAY be gated behind an option, serialization may not.
    const json = carveToAstJson('# Title\n')
    expect(json.children[0]).toHaveProperty('pos')
  })

  it('carries resolution results the consumer would have to recompute', () => {
    // PART 12 §5: "resolution results that a consumer can recompute - footnote
    // numbering, caption numbers - ARE serialized, because recomputing them
    // requires reimplementing PART 9R". Both halves, since the footnote half
    // used to be missing (#479): numbering lived inside the HTML renderer, so a
    // document serialized without being rendered carried no numbers at all.
    const json = carveToAstJson('![a](/i.png)\n\n^ Figure #: caption\n')
    const figure = json.children[0] as { caption: Array<{ type: string; n?: number }> }
    expect(figure.caption.find((c) => c.type === 'caption_number')?.n).toBe(1)

    const notes = carveToAstJson('P[^a] again[^a] and ^[inline]\n\n[^a]: note\n')
    const para = notes.children[0] as {
      children: Array<{ type: string; number?: number; refId?: string }>
    }
    const refs = para.children.filter((c) => c.type !== 'text')
    expect(refs.map((r) => [r.type, r.number, r.refId])).toEqual([
      // A repeated reference shares the NUMBER and gets its own backlink id.
      ['footnote_ref', 1, 'fnref1'],
      ['footnote_ref', 1, 'fnref1-2'],
      ['inline_footnote', 2, 'fnref2'],
    ])
  })

  it('numbers the AST exactly as the HTML does', () => {
    // The point of sharing the pass rather than reimplementing it: a consumer
    // that reads a number off the AST and a reader looking at the page must see
    // the same one.
    const source = 'A[^x] B[^y] C[^x] and ^[note]\n\n[^y]: why\n\n[^x]: ex\n'
    const html = carveToHtml(source)
    const json = carveToAstJson(source)
    const para = json.children[0] as { children: Array<{ type: string; number?: number }> }
    const numbers = para.children.filter((c) => c.number !== undefined).map((c) => c.number)

    expect(numbers).toEqual([1, 2, 1, 3])
    // The rendered markers, in the same order. Only the REFERENCE markers -
    // the backlinks in the endnotes section carry their own superscripts.
    const body = html.slice(0, html.indexOf('doc-endnotes'))
    const rendered = [...body.matchAll(/doc-noteref"><sup>(\d+)<\/sup>/g)].map((m) => Number(m[1]))
    expect(rendered).toEqual(numbers)
  })

  it('does not number references a profile removed', () => {
    // Numbering runs after the profile, so a denied footnote does not consume a
    // number and leave the sequence with a hole in it.
    const json = carveToAstJson('A[^x] B\n\n[^x]: ex\n', { profile: Profile.minimal() })
    expect(JSON.stringify(json)).not.toContain('footnote_ref')
  })
})
