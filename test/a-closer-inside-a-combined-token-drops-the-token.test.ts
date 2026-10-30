import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 9 §9 THE COMBINED TOKEN: a closer that would remove the entry from below
// drops the entry, and the region is read again with `/` and `*` as two bare
// candidates. Expected HTML is the spec model's.
const html = (src: string) => carveToHtml(src).trimEnd()

describe('a closer inside a combined token drops the token', () => {
  it.each([
    ['_`/`/*_*/', '<p><u><code>/</code>/*</u>*/</p>'],
    ['~/*a* b~ c*/', '<p><s>/<strong>a</strong> b</s> c*/</p>'],
    ['_*`/`/*{c}_*/', '<p><u><strong c=""><code>/</code>/</strong></u>*/</p>'],
    ['=a /*b= c*/', '<p><mark>a /*b</mark> c*/</p>'],
    ['*/*}{={.}q}/*{t="*/"}', '<p><strong>/</strong>}{<mark>{.}q}/*{t</mark>”*/“}</p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))

  it('keeps a bounded walk from failing a later unbounded one', () => {
    expect(html('_x/*a{.q}/*}/{c}b*/')).toBe('<p>_x/<strong>a{.q}/</strong>}<em>{c}b*</em></p>')
  })
})
