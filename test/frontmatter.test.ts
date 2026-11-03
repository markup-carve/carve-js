import { describe, it, expect } from 'vitest'
import { parse, carveToHtml } from '../src/index.js'

describe('typed frontmatter (raw-hold)', () => {
  // `toMatchObject` rather than `toEqual`: the root's frontmatter also carries
  // a `pos` now, so the serializer can place the node it builds (carve-js#480).
  it('holds a bare fence as yaml by default', () => {
    const doc = parse('---\ntitle: Hi\n---\n\nBody')
    expect(doc.frontmatter).toMatchObject({ format: 'yaml', content: 'title: Hi' })
  })

  it('captures an attached toml format token', () => {
    const doc = parse('---toml\ntitle = "Hi"\n---\n\nBody')
    expect(doc.frontmatter).toMatchObject({ format: 'toml', content: 'title = "Hi"' })
  })

  it('captures a json format token', () => {
    const doc = parse('---json\n{"title":"Hi"}\n---')
    expect(doc.frontmatter).toMatchObject({ format: 'json', content: '{"title":"Hi"}' })
  })

  it('captures an arbitrary custom token', () => {
    const doc = parse('---custom\nx\n---')
    expect(doc.frontmatter?.format).toBe('custom')
  })

  it('preserves content verbatim, including markup-like lines', () => {
    const doc = parse('---\n# not a heading\n[ref]: /url\n\nkey: v\n---\n\nBody')
    expect(doc.frontmatter?.content).toBe('# not a heading\n[ref]: /url\n\nkey: v')
  })

  it('holds an unclosed fence through the end of the document', () => {
    const doc = parse('---\ntitle: Hi\n\nBody with no close')
    expect(doc.frontmatter).toMatchObject({ format: 'yaml', content: 'title: Hi\n\nBody with no close' })
    expect(doc.children).toEqual([])
  })

  it('claims a bare one-line opener and keeps the final payload line', () => {
    expect(parse('---').frontmatter).toMatchObject({
      format: 'yaml', content: '',
      pos: { startLine: 1, endLine: 1, startOffset: 0, endOffset: 3 },
    })
    expect(parse('---toml\r\nx').frontmatter).toMatchObject({
      format: 'toml', content: 'x',
      pos: { startLine: 1, endLine: 2, startOffset: 0, endOffset: 10 },
    })
    expect(carveToHtml('---toml\r\nx')).toBe('')
  })

  it('honors defaultFrontmatterFormat for a bare fence', () => {
    const doc = parse('---\nx\n---', { defaultFrontmatterFormat: 'toml' })
    expect(doc.frontmatter?.format).toBe('toml')
  })

  it('an explicit token overrides defaultFrontmatterFormat', () => {
    const doc = parse('---json\nx\n---', { defaultFrontmatterFormat: 'toml' })
    expect(doc.frontmatter?.format).toBe('json')
  })

  it('accepts an optional space before the format token (lenient)', () => {
    // `--- toml` and `---toml` are equivalent; the no-space form is canonical.
    const doc = parse('--- toml\ntitle = "Hi"\n---\n\nBody')
    expect(doc.frontmatter).toMatchObject({ format: 'toml', content: 'title = "Hi"' })
    expect(carveToHtml('--- toml\ntitle = "Hi"\n---\n\nBody')).toBe('<p>Body</p>')
  })

  it('accepts a space before the token on a bare-default opener too', () => {
    const doc = parse('---   \nx\n---')
    expect(doc.frontmatter?.format).toBe('yaml')
  })

  it('does not consume a fence inside a nested block as frontmatter', () => {
    // Frontmatter is document-leading only. A `---`-fenced run inside an
    // admonition body must be parsed as content, not eaten by a sub-lexer.
    const doc = parse('::: note\n---toml\nkept\n---\n:::')
    expect(doc.frontmatter).toBeUndefined()
    expect(carveToHtml('::: note\n---toml\nkept\n---\n:::')).toContain('kept')
  })

  it('keeps a link definition inside unclosed frontmatter opaque', () => {
    const html = carveToHtml('---\n[r]: /u\n\n[x][r]')
    expect(html).toBe('')
  })

  it('does not collect an abbreviation definition from frontmatter', () => {
    // Frontmatter is opaque: an `*[API]:` line inside it must not turn a
    // later `API` in the body into an <abbr>.
    const html = carveToHtml('---\n*[API]: private\n---\n\nAPI')
    expect(html).not.toContain('<abbr')
  })
})
