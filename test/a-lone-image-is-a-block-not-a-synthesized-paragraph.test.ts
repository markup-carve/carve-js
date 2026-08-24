import { describe, expect, it } from 'vitest'
import { htmlToAst, htmlToCarve, parse } from '../src/index.js'

const tree = (html: string) => htmlToAst(html).value.children
const types = (html: string) => tree(html).map((node) => node.type)

/** What the SOURCE exit says the same input is, read back through the parser. */
const viaSource = (html: string) => parse(htmlToCarve(html).value).children

/**
 * A LONE IMAGE IS A BLOCK, AND THE PARAGRAPH AROUND IT WAS OURS
 * (`markup-carve/carve-js#1411`).
 *
 * HTML has no block/inline slot distinction, so `blocks()` puts a stray inline
 * into a paragraph to have somewhere to put it. `src/html-import.ts` already
 * states the consequence for a `<figure>` body, in `captionHost`: PART 9 §4b
 * enumerates the caption hosts as "an image, a quote, a code block, a
 * display-math paragraph", so the image host is the IMAGE, and
 *
 *   > The wrapper is OURS, not the author's. [...] taking that paragraph back
 *   > off drops nothing the document held.
 *
 * That reasoning never depended on a `<figure>` being present, and `captionHost`
 * is only reached from `figure()`, so every other block level kept the wrapper.
 *
 * IT IS AN ADDITION, WHICH IS WHY IT IS THE TREE'S DEFECT AND NOT THE SOURCE'S.
 * The importer's two exits disagreed here: `htmlToCarve` writes the bare image,
 * and that re-parses to a bare `image` block. A declared LOSS is a ceiling an
 * import may sit inside; a synthesized paragraph is the document coming back
 * saying something it never said, which changes what it MEANS. So the wrapper
 * goes rather than the disagreement being written down.
 */
describe('a lone image is a block, not a synthesized paragraph', () => {
  // The shape the spec fixture `detached-caption-caret` records, which arrives
  // with the pin bump this was found under.
  const detachedCaption = '<img src="g.jpg" alt="G">\n<p>^ c</p>'

  it('builds a bare image at the document root', () => {
    expect(tree(detachedCaption)[0]).toMatchObject({
      type: 'image',
      src: 'g.jpg',
      alt: 'G',
    })
  })

  it('leaves the paragraph beside it alone', () => {
    expect(types(detachedCaption)).toEqual(['image', 'paragraph'])
  })

  // THE WHITESPACE HALF, AND IT IS A PREMISE GUARD RATHER THAN A CLAIM ABOUT
  // THE FIX. The `\n` between the `<img>` and the `<p>` IS buffered into the
  // wrapper by `blocks()`, and the spec's declared-lag note for this fixture
  // records a tree carrying such a node - so a whitespace-tolerant predicate
  // reads as necessary. In this engine `blockInlines` has already trimmed it by
  // the time the run arrives, which is why `bareBlockImage` is the strict
  // one-child form. This holds on BOTH sides of that fix by design: what it
  // guards is the premise, so it goes red if the trimming ever stops and the
  // strict predicate silently starts declining the shape it was written for.
  it('hands the run no whitespace-only text to begin with', () => {
    expect(JSON.stringify(tree(detachedCaption))).not.toMatch(
      /"type":"text","value":"[ \t\n]*"/,
    )
  })

  it('agrees with the source exit', () => {
    expect(types(detachedCaption)).toEqual(viaSource(detachedCaption).map((n) => n.type))
  })

  // AT EVERY BLOCK LEVEL, not only the root: the wrapper is synthesized by the
  // same `blocks()` call wherever a stray inline run turns up.
  it('builds a bare image inside a div', () => {
    expect(types('<div><img src="g.jpg" alt="G"></div>')).toEqual(['image'])
  })

  it('builds a bare image inside a blockquote', () => {
    const quote = tree('<blockquote><img src="g.jpg" alt="G"></blockquote>')[0]!
    expect(quote).toMatchObject({
      type: 'block_quote',
      children: [{ type: 'image', src: 'g.jpg' }],
    })
  })
})

/**
 * THE BOUNDS, and each is a shape a wider fix would also have unwrapped.
 *
 * The rule is not "an image is never in a paragraph" - it is that a wrapper
 * this importer synthesized around NOTHING BUT one image held nothing. A run
 * that carries anything else is a paragraph the document really has, and it is
 * what `![a](i.png) folding content` parses to as well.
 */
describe('the shapes that keep their paragraph', () => {
  it('keeps it when the image shares the run with text', () => {
    expect(tree('<img src="g.jpg" alt="G"> hello')).toEqual([
      expect.objectContaining({ type: 'paragraph' }),
    ])
  })

  it('keeps it when two images share the run', () => {
    expect(types('<img src="a.jpg" alt="A">\n<img src="b.jpg" alt="B">')).toEqual(['paragraph'])
  })

  // THE AUTHOR'S OWN `<p>` IS NOT OURS TO TAKE. Removing it would be a LOSS
  // rather than the removal of an addition, and the two are not the same call.
  // The source exit writes `![G](g.jpg)` for this shape and reports nothing,
  // so the two exits disagree here too - filed separately, because the exit at
  // fault is the other one.
  it('keeps the paragraph the author wrote', () => {
    expect(types('<p><img src="g.jpg" alt="G"></p>')).toEqual(['paragraph'])
  })

  it('keeps a paragraph that carries its own attributes', () => {
    expect(tree('<p class="x"><img src="g.jpg" alt="G"></p>')[0]).toMatchObject({
      type: 'paragraph',
      attrs: { classes: ['x'] },
    })
  })

  // A figure body was already unwrapped by `captionHost`, and still is: the
  // target is the image, not a paragraph around it.
  it('still gives a figure the image as its target', () => {
    expect(
      tree('<figure><img src="g.jpg" alt="G"><figcaption>c</figcaption></figure>')[0],
    ).toMatchObject({ type: 'figure', target: { type: 'image', src: 'g.jpg' } })
  })
})
