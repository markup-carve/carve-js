import { describe, expect, it } from 'vitest'
import { expandIncludes, parse, parseDirective, renderHtml, resolve } from '../src/index.js'

function expand(source: string) {
  const doc = parse(source, { positions: true })
  const result = expandIncludes(doc, source, {
    resolve: (path) => (path === 'c.crv' ? '# Alpha\n\nA body.\n\n# Beta\n\nC body.' : null),
  })
  return { warnings: result.warnings, html: renderHtml(resolve(result.doc)) }
}

// carve-js#2572: `include_section` is one slot, so a second name leaves the
// directive literal with a warning, as carve-rs and carve-php report it.
describe('a second include section name', () => {
  it.each([
    ['spaced', '{{ c.crv #Alpha #Beta }}'],
    ['adjacent', '{{ c.crv#Alpha#Beta }}'],
    ['before an option', '{{ c.crv #Alpha #Beta @shift:1 }}'],
  ])('stays literal and warns include-selection-conflict when %s', (_label, source) => {
    const r = expand(source)
    expect(r.html).toMatch(/^<p>\{\{ c\.crv/)
    expect(r.html).not.toContain('body.')
    expect(r.warnings.map((w) => [w.rule, w.message])).toEqual([
      ['include-selection-conflict', 'Include directive cannot name two sections: "#Beta".'],
    ])
  })

  it('warns in inline position too', () => {
    const r = expand('See {{ c.crv #Alpha #Beta }} here.')
    expect(r.html).toMatch(/^<p>See \{\{ c\.crv/)
    expect(r.html).not.toContain('body.')
    expect(r.warnings.map((w) => w.rule)).toEqual(['include-selection-conflict'])
  })

  it('reports the second name through its own callback', () => {
    const seen: string[] = []
    expect(parseDirective('{{ c.crv #Alpha #Beta }}', undefined, (part) => seen.push(part))).toBeNull()
    expect(seen).toEqual(['#Beta'])
  })

  it('leaves a single name and a bad option as they were', () => {
    expect(expand('{{ c.crv #Alpha }}').warnings).toEqual([])
    expect(expand('{{ c.crv #Alpha @bogus:1 }}').warnings.map((w) => w.rule)).toEqual(['include-unknown-option'])
  })
})
