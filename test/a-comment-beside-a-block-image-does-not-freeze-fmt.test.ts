import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// A lone-image paragraph holding a comment carries `blockImage` after the
// representation passes; the readback has to run those passes too.
describe('a comment beside a block image does not freeze fmt', () => {
  it.each([
    ['an empty braced comment before the image', '{%%}![alt](x.png)\n', '{%  %}![alt](x.png)\n'],
    ['an empty braced comment after the image', '![alt](x.png){%%}\n\n---\n', '![alt](x.png){%  %}\n\n***\n'],
    ['inside a list item', '- {%%}![alt](x.png)\n\n---\n', '- {%  %}![alt](x.png)\n\n***\n'],
    ['inside a quote, with attributes', '> {%%}![alt](x.png){#i}\n\n---\n', '> {%  %}![alt](x.png){#i}\n\n***\n'],
  ])('%s', (_name, source, expected) => {
    const written = carveToCarve(source)
    expect(written).toBe(expected)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(carveToCarve(written)).toBe(written)
  })
})
