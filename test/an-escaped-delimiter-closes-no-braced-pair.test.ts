import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A backslash hides the character after it, so a delimiter written `\\*` is
 * text and closes nothing. The table that finds a braced pair's closer tested
 * the delimiter without asking whether it was escaped, and only an escaped
 * backtick was skipped. The pair therefore closed on its escaped closer, and
 * the backslash left over in front of it became a hard break (#1897).
 *
 * Expected bytes are the executable reference's, identical at the 0.1.6 tag
 * and at spec main.
 */
describe('an escaped delimiter closes no braced pair', () => {
  const moved: [string, string, string][] = [
    [
      'a strong pair',
      '{*a\\*}\n',
      '<p>{*a*}</p>',
    ],
    [
      'an emphasis pair',
      '{/a\\/}\n',
      '<p>{/a/}</p>',
    ],
    [
      'an underline pair',
      '{_a\\_}\n',
      '<p>{_a_}</p>',
    ],
    [
      'a strike pair',
      '{~a\\~}\n',
      '<p>{~a~}</p>',
    ],
    [
      'a highlight pair',
      '{=a\\=}\n',
      '<p>{=a=}</p>',
    ],
    [
      'a superscript pair',
      '{^a\\^}\n',
      '<p>{^a^}</p>',
    ],
    [
      'a subscript pair',
      '{,a\\,}\n',
      '<p>{,a,}</p>',
    ],
    [
      'an insertion pair',
      '{+a\\+}\n',
      '<p>{+a+}</p>',
    ],
    [
      'a deletion pair',
      '{-a\\-}\n',
      '<p>{-a-}</p>',
    ],
    [
      'text on both sides',
      'x {*a\\*} y\n',
      '<p>x {*a*} y</p>',
    ],
    [
      'two escaped closers',
      '{*a\\*b\\*}\n',
      '<p>{*a*b*}</p>',
    ],
    [
      'an escaped closer inside a nested kind',
      '{*a{/b\\/}c*}\n',
      '<p><strong>a{/b/}c</strong></p>',
    ],
    [
      'a real closer after the escaped one',
      '{*a\\*}b*}\n',
      '<p><strong>a*}b</strong></p>',
    ],
  ]

  for (const [name, source, expected] of moved) {
    it(`reads the escape as text: ${name}`, () => {
      expect(carveToHtml(source).trim()).toBe(expected)
    })
  }

  // Rows that read the same before and after: the escape does not reach them,
  // or a closer that is not escaped still closes.
  const unchanged: [string, string, string][] = [
    [
      'a pair with no escape',
      '{*a*}\n',
      '<p><strong>a</strong></p>',
    ],
    [
      'an escape before an ordinary character',
      '{*a\\b*}\n',
      '<p><strong>a\\b</strong></p>',
    ],
    [
      'an escaped backslash before the closer',
      '{*a\\\\*}\n',
      '<p><strong>a\\</strong></p>',
    ],
    [
      'an escaped opener',
      '{\\*a\\*}\n',
      '<p>{*a*}</p>',
    ],
    [
      'an escaped backtick opening no span',
      '{*a\\`b*}\n',
      '<p><strong>a`b</strong></p>',
    ],
    [
      'a code span holding the closer',
      '{*a`*}`b*}\n',
      '<p><strong>a<code>*}</code>b</strong></p>',
    ],
    [
      'an unclosed run ending at the pair closer',
      '{~` ~}\n',
      '<p><s><code></code></s></p>',
    ],
    // Inside a verbatim run a backslash is content, so the closer an unclosed
    // run ends at still counts.
    [
      'an unclosed run before an escaped closer',
      '{*a`b\\*}\n',
      '<p><strong>a<code>b\\</code></strong></p>',
    ],
    [
      'a bare pair with an escaped delimiter',
      '*a\\* b*\n',
      '<p><strong>a* b</strong></p>',
    ],
  ]

  for (const [name, source, expected] of unchanged) {
    it(`still reads: ${name}`, () => {
      expect(carveToHtml(source).trim()).toBe(expected)
    })
  }

  it('covers every row', () => {
    expect(moved).toHaveLength(13)
    expect(unchanged).toHaveLength(9)
  })
})
