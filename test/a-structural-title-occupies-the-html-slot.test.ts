import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a destination title and title= share one HTML attribute slot', () => {
  it('the image destination title wins over a promoted block attribute', () => {
    expect(carveToHtml('{title=p}\n![a](a "i")\n')).toBe(
      '<img src="a" alt="a" title="i">',
    )
  })

  it('matches title case-insensitively, as HTML does', () => {
    expect(carveToHtml('![a](a "i"){TITLE=p}\n')).toBe(
      '<img src="a" alt="a" title="i">',
    )
  })

  it('keeps title= when the destination supplies no title', () => {
    expect(carveToHtml('![a](a){title=p}\n')).toBe(
      '<img src="a" alt="a" title="p">',
    )
  })

  it('applies the same occupied-slot rule to links', () => {
    expect(carveToHtml('[x](a "i"){title=p}\n')).toBe(
      '<p><a href="a" title="i">x</a></p>',
    )
  })
})
