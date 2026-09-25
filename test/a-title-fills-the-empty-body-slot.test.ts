import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * CARVE-P10-001: an empty container body keeps a blank line, and a rendered
 * caption or div label is visible content that FILLS that slot. Both were
 * emitted here, so a titled container with no body carried a stray blank line
 * that carve-php and carve-rs never wrote (carve-js#2036).
 */
describe('a title or label fills the body slot', () => {
  it('writes no blank line after a title', () => {
    expect(carveToHtml('::: note "x"\n:::\n')).toBe(
      ['<aside class="admonition note" aria-labelledby="adm-1">', '  <p class="admonition-title" id="adm-1">x</p>', '</aside>'].join('\n'),
    )
  })

  it('writes no blank line after a label', () => {
    expect(carveToHtml('::: foo [L]\n:::\n')).toBe(
      ['<div class="foo">', '  <p class="div-label">L</p>', '</div>'].join('\n'),
    )
  })

  it('writes no blank line after a directive that places nothing', () => {
    expect(carveToHtml('::: footnotes "T" [L]\n:::\n')).toBe(
      ['<div class="footnotes">', '  <p class="admonition-title">T</p>', '  <p class="div-label">L</p>', '</div>'].join('\n'),
    )
  })

  it('keeps the blank line where the container carries neither', () => {
    expect(carveToHtml('::: foo\n:::\n')).toBe(['<div class="foo">', '', '</div>'].join('\n'))
    expect(carveToHtml('> \n')).toBe(['<blockquote>', '', '</blockquote>'].join('\n'))
  })

  it('leaves a container with a body untouched', () => {
    expect(carveToHtml('::: note "x" [L]\nbody\n:::\n')).toContain(
      ['  <p class="div-label">L</p>', '  <p>body</p>'].join('\n'),
    )
  })
})
