import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, parse, renderHtml } from '../src/index.js'

/**
 * A SOLE-IMAGE PARAGRAPH IS A BARE `<img>` INSIDE A CONTAINER TOO
 * (`markup-carve/carve-js#1440`, the half `carve-js#1443` could not reach).
 *
 * `carve-js#1438` gave the resolve-time promotion the column re-check
 * `markup-carve/carve#1660` asks for, so an INDENTED lone image is a paragraph
 * in the tree - and `carve-js#1443` then collapsed that paragraph back to a bare
 * `<img>` in the HTML, because the corpus and the other two engines emit one at
 * every column. Corpus
 * `411-a-lone-indented-image-is-a-paragraph-and-its-html-cannot-say-so` is the
 * ruling in its own name.
 *
 * That collapse lived in `renderBlockNode`'s `paragraph` arm, and THREE render
 * paths never go through it. The blockquote, `<li>` and `<dd>` renderers each
 * take a compact form when their one visible child is a PARAGRAPH, and they
 * render it by calling `renderInlines` on its children directly. So a lone image
 * indented past a container's content column kept its wrapper:
 *
 *     >   ![a](u)
 *
 * gave `<blockquote><p><img src="u" alt="a"></p></blockquote>` where carve-rs
 * (release binary, `da1ab7a4`) and carve-php (through its own autoloader) both
 * give the expanded bare-image form. carve-rs hit the same thing taking
 * carve#1660 and answered it the same way, with a pass ahead of the renderer
 * rather than an arm inside it (carve-rs#1347).
 *
 * WHY NO EXISTING TEST SAW IT. The spec corpus pins the two TOP-LEVEL spellings
 * of 411 and nothing else: measured across every `.crv` on `carve` main, the
 * only container-hosted image is `405`, which is flush AND captioned. This repo
 * cannot render 411 at all yet - it pins `spec` at `a04c0af2`, which still
 * predates the category (draft `carve-js#1435` is the bump that reaches it). So
 * the container shapes are pinned here, in this repo's own tests, because no
 * corpus document reaches them.
 *
 * EVERY EXPECTATION BELOW IS THE OTHER TWO ENGINES' OUTPUT, measured on the same
 * source. They agree byte for byte on all of it.
 */

const quoteChildren = (src: string) => {
  const [quote] = carveToAstJson(src).children
  expect(quote!.type).toBe('block_quote')

  return (quote as { children: { type: string }[] }).children.map((n) => n.type)
}

describe('a container hosting a lone image past its content column', () => {
  // BOTH HALVES, on the same source. The tree still says paragraph and the HTML
  // still declines to repeat it - a test that read only one of them could not
  // see this bug, because each half has been correct while the other was not.
  it('renders bare inside a quote', () => {
    expect(carveToHtml('>   ![a](u)\n')).toBe('<blockquote>\n  <img src="u" alt="a">\n</blockquote>')
  })

  it('still publishes a paragraph inside that quote', () => {
    expect(quoteChildren('>   ![a](u)\n')).toEqual(['paragraph'])
  })

  it('renders bare inside a list item', () => {
    expect(carveToHtml('- t\n\n   ![a](u)\n')).toBe(
      '<ul>\n  <li>t\n    <img src="u" alt="a">\n  </li>\n</ul>',
    )
  })

  // The REFERENCE spelling reaches block position only through `resolve()`, so
  // there is no syntactic block-image pass behind it at all - it is the shape
  // corpus 411's `-2` twin pins at top level, and nothing pins in a container.
  it('renders bare inside a quote for a reference image', () => {
    expect(carveToHtml('>   ![a][r]\n\n[r]: u\n')).toBe(
      '<blockquote>\n  <img src="u" alt="a">\n</blockquote>',
    )
  })

  // A leading block-attribute line lands on the PARAGRAPH. Dropping the wrapper
  // must not drop the id with it.
  it('carries a block-attribute line onto the image it collapses to in a quote', () => {
    expect(carveToHtml('> {#x}\n>   ![a](u)\n')).toBe(
      '<blockquote>\n  <img src="u" alt="a" id="x">\n</blockquote>',
    )
  })

  // A `<dd>` is the third compact form, and it turns out NO SOURCE reaches the
  // shape there: the `:` marker absorbs its padding at every width, so both
  // spellings below arrive as a block image already and neither moved when this
  // fix was reverted. They are kept as CONTROLS, not as regression pins - they
  // say the collapse does not disturb the `<dd>` compact form, and they are the
  // measurement behind the claim that the description path needed nothing. Only
  // the two-block form further down, where the second block gets its own
  // indentation, can spell it - and that one does go red without the pass.
  it('renders bare inside a description at its content column', () => {
    expect(carveToHtml(':: term\n:  ![a](u)\n')).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd>\n    <img src="u" alt="a">\n  </dd>\n</dl>',
    )
  })

  it('renders bare inside a description past its content column', () => {
    expect(carveToHtml(':: term\n:   ![a](u)\n')).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd>\n    <img src="u" alt="a">\n  </dd>\n</dl>',
    )
  })

  it('renders bare as a later block inside a description', () => {
    expect(carveToHtml(':: term\n:  t\n\n    ![a](u)\n')).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd>\n    <p>t</p>\n    <img src="u" alt="a">\n  </dd>\n</dl>',
    )
  })

  it('renders bare inside a div', () => {
    expect(carveToHtml(':::\n ![a](u)\n:::\n')).toBe('<div>\n  <img src="u" alt="a">\n</div>')
  })

  it('renders bare inside a footnote body', () => {
    expect(carveToHtml('[^1]: t\n\n       ![a](u)\n\ntext[^1]\n')).toContain(
      '      <p>t</p>\n      <img src="u" alt="a">\n',
    )
  })

  // The FLUSH control on the same container. Its bytes are identical to the
  // indented one above and its TREE is not, which is the whole ruling: the two
  // exits are allowed to disagree, and only here.
  it('renders bare inside a quote at the content column too', () => {
    expect(carveToHtml('> ![a](u)\n')).toBe('<blockquote>\n  <img src="u" alt="a">\n</blockquote>')
  })

  it('publishes a block image for the flush spelling in a quote', () => {
    expect(quoteChildren('> ![a](u)\n')).toEqual(['image'])
  })
})

