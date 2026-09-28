import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A marker line the block parser folds into an open paragraph opens no item, so
 * a definition on the line below it is a document definition and registers.
 *
 * The definition prepass pushed a content column for the marker line anyway,
 * because whether the marker folds is `paragraphReallyOpen` and that is not
 * computed until both column stacks have moved. The definition below then read
 * as the phantom item's lazy continuation, and the collection gate - which asks
 * for an empty list-column stack - rejected it. An abbreviation written there
 * expanded in the oracle, in carve-rs and in carve-php, and nowhere in this
 * engine (carve-js#2236).
 *
 * The prepass now retracts the column once the verdict exists, which leaves the
 * marker line itself measured against its own column and restores the stack only
 * for the line below. Values are the oracle's, run at spec `71b51d00`.
 *
 * THE TWO CONTROLS ARE THE POINT. A real item must keep its column, or the
 * retraction would hand every indented definition to the document.
 */
describe('a definition under a folded marker registers', () => {
  const html = (src: string) => carveToHtml(src).trim()

  it('expands an abbreviation defined under the folded marker', () => {
    expect(html('x\n- A\n*[A]: b\n')).toBe('<p>x\n- <abbr title="b">A</abbr></p>')
    expect(html('`x`\n- A\n*[A]: b\n')).toBe('<p><code>x</code>\n- <abbr title="b">A</abbr></p>')
  })

  it('reads the same when the fold runs through an empty bullet and an ordered marker', () => {
    expect(html('*\n. A\n*[A]: _\n')).toBe('<p>*\n. <abbr title="_">A</abbr></p>')
  })

  it('registers a reference definition written there too', () => {
    // Same gate, a different definition kind: the phantom column rejected all of
    // them, so fixing it on the abbreviation alone would have been a coincidence.
    expect(html('x\n- A\n[d]: /u\n\n[d][]\n')).toBe('<p>x\n- A</p>\n<p><a href="/u">d</a></p>')
  })

  it('leaves a REAL item its content column', () => {
    // The control. Here `- A` opens an item, the definition sits at its content
    // column, and it is item text rather than a document definition - so the
    // abbreviation does NOT expand.
    expect(html('- A\n  *[A]: b\n')).toBe('<ul>\n  <li>A\n*[A]: b</li>\n</ul>')
    expect(html('x\n\n- A\n*[A]: b\n')).toBe(
      '<p>x</p>\n<ul>\n  <li>A\n*[A]: b</li>\n</ul>',
    )
  })
})
