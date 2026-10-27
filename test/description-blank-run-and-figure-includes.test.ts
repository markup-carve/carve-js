import { describe, expect, it } from 'vitest'
import { carveToHtml, expandIncludes, parse, renderHtml, resolve } from '../src/index.js'

describe('container continuation', () => {
  it.each([1, 2, 3])('keeps a description quote after %i blanks', (count) => {
    const source = `:: t\n: d\n${'\n'.repeat(count)}    > q\n`
    expect(carveToHtml(source).replace(/>\s+</g, '><')).toContain('<dd><p>d</p><blockquote><p>q</p></blockquote></dd>')
  })

  it('expands a block include in a figure group', () => {
    const source = '::: figure\n{{ data/t.crv }}\n:::\n'
    const result = expandIncludes(parse(source), source, {
      resolve: (path) => path === 'data/t.crv' ? 'x' : null,
    })
    expect(renderHtml(resolve(result.doc))).toContain('<p>x</p>')
  })
})
