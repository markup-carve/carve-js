import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

/**
 * A code fence opened on a list MARKER line, with its body below the item's
 * content column (markup-carve/carve#950, markup-carve/carve-js#845).
 *
 * PART 9 §24's STEP algorithm needed no new rule. Take `x` at column 0 with the
 * stack `document > list > item(content_column 2) > code fence body`:
 *
 *  - S1 MATCH PREFIXES stops at the first container whose prefix the line does
 *    not supply, so the walk stops at the ITEM and the fenced body is never
 *    reached.
 *  - S2 FENCED BODY therefore never fires: it applies only when the innermost
 *    MATCHED container is a fenced body.
 *  - S4 PARTIAL MATCH governs, and its lazy branch continues an open PARAGRAPH.
 *    A verbatim body is not one - "fold in as lazy paragraph text" has no
 *    meaning inside content that is not markup. What remains is S4's otherwise:
 *    close the unmatched containers and re-classify the residue.
 *
 * So the item holds an EMPTY code block and the residue re-parses at document
 * level. The BLOCK QUOTE spelling already got exactly this answer; the only
 * difference is which container the walk stops at.
 *
 * THE GUARD BELONGS ON THE OPEN FENCE, not on "did the marker line open one".
 * Once the body has collected a line at the content column, a reader tracking
 * the item's paragraph state sees a paragraph open again and folds - which is
 * the row a marker-line-only fix fails.
 */

