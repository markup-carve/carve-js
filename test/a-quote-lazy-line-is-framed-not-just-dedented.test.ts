// Unmarked quote continuations fold into the open paragraph under PART 0 O1-O3.
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

  it('folds a list marker instead of opening a sublist', () => {
    expect(carveToHtml('> - :: t\n    - m\ntail\n')).toBe(TERM_FOLD('- m'))
  })

  it('folds a heading instead of opening one', () => {
    expect(carveToHtml('> - :: t\n    # h\ntail\n')).toBe(TERM_FOLD('# h'))
  })

  it('folds a thematic break', () => {
    expect(carveToHtml('> - :: t\n    ---\ntail\n')).toBe(TERM_FOLD('—'))
  })

  it('folds a table row', () => {
    expect(carveToHtml('> - :: t\n    | a |\ntail\n')).toBe(TERM_FOLD('| a |'))
  })

  it('folds an attribute block', () => {
    expect(carveToHtml('> - :: t\n    {.k}\ntail\n')).toBe(TERM_FOLD('{.k}'))
  })

  it('folds a colon fence', () => {
    expect(carveToHtml('> - :: t\n    ::: note\ntail\n')).toBe(TERM_FOLD('::: note'))
  })

  it('folds into an item that holds no definition list at all', () => {
    expect(carveToHtml('> - x\n    # h\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>x\n# h\ntail</li>\n  </ul>\n</blockquote>',
    )
  })
})

describe('the frame keeps the fence family a wider dedent would lose', () => {
  it('keeps an unterminated code fence as the term inline verbatim run', () => {
    expect(carveToHtml('> - :: t\n    ```\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n' +
        '<code>\ntail</code></dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('keeps an unterminated tilde fence as term text', () => {
    expect(carveToHtml('> - :: t\n    ~~~\ntail\n')).toBe(TERM_FOLD('~~~'))
  })
})

describe('unmarked entry-shaped lines remain term text', () => {
  it('folds a description-shaped line into the open term', () => {
    expect(carveToHtml('> - :: t\n    :  a\ntail\n')).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n:  a\ntail</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>",
    )
  })

  it('folds a second term marker', () => {
    expect(carveToHtml('> - :: t\n    :: t2\ntail\n')).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n:: t2\ntail</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>",
    )
  })

  it('folds consecutive description-shaped lines into the term', () => {
    expect(carveToHtml('> - :: t\n    :  a\n    :  b\ntail\n')).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n:  a\n:  b\ntail</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>",
    )
  })
})

describe('a quoted fence needs marked body lines', () => {
  it('leaves an unmarked line outside the quote', () => {
    expect(carveToHtml("> - ```\n  # h\n\npara\n" )).toBe("<blockquote>\n  <ul>\n    <li>\n      <pre><code></code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p># h</p>\n<p>para</p>")
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
  it('folds a marked heading past the term column', () => {
    expect(carveToHtml('> - :: t\n>     # h\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n  # h\ntail</dt>\n' +
        '      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('folds the same heading in an unquoted item', () => {
    expect(carveToHtml('- :: t\n    # h\ntail\n')).toBe(
      '<ul>\n  <li>\n    <dl>\n      <dt>t\n  # h\ntail</dt>\n    </dl>\n  </li>\n</ul>',
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
  it('leaves a marker the quote folded in to carve#1904, even under a folded fence', () => {
    expect(carveToHtml('> - :  d\n> ```\n  - m\n\npara\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>:  d\n<code>\n- m</code></li>\n  </ul>\n' +
        '</blockquote>\n<p>para</p>',
    )
  })
})
