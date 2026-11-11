import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'

const fmt = (source: string): string => renderCarve(parse(source, { positions: true }))

describe('fmt keeps a marker-line comment run past its brace', () => {
  it('keeps the corpus 1069-3 spelling and empty item', () => {
    const source = '-{.g} {% b\n       b %}\n'
    expect(fmt(source)).toBe(source)
    expect(carveToHtml(fmt(source))).toBe('<ul>\n  <li class="g"></li>\n</ul>')
  })

  it.each([
    '-{.long} {% first\n            second %}\n',
    '1.{#i} {% first\n         second %}\n',
    '-{.g} {% first\n       second\n       third %}\n',
    '- [x] {% first\n        second %}\n',
    '> -{.g} {% first\n>        second %}\n',
    '-{.g} {% first\n       second %}\n  after\n',
  ])('keeps the rendered meaning and fixed point of %j', (source) => {
    const formatted = fmt(source)
    expect(carveToHtml(formatted)).toBe(carveToHtml(source))
    expect(fmt(formatted)).toBe(formatted)
  })
})
