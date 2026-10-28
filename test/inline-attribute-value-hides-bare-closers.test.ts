import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml } from '../src/index.js'

// PART 3 inline_span owns its attribute run before bare delimiter pairing.
describe('bare closers inside inline attribute values', () => {
  it.each([
    ['highlight, unquoted', '=[]{e=x=}', '<p>=<span e="x="></span></p>'],
    ['highlight, quoted', '=[]{title="x=y"}', '<p>=<span title="x=y"></span></p>'],
    ['emphasis', '/[]{e=x/}', '<p>/<span e="x/"></span></p>'],
    ['strong', '*[]{e=x*}', '<p>*<span e="x*"></span></p>'],
    ['strike', '~[]{e=x~}', '<p>~<span e="x~"></span></p>'],
    ['no closer', '=[]{e=x}', '<p>=<span e="x"></span></p>'],
  ])('%s stays inside the span', (_name, source, expected) => {
    expect(renderHtml(parse(source)).trim()).toBe(expected)
    expect(carveToHtml(source).trim()).toBe(expected)
  })
})