describe('a fence opened on a list marker line', () => {
  it('leaves an EMPTY code block and re-parses the residue at document level', () => {
    expect(carveToHtml('- ```\nx\n```\n')).toBe(
      '<ul>\n  <li>\n    <pre><code>\n</code></pre>\n  </li>\n</ul>\n<p>x\n<code></code></p>',
    )
  })

  it('answers the same one column in', () => {
    // A separate row because the broken readings differed here, one keeping the
    // leading space in the code text and one stripping it.
    expect(carveToHtml('- ```\n x\n ```\n')).toBe(
      '<ul>\n  <li>\n    <pre><code>\n</code></pre>\n  </li>\n</ul>\n<p>x\n<code></code></p>',
    )
  })

  it('CONTROL at the content column the body is the item\'s, unchanged', () => {
    // The shape every existing corpus case uses.
    expect(carveToHtml('- ```\n  x\n  ```\n')).toBe(
      '<ul>\n  <li>\n    <pre><code>x\n</code></pre>\n  </li>\n</ul>',
    )
  })

  it('CONTROL the BLOCK QUOTE analogue is unchanged', () => {
    // Unanimous across engines and unenforced until now. It is the answer the
    // item spelling had drifted away from.
    expect(carveToHtml('> ```\nx\n```\n')).toBe(
      '<blockquote>\n  <pre><code>\n</code></pre>\n</blockquote>\n<p>x\n<code></code></p>',
    )
  })

  it('holds for a tilde fence, where the residue is plain text', () => {
    // Shows the empty inline code in the first row is a property of the
    // backtick run and not of this rule.
    expect(carveToHtml('- ~~~\nx\n~~~\n')).toBe(
      '<ul>\n  <li>\n    <pre><code>\n</code></pre>\n  </li>\n</ul>\n<p>x\n~~~</p>',
    )
  })

  it('holds after the body has collected a line at the content column', () => {
    // THE ROW A MARKER-LINE-ONLY FIX FAILS. `x` reopens the item's paragraph
    // for any reader tracking that instead of the open fence.
    expect(carveToHtml('- ```\n  x\n y\n  ```\n')).toBe(
      '<ul>\n  <li>\n    <pre><code>x\n</code></pre>\n  </li>\n</ul>\n<p>y\n<code></code></p>',
    )
  })

  it('holds for a fence opened on a CONTINUATION line', () => {
    // The fence is open when `y` arrives, so `y` ends the item; only then does
    // §10 I4 decide what the leftover fence means - it has no closer inside the
    // truncated item, so it does not interrupt the open paragraph and degrades
    // to inline verbatim.
    expect(carveToHtml('- a\n  ```\n  b\n y\n  ```\n')).toBe(
      '<ul>\n  <li>a\n<code>\nb</code></li>\n</ul>\n<p>y\n<code></code></p>',
    )
  })

  it('CONTROL an UNTERMINATED fence mid-item is inline verbatim, so the line still folds', () => {
    // §10's CLOSER LOOKAHEAD, the same rule the quote's tracker applies. With
    // no closer anywhere the fence never opens, the item's paragraph stays
    // open, and the below-column line folds into it. A fix that broke on ANY
    // fence opener rather than on an OPEN fence takes this row with it.
    expect(carveToHtml('- q\n  ```\n  x\ntail\n')).toBe(
      '<ul>\n  <li>q\n<code>\nx\ntail</code></li>\n</ul>',
    )
  })

  it('opens UNCONDITIONALLY where no paragraph is open, as it does in a quote', () => {
    // The other half of §10's lookahead: it conditions a fence on a closer only
    // when a paragraph is already OPEN. After a thematic break or a closed
    // fence there is none, so the next fence opens whether or not it closes -
    // and the below-column line ends the item. Both shapes DIVERGED from the
    // quote before this change: the item folded `tail` into the code text.
    expect(carveToHtml('- a\n  ---\n  ```\n  x\ntail\n')).toBe(
      '<ul>\n  <li>a\n    <hr>\n    <pre><code>x\n</code></pre>\n  </li>\n</ul>\n<p>tail</p>',
    )
    expect(carveToHtml('- a\n  ```\n  b\n  ```\n  ~~~\n  x\ntail\n')).toBe(
      '<ul>\n  <li>a\n    <pre><code>b\n</code></pre>\n    <pre><code>x\n</code></pre>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('CONTROL the line directly under an unterminated mid-item fence still folds', () => {
    // With no line collected in between, so an implementation that closed the
    // paragraph at the opener and reopened it on the next ordinary line cannot
    // pass by accident. The quote answers identically.
    expect(carveToHtml('- q\n  ```\ntail\n')).toBe(
      '<ul>\n  <li>q\n<code>\ntail</code></li>\n</ul>',
    )
    expect(carveToHtml('> q\n> ```\ntail\n')).toBe(
      '<blockquote><p>q\n<code>\ntail</code></p></blockquote>',
    )
  })

  it('answers the same in a list item as in a block quote, across every fence shape', () => {
    // The parity the ticket is about: S4 is written about the OPEN STACK, not
    // about which container kind is on it.
    const bodies = [
      ['```', 'x', '```'],
      ['```', 'x'],
      ['~~~', 'x', '~~~'],
      ['```js', 'x', '```'],
      ['```', 'x', '~~~', '```'],
      // With a paragraph ABOVE the fence the closer lookahead decides, so
      // these two answer the other way and make the comparison mean something.
      ['q', '```', 'x'],
      ['q', '```', 'x', '```'],
      ['q', 'more'],
    ]
    const rows = bodies.map((body) => {
      const item = carveToHtml('- ' + body[0] + '\n' + body.slice(1).map((l) => '  ' + l).join('\n') + '\ntail\n')
      const quote = carveToHtml(body.map((l) => '> ' + l).join('\n') + '\ntail\n')
      const outside = (html: string, closer: string) => {
        const end = html.lastIndexOf(closer)
        expect(end).toBeGreaterThan(-1)
        return html.lastIndexOf('tail') > end
      }
      return {
        body: body.join(' | '),
        item: outside(item, '</ul>'),
        quote: outside(quote, '</blockquote>'),
      }
    })
    expect(rows.filter((r) => r.item !== r.quote)).toEqual([])
    // The control on the comparison: the shapes do not all answer the same
    // way, so agreeing on every one is a result rather than a constant.
    expect(new Set(rows.map((r) => r.item)).size).toBe(2)
  })

  perfIt('scans an item of unterminated fence openers in linear time', () => {
    // The closer lookahead runs per fence-shaped line while the item's
    // paragraph is open, so without its negative cache an item of N
    // unterminated openers is scanned N times: measured at 26ms for 500 lines
    // and 449ms for 4000 before the cache went in.
    expectScansLinearly((input) => void carveToHtml(input), '  ```=html\n', {
      prefix: '- a\n',
      label: 'item-local unterminated fence openers',
      smallRepeats: 2000,
    })
  })
})
