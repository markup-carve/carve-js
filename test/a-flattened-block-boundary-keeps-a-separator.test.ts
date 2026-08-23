import { describe, it, expect } from 'vitest'
import { htmlToCarve, carveToHtml } from '../src/index.js'

/**
 * PART 11 §1b: where two former sibling blocks each contribute at least one
 * TOKEN, a separator is required, and it is sufficient iff re-reading the slot
 * draws no token from both sides of the join.
 *
 * A caption holds inline content, so a `<figcaption>` carrying two paragraphs is
 * FLATTENED and the slot has nowhere to put a node for the boundary. Joined
 * instead of separated, the join is read back as one thing rather than two, and
 * nothing below this reports it: `element-unwrapped` says a `<p>` was unwrapped
 * and says nothing about what the unwrapping joined, the HTML is well-formed,
 * and the round trip holds on the joined value.
 *
 * THE UNIT IS THE TOKEN, NOT THE NODE. A node test passes `onetwo` and `one two`
 * alike, which is exactly the trap: `one` and `two` are two text nodes either
 * way. Each case below asserts the rendered BYTES.
 */

const caption = (inner: string): string =>
  `<figure><img src="/i" alt="x"><figcaption>${inner}</figcaption></figure>`

const rendered = (html: string): string => carveToHtml(htmlToCarve(html).value)

const figure = (cap: string): string =>
  `<figure>\n  <img src="/i" alt="x">\n  <figcaption>${cap}</figcaption>\n</figure>`

describe('a flattened block boundary keeps a separator', () => {
  it('keeps two words apart', () => {
    expect(rendered(caption('<p>one</p><p>two</p>'))).toBe(figure('one two'))
  })

  /**
   * The two shapes where the join CORRUPTS rather than merely merges, and
   * neither is in the ticket that raised the rule. `*a**b*` is one strong run
   * holding a literal asterisk; two adjacent code spans become one span holding
   * the delimiters that used to end and begin them.
   */
  it('keeps two strong runs from merging into one', () => {
    expect(rendered(caption('<p><strong>a</strong></p><p><strong>b</strong></p>'))).toBe(
      figure('<strong>a</strong> <strong>b</strong>'),
    )
  })

  it('keeps two code spans from merging into one', () => {
    expect(rendered(caption('<p><code>a</code></p><p><code>b</code></p>'))).toBe(
      figure('<code>a</code> <code>b</code>'),
    )
  })

  /**
   * A BLOCK THAT CONTRIBUTES NO TOKEN IS NOT A SIDE. This is the near-miss a
   * fix that separates every block boundary also breaks - it reads `a  b`, one
   * space too many, and the HTML collapses it so only the emitted Carve shows
   * the difference.
   */
  it('takes no separator for an empty block between two full ones', () => {
    expect(htmlToCarve(caption('<p>a</p><p></p><p>b</p>')).value).toBe('![x](/i)\n^ a b\n')
    expect(rendered(caption('<p>a</p><p></p><p>b</p>'))).toBe(figure('a b'))
  })

  it('takes no separator where the source already wrote whitespace between the tags', () => {
    expect(htmlToCarve(caption('<p>one</p>\n<p>two</p>')).value).toBe('![x](/i)\n^ one two\n')
  })

  /**
   * SUFFICIENCY, ASKED FROM EACH SIDE SEPARATELY. Whitespace already at the
   * boundary makes the separator unnecessary wherever it sits - trailing on the
   * block before, leading on the block after - and a whitespace-only block is
   * the token test rather than the node test: it holds a node, so a check that
   * counted nodes would call it a side and write a second space.
   */
  const sufficient: Record<string, string> = {
    'a whitespace-only block between two full ones': '<p>a</p><p> </p><p>b</p>',
    'whitespace leading the block after': '<p>a</p><p> b</p>',
    'whitespace trailing the block before': '<p>a </p><p>b</p>',
  }

  for (const [label, inner] of Object.entries(sufficient)) {
    it(`adds nothing where the boundary already separates: ${label}`, () => {
      expect(htmlToCarve(caption(inner)).value).toBe('![x](/i)\n^ a b\n')
    })
  }

  it('opens the slot with no separator when the first block is empty', () => {
    expect(htmlToCarve(caption('<p></p><p>b</p>')).value).toBe('![x](/i)\n^ b\n')
  })

  it('keeps the boundary across a node that produced nothing at all', () => {
    // An empty inline element leaves the slot untouched, so the block before it
    // is still the left side of the join and `b` is still the right one. A walk
    // that let any node clear the pending boundary reads `ab` here.
    expect(htmlToCarve(caption('<p>a</p><span></span>b')).value).toBe('![x](/i)\n^ a b\n')
  })

  it('adds nothing after a break, which already separates', () => {
    expect(htmlToCarve(caption('<p>a<br></p><p>b</p>')).value).toBe('![x](/i)\n^ a\\\nb\n')
  })

  it('adds nothing before a break, which separates from the other side', () => {
    expect(htmlToCarve(caption('<p>a</p><p><br>b</p>')).value).toBe('![x](/i)\n^ a\\\nb\n')
  })

  it('separates a boundary the source spelled as list items', () => {
    // The clause is over every inline-only slot an importer can reach, not over
    // the caption it was first measured in: two `<li>` join exactly as two `<p>`.
    expect(rendered(caption('<ul><li>a</li><li>b</li></ul>'))).toBe(figure('a b'))
  })

  it('separates a block from the loose text beside it, in either order', () => {
    expect(rendered(caption('a<p>b</p>'))).toBe(figure('a b'))
    expect(rendered(caption('<p>a</p>b'))).toBe(figure('a b'))
  })

  /**
   * A character that was TEXT and turns into a live delimiter once its neighbour
   * arrives beside it is a DIFFERENT question, already answered by the writer's
   * escaping rule. The clause says so, and this pins that the separator does not
   * take that job on: the asterisk is escaped because the writer reads its own
   * output, not because a separator was inserted between them.
   *
   * ONE ASTERISK, not both. Strong needs an opener AND a closer, so suppressing
   * the opener is the whole of it and the second asterisk opens nothing on its
   * own - PART 11 §2 per opener occurrence (markup-carve/carve#1533). The
   * unit-scoped form escaped both, and the second backslash was idle.
   */
  it('leaves a delimiter that becomes live to the writer to escape', () => {
    expect(htmlToCarve(caption('<p>a *b</p><p>c* d</p>')).value).toBe('![x](/i)\n^ a \\*b c* d\n')
    expect(rendered(caption('<p>a *b</p><p>c* d</p>'))).toBe(figure('a *b c* d'))
  })

  /**
   * THE INTENDED SURVIVORS. One block is not a boundary and neither is none, so
   * these read the same with the separator removed - which is what makes the
   * cases above evidence about the boundary rather than about the importer.
   */
  it('adds nothing to a caption holding one paragraph', () => {
    expect(htmlToCarve(caption('<p>only</p>')).value).toBe('![x](/i)\n^ only\n')
  })

  it('adds nothing to a caption holding no block at all', () => {
    expect(htmlToCarve(caption('plain')).value).toBe('![x](/i)\n^ plain\n')
  })

  it('adds nothing between two inline siblings', () => {
    expect(htmlToCarve(caption('<strong>a</strong><em>b</em>')).value).toBe('![x](/i)\n^ *a*/b/\n')
  })
})
