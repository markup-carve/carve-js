import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

/**
 * PART 1 S4 NO OPEN PARAGRAPH, NO LAZY LINE, applied to a container inside a
 * BLOCK QUOTE (markup-carve/carve#920, markup-carve/carve-js#833).
 *
 * S4 is written about the OPEN STACK, not about which container kind is on it:
 * a container a quoted line has just opened is EMPTY and holds no open
 * paragraph, and a CLOSED one holds none either. So a following flush-left line
 * closes the quote instead of folding into the container.
 *
 * The quote's lazy-state tracker answered that only when the opener stood where
 * no paragraph was already open, and it never modelled a colon fence's CLOSER
 * at all. The LIST ITEM twin already answered correctly, which is what makes
 * this a defect rather than a reading - so the quote tracker now keeps the
 * same model as `trackItemLazyState`, and the last block below measures the two
 * against each other.
 */

const TAIL_OUTSIDE = (body: string[]) =>
  body.map((l) => '> ' + l).join('\n') + '\ntail\n'

describe('a closed or empty container inside a quote holds no open paragraph', () => {
  it('an EMPTY div opened by a quoted line does not swallow the flush-left line', () => {
    // markup-carve/carve-js#833, document A. The div folded `tail` in.
    expect(html('> quote\n> ::: note\ntail\n')).toBe(
      '<blockquote>\n  <p>quote</p>\n  <aside class="admonition note">\n\n  </aside>\n</blockquote>\n<p>tail</p>',
    )
  })

  it('a CLOSED div holding a body does not keep the flush-left line in the quote', () => {
    // markup-carve/carve-js#833, document B. `tail` stayed inside the quote,
    // because a colon fence's closer was not tracked at all.
    expect(html('> quote\n> ::: note\n> body\n> :::\ntail\n')).toBe(
      '<blockquote>\n  <p>quote</p>\n  <aside class="admonition note">\n    <p>body</p>\n  </aside>\n</blockquote>\n<p>tail</p>',
    )
  })

  it('a CLOSED plain div ends the quote', () => {
    expect(html('> quote\n> :::\n> body\n> :::\ntail\n')).toBe(
      '<blockquote>\n  <p>quote</p>\n  <div>\n    <p>body</p>\n  </div>\n</blockquote>\n<p>tail</p>',
    )
  })

  it('a CLOSED div ends the quote with no paragraph above it either', () => {
    // The no-paragraph-before spelling of the same shape. It was wrong too,
    // and the ticket did not name it: the closer, not the opener, is what was
    // missing, so both spellings moved.
    expect(html('> ::: note\n> body\n> :::\ntail\n')).toBe(
      '<blockquote>\n  <aside class="admonition note">\n    <p>body</p>\n  </aside>\n</blockquote>\n<p>tail</p>',
    )
  })

  it('a CLOSED code fence ends the quote, as the same fence already did with no paragraph above it', () => {
    expect(html('> quote\n> ```\n> body\n> ```\ntail\n')).toBe(
      '<blockquote>\n  <p>quote</p>\n  <pre><code>body\n</code></pre>\n</blockquote>\n<p>tail</p>',
    )
  })

  it('a CLOSED comment fence ends the quote', () => {
    expect(html('> quote\n> %%%\n> body\n> %%%\ntail\n')).toBe(
      '<blockquote>\n  <p>quote</p>\n</blockquote>\n<p>tail</p>',
    )
  })

  it('a CLOSED nested div leaves the OUTER one open but holding no paragraph', () => {
    expect(html('> quote\n> ::: a\n> ::: b\n> x\n> :::\ntail\n')).toBe(
      '<blockquote>\n  <p>quote</p>\n  <div class="a">\n    <div class="b">\n      <p>x</p>\n    </div>\n  </div>\n</blockquote>\n<p>tail</p>',
    )
  })

  // ---- CONTROLS: shapes that must NOT move ----

  it('CONTROL an OPEN div holding a paragraph still takes the flush-left line', () => {
    // There IS an open paragraph on the stack here, so S4 folds. This is the
    // row that a fix written as "any container ends the quote" would break.
    expect(html('> quote\n> ::: note\n> body\ntail\n')).toBe(
      '<blockquote>\n  <p>quote</p>\n  <aside class="admonition note">\n    <p>body\ntail</p>\n  </aside>\n</blockquote>',
    )
  })

  it('CONTROL an UNTERMINATED code fence mid-paragraph is inline verbatim, so the line still folds', () => {
    // §10 CLOSER LOOKAHEAD: with no closer ahead the fence does not interrupt,
    // the quoted paragraph stays open, and the flush-left line folds into it.
    expect(html('> quote\n> ```\ntail\n')).toBe(
      '<blockquote><p>quote\n<code>\ntail</code></p></blockquote>',
    )
  })

  it('CONTROL an UNTERMINATED code fence with no paragraph above it still opens a block', () => {
    expect(html('> ```\ntail\n')).toBe(
      '<blockquote>\n  <pre><code>\n</code></pre>\n</blockquote>\n<p>tail</p>',
    )
  })

  it('CONTROL an ABSORBED colon fence keeps the quoted paragraph open across prose', () => {
    // Corpus 260. `:::note` fails §12's opener test (a type word needs a
    // space), so it is paragraph text and the paragraph then absorbs the bare
    // run below it - across the prose line in between.
    expect(html('> quote\n> :::note\n> body\n> :::\ntail\n')).toBe(
      '<blockquote><p>quote\n:::note\nbody\n:::\ntail</p></blockquote>',
    )
  })

  it('CONTROL a CLOSED empty div after a blank line still ends the quote', () => {
    expect(html('> quote\n> ::: note\n> :::\n\ntail\n')).toBe(
      '<blockquote>\n  <p>quote</p>\n  <aside class="admonition note">\n\n  </aside>\n</blockquote>\n<p>tail</p>',
    )
  })

  it('CONTROL a flush-left `:::` under an absorbed fence still ends the quote and opens a div', () => {
    expect(html('> quote\n> ```\n:::\n')).toBe(
      '<blockquote><p>quote\n<code></code></p></blockquote>\n<div>\n</div>',
    )
  })

  it('CONTROL the LIST ITEM twin is unchanged', () => {
    expect(html('- item\n  ::: note\n  body\n  :::\ntail\n')).toBe(
      '<ul>\n  <li>item\n    <aside class="admonition note">\n      <p>body</p>\n    </aside>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('counts the open containers, so a malformed fence INSIDE one does not arm absorption', () => {
    // The bare run below a CLOSED container is that container's sibling, not
    // absorbed text, and only a divDepth counter tells the two apart: with the
    // closer branch gone the run reads as another OPENER, the depth never
    // returns to 0, and the malformed `:::note` two lines down stops arming
    // absorption. The TOP LEVEL is the arbiter here and gives this same answer.
    const quoted = '> ::: note\n> body\n> :::\n> :::note\n> x\n> :::\ntail\n'
    expect(html(quoted)).toBe(
      '<blockquote>\n  <aside class="admonition note">\n    <p>body</p>\n  </aside>\n  <p>:::note\nx\n:::\ntail</p>\n</blockquote>',
    )
    expect(html('::: note\nbody\n:::\n:::note\nx\n:::\ntail\n')).toBe(
      '<aside class="admonition note">\n  <p>body</p>\n</aside>\n<p>:::note\nx\n:::\ntail</p>',
    )
  })

  it('closes a container only on an EXACT bare-run width, so a shorter run stays absorbable text', () => {
    // `collectColonFenceBody` matches a closer on the EXACT opener width, so
    // inside a `::::` container a bare `:::` is a NESTED OPENER, not the
    // closer - and after a malformed `:::note` above it, §12 absorption takes
    // it as text and the paragraph stays open. A plain open-container COUNT
    // read it as the closer and ended the quote. The top level and the list
    // item both fold here, and now so does the quote.
    const source = (prefix: string) =>
      [':::: outer', ':::note', 'x', ':::'].map(prefix ? (l) => prefix + l : (l) => l).join('\n') +
      '\ntail\n'
    expect(html(source(''))).toBe(
      '<div class="outer">\n  <p>:::note\nx\n:::\ntail</p>\n</div>',
    )
    expect(html(source('> '))).toBe(
      '<blockquote>\n  <div class="outer">\n    <p>:::note\nx\n:::\ntail</p>\n  </div>\n</blockquote>',
    )
  })

  it('CONTROL a shorter bare run with no absorption above it still opens a nested container', () => {
    // The control on the width rule: without the malformed fence there is
    // nothing to absorb, so the shorter run opens an EMPTY nested container -
    // which holds no paragraph, so the quote still ends.
    expect(html('> :::: outer\n> x\n> :::\ntail\n')).toBe(
      '<blockquote>\n  <div class="outer">\n    <p>x</p>\n    <div>\n    </div>\n  </div>\n</blockquote>\n<p>tail</p>',
    )
  })

  it('does not count a fence closer that sits OUTSIDE the quote', () => {
    // `quotedFenceHasCloser` stops at the first unquoted line, for the reason
    // `quotedCommentHasCloser` gives: it has to agree with a sub-lexer that
    // only ever sees this quote's own lines.
    expect(html('> quote\n> ```\ntail\n```\n')).toBe(
      '<blockquote>\n  <p>quote</p>\n  <pre><code>tail\n</code></pre>\n</blockquote>',
    )
  })

  // ---- the parity this ticket is about ----

  it('answers S4 the same way in a quote as in a list item, across every colon-fence shape', () => {
    const bodies = [
      ['::: note'],
      ['::: note', 'body', ':::'],
      [':::note', 'body', ':::'],
      [':::note', ':::'],
      ['::: note', 'body'],
      ['::: note', '::: inner', 'x', ':::'],
      ['::: note', '::: inner', 'x', ':::', ':::'],
      ['::::', 'x', ':::'],
      ['::::', 'x', '::::'],
      ['```', 'x', '```'],
      ['```', 'x'],
    ]
    const outside = (source: string, closer: string) => {
      const out = html(source)
      const end = out.lastIndexOf(closer)
      // The container must exist, or the row proves nothing.
      expect(end).toBeGreaterThan(-1)
      return out.lastIndexOf('tail') > end
    }
    const rows = bodies.map((body) => {
      const quote = outside(TAIL_OUTSIDE(['q', ...body]), '</blockquote>')
      const item =
        outside(
          '- q\n' + body.map((l) => '  ' + l).join('\n') + '\ntail\n',
          '</ul>',
        )
      return { body: body.join(' | '), quote, item }
    })
    expect(rows.filter((r) => r.quote !== r.item)).toEqual([])
    // The control on the comparison: the shapes are not all the same answer,
    // so agreeing on every one is a real result rather than a constant.
    expect(new Set(rows.map((r) => r.quote)).size).toBe(2)
  })
})
