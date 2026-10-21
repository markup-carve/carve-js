import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'
import { layoutWork } from '../src/parse.js'

const html = (source: string): string => renderHtml(parse(source))

const cases = [
  ['outer bullet marker', '- :: t\n:  head\n\n     a\n', '<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n    </dl>\n  </li>\n</ul>\n<p>:  head</p>\n<p>a</p>'],
  ['below bullet marker', '- :: t\n :  head\n', '<ul>\n  <li>\n    <dl>\n      <dt>t\n:  head</dt>\n    </dl>\n  </li>\n</ul>'],
  ['bullet content column', '- :: t\n  :  head\n', '<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n      <dd>head</dd>\n    </dl>\n  </li>\n</ul>'],
  ['outer ordered marker', '1. :: t\n:  head\n', '<ol>\n  <li>\n    <dl>\n      <dt>t</dt>\n    </dl>\n  </li>\n</ol>\n<p>:  head</p>'],
  ['outer quoted marker', '> - :: t\n> :  head\n', '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n  <p>:  head</p>\n</blockquote>'],
  ['below quoted marker', '> - :: t\n>  :  head\n', '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n:  head</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>'],
  ['quoted content column', '> - :: t\n>   :  head\n', '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n        <dd>head</dd>\n      </dl>\n    </li>\n  </ul>\n</blockquote>'],
] as const

describe('marker-line term separator columns', () => {
  for (const [name, source, expected] of cases) {
    it(name, () => expect(html(source)).toBe(expected))
  }
  it('keeps an authored term at its own column', () => {
    expect(html(':: t\n:  head\n')).toContain('<dd>head</dd>')
  })
  it('scales with the number of marker-line terms', () => {
    const visits = (count: number): number => {
      layoutWork.reset()
      layoutWork.on = true
      parse('- :: t\n:  head\n\n     a\n'.repeat(count))
      return layoutWork.gate + layoutWork.strip + layoutWork.seam + layoutWork.offsets +
        layoutWork.closerLines + layoutWork.colonLines
    }
    const small = visits(128)
    const large = visits(256)
    layoutWork.on = false
    layoutWork.reset()
    expect(large).toBeLessThanOrEqual(2 * small + 32)
  })
})
