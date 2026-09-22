import { describe, expect, it } from 'vitest'
import { bbcodeToCarve, carveToHtml } from '../src/index.js'

const html = (bbcode: string) => carveToHtml(bbcodeToCarve(bbcode)).trim()

/*
 * BBCode has no block syntax, so a line-initial `#`, `*`/`-`, `1.`/`1)`, `.`
 * or `>` in a post's own text becomes document structure the author never
 * asked for: heading, list, quote or fenced div (#1893). The same fault as
 * carve-js#1386, which protected only a `[noparse]` body; this covers
 * ordinary text.
 *
 * `escapeLineInitialBlockOpeners` already existed for `[noparse]`; it now
 * also runs on the plain-text pass every post goes through.
 *
 * Expected bytes are the executable reference's, identical at the 0.1.6 tag
 * and at spec main.
 */
describe('a line-initial block opener in a post is text', () => {
  const moved: [string, string, string][] = [
    ['a heading marker', '# a', '<p># a</p>'],
    ['a level-2 heading marker', '## a', '<p>## a</p>'],
    ['a bullet, star', '* a', '<p>* a</p>'],
    ['a bullet, hyphen', '- a', '<p>- a</p>'],
    ['a quote', '> a', '<p>&gt; a</p>'],
    ['an ordered marker with a dot', '1. a', '<p>1. a</p>'],
    ['an ordered marker with a paren', '1) a', '<p>1) a</p>'],
    ['an ordered marker with two digits', '10. a', '<p>10. a</p>'],
    ['a bare-dot continuation opener', '. a', '<p>. a</p>'],
    ['a thematic break', '*** a', '<p>*** a</p>'],
    ['a colon fence', ':::', '<p>:::</p>'],
    ['on a later line, after a paragraph', 'q q\n# a', '<p>q q\n# a</p>'],
    ['on a later line, after a converted tag', '[b]x[/b]\n# a', '<p><strong>x</strong>\n# a</p>'],
  ]

  for (const [name, bbcode, expected] of moved) {
    it(`stays text: ${name}`, () => {
      expect(html(bbcode)).toBe(expected)
    })
  }

  // Rows that read the same before and after.
  const unchanged: [string, string, string][] = [
    ['a plus is not a marker', '+ a', '<p>+ a</p>'],
    ['text with no leading marker', 'a # b', '<p>a # b</p>'],
    ['a converted tag stays a tag', '[b]x[/b]', '<p><strong>x</strong></p>'],
  ]

  for (const [name, bbcode, expected] of unchanged) {
    it(`still reads: ${name}`, () => {
      expect(html(bbcode)).toBe(expected)
    })
  }

  // Unaffected: a [code] body is still written verbatim inside a fence, and
  // a [noparse] body still goes through its own dedicated call - this pass
  // never reaches either, since both are behind a stash placeholder by the
  // time it runs.
  it('does not touch a [code] body', () => {
    expect(bbcodeToCarve('[code]- a\n# b[/code]')).toBe('```\n- a\n# b\n```\n')
  })

  it('still protects a [noparse] body the same way', () => {
    const carve = bbcodeToCarve('[noparse]- a[/noparse]')
    expect(carve).toContain('\\- a')
  })

  it('covers every row', () => {
    expect(moved).toHaveLength(13)
    expect(unchanged).toHaveLength(3)
  })
})
