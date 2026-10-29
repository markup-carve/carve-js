import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve-js#3912: in a description body the host owns column 0, so a first-block `+` on the
// marker line takes a follower only at the line's own opener columns (CARVE-P9-067).
const flat = (html: string): string => html.replace(/>\s+</g, '><').trim()

describe('a first-block marker on a description marker line', () => {
  const cases: Array<[string, string]> = [
    [':: t\n: - +\n # H\n', '<dl><dt>t</dt><dd><ul><li></li></ul></dd></dl><section id="H"><h1>H</h1></section>'],
    [':: t\n: - +\n# H\n', '<dl><dt>t</dt><dd><ul><li></li></ul></dd></dl><section id="H"><h1>H</h1></section>'],
    [':: t\n: > +\nq\n', '<dl><dt>t</dt><dd><blockquote><p>+</p></blockquote></dd></dl><p>q</p>'],
    [':: t\n: > +\n  q\n', '<dl><dt>t</dt><dd><blockquote><p>q</p></blockquote></dd></dl>'],
    [':: t\n: > > +\n  q\n', '<dl><dt>t</dt><dd><blockquote><blockquote><p>q</p></blockquote></blockquote></dd></dl>'],
    [':: t\n: > > +\n    q\n', '<dl><dt>t</dt><dd><blockquote><blockquote><p>+\nq</p></blockquote></blockquote></dd></dl>'],
    ['- :: t\n  : > +\n  q\n', '<ul><li><dl><dt>t</dt><dd><blockquote><p>+</p></blockquote></dd></dl>\n    q\n  </li></ul>'],
    ['> :: t\n> : > +\n> q\n', '<blockquote><dl><dt>t</dt><dd><blockquote><p>+</p></blockquote></dd></dl><p>q</p></blockquote>'],
    ['> :: t\n> : - > +\n>     q\n', '<blockquote><dl><dt>t</dt><dd><ul><li><blockquote><p>q</p></blockquote></li></ul></dd></dl></blockquote>'],
  ]
  for (const [source, html] of cases) {
    it(`reads ${JSON.stringify(source)} as the model does`, () => {
      expect(flat(carveToHtml(source))).toBe(html)
    })
  }
})
