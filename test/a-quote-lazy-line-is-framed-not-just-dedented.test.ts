// A quoted term folds plain text but releases block-form lines under carve#4300.
import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'


const NUL = String.fromCharCode(0)

const TERM_FOLD = (payload: string) =>
  '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n' +
  payload +
  '\ntail</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>'

describe('a quote-lazy line reaches no content column inside a quoted item', () => {
  it('folds plain prose with no residual indent', () => {
    expect(carveToHtml('> - :: t\n    plain\ntail\n')).toBe(TERM_FOLD('plain'))
  })

  it('ends the term before a list marker', () => {
    expect(carveToHtml('> - :: t\n    - m\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<ul>\n  <li>m\ntail</li>\n</ul>',
    )
  })

  it('opens a heading after the quote instead of folding it', () => {
    expect(carveToHtml('> - :: t\n    # h\ntail\n')).toBe('<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<section id="h">\n  <h1>h</h1>\n  <p>tail</p>\n</section>')
  })

  it('does not fold a thematic break', () => {
    expect(carveToHtml('> - :: t\n    ---\ntail\n')).toBe('<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<hr>\n<p>tail</p>')
  })

  it('does not fold a table row', () => {
    expect(carveToHtml('> - :: t\n    | a |\ntail\n')).toBe('<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<table>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>\n<p>tail</p>')
  })

  it('does not fold an attribute block', () => {
    expect(carveToHtml('> - :: t\n    {.k}\ntail\n')).toBe('<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<p class="k">tail</p>')
  })

  it('does not fold a colon fence', () => {
    expect(carveToHtml('> - :: t\n    ::: note\ntail\n')).toBe('<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<aside class="admonition note" aria-label="Note">\n  <p>tail</p>\n</aside>')
  })

  it('folds into an item that holds no definition list at all', () => {
    expect(carveToHtml('> - x\n    # h\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>x</li>\n  </ul>\n</blockquote>\n<section id="h">\n  <h1>h</h1>\n  <p>tail</p>\n</section>',
    )
  })
})

describe('the frame keeps the fence family a wider dedent would lose', () => {
  it('ends the quote at an unmarked code fence, which a term does not fold', () => {
    expect(carveToHtml('> - :: t\n    ```\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<pre><code>tail\n</code></pre>',
    )
  })

  it('ends the quote at an unmarked tilde fence the same way', () => {
    expect(carveToHtml('> - :: t\n    ~~~\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<pre><code>tail\n</code></pre>',
    )
  })
})

describe('unmarked entry-shaped lines leave a quoted term', () => {
  it('releases a description-shaped line from the open term', () => {
    expect(carveToHtml('> - :: t\n    :  a\ntail\n')).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<p>:  a\ntail</p>",
    )
  })

  it('folds a second term marker', () => {
    expect(carveToHtml('> - :: t\n    :: t2\ntail\n')).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<dl>\n  <dt>t2\ntail</dt>\n</dl>",
    )
  })

  it('reads consecutive description-shaped lines after the term', () => {
    expect(carveToHtml('> - :: t\n    :  a\n    :  b\ntail\n')).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<p>:  a\n:  b\ntail</p>",
    )
  })
})

describe('a quoted fence needs marked body lines', () => {
  it('leaves an unmarked line outside the quote', () => {
    expect(carveToHtml("> - ```\n  # h\n\npara\n" )).toBe("<blockquote>\n  <ul>\n    <li>\n      <pre><code></code></pre>\n    </li>\n  </ul>\n</blockquote>\n<section id=\"h\">\n  <h1>h</h1>\n  <p>para</p>\n</section>")
  })
})

describe('the frame never leaks into rendered text', () => {
  it('never leaks the frame', () => {
    const leads = [
      '> - :: t',
      '> - x',
      '> - ```',
      '> - ~~~',
      '> - =html',
      '> - ```=html',
      '- - ```=html',
      '> - ~~~=html',
      '> - :  d',
      '> - | a |',
      '> - - :: t',
      '> - 1. :: t',
      '> > - :: t',
      '> - - - :: t',
    ]
    const payloads = ['plain', '- m', '# h', '```', '~~~', '```=html', ':  a', ':: t2', '{.k}', '| a |', '=html']
    const offenders: string[] = []
    for (const lead of leads) {
      for (const payload of payloads) {
        for (let col = 0; col <= 6; col++) {
          for (const trailer of ['\ntail\n', '\n\npara\n']) {
            const src = `${lead}\n${' '.repeat(col)}${payload}${trailer}`
            if (carveToHtml(src).includes(NUL)) offenders.push(JSON.stringify(src))
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('marked and unquoted term continuations follow their column', () => {
  it('opens a marked heading past the term column in the item', () => {
    expect(carveToHtml('> - :: t\n>     # h\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n      <h1 id="h">h</h1>\n    </li>\n  </ul>\n</blockquote>\n<p>tail</p>',
    )
  })

  it('folds the same heading in an unquoted item', () => {
    expect(carveToHtml('- :: t\n    # h\ntail\n')).toBe(
      '<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n    </dl>\n    <h1 id="h">h</h1>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('a flush-left line still interrupts the quote', () => {
    expect(carveToHtml('> - :: t\n# h\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n' +
        '      </dl>\n    </li>\n  </ul>\n</blockquote>\n' +
        '<section id="h">\n  <h1>h</h1>\n  <p>tail</p>\n</section>',
    )
  })
})

describe('a lazy marker remains text in its original host', () => {
  it('leaves the quote at an unmarked marker after a quoted fence, which nothing folds into', () => {
    expect(carveToHtml('> - :  d\n> ```\n  - m\n\npara\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>:  d</li>\n  </ul>\n  <pre><code></code></pre>\n' +
        '</blockquote>\n<ul>\n  <li>m</li>\n</ul>\n<p>para</p>',
    )
  })
})
