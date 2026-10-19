import { describe, expect, it } from 'vitest'
import { expandIncludes, parse, renderHtml, resolve } from '../src/index.js'

function expand(source: string) {
  const doc = parse(source, { positions: true })
  return expandIncludes(doc, source, { resolve: (path) => (path === 'b.crv' ? 'BODY' : 'x') })
}

function warnings(source: string) {
  return expand(source).warnings.map((w) => [w.rule, w.message, w.line, w.column])
}

// carve-js#3256: an option value holding a brace failed the whole-paragraph
// shape check, so the inline scan reported the same directive a second time.
describe('an invalid include option value holding a brace', () => {
  it.each([
    ['{{ a.js @code:j{s }}', '@code:j{s'],
    ['{{ a.crv @region:a}b }}', '@region:a}b'],
  ])('is reported once for %s', (source, part) => {
    expect(warnings(source)).toEqual([['include-unknown-option', `Unknown include option "${part}".`, 1, 1]])
  })

  it('is reported once in inline position', () => {
    expect(warnings('See {{ a.js @code:j{s }} here.').map((w) => w[0])).toEqual(['include-unknown-option'])
  })

  it('still expands a valid directive after an invalid one in the same paragraph', () => {
    const source = '{{ a.crv @bad:x }} {{ b.crv }}'
    const r = expand(source)
    expect(r.warnings.map((w) => [w.rule, w.message])).toEqual([
      ['include-unknown-option', 'Unknown include option "@bad:x".'],
    ])
    expect(renderHtml(resolve(r.doc))).toContain('BODY')
  })
})
