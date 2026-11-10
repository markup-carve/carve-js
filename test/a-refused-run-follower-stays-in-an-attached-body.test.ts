import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A refused brace run claims no lines (carve#5830 rule A), also where a `+` attaches
// it to a description or footnote: the next line is read normally. Each row is the spec model's output.
describe('a refused run attached by a `+`', () => {
  it.each([
    [':: t\n: d\n+\n{x\n}\n- b\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>d</p>\n    <p>{x\n}</p>\n  </dd>\n</dl>\n<ul>\n  <li>b</li>\n</ul>'],
    [':: t\n: d\n+\n{% x\n%}\n- b\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>d</p>\n    <p>{% x\n%}</p>\n  </dd>\n</dl>\n<ul>\n  <li>b</li>\n</ul>'],
    ['- a\n+\n{x\n}\n- b\n', '<ul>\n  <li>a\n    {x\n}\n  </li>\n  <li>b</li>\n</ul>'],
  ])('reads %j as the spec model', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it('ends the footnote at a list marker below the run', () => {
    expect(carveToHtml('[^n]: x\n+\n{x\n}\n- b\n')).toBe('<ul>\n  <li>b</li>\n</ul>')
  })

  it('lets a sibling description end the host', () => {
    expect(carveToHtml(':: t\n: d\n+\n{x\n}\n: e\n')).toContain('<dd>e</dd>')
  })
})
