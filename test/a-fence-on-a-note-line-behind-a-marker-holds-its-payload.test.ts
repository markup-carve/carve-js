import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const refs = '\n\nr[^n] A [t][r]\n'
const live = (html: string) => ({
  abbr: html.includes('<abbr title="b">A</abbr>'),
  link: html.includes('<a href="/u">t</a>'),
})
const fence = '```'

// CARVE-P12-026, PART 9R: a definition registers in the owner S2 selects; a payload is opaque.
describe('a fence or comment on a note line behind a marker', () => {
  it.each([
    ['quote', `[^n]: > ${fence}\n    > *[A]: b\n    > [r]: /u\n    > ${fence}`],
    ['two quotes', `[^n]: > > ${fence}\n    > > *[A]: b\n    > > [r]: /u\n    > > ${fence}`],
    ['joined quotes', `[^n]: > > ${fence}\n    >> *[A]: b\n    >> [r]: /u\n    >> ${fence}`],
    ['item in a quote', `[^n]: > - ${fence}\n    >   *[A]: b\n    >   [r]: /u\n    >   ${fence}`],
    ['quoted note', `> [^n]: > ${fence}\n>     > *[A]: b\n>     > [r]: /u\n>     > ${fence}`],
    ['note in an item', `- [^n]: > ${fence}\n      > *[A]: b\n      > [r]: /u\n      > ${fence}`],
    ['comment', `[^n]: %%%\n  *[A]: b\n  [r]: /u\n  %%%`],
    ['quoted comment', `[^n]: > %%%\n    > *[A]: b\n    > [r]: /u\n    > %%%`],
  ])('%s: the payload defines nothing', (_name, note) => {
    expect(live(carveToHtml(note + refs))).toEqual({ abbr: false, link: false })
  })

  it.each([
    ['quoted fence', `[^n]: > ${fence}\n    > x\n    > ${fence}\n    > *[A]: b\n    > [r]: /u`],
    ['item leaves at its column', `[^n]: - ${fence}\n      *[A]: b\n      [r]: /u`],
    ['two items, one column short', `[^n]: - - ${fence}\n        *[A]: b\n        [r]: /u`],
    ['quote ended by a column-0 marker', `[^n]: > ${fence}\n> *[A]: b\n> [r]: /u`],
    ['comment closer past the note', `[^n]: > %%%\n> *[A]: b\n> [r]: /u\n> %%%`],
    ['comment left by its item', `[^n]: - %%%\n      *[A]: b\n      [r]: /u\n      %%%`],
  ])('%s: the line past the holder defines', (_name, note) => {
    expect(live(carveToHtml(note + refs))).toEqual({ abbr: true, link: true })
  })

  it('reads a deeper quote marker as payload, not as the closer', () => {
    const html = carveToHtml(`> ${fence}\n> > ${fence}\n> *[A]: b\n> ${fence}\n\nA\n`)
    expect(html).toContain('&gt; ```\n*[A]: b\n')
    expect(html).not.toContain('<abbr')
  })
})
