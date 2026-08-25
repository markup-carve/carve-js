import { describe, expect, it } from 'vitest'
import { htmlToCarve, parse, renderCarve, renderHtml } from '../src/index.js'
import { resolveHeadingIds } from '../src/heading-ids.js'

describe('digit-leading explicit ids and classes', () => {
  it('accepts explicit id/class shorthands without widening attribute names', () => {
    expect(renderHtml(parse('[x]{.123}\n[y]{#7-x}\n'))).toContain('class="123"')
    expect(renderHtml(parse('[x]{.123}\n[y]{#7-x}\n'))).toContain('id="7-x"')
    expect(renderHtml(parse('[x]{12=v}\n'))).toContain('[x]{12=v}')
    expect(renderHtml(parse('[x]{12}\n'))).toContain('[x]{12}')
    expect(renderHtml(parse(':1[x]\n'))).toContain(':1[x]')
  })

  it('accepts a digit-leading generic-div class and writes it back', () => {
    const doc = parse('::: 123\nbody\n:::\n')
    expect(renderHtml(doc)).toContain('<div class="123">')
    expect(renderCarve(doc)).toBe('::: 123\nbody\n:::\n')
  })

  it('keeps generated digit-leading heading ids conservative', () => {
    const doc = parse('# 2024 Recap\n')
    resolveHeadingIds(doc)
    expect(renderHtml(doc)).toContain('id="s-2024-Recap"')
  })

  it('preserves digit-leading ids and classes imported from HTML', () => {
    const source = htmlToCarve('<p id="123" class="7-x">x</p>').value
    expect(source).toContain('{#123 .7-x}')
    expect(renderHtml(parse(source))).toContain('id="123" class="7-x"')
  })
})
