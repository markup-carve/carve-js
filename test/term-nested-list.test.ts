import { describe, expect, it } from 'vitest'
import { render } from '../src/index.ts'
import { shape } from './support/shape.ts'

describe('C2-B-015: nested list after a definition term', () => {
  it('opens beneath the enclosing item when its first marker is a bullet or one', () => {
    expect(render('10. :: t\n  1. x')).toBe('<ol start="10">\n  <li>\n    <dl>\n      <dt>t</dt>\n    </dl>\n    <ol>\n      <li>x</li>\n    </ol>\n  </li>\n</ol>')
    expect(shape('- :: t\n * x')).toBe('ul(-)[li[dl[dt"t"] ul(*)[li[p"x"]]]]')
  })

  it('keeps a marker at the description column or starting at another number as term text', () => {
    expect(shape('10. :: t\n    1. x')).toContain('1. x')
    expect(shape('10. :: t\n  2. x')).toContain('2. x')
  })
})
