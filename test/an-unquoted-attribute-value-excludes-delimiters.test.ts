import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { parse } from '../src/parse.js'
import { renderCarve } from '../src/render-carve.js'

const quoted = (value: string) => `"${value.replace(/[\\"|]/g, '\\$&')}"`

describe('unquoted attribute value boundaries (#2191)', () => {
  it.each(['a|b', 'a\\b', 'a\\|b', 'a"b"c', "a'b'c"])(
    'leaves an invalid unquoted value as text: %s',
    (value) => {
      const inline = carveToHtml(`*x*{k=${value}}\n`)
      expect(inline).toContain('<strong>x</strong>{k=')
      expect(inline).not.toContain('<strong k=')
      const block = carveToHtml(`{k=${value}}\n\nparagraph\n`)
      expect(block).toContain('<p>{k=')
      expect(block).toContain('<p>paragraph</p>')
      expect(carveToHtml(`[x]{k=${value}}\n`)).not.toContain('<span')
    },
  )

  it.each([
    '-{k=a|b} item\n',
    '[l]: /u {k=a|b}\n\n[l][]\n',
    '| x |{k=a\\b}\n',
    '{.ok\n k=a\\b}\n\nparagraph\n',
  ])('refuses invalid values through container-specific paths: %s', (source) => {
    const html = carveToHtml(source)
    expect(html).not.toMatch(/<[^>]+ k=/)
    expect(html).toContain('k=')
    const valid = source.replace(/k=a[|\\]b/, 'k=a/b')
    expect(carveToHtml(valid)).toContain('k="a/b"')
    expect(carveToHtml(renderCarve(parse(source)))).toBe(html)
  })

  it.each(['w-1/2', 'a+b', 'a%b', 'a(b', 'a#b', 'a=b', 'a{b', 'a\vb', 'a\fb', 'a\u00a0b'])(
    'accepts the widened unquoted character set: %s',
    (value) => {
      expect(carveToHtml(`*x*{k=${value}}\n`)).toBe(`<p><strong k="${value}">x</strong></p>`)
    },
  )

  // PART 11 §2 escapes a character only if omitting the escape would change
  // the re-parse, so a backslash before a NON-punctuation character stays
  // single: a reader keeps it literal either way, and doubling it wrote back
  // one character the re-parse then discarded. Spelled out per value rather
  // than derived, so the expectation pins the rule instead of the writer.
  it.each([
    ['a\\b', '"a\\b"'],
    ['a\\', '"a\\\\"'],
    ['\\', '"\\\\"'],
    ['a\\.b', '"a\\\\.b"'],
    ['a|b', '"a\\|b"'],
    ['a"b', '"a\\"b"'],
    ["a'b", '"a\'b"'],
    ['a}b', '"a}b"'],
    ['a b', '"a b"'],
  ])('formats a quoted value to its shortest re-parsing spelling: %s', (value, expected) => {
    const source = `*x*{k=${quoted(value)}}\n`
    const formatted = renderCarve(parse(source))
    expect(formatted).toContain(`{k=${expected}}`)
    expect(carveToHtml(formatted)).toBe(carveToHtml(source))
    expect(renderCarve(parse(formatted))).toBe(formatted)
  })

  it('preserves quoted pipe and backslash values in table cells', () => {
    const source = '| *x*{k="a\\|b\\\\c"} |\n'
    const formatted = renderCarve(parse(source))
    expect(carveToHtml(formatted)).toBe(carveToHtml(source))
    expect(carveToHtml(source)).toContain('k="a|b\\c"')
    expect(renderCarve(parse(formatted))).toBe(formatted)
  })
})
