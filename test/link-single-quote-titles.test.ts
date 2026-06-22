import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * Link/image titles accept single OR double quotes (grammar link_title;
 * a deliberate enhancement over djot, which folds `'…'` into the URL).
 * Matches carve-php.
 */
describe('single-quote link/image titles', () => {
  it('parses a single-quoted link title', () => {
    expect(h("[t](/u 'ti')")).toBe('<p><a href="/u" title="ti">t</a></p>')
  })

  it('matches the double-quoted form', () => {
    expect(h('[t](/u "ti")')).toBe(h("[t](/u 'ti')"))
  })

  it('allows the other quote inside each title form', () => {
    expect(h('[t](/u "it\'s")')).toBe('<p><a href="/u" title="it&apos;s">t</a></p>')
    expect(h("[t](/u 'say \"hi\"')")).toBe(
      '<p><a href="/u" title="say &quot;hi&quot;">t</a></p>',
    )
  })

  it('parses a single-quoted image title', () => {
    expect(h("![a](/i.png 'cap')")).toBe('<img src="/i.png" alt="a" title="cap">')
  })

  it('still accepts a trailing attribute block after the title', () => {
    expect(h("[t](/u 'ti'){.c}")).toBe(
      '<p><a href="/u" title="ti" class="c">t</a></p>',
    )
  })

  it('escapes a literal apostrophe in an attribute value (matches djot + carve-php)', () => {
    expect(h('[t](/u "it\'s")')).toContain('title="it&apos;s"')
  })

  it('accepts an escaped quote inside a double-quoted title (matches carve-php)', () => {
    expect(h('[t](u "a \\"b\\" c")')).toBe('<p><a href="u" title="a &quot;b&quot; c">t</a></p>')
  })

  it('accepts an escaped quote inside an image title', () => {
    expect(h('![a](i "t\\"i")')).toBe('<p><img src="i" alt="a" title="t&quot;i"></p>')
  })

  it('preserves explicit empty link and image titles', () => {
    expect(h('[x](u "")')).toBe('<p><a href="u" title="">x</a></p>')
    expect(h('![a](i "")')).toBe('<img src="i" alt="a" title="">')
  })
})
