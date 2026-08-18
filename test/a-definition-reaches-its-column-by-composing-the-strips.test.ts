import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * ONE LINE CANNOT BE BOTH (carve-js#1199).
 *
 * The definition prepass registered a LINK reference definition off a line that
 * reaches no live content column, and `carveToHtml` printed that same line as
 * text in the same output. Whichever way the seam is settled, the engine that
 * renders `&gt; [r]: /url` inside a block quote is the one that cannot also
 * have consumed it - and carve-js's own FOOTNOTE kind was already on the other
 * side of it, so the two definition kinds disagreed with each other inside one
 * engine.
 *
 * The cause was a column model, not a reading. `listCols` walks list markers on
 * a view that strips a COLUMN-0 quote run and stops at the first quote it meets,
 * so under `- > - - x` it recorded 2 and lost the items at 6 and 8. It did not
 * matter, because the gate carried an exemption for any line supplying a
 * container prefix of its own - which every quoted definition line does.
 *
 * `composeContainerPrefix` takes each strip against the column the one before it
 * hands out (markup-carve/carve#1372, "compose the strips, do not walk the
 * prefix"), so the definition's own column is known and the exemption is gone.
 *
 * Every expectation below is the executable spec's own output for that input,
 * taken from `spec/scripts/spec/layout.mjs` plus `spec/scripts/spec/html.mjs`,
 * and carve-rs answers the same way. They are FULL documents rather than a
 * `toContain` on the reference, because the defect's output contains BOTH
 * halves: asserting only that the text survives passes on the wrong output too.
 */

const flat = (html: string): string => html.replace(/\n\s*/g, ' ').trim()

describe('a definition reaches its column by composing the strips', () => {
  it('does not register from an indented quote marker inside a quote', () => {
    expect(flat(carveToHtml('> a\n>   > [r]: /url\n\nSee [r][].\n'))).toBe(
      '<blockquote><p>a &gt; [r]: /url</p></blockquote> <p>See [r][].</p>',
    )
  })

  it('reads the footnote kind the same way, as it always did', () => {
    expect(flat(carveToHtml('> a\n>   > [^f]: note\n\nSee[^f]\n'))).toBe(
      '<blockquote><p>a &gt; [^f]: note</p></blockquote> <p>See[^f]</p>',
    )
  })

  it("does not register from a quote marker past a nested quote's own column", () => {
    expect(flat(carveToHtml('> > x\n>   > [r]: /url\n\nSee [r][].\n'))).toBe(
      '<blockquote> <blockquote><p>x &gt; [r]: /url</p></blockquote> </blockquote>' +
        ' <p>See [r][].</p>',
    )
  })

  it('does not register between two live content columns', () => {
    expect(flat(carveToHtml('- > - - x\n  >    [r]: /url\n\nSee [r][].\n'))).toBe(
      '<ul> <li> <blockquote> <ul> <li> <ul> <li>x [r]: /url</li> </ul> </li> </ul>' +
        ' </blockquote> </li> </ul> <p>See [r][].</p>',
    )
  })

  // A line that never writes the quote marker again is the quote paragraph's
  // lazy continuation. carve-js already read this one correctly; it is pinned
  // because an intermediate shape of the fix broke it, which is the
  // over-correction this whole change is most exposed to.
  it('does not register from a line that never re-enters the quote', () => {
    expect(flat(carveToHtml('- > x\n    [r]: /url\n\nSee [r][].\n'))).toBe(
      '<ul> <li> <blockquote><p>x [r]: /url</p></blockquote> </li> </ul> <p>See [r][].</p>',
    )
  })

  // The controls. Each one is a definition that DOES reach its column, and each
  // is meant to survive every mutation the fix is tested with.
  it('still registers at the innermost content column', () => {
    expect(flat(carveToHtml('- > - - x\n  >     [r]: /url\n\nSee [r][].\n'))).toBe(
      '<ul> <li> <blockquote> <ul> <li> <ul> <li>x</li> </ul> </li> </ul> </blockquote>' +
        ' </li> </ul> <p>See <a href="/url">r</a>.</p>',
    )
  })

  it('still registers on an item marker line', () => {
    expect(flat(carveToHtml('- [r]: /url\n\nSee [r][].\n'))).toBe(
      '<ul> <li></li> </ul> <p>See <a href="/url">r</a>.</p>',
    )
  })

  it('still registers inside a block quote', () => {
    expect(flat(carveToHtml('> [r]: /url\n\nSee [r][].\n'))).toBe(
      '<blockquote> </blockquote> <p>See <a href="/url">r</a>.</p>',
    )
  })

  it('still registers inside two block quotes', () => {
    expect(flat(carveToHtml('> > [r]: /url\n\nSee [r][].\n'))).toBe(
      '<blockquote> <blockquote> </blockquote> </blockquote> <p>See <a href="/url">r</a>.</p>',
    )
  })

  // A DESCRIPTION'S BODY STARTS WHERE ITS TEXT DOES, not at §16's fixed three.
  // The walk peels the whole `:` plus whitespace slot, so a wider one still puts
  // the definition at the column it opens - which is how the oracle reads it.
  it('still registers under a wider description slot', () => {
    expect(flat(carveToHtml(':: t\n:   [r]: /url\n\nSee [r][].\n'))).toBe(
      '<dl> <dt>t</dt> <dd></dd> </dl> <p>See <a href="/url">r</a>.</p>',
    )
  })

  // A SIBLING MARKER CLOSES WHAT WAS OPEN INSIDE. The item at column 4 is gone
  // once `- b` opens at column 0, so a definition written at 4 below it reaches
  // no live column and is `b`'s own lazy text.
  it('does not register at a column a sibling item closed', () => {
    expect(flat(carveToHtml('- - a\n- b\n    [r]: /url\n\nSee [r][].\n'))).toBe(
      '<ul> <li> <ul> <li>a</li> </ul> </li> <li>b [r]: /url</li> </ul> <p>See [r][].</p>',
    )
  })
})
