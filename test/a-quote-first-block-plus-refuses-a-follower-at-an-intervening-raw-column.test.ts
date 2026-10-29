import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve-js#3924: a quote's first-block `+` reads its follower at the raw column, before rule A
// moves the line. Off column 0, the opener line's column and the owning quote's column the `+`
// is refused and reads like a letter (CARVE-P9-067, carve#3421 rulings of 22 October).
const flat = (html: string): string => html.replace(/>\s+</g, '><').trim()

describe('a quote first-block `+` at an intervening follower column', () => {
  const cases: Array<[string, string]> = [
    ['> +\n # h\n', '<blockquote><p>+</p></blockquote><section id="h"><h1>h</h1></section>'],
    ['> +\n | a |\n', '<blockquote><p>+</p></blockquote><table><tbody><tr><td>a</td></tr></tbody></table>'],
    ['> > +\n > q\n', '<blockquote><blockquote><p>+\nq</p></blockquote></blockquote>'],
    ['- > +\n   # h\n', '<ul><li><blockquote><p>+</p></blockquote><h1 id="h">h</h1></li></ul>'],
    ['- a\n  > +\n   {.c}\n', '<ul><li>a\n    <blockquote><p>+</p></blockquote></li></ul>'],
  ]
  for (const [source, html] of cases) {
    it(`reads ${JSON.stringify(source)} as the model does`, () => {
      expect(flat(carveToHtml(source))).toBe(html)
    })
  }

  it('reads every refused follower like a letter', () => {
    const hosts = [
      { pre: [], lead: '' },
      { pre: ['- a'], lead: '  ' },
      { pre: ['- a', '  - b'], lead: '    ' },
      { pre: ['1. a'], lead: '   ' },
      { pre: [], lead: '- ', marker: true },
      { pre: [], lead: '- - ', marker: true },
    ]
    const blocks = ['q', '# h', '| a |', '***', '::: note', '{.c}']
    let count = 0
    for (const host of hosts) {
      for (const stack of ['> +', '> > +', '> > > +']) {
        const opener = host.lead + stack
        const eligible = [0, host.marker ? host.lead.search(/\S|$/) : host.lead.length, opener.lastIndexOf('>')]
        for (let col = 0; col <= 8; col++) {
          if (eligible.includes(col)) continue
          for (const depth of [0, 1, 2]) {
            for (const block of blocks) {
              const follower = ' '.repeat(col) + '> '.repeat(depth) + block
              const doc = (end: string): string => [...host.pre, opener.replace(/\+$/, end), follower].join('\n') + '\n'
              expect(carveToHtml(doc('+')), doc('+')).toBe(carveToHtml(doc('z')).replace('z', '+'))
              count++
            }
          }
        }
      }
    }
    expect(count).toBeGreaterThan(2000)
  })
})
