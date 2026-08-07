import { describe, it, expect } from 'vitest'
import {
  carveToAnsi,
  carveToCarve,
  carveToHtml,
  carveToMarkdown,
  carveToPlainText,
  fromAstJson,
  parse,
  renderHtml,
  toAstJson,
} from '../src/index.js'

/**
 * PART 12 §3a: an unresolved reference is still a node, not reverted source.
 *
 * The link half already held. The IMAGE half did not: resolve() replaced the
 * node with a text node before the HTML path ever saw it, so `![alt][nope]`
 * looked right while the image node had no renderer arm anywhere. The serialized
 * tree kept the image, so a document decoded from JSON rendered `<img src="">` -
 * the same document, two shapes, depending on the entry point (carve-php#624).
 */
describe('an unresolved reference image is an image node that renders as its source', () => {
  it('keeps the image node with ref and rawRef', () => {
    const ast = toAstJson(parse('![alt][nope]\n'))
    const paragraph = ast.children[0] as { type: string; children: Array<Record<string, unknown>> }

    expect(paragraph.type).toBe('paragraph')
    expect(paragraph.children).toHaveLength(1)
    expect(paragraph.children[0]).toMatchObject({
      type: 'image',
      src: '',
      alt: 'alt',
      ref: 'nope',
      rawRef: '![alt][nope]',
    })
  })

  it('renders the literal source, from a parsed and from a decoded tree alike', () => {
    for (const source of ['![alt][nope]\n', '![a][]\n', 'a ![alt][nope] b\n']) {
      const expected = carveToHtml(source)
      expect(expected.trim()).toBe(`<p>${source.trim()}</p>`)
      // §6: the decoded tree is the parsed tree, so it must render the same.
      expect(renderHtml(fromAstJson(toAstJson(parse(source))))).toBe(expected)
    }
  })

  it('escapes the source like any other literal text', () => {
    expect(carveToHtml('![a&b][no<pe>]\n').trim()).toBe('<p>![a&amp;b][no&lt;pe&gt;]</p>')
  })

  it('writes the source back out in every other target', () => {
    const source = 'a ![alt][nope] and [b][no] x\n'

    // The Markdown line is section 8a M1b: a `[` is escaped only where it is
    // ADJACENT to another `[` on the emitted line, and none of these is, so the
    // brackets are written bare. The `]` is not narrowed by that clause (M1c),
    // so it keeps M1. The other three writers are unaffected and stay
    // byte-identical to carve-php's; the Markdown one diverges from carve-php
    // until markup-carve/carve#970 lands there too.
    expect(carveToMarkdown(source).trim()).toBe('a ![alt\\][nope\\] and [b\\][no\\] x')
    expect(carveToPlainText(source).trim()).toBe('a ![alt][nope] and [b][no] x')
    expect(carveToAnsi(source).trim()).toBe('a ![alt][nope] and [b][no] x')
    expect(carveToCarve(source)).toBe(source)
  })

  it('is not promoted to a block image, so it keeps its paragraph', () => {
    // A lone image paragraph IS a block image (no <p>), but an unresolved
    // reference is not an image on the surface at all.
    expect(carveToHtml('![a](/x)\n').trim()).toBe('<img src="/x" alt="a">')
    expect(carveToHtml('![a][]\n').trim()).toBe('<p>![a][]</p>')
  })

  it('resolves against an explicit definition, where one exists', () => {
    expect(carveToHtml('![a][d]\n\n[d]: /x\n').trim()).toBe('<img src="/x" alt="a">')
  })
})
