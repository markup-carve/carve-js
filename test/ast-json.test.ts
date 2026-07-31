import { describe, it, expect } from 'vitest'
import { parse } from '../src/parse.js'
import { toAstJson } from '../src/ast-json.js'

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
    expect(doc.frontmatter).toEqual({ format: 'yaml', content: 'title: T' })
    expect(Object.keys(doc.footnoteDefs ?? {})).toEqual(['a'])
  })

  it('makes frontmatter the first child, raw and with its format', () => {
    const json = toAstJson(parse('---toml\nx = 1\n---\n\nBody\n'))
    expect(json.children[0]).toEqual({
      type: 'frontmatter',
      format: 'toml',
      content: 'x = 1',
    })
  })

  it('defaults the frontmatter format to yaml when the fence carries none', () => {
    const json = toAstJson(parse('---\ntitle: T\n---\n\nBody\n'))
    expect(json.children[0]).toMatchObject({ type: 'frontmatter', format: 'yaml' })
  })

  it('emits a footnote definition as a document child carrying id', () => {
    const json = toAstJson(parse('Para[^a]\n\n[^a]: note\n'))
    const def = json.children.find((c) => c.type === 'footnote')
    expect(def).toBeDefined()
    expect(def).toMatchObject({ type: 'footnote', id: 'a' })
  })

  it('lifts a definition authored inside a container up to the document', () => {
    // PART 9 §16: a definition is document-level metadata, collected out of the
    // container that held it, which then renders empty.
    const json = toAstJson(parse('Text[^a]\n\n> quoted\n>\n> [^a]: inside a quote\n'))
    const def = json.children.find((c) => c.type === 'footnote')
    expect(def).toMatchObject({ type: 'footnote', id: 'a' })
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
