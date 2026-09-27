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

  it.each(['w-1/2', 'a+b', 'a%b', 'a(b', 'a#b', 'a=b', 'a{b', 'a\vb', 'a\fb', 'a\u00a0b'])(
    'accepts the widened unquoted character set: %s',
    (value) => {
      expect(carveToHtml(`*x*{k=${value}}\n`)).toBe(`<p><strong k="${value}">x</strong></p>`)
    },
  )

  it.each(['a\\b', 'a\\', '\\', 'a|b', 'a"b', "a'b", 'a}b', 'a b'])(
    'formats a quoted value without changing it: %s',
    (value) => {
      const source = `*x*{k=${quoted(value)}}\n`
      const formatted = renderCarve(parse(source))
      expect(formatted).toContain(`{k=${quoted(value)}}`)
      expect(carveToHtml(formatted)).toBe(carveToHtml(source))
      expect(renderCarve(parse(formatted))).toBe(formatted)
    },
  )

  it('preserves quoted pipe and backslash values in table cells', () => {
    const source = '| *x*{k="a\\|b\\\\c"} |\n'
    const formatted = renderCarve(parse(source))
    expect(carveToHtml(formatted)).toBe(carveToHtml(source))
    expect(carveToHtml(source)).toContain('k="a|b\\c"')
    expect(renderCarve(parse(formatted))).toBe(formatted)
  })
})
