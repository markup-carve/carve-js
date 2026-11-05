import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// The line after a refused brace run continues its paragraph whatever it opens
// (CARVE-P2-035), also where a `+` attaches the run to a description or footnote;
// a sibling item, description or note still ends the host. Each row is the spec model's output.
describe('a refused run attached by a `+`', () => {
  it.each([
    [':: t\n: d\n+\n{x\n}\n- b\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>d</p>\n    <p>{x\n}\n- b</p>\n  </dd>\n</dl>'],
    [':: t\n: d\n+\n{% x\n%}\n- b\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>d</p>\n    <p>{% x\n%}\n- b</p>\n  </dd>\n</dl>'],
    ['- a\n+\n{x\n}\n- b\n', '<ul>\n  <li>a\n    {x\n}\n  </li>\n  <li>b</li>\n</ul>'],
  ])('reads %j as the spec model', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it('keeps the follower in a footnote', () => {
    expect(carveToHtml('[^n]: x\n+\n{x\n}\n- b\n')).not.toContain('<li>')
  })

  it('lets a sibling description end the host', () => {
    expect(carveToHtml(':: t\n: d\n+\n{x\n}\n: e\n')).toContain('<dd>e</dd>')
  })
})
