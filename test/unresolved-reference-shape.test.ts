import { describe, it, expect } from 'vitest'
import { parse } from '../src/parse.js'
import { toAstJson, fromAstJson } from '../src/ast-json.js'
import {
  carveToAstJson,
  carveToHtml,
  carveToMarkdown,
  carveToPlainText,
  carveToAnsi,
  carveToCarve,
} from '../src/index.js'

/**
 * PART 12 §3a: an UNRESOLVED reference is still a `link` node carrying `ref`
 * and `rawRef`, not a text run holding its source.
 *
 * `parse()` always produced that shape. `resolve()` then replaced the node with
 * a text node, and every wire path runs `resolve()` first - so the serialized
 * tree lost it, and three rules broke at once on one document:
 *
 *   §3a  the wire could not tell `[a][]` from literal text the author typed;
 *   §1a  what replaced it were three ADJACENT text nodes, unmerged;
 *   §6   the parsed tree held a link, so the round trip was not an identity.
 *
 * carve#486's table read `parse()`, which is why the encoder went unchecked.
 */

const inlineTypes = (json: ReturnType<typeof carveToAstJson>) =>
  ((json.children[0] as { children?: { type: string }[] }).children ?? []).map((c) => c.type)

describe('an unresolved reference stays a link on the wire (PART 12 §3a)', () => {
  it('publishes link, not text', () => {
    expect(inlineTypes(carveToAstJson('see [a][] here'))).toEqual(['text', 'link', 'text'])
  })

  it('carries the reference and its source', () => {
    const json = carveToAstJson('see [a][] here')
    const link = (json.children[0] as { children: { ref?: string; rawRef?: string; href?: string }[] })
      .children[1]!
    expect(link.ref).toBe('a')
    expect(link.rawRef).toBe('[a][]')
    expect(link.href).toBe('')
  })

  it('does not publish adjacent text runs (PART 12 §1a)', () => {
    // The old shape was text/text/text - adjacent and unmerged, which §1a
    // forbids independently of §3a.
    const types = inlineTypes(carveToAstJson('see [a][] here'))
    for (let i = 1; i < types.length; i++) {
      expect(types[i] === 'text' && types[i - 1] === 'text').toBe(false)
    }
  })

  it('publishes the same node kinds the parsed tree holds (PART 12 §6)', () => {
    // This is where §6 actually broke, and why it went unnoticed: encoding the
    // PARSED tree was always an identity, because `toAstJson` does not resolve.
    // The loss happened on the wire path, which resolves first - so the tree
    // held a link and the published document held text.
    const parsed = (parse('see [a][] here').children[0] as { children: { type: string }[] }).children
    expect(inlineTypes(carveToAstJson('see [a][] here'))).toEqual(parsed.map((c) => c.type))
  })

  it('encodes and decodes back to an identical tree', () => {
    const doc = parse('see [a][] here')
    expect(fromAstJson(toAstJson(doc))).toEqual(doc)
  })

  it('still resolves a reference that has a definition, and keeps the reference', () => {
    // §3a's second half: A RESOLVED REFERENCE KEEPS ITS DESTINATION - the
    // authored `ref` and `rawRef` survive BESIDE `href`, the same way §5 has
    // footnote numbering added alongside rather than in place of the
    // reference. This asserted `ref` was gone, which made `[a][]` and
    // `[a](/url)` the same tree (carve#596).
    const json = carveToAstJson('see [a][] here\n\n[a]: /url\n')
    const link = (
      json.children[0] as { children: { ref?: string; rawRef?: string; href?: string }[] }
    ).children[1]!
    expect(link.href).toBe('/url')
    expect(link.ref).toBe('a')
    expect(link.rawRef).toBe('[a][]')
  })
})

describe('the tree gains the reference; no output changes', () => {
  // The whole point: a consumer can now tell what the author wrote, and every
  // render target still writes exactly what it wrote before.
  const src = 'see [a][] here'

  it('HTML', () => expect(carveToHtml(src)).toBe('<p>see [a][] here</p>'))
  it('Markdown', () => expect(carveToMarkdown(src)).toBe('see \\[a\\]\\[\\] here\n'))
  it('plain text', () => expect(carveToPlainText(src)).toBe('see [a][] here\n'))
  it('ANSI', () => expect(carveToAnsi(src)).toBe('see [a][] here\n'))
  it('Carve', () => expect(carveToCarve(src)).toBe('see [a][] here\n'))

  it('an unresolved reference nested in a link label keeps its literal source', () => {
    // "Links never nest" unwraps an inner link to its children. For an
    // unresolved reference that would print the LABEL where the author wrote
    // the whole construct, so it becomes its raw source instead.
    expect(carveToHtml('[[x][missing]](/z)')).toBe('<p><a href="/z">[x][missing]</a></p>')
  })

  it('an unresolved reference image is still literal source', () => {
    expect(carveToHtml('see ![alt][missing] here')).toBe('<p>see ![alt][missing] here</p>')
  })
})
