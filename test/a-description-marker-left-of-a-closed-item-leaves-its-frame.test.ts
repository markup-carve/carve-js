import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A `: ` line left of a nested item's column is not in that item, so the item's closed frame no longer decides
// whether the next unmarked line is lazy text (spec model at carve main).
describe('a description marker left of a closed item leaves its frame', () => {
  it.each(['%% c', '%%', '[r]: /u'])('folds the line after `: x` in a note body past a %s line', (invisible) => {
    const html = carveToHtml(['[^n]: a', '  - inner', `    ${invisible}`, '  : x', 'tail', '', 'see[^n]'].join('\n'))
    expect(html).toContain('<li>inner\n: x\ntail</li>')
  })

  it('still folds `: x` into the open item paragraph without the invisible line', () => {
    const html = carveToHtml(['[^n]: a', '  - inner', '  : x', 'tail', '', 'see[^n]'].join('\n'))
    expect(html).toContain('<li>inner\n: x\ntail</li>')
  })
})
