import { describe, it, expect } from 'vitest'
import {
  carveToAnsi,
  carveToAstJson,
  carveToCarve,
  carveToHtml,
  carveToMarkdown,
  carveToPlainText,
  fromAstJson,
  parse,
  renderCarve,
} from '../src/index.js'

/**
 * PART 12 §3a, A NESTED LINK AND AN AUTOLINK STAY NODES -- NORMATIVE
 * (markup-carve/carve#817).
 *
 * "Links never nest" is a RENDERING rule: an anchor may not contain another
 * anchor. It binds the renderer, not the encoder. A link or an autolink inside a
 * link's label is serialized as the node the author wrote, and every renderer
 * unwraps it at the render seam exactly as it does today.
 *
 * Flattening it at the encoder is the fold §3a exists to forbid, and it is
 * strictly lossier than the case the section opens with: an unresolved reference
 * at least keeps enough to be written back, while a nested link's destination
 * did not survive at all.
 *
 * THE NODE CARRIES NO NON-ANCHOR FLAG. Nothing on the wire marks the inner link
 * as unclickable; a consumer infers it from context.
 *
 * RENDERED OUTPUT DOES NOT MOVE, which is why no corpus golden pins this: a
 * corpus pair here would pass before and after and prove nothing. The pins that
 * can fail are the §6 round trip on these shapes and the AST-shape expectation
 * that a `link` and an `autolink` are admissible inside a link's children.
 */

/** The first paragraph's inline children, as published. */
const wire = (src: string): unknown[] =>
  JSON.parse(
    JSON.stringify(carveToAstJson(src), (k, v) => (k === 'pos' ? undefined : v)),
  ).children[0].children

