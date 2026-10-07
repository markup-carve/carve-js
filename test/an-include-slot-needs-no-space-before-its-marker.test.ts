import { describe, expect, it } from 'vitest'
import { expandIncludes, isDirectiveShape, parse, parseDirective, renderHtml, resolve } from '../src/index.js'

function expand(source: string, files: Record<string, string>) {
  const doc = parse(source, { positions: true })
  const result = expandIncludes(doc, source, { resolve: (path) => files[path] ?? null })
  return { rules: result.warnings.map((w) => w.rule), html: renderHtml(resolve(result.doc)) }
}

const child = '# Alpha\n\nA body.\n\n# Beta\n\nOther.'
const files = { 'c.crv': child, 'my c.crv': child }

// carve-js#2563, carve#2773: the path stops at `#` and `@`, and the name stops
// at `@`, so neither slot needs whitespace in front of its marker.
describe('an include slot needs no whitespace before its marker', () => {
  const spaced = expand('{{ c.crv #Alpha }}', files)

  it('the spaced form selects the heading section', () => {
    expect(spaced.rules).toEqual([])
    expect(spaced.html).toContain('A body.')
    expect(spaced.html).not.toContain('Other.')
  })

  it.each([
    ['a bare path', '{{ c.crv#Alpha }}'],
    ['a quoted path', '{{ "c.crv"#Alpha }}'],
    ['a curly-quoted path', '{{ “c.crv”#Alpha }}'],
    ['a tab separator', '{{ c.crv\t#Alpha }}'],
    ['a quoted path holding a space', '{{ "my c.crv"#Alpha }}'],
  ])('%s takes an adjacent section name', (_label, source) => {
    const r = expand(source, files)
    expect(r.rules).toEqual([])
    expect(r.html).toBe(spaced.html)
  })

  it.each([
    ['after a path', '{{ c.crv@shift:1 }}', { path: 'c.crv', shift: 1 }],
    ['after a name', '{{ c.crv #Alpha@shift:1 }}', { path: 'c.crv', section: 'Alpha', shift: 1 }],
    ['after an adjacent name', '{{ c.crv#Alpha@shift:1 }}', { path: 'c.crv', section: 'Alpha', shift: 1 }],
    [
      'after another option',
      '{{ c.crv@shift:2@lines:1-2 }}',
      { path: 'c.crv', shift: 2, lines: { start: 1, end: 2 } },
    ],
  ])('an option needs no space in front of it %s', (_label, source, expected) => {
    expect(parseDirective(source)).toEqual({ raw: source, ...expected })
  })

  it('an adjacent option still applies at expansion', () => {
    const r = expand('{{ c.crv#Alpha@shift:1 }}', files)
    expect(r.rules).toEqual([])
    expect(r.html).toContain('<h2>Alpha</h2>')
  })

  it('a malformed adjacent option still warns rather than staying silent', () => {
    expect(expand('{{ c.crv#Alpha@bogus:1 }}', files).rules).toContain('include-unknown-option')
  })

  it.each(['{{c.crv#Alpha}}', '{{ c.crv#Alpha}}', '{{c.crv#Alpha }}'])(
    'the padding is still required on both sides: %s',
    (source) => {
      expect(isDirectiveShape(source)).toBe(false)
      expect(expand(source, files).html).toBe(`<p>${source}</p>`)
    },
  )
})
