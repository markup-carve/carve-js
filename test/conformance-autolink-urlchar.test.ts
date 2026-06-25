import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s).trim()

// Fix 5: autolink url body excludes non-url_char characters.
// url_char excludes `<` `>` `"` `\` `` ` `` `{` `}` `|` `^`. A body holding any
// of these never validly closes the autolink, so the construct stays literal --
// no `<a>` is emitted. carve-rs is the oracle (literal here); js+php were wrong,
// admitting these into the href. The spec corpus stays byte-identical.

describe('Fix 5: autolink url body excludes non-url_char characters', () => {
  const excluded: Array<[string, string]> = [
    ['double-quote', '"'],
    ['backslash', '\\'],
    ['backtick', '`'],
    ['open-brace', '{'],
    ['close-brace', '}'],
    ['pipe', '|'],
    ['caret', '^'],
  ]

  for (const [name, ch] of excluded) {
    it(`does not autolink when the body holds a ${name}`, () => {
      const out = h(`<http://a.com/a${ch}b>`)
      expect(out).not.toContain('<a ')
      expect(out).not.toContain('href=')
    })
  }

  it('keeps a body with a double-quote fully literal', () => {
    // No <a>; the `"` is not a url_char so the run is plain inline text
    // (byte-identical to carve-rs, smart quotes and all).
    expect(h('<http://a.com/"q">')).toBe('<p>&lt;http://a.com/“q”&gt;</p>')
  })

  it('still autolinks a clean url with no excluded char', () => {
    expect(h('<http://a.com/path?x=1>')).toBe(
      '<p><a href="http://a.com/path?x=1">http://a.com/path?x=1</a></p>',
    )
  })
})
