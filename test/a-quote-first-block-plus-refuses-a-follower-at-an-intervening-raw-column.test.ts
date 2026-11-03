import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { carveToHtml } from '../src/index.js'

// carve-js#3924: a quote's first-block `+` reads its follower at the raw column, before rule A
// moves the line. Off the owning quote's column the `+` is refused and reads like a letter
// (markup-carve/carve#4409).
const flat = (html: string): string => html.replace(/>\s+</g, '><').trim()

describe('a quote first-block `+` at an intervening follower column', () => {
  const cases: Array<[string, string]> = [
    ['> +\n # h\n', "<blockquote></blockquote><section id=\"h\"><h1>h</h1></section>"],
    ['> +\n | a |\n', "<blockquote></blockquote><table><tbody><tr><td>a</td></tr></tbody></table>"],
    ['> > +\n > q\n', "<blockquote><blockquote></blockquote><p>q</p></blockquote>"],
    ['- > +\n   # h\n', "<ul><li><blockquote></blockquote><h1 id=\"h\">h</h1></li></ul>"],
    ['- a\n  > +\n   {.c}\n', "<ul><li>a\n    <blockquote></blockquote></li></ul>"],
  ]
  for (const [source, html] of cases) {
    it(`reads ${JSON.stringify(source)} as the model does`, () => {
      expect(flat(carveToHtml(source))).toBe(html)
    })
  }

  it('matches the ruled output over shifted and nested followers', () => {
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
    const digest = createHash('sha256')
    for (const host of hosts) {
      for (const stack of ['> +', '> > +', '> > > +']) {
        const opener = host.lead + stack
        const owner = opener.lastIndexOf('>')
        for (let col = 0; col <= 8; col++) {
          if (col === owner) continue
          for (const depth of [0, 1, 2]) {
            if (col + 2 * depth >= owner && (owner - col) % 2 === 0 && col <= owner) continue
            for (const block of blocks) {
              const follower = ' '.repeat(col) + '> '.repeat(depth) + block
              const source = [...host.pre, opener, follower].join('\n') + '\n'
              digest.update(JSON.stringify([source, carveToHtml(source)]) + '\n')
              count++
            }
          }
        }
      }
    }
    expect(count).toBe(2310)
    expect(digest.digest('hex')).toBe('1d69cfc6feb9ee1ad9f39bd82a3c58a10f358b5ef9587dd4f46d432828c7e47b')
  })
})
