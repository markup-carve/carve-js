import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/**
 * PART 11 §1: `to_html(fmt(x)) == to_html(x)`, on a block attached with the
 * continuation marker (PART 9 §17).
 *
 * The writer converts a `+` attachment into indentation whenever the attached
 * block cannot fold into the paragraph above it. Two things it got wrong
 * (markup-carve/carve-js#902), which turn out to be one rule each:
 *
 * - a standalone `image` and a `figure` are written as a bare inline run on
 *   their own line, so at the item's content column they ARE lazy continuation.
 *   The `<figure>` disappeared and the caption came out as literal text.
 * - once one child is written at the marker column - column 0 - a later child at
 *   the item's content column is INDENTED relative to it and is absorbed as its
 *   lazy continuation. Only the last line of the attached run was indented, and
 *   a thematic break folded into the paragraph above it as an em dash.
 *
 * The two are separate seams, which is what the ticket asked to determine rather
 * than assume: carve-rs reproduces the caption loss and not the indentation, and
 * the fix here has two independent conditions.
 */

const roundTrips = (src: string) => carveToHtml(carveToCarve(src)) === carveToHtml(src)

describe('a continuation marker attaches every block in its run', () => {
  it('a +-attached image with a caption keeps its figure', () => {
    const src = '- x\n+\n![a](i.png)\n^ cap\n'
    expect(carveToCarve(src)).toBe(src)
    expect(roundTrips(src)).toBe(true)
    const html = carveToHtml(carveToCarve(src))
    expect(html).toContain('<figure>')
    expect(html).toContain('<figcaption>cap</figcaption>')
    expect(html).not.toContain('^ cap')
  })

  it('a +-attached image without a caption stays a block image', () => {
    const src = '- x\n+\n![a](i.png)\n'
    expect(carveToCarve(src)).toBe(src)
    expect(roundTrips(src)).toBe(true)
  })

  it('every later child of the run is written at the marker column too', () => {
    const src = '- x\n+\n---yaml\nk: v\n---\n'
    // ONE MARKER, ONE BLOCK (§17 L3, markup-carve/carve#1290). The marker takes
    // the paragraph and the break below it is the document's, so the writer has
    // no second child of the run to place and emits an ordinary separator. This
    // row read `+` before the break while the marker still attached the whole
    // run; carve-rs `b6ff319c` writes exactly what is asserted here, and renders
    // the `<hr>` outside the list for the same reason.
    expect(carveToCarve(src)).toBe('- x\n+\n---yaml\nk: v\n\n---\n')
    expect(roundTrips(src)).toBe(true)
    expect(carveToHtml(carveToCarve(src))).toContain('<hr>')
  })

  it('every block construct measured attaches without loss', () => {
    // The sweep this was found by, kept so a construct added later that folds
    // fails here instead of in a document.
    const constructs = [
      'p',
      '![a](i.png)',
      '![a](i.png)\n^ cap',
      '# h',
      '```\nc\n```',
      '> q',
      '| a |\n|---|\n| y |',
      '---',
      '::: {.d}\nb\n:::',
      '- inner',
      't\n: d',
      '*[T]: e',
      '[a]: /u',
      '%% c',
      '::: note\nb\n:::',
      '::: |\nl1\nl2\n:::',
      '$$\nx\n$$',
      '```=html\n<b>x</b>\n```',
      '[^f]: n',
      '---yaml\nk: v\n---',
    ]
    for (const block of constructs) {
      expect(roundTrips(`- x\n+\n${block}\n`), block).toBe(true)
    }
  })

  it('CONTROL: a +-attached paragraph already kept its marker', () => {
    expect(carveToCarve('- x\n+\np\n')).toBe('- x\n+\np\n')
  })

  it('CONTROL: a +-attached fence is still converted to indentation', () => {
    // The sharp control: it shows the `+`-to-indentation conversion is not
    // wrong in general, so the fix is not "always keep the `+`". No mutation of
    // the fold set moves it.
    expect(carveToCarve('- x\n+\n```\nc\n```\n')).toBe('- x\n  ```\n  c\n  ```\n')
    expect(carveToCarve('- x\n+\n> q\n')).toBe('- x\n  > q\n')
    expect(carveToCarve('- x\n+\n# h\n')).toBe('- x\n  # h\n')
    expect(carveToCarve('- x\n+\n---\n')).toBe('- x\n  ---\n')
  })

  it('CONTROL: an already-indented image with no marker is left alone', () => {
    // It is one paragraph holding an inline image, and it must stay one.
    expect(carveToCarve('- x\n  ![a](i.png)\n  ^ cap\n')).toBe('- x\n  ![a](i.png)\n  ^ cap\n')
    expect(roundTrips('- x\n  ![a](i.png)\n  ^ cap\n')).toBe(true)
  })

  it('a blockquote reaches the same shape through its own prefix', () => {
    expect(roundTrips('> x\n+\n![a](i.png)\n^ cap\n')).toBe(true)
  })

  it('is idempotent', () => {
    for (const src of ['- x\n+\n![a](i.png)\n^ cap\n', '- x\n+\n---yaml\nk: v\n---\n']) {
      const once = carveToCarve(src)
      expect(carveToCarve(once)).toBe(once)
    }
  })
})
