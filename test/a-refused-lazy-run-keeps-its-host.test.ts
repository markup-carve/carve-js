import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A refused run claims no lines, so the host its lazy opener continues stays open (carve#5830 rule A).
describe('a refused run on a lazy line keeps its host', () => {
  it('ends a quoted item at an unprefixed list marker (carve-js#4903)', () => {
    const after = '<blockquote>\n  <ul>\n    <li>b\n{% x\n%}</li>\n  </ul>\n</blockquote>\n<ul>\n  <li>s</li>\n</ul>'
    expect(carveToHtml('> - b\n>  {% x\n%}\n- s\n')).toBe(after)
    expect(carveToHtml('> - b\n>  {.x\n.y}\n- s\n')).toBe(after.replace('{% x\n%}', '{.x\n.y}'))
    expect(carveToHtml('> - b\n>  {% x\ny\n- s\n')).toBe(after.replace('%}', 'y'))
  })

  it('folds a later lazy line into the nested item (carve-js#4893)', () => {
    const nested = (text: string): string =>
      `<ul>\n  <li>a\n    <ul>\n      <li>b\n${text}</li>\n    </ul>\n  </li>\n</ul>`
    expect(carveToHtml('- a\n  - b\n  {.x\n .y}\ntail\n')).toBe(nested('{.x\n.y}\ntail'))
    expect(carveToHtml('- a\n  - b\n  {.x\n .y}\n: d\n')).toBe(nested('{.x\n.y}\n: d'))
  })

  it('still ends the quote after a valid run on a lazy line', () => {
    expect(carveToHtml('> - a\n>   - b\n>   {.x\n>    .y}\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a\n      <ul>\n        <li>b</li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>\n<p>tail</p>',
    )
  })

  it('measures a quoted item run behind glued attributes where it is written (carve#5826)', () => {
    const refused = '<blockquote>\n  <ul>\n    <li class="a">{.x\n.y}\nplain</li>\n  </ul>\n</blockquote>'
    expect(carveToHtml('> -{.a} {.x\n>    .y}\nplain\n')).toBe(refused)
    expect(carveToHtml('> -{.a} {.x\n>       .y}\nplain\n')).toBe(refused)
    expect(carveToHtml('> -{.a} {.x\n>        .y}\nplain\n')).toBe(
      '<blockquote>\n  <ul>\n    <li class="a"></li>\n  </ul>\n</blockquote>\n<p>plain</p>',
    )
  })
})
