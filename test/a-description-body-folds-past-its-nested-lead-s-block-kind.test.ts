import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s).trim()

/** The deepest open paragraph decides continuation (CARVE-P0-009). */
describe("a description follows its deepest paragraph state", () => {
  describe('finished nested blocks end the description', () => {
    for (const [label, lead, inner] of [
      ['a heading', '# h', '<h1 id="h">h</h1>'],
      ['a break', '---', '<hr>'],
      ['an attribute block', '{.k}', ''],
    ] as const) {
      it('publishes the flush-left line after ' + label, () => {
        expect(html(':: t\n: - ' + lead + '\nx\n')).toBe(
          [
            '<dl>',
            '  <dt>t</dt>',
            '  <dd>',
            '    <ul>',
            '      <li>' + (inner === '' ? '' : '\n        ' + inner + '\n      ') + '</li>',
            '    </ul>',
            '  </dd>',
            '</dl>',
            '<p>x</p>',
          ].join('\n'),
        )
      })
    }

    it('publishes the flush-left line after a `%%` comment line', () => {
      expect(html(':: t\n: - %% c\nx\n')).toBe(
        [
          '<dl>',
          '  <dt>t</dt>',
          '  <dd>',
          '    <ul>',
          '      <li></li>',
          '    </ul>',
          '  </dd>',
          '</dl>',
          '<p>x</p>',
        ].join('\n'),
      )
    })

    it('publishes the flush-left line after a table', () => {
      const out = html(':: t\n: - | a |\n    | - |\n    | b |\nx\n')
      expect(out).toMatch(/<\/dl>\s*<p>x<\/p>/)
    })

    it('publishes the follower after a closed code fence', () => {
      expect(html(':: t\n: - ```\n    c\n    ```\nx\n')).toMatch(/<\/dl>\s*<p>x<\/p>/)
    })

    it('reads an ordered marker, a deeper list and a list over a quote alike', () => {
      for (const lead of [': 1. # h', ': - - # h', ': - > # h', ': > - # h']) {
        expect(html(':: t\n' + lead + '\nx\n'), lead).toMatch(/<\/dl>\s*<p>x<\/p>/)
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

    it('publishes the follower after an unterminated comment opener', () => {
      expect(html(':: t\n: - %%%\nx\n')).toMatch(/<\/dl>\s*<p>x<\/p>/)
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