describe('a nested link and an autolink stay nodes', () => {
  it('a nested inline link keeps its destination on the wire', () => {
    expect(wire('[[x](y)](z)\n')).toEqual([
      {
        type: 'link',
        href: 'z',
        children: [{ type: 'link', href: 'y', children: [{ type: 'text', value: 'x' }] }],
      },
    ])
  })

  it('a nested autolink stays an autolink', () => {
    // Flattened it returned as a bare URL, and that is a DIFFERENT document: a
    // bare URL stays literal where an autolink is a link.
    expect(wire('[<https://e.com>](z)\n')).toEqual([
      {
        type: 'link',
        href: 'z',
        children: [{ type: 'autolink', href: 'https://e.com', text: 'https://e.com' }],
      },
    ])
  })

  it('a nested RESOLVED reference keeps ref, rawRef and href', () => {
    expect(wire('[a [r][d] b](z)\n\n[d]: /dd\n')[0]).toEqual({
      type: 'link',
      href: 'z',
      children: [
        { type: 'text', value: 'a ' },
        { type: 'link', href: '/dd', children: [{ type: 'text', value: 'r' }], ref: 'd', rawRef: '[r][d]' },
        { type: 'text', value: ' b' },
      ],
    })
  })

  it('the node carries NO non-anchor flag', () => {
    // A field exactly one construct ever sets is a special case where the
    // uniform rule is available, and it would carry a RENDER fact back into the
    // format that describes the SOURCE. The asymmetry is deliberate: adding the
    // flag later is a normal additive change, removing it later is a break.
    const inner = (wire('[[x](y)](z)\n')[0] as { children: Record<string, unknown>[] }).children[0]!
    expect(Object.keys(inner).sort()).toEqual(['children', 'href', 'type'])
  })

  it('the section 6 round trip holds on both shapes', () => {
    // The pin that actually fails. `fmt` on the parsed document and `fmt` on the
    // same document taken through the AST were two spellings of one source.
    for (const src of ['[[x](y)](z)\n', '[<https://e.com>](z)\n', '[![i](i.png)](z)\n']) {
      expect(renderCarve(parse(src))).toBe(src)
      expect(renderCarve(fromAstJson(carveToAstJson(src)))).toBe(src)
      expect(carveToCarve(src)).toBe(src)
    }
  })

  it('RENDERED OUTPUT DOES NOT MOVE, on every target', () => {
    // Every one of these is the byte the target emitted before the encoder
    // stopped flattening. The unwrap moved to the render seam; the output did
    // not move at all.
    const cases: Array<[string, string, string, string]> = [
      // [source, html, markdown, plain]
      ['[[x](y)](z)\n', '<p><a href="z">x</a></p>', '[x](z)\n', 'x\n'],
      [
        '[<https://e.com>](z)\n',
        '<p><a href="z">https://e.com</a></p>',
        '[https://e.com](z)\n',
        'https://e.com\n',
      ],
      ['[<mailto:a@b.c>](z)\n', '<p><a href="z">a@b.c</a></p>', '[a@b.c](z)\n', 'a@b.c\n'],
      [
        '[a [r][d] b](z)\n\n[d]: /dd\n',
        '<p><a href="z">a r b</a></p>',
        '[a r b](z)\n',
        'a r b\n',
      ],
      [
        '[*em [x](y)*](z)\n',
        '<p><a href="z"><strong>em x</strong></a></p>',
        '[**em x**](z)\n',
        'em x\n',
      ],
    ]
    for (const [src, html, md, plain] of cases) {
      expect(carveToHtml(src)).toBe(html)
      expect(carveToMarkdown(src)).toBe(md)
      expect(carveToPlainText(src)).toBe(plain)
    }
    // ANSI emits its destination parenthetically, so the nesting shows as a
    // doubled style run rather than as a second anchor. One row is enough to
    // catch it, and this is the one that doubled.
    expect(carveToAnsi('[[x](y)](z)\n')).toBe(
      '[4m[34mx[0m[2m (z)[0m\n',
    )
  })

  it("a crossref's cloned display text renders in the link context too", () => {
    // The `heading_ref` exemption is the PRECEDENT this clause extends, and it
    // has a second half: the clone is display text that renders inside the
    // crossref's OWN anchor, so a link cloned in from the target heading may not
    // nest there either. The resolver used to unwrap the clone; with that pass
    // gone each target has to say so at its own seam, and Markdown and ANSI both
    // published a nested link until they did.
    const src = '{#h}\n# [a](/u) and <https://e.com>\n\nSee </#h>.\n'
    expect(carveToHtml(src)).toContain('<p>See <a href="#h">a and https://e.com</a>.</p>')
    expect(carveToMarkdown(src)).toContain('See [a and https://e.com](#h).\n')
    expect(carveToPlainText(src)).toContain('See a and https://e.com.\n')
  })

  it('an UNRESOLVED reference nested in a link is still its raw source', () => {
    // A different case and unchanged: unwrapping it to its children would print
    // the LABEL where the author wrote the whole `[r][missing]`.
    expect(carveToHtml('[a [r][missing] b](z)\n')).toBe('<p><a href="z">a [r][missing] b</a></p>')
    expect(carveToCarve('[a [r][missing] b](z)\n')).toBe('[a [r][missing] b](z)\n')
  })

  it('CONTROL an image and a code span in a label were never flattened', () => {
    // What makes this an extension of an existing exemption rather than a new
    // rule about what a label may contain.
    expect(wire('[![i](i.png)](z)\n')).toEqual([
      {
        type: 'link',
        href: 'z',
        children: [{ type: 'image', src: 'i.png', alt: 'i' }],
      },
    ])
    expect(wire('[`c`](z)\n')).toEqual([
      { type: 'link', href: 'z', children: [{ type: 'code', value: 'c' }] },
    ])
  })

  it('CONTROL a link that is NOT nested is untouched', () => {
    expect(carveToHtml('[x](y)\n')).toBe('<p><a href="y">x</a></p>')
    expect(wire('[x](y)\n')).toEqual([
      { type: 'link', href: 'y', children: [{ type: 'text', value: 'x' }] },
    ])
    // And a link inside a FOOTNOTE body is not nested: the body renders outside
    // any anchor, so the walk re-enters it with the flag cleared.
    expect(carveToHtml('see[^a]\n\n[^a]: a [b](/c) d\n')).toContain('<a href="/c">b</a>')
  })
})
