import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'

// A braced inline starts its own scope for E3 and E2: an opener of an outer
// kind nests inside it, and a closer inside it cannot reach an outer span
// (markup-carve/carve#2091, corpus 471 rows 5 to 7).

const html = (source: string) => carveToHtml(source).trim()

describe('a braced span of another kind', () => {
  it.each([
    ['a forced opener of the outer kind nests', '{*a {/b {*c*} d/} e*}', '<p><strong>a <em>b <strong>c</strong> d</em> e</strong></p>'],
    ['a closer inside it does not close the outer span', '{*a {/b *} d/} e*}', '<p><strong>a <em>b *} d</em> e</strong></p>'],
    ['a bare opener of the outer kind nests', '*a {/b *c* d/} e*', '<p><strong>a <em>b <strong>c</strong> d</em> e</strong></p>'],
  ])('is a scope: %s', (_, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it('keeps a forced opener of its own kind literal', () => {
    expect(html('a{*{*x*}*}b')).toBe('<p>a<strong>{*x</strong>*}b</p>')
  })

  it('is written braced where a descendant repeats an outer kind', () => {
    expect(carveToCarve('*a {/b *c* d/} e*\n')).toBe('*a {/b *c* d/} e*\n')
    expect(htmlToCarve('<p><strong>a <em>b <strong>c</strong> d</em> e</strong></p>').value).toBe('*a {/b *c* d/} e*\n')
  })

  it('is written bare where nothing below repeats an outer kind', () => {
    expect(carveToCarve('{*a {/b d/} e*}\n')).toBe('*a /b d/ e*\n')
  })
})
