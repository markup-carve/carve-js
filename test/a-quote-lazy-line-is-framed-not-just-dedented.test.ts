import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A QUOTE'S LAZY LINE IS FRAMED, NOT MERELY DEDENTED
 * (markup-carve/carve-js#1609).
 *
 * PART 0 LAZY CONTINUATION: a line carrying no `>` still continues the quote by
 * folding into the innermost open paragraph, and it is not the quote's content
 * at any column - it reached that paragraph by the fold and is its text wherever
 * it landed. Three shapes had been ported to that fact one at a time: a link
 * definition, a list marker (markup-carve/carve#1904) and a description marker
 * (markup-carve/carve-js#1606). This is the general rule.
 *
 * WHY A WIDER DEDENT IS NOT THE PORT. Sending every quote-lazy line down the
 * item's lazy arm and stripping it whole moves a great many documents onto the
 * oracle's answer and a fence-shaped family OFF it: a stripped `` ``` `` line
 * still RE-CLASSIFIES at the column it was stripped to, so it opens a real code
 * fence at the item body's column 0 and the text below escapes the item. The
 * oracle has no such problem because its lazy line is FRAMED - a sentinel whose
 * first character is not whitespace, so the line stands at column 0 AND matches
 * no block opener at all. `LAZY_FRAME` in src/parse.ts is that frame, and the
 * fence documents below are the family a dedent loses.
 *
 * THE FRAME IS UNFORGEABLE, not merely unlikely: `parse` replaces every U+0000
 * with U+FFFD before the first line is read (PART 0 INPUT). `never leaks the
 * frame` below is the standing guard that it also never reaches rendered text -
 * the oracle shipped exactly that bug into fenced code before its own
 * `stripLazy` covered the verbatim collectors.
 *
 * ORACLE. `spec/scripts/spec/layout.mjs` into `spec/scripts/spec/html.mjs`, at
 * the PINNED submodule (549f2a52) and again at spec main (35148309). Over a
 * 4480-document sweep the two revisions disagree on 224 documents and every one
 * of them carries a COMMENT payload; both score this change identically (1952
 * documents move onto the oracle's answer, none away), so the pin does not
 * matter here. carve-js was driven through `carveToHtml`, not `parse` plus
 * `renderHtml`.
 *
 * WHAT DOES NOT MOVE. `carries its own marker` and `an unquoted item` are
 * PRE-EXISTING divergences from the oracle, verified unchanged before and after
 * this commit: they pin that the change touches only lines the QUOTE folded in.
 * `a flush-left line` already agreed. None of the three is killed by any
 * mutation of this fix, which is what makes them controls rather than coverage.
 */

const NUL = String.fromCharCode(0)

const TERM_FOLD = (payload: string) =>
  '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n' +
  payload +
  '\ntail</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>'

describe('a quote-lazy line reaches no content column inside a quoted item', () => {
  it('folds plain prose with no residual indent', () => {
    // The residue the ticket names: carve-js kept two columns of the payload's
    // indent inside the term, because the content-column arm dedents by the
    // item's own column and leaves the rest.
    expect(carveToHtml('> - :: t\n    plain\ntail\n')).toBe(TERM_FOLD('plain'))
  })

  it('folds a list marker instead of opening a sublist', () => {
    expect(carveToHtml('> - :: t\n    - m\ntail\n')).toBe(TERM_FOLD('- m'))
  })

  it('folds a heading instead of opening one', () => {
    expect(carveToHtml('> - :: t\n    # h\ntail\n')).toBe(TERM_FOLD('# h'))
  })

  it('folds a thematic break', () => {
    // `---` in term text is inline typography, not a rule: the em dash IS the
    // oracle's answer here.
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
    // THE DOCUMENT THE 22-FOR-330 TRADE WOULD HAVE BROKEN. Stripping the indent
    // opens a real fence at the item body's column 0 and `tail` escapes the
    // item; the frame leaves it as the term's text, where the inline pass reads
    // the run as verbatim.
    expect(carveToHtml('> - :: t\n    ```\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n' +
        '<code>\ntail</code></dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('keeps an unterminated tilde fence as term text', () => {
    expect(carveToHtml('> - :: t\n    ~~~\ntail\n')).toBe(TERM_FOLD('~~~'))
  })
})

describe('the def-list entry matcher is the one consumer that unframes', () => {
  it('attaches a description to the open term', () => {
    // markup-carve/carve-js#1606's document, still answered the same way now
    // that the shape gate it needed has become the general rule.
    expect(carveToHtml('> - :: t\n    :  a\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n' +
        '        <dd>a\ntail</dd>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('opens a second term', () => {
    expect(carveToHtml('> - :: t\n    :: t2\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n' +
        '        <dt>t2\ntail</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('continues an OPEN description body instead of registering a second entry', () => {
    // The one state the frame is withheld from: the body's fold tests a lazy
    // line BEFORE unframing it, where the term's fold tests after.
    expect(carveToHtml('> - :: t\n    :  a\n    :  b\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n' +
        '        <dd>a\n:  b\ntail</dd>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })
})

describe('an open fence classifies nothing, so the frame stands aside', () => {
  it('feeds a fence body the line at its own column', () => {
    expect(carveToHtml('> - ```\n  # h\n\npara\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <pre><code># h\n</code></pre>\n' +
        '    </li>\n  </ul>\n</blockquote>\n<p>para</p>',
    )
  })

  it('leaves a marker the quote folded in to carve#1904, even under a folded fence', () => {
    // The fence here was FOLDED in rather than owned by the item, and a
    // quote-lazy MARKER line never reaches the content-column arm regardless.
    expect(carveToHtml('> - :  d\n> ```\n  - m\n\npara\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>:  d\n<code>\n- m</code></li>\n  </ul>\n' +
        '</blockquote>\n<p>para</p>',
    )
  })
})

describe('the frame never leaks into rendered text', () => {
  it('never leaks the frame', () => {
    // The oracle shipped this exact bug: a verbatim collector joined its raw
    // lines and put the sentinel into the rendered code. Generated rather than
    // listed, because the leaking shapes are the ones nobody thinks to list -
    // and the NESTED leads are here for a second reason. A line an outer item
    // framed reaches the inner item already framed, and framing it twice leaks a
    // sentinel that `stripLazyFrame` takes off only once. Neither sweep behind
    // this commit could express that shape; the repo's own #1606 test caught it.
    const leads = [
      '> - :: t',
      '> - x',
      '> - ```',
      '> - ~~~',
      '> - =html',
      '> - :  d',
      '> - | a |',
      '> - - :: t',
      '> - 1. :: t',
      '> > - :: t',
      '> - - - :: t',
    ]
    const payloads = ['plain', '- m', '# h', '```', '~~~', ':  a', ':: t2', '{.k}', '| a |', '=html']
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

describe('lines the quote did not fold in do not move', () => {
  it('carries its own marker, so the item reads it by column', () => {
    // PRE-EXISTING divergence from the oracle, unchanged by this commit: the
    // oracle puts `tail` outside the item. Pinned as carve-js reads it today so
    // that a fix which reaches past the quote's lazy lines is visible here.
    expect(carveToHtml('> - :: t\n>     # h\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n' +
        '      </dl>\n      <h1 id="h">h</h1>\n      tail\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('an unquoted item is untouched', () => {
    // Also a pre-existing divergence on `tail`, and the control that localizes
    // everything above to the QUOTE prefix.
    expect(carveToHtml('- :: t\n    # h\ntail\n')).toBe(
      '<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n    </dl>\n' +
        '    <h1 id="h">h</h1>\n    tail\n  </li>\n</ul>',
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
