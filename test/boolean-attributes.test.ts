import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s).trim()

/**
 * Boolean (bare-word) attributes: a name with no value in a `{…}` block becomes
 * a value-less attribute, rendered `name=""` (the djot-php / carve-php form).
 * Works in any attribute position and mixes with id / class / key=value.
 */
describe('boolean (bare-word) attributes', () => {
  it('inline span', () => {
    expect(h('[x]{disabled}')).toBe('<p><span disabled="">x</span></p>')
  })

  it('block-attribute line', () => {
    expect(h('{disabled}\nText')).toBe('<p disabled="">Text</p>')
  })

  it('heading, via a leading block-attribute line', () => {
    expect(h('{disabled}\n# H')).toBe(
      '<section id="h">\n  <h1 disabled="">H</h1>\n</section>',
    )
  })

  it('link', () => {
    expect(h('[t](u){disabled}')).toBe('<p><a href="u" disabled="">t</a></p>')
  })

  it('emphasis', () => {
    expect(h('*b*{disabled}')).toBe('<p><strong disabled="">b</strong></p>')
  })

  it('multiple bare words', () => {
    expect(h('[x]{kbd foo}')).toBe('<p><span kbd="" foo="">x</span></p>')
  })

  it('mixes with class (both applied, source order)', () => {
    expect(h('[x]{.c disabled}')).toBe('<p><span class="c" disabled="">x</span></p>')
  })

  it('mixes with a key=value', () => {
    expect(h('[x]{disabled k=v}')).toBe('<p><span disabled="" k="v">x</span></p>')
  })

  it('a digit-first bare word is not a valid attribute (stays literal)', () => {
    expect(h('[x]{2bad}')).toBe('<p>[x]{2bad}</p>')
  })
})
