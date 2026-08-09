import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

describe('generated canonical divergence regressions', () => {
  it('keeps separated brace blocks as lazy paragraph text', () => {
    const source = '::: note {.cls} \\  a) y \n {.cls} {.cls}\n'

    expect(carveToCarve(source)).toBe('::: note {.cls} \\  a) y\n{.cls} {.cls}\n')
  })

  it('still accepts padding after one block-attribute block', () => {
    expect(carveToCarve('{.cls} \n 10\\ kg\n')).toBe('{.cls}\n10\\ kg\n')
  })

  it('a bare image lazily continues an open list-item paragraph', () => {
    const source = 'a) y\n[t][r]\n+-\n{,y,}\n:name:\n![a](/u)\n[t][r]\n'

    expect(carveToCarve(source)).toBe(
      'a) y\n   [t][r]\n   +-\n   {,y,}\n   :name:\n   ![a](/u)\n   [t][r]\n',
    )
    expect(carveToHtml(source)).toContain('<img src="/u" alt="a">\n[t][r]</li>')
  })

  it('escapes only the caret that becomes adjacent after definition hoisting', () => {
    const source = '^ cap\n# head\n{.cls}\n@user\n| a | b |\n[a]: /u\n^ cap\n'

    expect(carveToCarve(source)).toBe(
      '^ cap\n\n# head\n\n{.cls}\n@user\n\n| a | b |\n\n\\^ cap\n\n[a]: /u\n',
    )
  })
})
