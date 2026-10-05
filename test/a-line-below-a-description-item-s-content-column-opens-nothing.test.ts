import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s).trim()

/**
 * A LINE BELOW A DESCRIPTION ITEM'S CONTENT COLUMN OPENS NOTHING
 * (markup-carve/carve-js#2535).
 *
 * A line the body takes below the open item's content column reaches the body
 * but not the item, which makes it the item's LAZY CONTINUATION. A lazy
 * continuation has no structure to read, so the oracle folds it into the item's
 * open paragraph whatever it is spelled as.
 *
 * The authored-base pass asked the line's SPELLING instead - whether it looks
 * like an opener - so a heading, a break, a table row, a quote, a fence or a
 * `:::` run written one column short of the item became a block of the body's
 * own, where prose at the identical column folded. One rule with two answers,
 * decided by the spelling rather than by the column, which is why the ticket
 * found it as an ordered-marker defect: an ordered marker is what makes the
 * column easy to miss by one.
 *
 * Two narrowings, each measured against the oracle rather than against this
 * engine:
 *
 *   - THE ITEM'S PARAGRAPH HAS TO BE OPEN. A fence on the lead leaves a BLOCK,
 *     and the line below a fenced item is the body's own. `leavesParagraphOpen`
 *     answers one question short of this, since a fence leaves that flag set.
 *   - A DEFINITION REGISTERS WHEREVER IT STANDS. A reference and a footnote
 *     definition render nothing and are recognized from a leading run, so the
 *     oracle still takes one here.
 */

describe("a line below a description item's content column opens nothing", () => {
  it('reads the ticket\'s colon run as the item\'s one paragraph', () => {
    expect(html(':: t\n: 1. ::: note\n    n\n    :::\n')).toBe(
      ['<dl>', '  <dt>t</dt>', '  <dd>', '    <ol>', '      <li>::: note', 'n', ':::</li>', '    </ol>', '  </dd>', '</dl>'].join('\n'),
    )
  })

  it('reads the unordered spelling of the same column miss alike', () => {
    expect(html(':: t\n:  - ::: note\n    n\n    :::\n')).toBe(
      ['<dl>', '  <dt>t</dt>', '  <dd>', '    <ul>', '      <li>::: note', 'n', ':::</li>', '    </ul>', '  </dd>', '</dl>'].join('\n'),
    )
  })

  for (const [label, payload, folded] of [
    ['a heading', '# H', '# H'],
    ['a break', '---', '—'],
    ['a table row', '| a |', '| a |'],
    ['a quote marker', '> q', '&gt; q'],
    ['an attribute block', '{.k}', '{.k}'],
  ] as const) {
    it('folds ' + label + " one column short of the item", () => {
      expect(html(':: t\n: 1. p\n    ' + payload + '\n')).toBe(
        ['<dl>', '  <dt>t</dt>', '  <dd>', '    <ol>', '      <li>p', folded + '</li>', '    </ol>', '  </dd>', '</dl>'].join('\n'),
      )
    })
  }

  it('still reads the same payload AT the item\'s column as structure', () => {
    expect(html(':: t\n: 1. ::: note\n     n\n     :::\n')).toBe(
      [
        '<dl>',
        '  <dt>t</dt>',
        '  <dd>',
        '    <ol>',
        '      <li>',
        '        <aside class="admonition note" aria-label="Note">',
        '          <p>n</p>',
        '        </aside>',
        '      </li>',
        '    </ol>',
        '  </dd>',
        '</dl>',
      ].join('\n'),
    )
  })

  it('still reads a payload at the BODY\'s own column as the body\'s block', () => {
    expect(html(':: t\n: - ::: note\n  n\n  :::\n')).toBe(
      [
        '<dl>',
        '  <dt>t</dt>',
        '  <dd>',
        '    <ul>',
        '      <li>::: note',
        'n</li>',
        '    </ul>',
        '    <div>',
        '',
        '    </div>',
        '  </dd>',
        '</dl>',
      ].join('\n'),
    )
  })

  it('leaves a FENCED lead\'s below-column line to the body', () => {
    expect(html(':: t\n: - ```\n   # H\n   tail\n')).toBe(
      [
        '<dl>',
        '  <dt>t</dt>',
        '  <dd>',
        '    <ul>',
        '      <li>',
        '        <pre><code></code></pre>',
        '      </li>',
        '    </ul>',
        '    <h1 id="H">H</h1>',
        '    <p>tail</p>',
        '  </dd>',
        '</dl>',
      ].join('\n'),
    )
  })

  for (const [label, payload] of [
    ['a reference definition', '[r]: /u'],
    ['a footnote definition', '[^f]: t'],
  ] as const) {
    it('still registers ' + label + ' below the column', () => {
      expect(html(':: t\n: 1. p\n    ' + payload + '\n')).toBe(
        ['<dl>', '  <dt>t</dt>', '  <dd>', '    <ol>', '      <li>p</li>', '    </ol>', '  </dd>', '</dl>'].join('\n'),
      )
    })
  }
})
