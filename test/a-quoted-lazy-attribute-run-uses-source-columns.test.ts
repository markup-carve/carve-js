import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// CARVE-P2-035: a lazy continuation at the opening brace's source column
// refuses the whole attribute run, including text that looks like inline syntax.
describe('quoted lazy attribute runs use source columns', () => {
  it.each([
    ['> q\n> {.k\ntail\n> #x}', '<blockquote><p>q\n{.k\ntail\n#x}</p></blockquote>'],
    ['> > {.k\ntail\n> > #x}', '<blockquote><blockquote><p>{.k\ntail\n#x}</p></blockquote></blockquote>'],
  ])('keeps %j literal', (source, expected) => {
    expect(carveToHtml(source).replace(/>\s+</g, '><')).toBe(expected)
  })
})
