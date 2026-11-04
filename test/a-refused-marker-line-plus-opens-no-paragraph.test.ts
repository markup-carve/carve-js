import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// carve#5156: a refused `+` on a quote's marker line opens no paragraph (PART 9 §17 L3),
// so the next line misses the item and the quote, and an indented opener after it interrupts (PART 0 S4).
const emptyQuoteItem = '<ul>\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>\n'

describe('a refused marker-line plus opens no paragraph', () => {
  it.each([
    ['- > +\np\n  > q\n', '<p>p</p>\n<blockquote><p>q</p></blockquote>'],
    ['- > +\np\n   > q\n', '<p>p</p>\n<blockquote><p>q</p></blockquote>'],
    ['- > +\np\n  # q\n', '<p>p</p>\n<section id="q">\n  <h1>q</h1>\n</section>'],
    ['- > +\np\n  ```\n  x\n  ```\n', '<p>p</p>\n<pre><code>x\n</code></pre>'],
    // A comment line between does not let the `+` attach what follows it.
    ['- > +\n%% c\np\n', '<p>p</p>'],
    ['- > +\n%% c\n%% d\np\n', '<p>p</p>'],
  ])('%j', (source, after) => {
    expect(carveToHtml(source)).toBe(emptyQuoteItem + after)
    const written = carveToCarve(source)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(carveToCarve(written)).toBe(written)
  })

  it('holds for a quote under deeper containers', () => {
    expect(carveToHtml('- - > +\np\n  > q\n')).toContain('<p>p</p>\n<blockquote><p>q</p></blockquote>')
    expect(carveToHtml('1. > +\np\n  > q\n')).toContain('<p>p</p>\n<blockquote><p>q</p></blockquote>')
    expect(carveToHtml('- a\n  > +\np\n  > q\n')).toContain('<p>p</p>\n<blockquote><p>q</p></blockquote>')
  })
})
