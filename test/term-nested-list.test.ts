import { describe, expect, it } from 'vitest'
import { render } from '../src/index.ts'
import { shape } from './support/shape.ts'

describe('C2-B-015: nested list after a definition term', () => {
  it('opens beneath the enclosing item when its first marker is a bullet or one', () => {
    expect(render('10. :: t\n  1. x')).toBe('<ol start="10">\n  <li>\n    <dl>\n      <dt>t</dt>\n    </dl>\n    <ol>\n      <li>x</li>\n    </ol>\n  </li>\n</ol>')
    expect(shape('- :: t\n * x')).toBe('ul(-)[li[dl[dt"t"] ul(*)[li[p"x"]]]]')
  })

  it('C2-B-234: keeps a marker indented past the term mark as term text, and opens a list for one that is not', () => {
    expect(shape('10. :: t\n      2. x')).toBe('ol(10.)[li[dl[dt"t|2. x"]]]')
    expect(shape('10. :: t\n    1. x')).toBe('ol(10.)[li[dl[dt"t"] ol(1.)[li[p"x"]]]]')
    expect(shape('10. :: t\n  2. x')).toBe('ol(10.)[li[dl[dt"t"] ol(2.)[li[p"x"]]]]')
  })

  it('compares ownership correctly across a quote origin', () => {
    expect(shape('    - >   :: t\n      >  1. x')).toContain('dt"t"] ol(1.)[li[p"x"]]')
  })

  it('closes the description list before checking the depth cap', () => {
    const quotes = '> '.repeat(196)
    expect(shape(`${quotes}- :: t\n${quotes} 1. x`)).toContain('dt"t"] ol(1.)[li[p"x"]]')
  })
})
