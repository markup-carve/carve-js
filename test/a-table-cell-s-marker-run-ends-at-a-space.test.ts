import { describe, expect, it } from 'vitest'

import { carveToCarve, carveToHtml } from '../src/index.js'

/**
 * Spec §5 T11: a cell's marker run - the kind marker `=`, the alignment run and
 * the attribute block, in T10's order - ends at a space.
 *
 * The run had no terminator, so it took content instead. `|=hot= |` was a
 * header cell holding `hot=`: the `=` the author wrote to open a highlight was
 * eaten by the marker, and nothing said so. The alignment part already required
 * the space; the kind marker and the attribute block did not, which is the hole
 * this closes.
 *
 * The run is ATOMIC. A rejected alignment run takes the `=` with it, so
 * `|=<< Note |` is not a header cell holding `<< Note` - it is a data cell
 * whose text is `=<< Note`. Reading the `=` as a marker while rejecting the
 * rest is the "first marker wins, the rest is content" behaviour the clause
 * replaces.
 */

const cells = (src: string): string => carveToHtml(src).replace(/\s+/g, ' ').trim()

describe("a table cell's marker run", () => {
  it('ends at a space, so a glued kind marker is content', () => {
    expect(cells('|=hot= |')).toContain('<td><mark>hot</mark></td>')
    expect(cells('|=a |')).toContain('<td>=a</td>')
    expect(cells('|= a |')).toContain('<th scope="col">a</th>')
  })

  it('takes the attribute block with it', () => {
    expect(cells('|{#x} =R |')).toContain('<td id="x">=R</td>')
    const glued = cells('|{#x}=R|')
    expect(glued).not.toContain('id="x"')
    expect(glued).not.toContain('<th')
  })

  it('is atomic: a rejected alignment run takes the kind marker with it', () => {
    expect(cells('|=<< Note |= Plain |')).toContain(
      '<tr><td>=&lt;&lt; Note</td><th scope="row">Plain</th></tr>',
    )
    // A lone vertical marker never stood alone; now it takes the `=` too.
    expect(cells('|=^ Top |')).toContain('<td>=^ Top</td>')
  })

  it('is not terminated by the closing pipe, and not by a tab', () => {
    expect(cells('|= h |')).toContain('<th scope="col">h</th>')
    // An all-blank header row is a paragraph, not an empty-header table
    // (markup-carve/carve#1954); a header cell needs content to be one.
    expect(carveToHtml('|= |')).toBe('<p>|= |</p>')
    expect(cells('|=|')).toContain('<td>=</td>')
    // Read off the raw HTML: the `cells` helper folds whitespace, and the tab
    // surviving INSIDE the content is the half worth asserting.
    expect(carveToHtml('|=\th |')).toContain('<td>=\th</td>')
  })

  it('leaves a cell with no run alone', () => {
    expect(cells('|a|')).toContain('<td>a</td>')
    expect(cells('| a |')).toContain('<td>a</td>')
  })

  it('reaches the other reading through an escape', () => {
    expect(cells('|\\= a |')).toContain('<td>= a</td>')
  })

  it('round-trips through the writer, which pads every cell', () => {
    for (const src of ['|=hot= |', '|=a |', '|= a |', '|{#x}=R|', '|=|', '|a|']) {
      expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
    }
  })
})
