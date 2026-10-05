import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s).trim()

/**
 * A DESCRIPTION BODY FOLDS PAST ITS NESTED LEAD'S BLOCK KIND
 * (markup-carve/carve-js#2531, the twin of markup-carve/carve-php#2904).
 *
 * PART 9 §17's lazy branch for this host asks whether a CONTAINER the body
 * opened is still collecting, not whether a paragraph is open. The engine asked
 * the paragraph's question, so a nested item whose lead ends in a heading, a
 * `%%` comment line, a table or a break reported nothing to fold into and the
 * flush-left line below fell to the document - while the same lead ending in a
 * closed code fence folded, because that shape happens to leave the paragraph
 * flag set. One rule with two answers, decided by the lead's bottom block.
 *
 * The three narrowings are the rule's real shape, each measured against the
 * executable spec rather than against this engine:
 *
 *   - CONTAINER KIND. A nested list takes the line; a QUOTE on the lead ends the
 *     body on every one of those kinds, and a fence a quote holds is the quote's
 *     rather than the list's at either nesting order.
 *   - A DEFINITION ENDS THE BODY with a container open - a term, a reference
 *     definition, a footnote definition - and so does a column-0 opener. The
 *     interruption veto in front of the gate is what keeps those.
 *   - A CLOSED `%%%` RUN is a finished invisible block and ends the body, where
 *     the `%%` LINE form is only a line and the body folds on past it.
 */

describe("a description body folds past its nested lead's block kind", () => {
  describe('the kinds a nested list folds', () => {
    for (const [label, lead, inner] of [
      ['a heading', '# h', '<h1 id="h">h</h1>'],
      ['a break', '---', '<hr>'],
      ['an attribute block', '{.k}', ''],
    ] as const) {
      it('keeps the flush-left line in the body after ' + label, () => {
        expect(html(':: t\n: - ' + lead + '\nx\n')).toBe(
          [
            '<dl>',
            '  <dt>t</dt>',
            '  <dd>',
            '    <ul>',
            '      <li>' + (inner === '' ? '' : '\n        ' + inner + '\n      ') + '</li>',
            '    </ul>',
            '    <p>x</p>',
            '  </dd>',
            '</dl>',
          ].join('\n'),
        )
      })
    }

    it('keeps the flush-left line in the body after a `%%` comment line', () => {
      expect(html(':: t\n: - %% c\nx\n')).toBe(
        [
          '<dl>',
          '  <dt>t</dt>',
          '  <dd>',
          '    <ul>',
          '      <li></li>',
          '    </ul>',
          '    <p>x</p>',
          '  </dd>',
          '</dl>',
        ].join('\n'),
      )
    })

    it('keeps the flush-left line in the body after a table', () => {
      const out = html(':: t\n: - | a |\n    | - |\n    | b |\nx\n')
      expect(out).toContain('    <p>x</p>\n  </dd>')
      expect(out).not.toMatch(/<\/dl>\s*<p>x<\/p>/)
    })

    /*
     * ALREADY FOLDED, and the row that made the split visible: the flag the gate
     * read is left set by a closed code fence and by nothing else in this band.
     */
    it('still keeps it after a closed code fence', () => {
      expect(html(':: t\n: - ```\n    c\n    ```\nx\n')).toContain('    <p>x</p>\n  </dd>')
    })

    it('reads an ordered marker, a deeper list and a list over a quote alike', () => {
      for (const lead of [': 1. # h', ': - - # h', ': - > # h', ': > - # h']) {
        expect(html(':: t\n' + lead + '\nx\n'), lead).toContain('<p>x</p>\n  </dd>')
      }
    })
  })

  describe('CONTROL: a quote on the lead ends the body', () => {
    for (const [label, lead] of [
      ['a heading', '# h'],
      ['a table', '| a |'],
      ['a `%%` comment line', '%% c'],
    ] as const) {
      it('publishes the follower after ' + label, () => {
        expect(html(':: t\n: > ' + lead + '\nx\n'), lead).toMatch(/<\/dl>\s*<p>x<\/p>/)
      })
    }

    it('publishes a flush-left fence line below a fence the quote holds', () => {
      for (const lead of [': - > ```', ': > - ```']) {
        const out = html(':: t\n' + lead + '\n```\nk\n```\n')
        expect(out, lead).not.toMatch(/<p>k[\s\S]*<\/dd>/)
      }
    })
  })

  describe('CONTROL: a definition and a column-0 opener still end the body', () => {
    for (const [label, follower] of [
      ['a reference definition', '[r]: /u'],
      ['a footnote definition', '[^f]: n'],
      ['a term', ':: u\n: v'],
      ['a break', '---'],
      ['a heading', '# H'],
      ['a list', '- i'],
      ['a `%%%` fence', '%%%\nc\n%%%'],
    ] as const) {
      it('ends the body at ' + label, () => {
        expect(html(':: t\n: - # h\n' + follower + '\nx\n'), label).not.toMatch(/<p>x<\/p>\s*<\/dd>/)
      })
    }
  })

  describe('CONTROL: a closed `%%%` run on the lead ends the body', () => {
    it('publishes the follower below a CLOSED comment fence', () => {
      expect(html(':: t\n: - %%%\n    c\n    %%%\nx\n')).toMatch(/<\/dl>\s*<p>x<\/p>/)
    })

    /*
     * The run has to be the CLOSED one: an unterminated `%%%` is still
     * collecting, so the body folds on past it. A fix keyed on the `%%%` line
     * alone would move this row.
     */
    it('keeps the follower in the body below an UNTERMINATED comment fence', () => {
      expect(html(':: t\n: - %%%\nx\n')).toContain('<p>x</p>\n  </dd>')
    })
  })

  describe("CONTROL: the body's OWN column closes the list", () => {
    for (const [label, second] of [
      ['a `%%` comment line', '  %% c'],
      ['a heading', '  # h'],
      ['a blank line', ''],
    ] as const) {
      it("publishes the follower when " + label + " stands at the body's column", () => {
        expect(html(':: t\n: - a\n' + second + '\nx\n'), label).not.toMatch(/<p>x<\/p>\s*<\/dd>/)
      })
    }

    /*
     * ...AND RE-OPENS IT. The heading at the body's column ends the first list,
     * and the marker below it opens a second one the flush-left line still
     * reaches - here into the item's own paragraph, which is where the oracle
     * puts it. A flag seeded off the lead alone and never advanced would end the
     * body at the heading instead.
     */
    it("re-opens the fold when a later line at the body's column is a list marker", () => {
      expect(html(':: t\n: - a\n  # h\n  - b\nx\n')).toBe(
        [
          '<dl>',
          '  <dt>t</dt>',
          '  <dd>',
          '    <ul>',
          '      <li>a</li>',
          '    </ul>',
          '    <h1 id="h">h</h1>',
          '    <ul>',
          '      <li>b',
          'x</li>',
          '    </ul>',
          '  </dd>',
          '</dl>',
        ].join('\n'),
      )
    })
  })
})
