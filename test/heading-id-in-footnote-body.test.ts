import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A heading inside a footnote body gets a generated id, like a heading in any
 * other container.
 *
 * `resolveHeadingIds` walked `doc.children` only. A note body's blocks live in
 * `doc.footnoteDefs`, so the pass never reached them and the heading rendered as
 * a bare `<h1>` - while the same heading in a list item, block quote, div or
 * definition list got its slug (carve-js#669).
 *
 * The executable spec, carve-rs and carve-php all assign it.
 */

const ids = (src: string) => carveToHtml(src).match(/id="H[^"]*"/g) ?? []

describe('a heading inside a footnote body', () => {
  it('gets its generated id', () => {
    expect(carveToHtml('[^a]: note\n\n  # H\n\nsee[^a]\n')).toContain('<h1 id="H">')
  })

  it('slugs a trailing brace run as TEXT, not as attributes', () => {
    // Carve is djot-strict here: a trailing `{...}` on a heading is not an
    // attribute list, so `# H {#mine}` is a heading whose text is `H {#mine}`
    // and the slug follows from that. All three of the others agree on
    // `H-mine`; I expected `mine` and was wrong.
    expect(carveToHtml('[^a]: note\n\n  # H {#mine}\n\nsee[^a]\n')).toContain('id="H-mine"')
  })

  it('honors an id set by a preceding attribute line', () => {
    // The form that DOES set an explicit id.
    expect(carveToHtml('[^a]: note\n\n  {#mine}\n  # H\n\nsee[^a]\n')).toContain('id="mine"')
  })

  it('emits no <section> wrapper, like any nested heading', () => {
    // Nested headings carry the id on the <h*> and nothing else; the section
    // wrapper is a top-level-only concern.
    const out = carveToHtml('[^a]: note\n\n  # H\n\nsee[^a]\n')
    expect(out).toContain('<h1 id="H">')
    expect(out).not.toContain('<section id="H"')
  })
})

describe('the dedup counter follows OUTPUT order', () => {
  // The endnotes section renders last, so a top-level heading takes the bare
  // slug and the note body's takes `-2` - whichever order they sit in the
  // SOURCE. Measured in all three of the others before being pinned here.
  it('top-level first in the source', () => {
    expect(ids('# H\n\n[^a]: note\n\n  # H\n\nsee[^a]\n')).toEqual(['id="H"', 'id="H-2"'])
  })

  it('note body first in the source', () => {
    expect(ids('[^a]: note\n\n  # H\n\n# H\n\nsee[^a]\n')).toEqual(['id="H"', 'id="H-2"'])
  })
})

describe('the containers that already worked still do', () => {
  it('a list item', () => {
    expect(carveToHtml('- # H\n')).toContain('id="H"')
  })

  it('a block quote', () => {
    expect(carveToHtml('> # H\n')).toContain('id="H"')
  })

  it('top level still gets its section wrapper', () => {
    // The boundary: adding the note-body walk must not change the top-level
    // shape, which DOES wrap in a section.
    expect(carveToHtml('# H\n')).toContain('<section id="H"')
  })
})
