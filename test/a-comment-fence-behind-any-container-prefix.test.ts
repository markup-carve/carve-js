import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A DEFINITION WRITTEN INSIDE A COMMENT FENCE REGISTERS NOTHING, AT EVERY
 * COLUMN A FENCE CAN SIT AT (markup-carve/carve#1309) - INCLUDING BEHIND A
 * CONTAINER PREFIX OF ANY SHAPE.
 *
 * markup-carve/carve-js#1178 widened the definition prepass past leading
 * blockquote markers and past a list item's content column, and it held at
 * every depth measured except one: a quote inside a DOUBLY nested list still
 * registered (carve-js#1181).
 *
 * ````
 * - - > %%%
 *     > [r]: /url
 *     > %%%
 *
 * See [r][].
 * ````
 *
 * THE CAUSE IS THAT THE PREFIX WAS READ AS ONE MARKER, NOT AS A RUN. The pass
 * measured a line's quote depth from two views - the raw line, and the line
 * behind a single list marker - so `- - > %%%` reported depth 0 while its own
 * closer `    > %%%` reported depth 1. `commentCloserInScope` accepts only a
 * run at the opener's own depth, found none, and the region never opened, so a
 * definition inside an invisible comment went into the link table.
 *
 * TWO MORE SHAPES FAILED THE SAME TEST AND WERE NOT IN THE REPORT, which is why
 * this file pins the RULE rather than the reported row: `- - - > %%%` under-read
 * the same way, and `- > - > %%%` under-COUNTED, reporting one quote on a line
 * that carries two. Each widening of this prefix so far has been one more
 * spelling, and each left the next depth to be found.
 *
 * BOTH HALVES OF THE ANSWER HAVE TO AGREE, and that is what the leak violated:
 * the comment body renders as nothing, so a reference resolving out of it is the
 * parser publishing a definition it also hides. Every case below asserts the
 * rendered body is gone AND that the reference stayed literal; a fix that merely
 * stopped opening the region would satisfy the second and publish the commented
 * body into the document, which is the worse defect.
 */

const resolves = (doc: string) => carveToHtml(doc).includes('href="/url"')

// Every interleaving of a list marker and a quote marker up to depth 4. `-`
// contributes a two-space continuation, `>` contributes a `> ` one, which is
// how each shape's body and closer stay inside the container the opener sits in.
const prefixes: string[][] = []
for (let n = 1; n <= 4; n++) {
  for (let bits = 0; bits < 1 << n; bits++) {
    const seq: string[] = []
    for (let k = 0; k < n; k++) seq.push((bits >> k) & 1 ? '>' : '-')
    prefixes.push(seq)
  }
}
const opener = (seq: string[]) => seq.map((c) => (c === '-' ? '- ' : '> ')).join('')
const cont = (seq: string[]) => seq.map((c) => (c === '-' ? '  ' : '> ')).join('')

describe('a comment fence behind any container prefix', () => {
  it('the reported document leaves the reference literal', () => {
    const out = carveToHtml('- - > %%%\n    > [r]: /url\n    > %%%\n\nSee [r][].\n')
    expect(out).toContain('<p>See [r][].</p>')
    expect(out).not.toContain('href="/url"')
  })

  it('the two shapes the report did not name fail the same way', () => {
    expect(resolves('- - - > %%%\n      > [r]: /url\n      > %%%\n\nSee [r][].\n')).toBe(false)
    // Under-COUNTED rather than under-read: the line carries two quote markers
    // and one view of it saw one.
    expect(resolves('- > - > %%%\n  > > [r]: /url\n  > > %%%\n\nSee [r][].\n')).toBe(false)
  })

  it('the fence is still CONSUMED as a comment, so the body is gone', () => {
    // The registration is the only thing that moves. A fix that stopped opening
    // the region would also pass the assertions above - and would publish the
    // commented-out body into the document, which is the worse defect. This is
    // the row that separates the two.
    const out = carveToHtml(
      '- - > %%%\n    > [r]: /url\n    > hidden prose\n    > %%%\n\nSee [r][].\n',
    )
    expect(out).not.toContain('hidden prose')
    expect(out).not.toContain('href="/url"')
    expect(out).toContain('<blockquote>')
  })

  it('a definition the renderer HIDES is the only one suppressed', () => {
    // A shallower closer than its opener: `- - > %%%` closed by `  > %%%`. The
    // renderer swallowed the definition line here on main too, and the prepass
    // registered it anyway - the two halves contradicting each other, one
    // container deeper than the reported row.
    const out = carveToHtml('- - > %%%\n    > [r]: /url\n  > %%%\n\nSee [r][].\n')
    expect(out).not.toContain('[r]: /url')
    expect(out).not.toContain('href="/url"')
  })

  describe('the rule holds across every prefix, and only suppresses a fenced one', () => {
    for (const seq of prefixes) {
      const shape = seq.join(' ')
      const [o, k] = [opener(seq), cont(seq)]

      it(`${shape} > %%% hides its definition`, () => {
        expect(resolves(`${o}%%%\n${k}[r]: /url\n${k}%%%\n\nSee [r][].\n`)).toBe(false)
      })

      // THE SURVIVOR CONTROL, and it is what makes the row above evidence. The
      // same definition at the same depth with NO fence around it must still
      // register: without this, "nothing resolves" would pass the whole suite
      // while the prepass had simply stopped collecting at depth.
      it(`${shape} registers an UNFENCED definition`, () => {
        expect(resolves(`${o}[r]: /url\n\nSee [r][].\n`)).toBe(true)
      })
    }
  })

  describe('the depth distinction the widening must not collapse', () => {
    // Quote markers are counted and list markers only consumed. A fix that
    // stripped the whole run without counting would close these across a quote
    // boundary and suppress a definition the parser publishes - the opposite
    // error, and the worse direction (markup-carve/carve#1341).
    it('a DEEPER run does not close a shallower fence', () => {
      expect(resolves('> %%%\n> [r]: /url\n> > %%%\n\nSee [r][].\n')).toBe(true)
    })

    it('a SHALLOWER run does not close a deeper fence', () => {
      expect(resolves('> > %%%\n> > [r]: /url\n> %%%\n\nSee [r][].\n')).toBe(true)
    })

    it('a blank line ends the quote, so a later run is a different one', () => {
      expect(resolves('> %%%\n> [r]: /url\n\n> %%%\n\nSee [r][].\n')).toBe(true)
    })

    it('a matched depth still closes', () => {
      expect(resolves('> > %%%\n> > [r]: /url\n> > %%%\n\nSee [r][].\n')).toBe(false)
    })
  })
})
