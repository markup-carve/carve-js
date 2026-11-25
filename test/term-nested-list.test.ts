import { describe, expect, it } from 'vitest'
import { format, render } from '../src/index.ts'
import { lint } from '../lint/lint.ts'
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

describe('carve#6758: a list marker past the term mark ends the term as it ends a heading (C2-B-234, C2-B-015)', () => {
  it('opens a nested list in the item for a bullet, bare dot or value-1 marker', () => {
    expect(render('- :: t\n     - x\n')).toBe('<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n    </dl>\n    <ul>\n      <li>x</li>\n    </ul>\n  </li>\n</ul>')
    expect(shape('1. :: t\n      . x')).toBe(shape('1. = t\n      . x').replace('h1"t"', 'dl[dt"t"]'))
    expect(shape('a[^1]\n\n[^1]: :: t\n        1) x')).toContain('dt"t"] ol(1))[li[p"x"]]')
  })

  it('keeps term text for another value, a blank-free top level, and a div in the item', () => {
    expect(shape('- :: t\n     2. x')).toBe('ul(-)[li[dl[dt"t|2. x"]]]')
    expect(shape(':: t\n   - x')).toBe('dl[dt"t|- x"]')
    expect(render('- ::::\n  :: t\n   - y\n')).toContain('<dt>t\n- y</dt>')
  })

  it('stops linting the marker and writes an escaped marker back as term text', () => {
    expect(lint('- :: t\n     - x\n').map((d) => d.code)).not.toContain('list-marker-without-blank-line')
    expect(format('- :: t\n     \\- x\n')).toBe('- :: t\n     \\- x\n')
  })
})