/**
 * THE NEAR MISSES a collapse reaching one step wider would eat. All three
 * engines keep the `<p>` on every one, and each sits in its own test: a run
 * stops at the first failing assertion, so two near misses sharing a test means
 * the second is never evaluated on the side where it would fail.
 */
describe('what does not collapse, inside a container', () => {
  // Corpus `158-indented-image-and-caption-stay-literal`, in a quote. The FIGURE
  // promotion stays column-gated on both paths - lifting the gate there would
  // build a figure the author did not write - and this pass cannot reach the
  // shape anyway, because a captioned paragraph holds three inlines.
  it('keeps the wrapper on an indented image with a caption line', () => {
    expect(carveToHtml('>   ![a](u)\n>   ^ cap\n')).toBe(
      '<blockquote><p><img src="u" alt="a">\n^ cap</p></blockquote>',
    )
  })

  it('keeps the wrapper on an unresolved reference image in a quote', () => {
    expect(carveToHtml('>   ![a][nope]\n')).toBe('<blockquote><p>![a][nope]</p></blockquote>')
  })

  it('keeps the wrapper when text shares the paragraph in a quote', () => {
    expect(carveToHtml('>   ![a](u) t\n')).toBe('<blockquote><p><img src="u" alt="a"> t</p></blockquote>')
  })

  it('keeps the wrapper when a second image shares the paragraph in a quote', () => {
    expect(carveToHtml('>   ![a](u)\n>   ![b](v)\n')).toBe(
      '<blockquote><p><img src="u" alt="a">\n<img src="v" alt="b"></p></blockquote>',
    )
  })
})

/**
 * The pass is COPY ON WRITE because `renderHtml` is public API and the caller
 * owns the `Document` it hands over. A caller that renders a tree and then
 * publishes it must get back the tree it built, paragraph and all - otherwise
 * this would undo `carve-js#1438` through the back door for every caller that
 * renders before it serializes.
 */
describe('rendering does not rewrite the caller tree', () => {
  it('leaves the document it was given untouched', () => {
    const doc = parse('>   ![a](u)\n')
    const before = structuredClone(doc)
    expect(renderHtml(doc)).toBe('<blockquote>\n  <img src="u" alt="a">\n</blockquote>')
    expect(doc).toEqual(before)
  })

  /**
   * A FOOTNOTE LABEL IS AUTHOR-CONTROLLED, and `[^__proto__]: body` is a real,
   * resolvable definition - `Object.getOwnPropertyNames(doc.footnoteDefs)`
   * reports `__proto__` for it. Copying that map with `next[label] = …` onto an
   * object literal finds `Object.prototype`'s accessor instead of creating an
   * own property, so the definition vanishes from the copy.
   *
   * The failure is invisible except in combination: it needs a lone-image
   * paragraph in the SAME document, because the pass returns the document
   * untouched otherwise. Then the reference resolves against nothing, falls back
   * to literal source, and the entire footnote section is gone from the output.
   * Found by `codex review`, and reproduced before it was believed.
   */
  it('keeps a footnote definition whose label is a prototype key', () => {
    const html = carveToHtml('[^__proto__]: body text\n\ncall[^__proto__]\n\n ![a](u)\n')
    expect(html).toContain('<p>body text<a href="#fnref1"')
    expect(html).not.toContain('[^__proto__]')
  })

  // A `paragraph > image` also arrives from `--from-json` and from a tree built
  // through the API, where no column was ever recorded. Those collapse too: the
  // answer is a property of the shape, not of how it got here.
  it('collapses a nested paragraph that never came from source', () => {
    const doc = {
      type: 'document' as const,
      children: [
        {
          type: 'block_quote' as const,
          children: [
            {
              type: 'paragraph' as const,
              children: [{ type: 'image' as const, src: 'u', alt: 'a' }],
            },
          ],
        },
      ],
    }
    expect(renderHtml(doc)).toBe('<blockquote>\n  <img src="u" alt="a">\n</blockquote>')
  })
})
