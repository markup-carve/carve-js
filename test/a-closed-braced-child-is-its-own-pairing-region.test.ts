import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 9 section 9 R1/R2/R3: a bare opener inside a braced child that has
// closed, or under a span that closed, pairs with nothing after it, so no
// attribute run glued there hides a closer. Expected HTML is the spec model's.
const html = (src: string) => carveToHtml(src).trimEnd()

describe('stacked braced openers before a block holding a closer (carve-js#4047)', () => {
  it.each([
    ['{/b{_{*{c_}/*{t=a*/}', '<p><em>b<u>{*{c</u>/<strong>{t=a</strong></em></p>'],
    ['{_=}{*{c_}~/*{t=a*/}a', '<p><u>=}{*{c</u>~<strong><em>{t=a</em></strong>}a</p>'],
    ['*/*}{={.}q}/*{t="*/"}', '<p><strong>/</strong>}{<mark>{.}q}/*{t</mark>”*/“}</p>'],
    ['{_{/{*_{t="*/"}{t=a*/}', '<p>{_<em>{<strong>_{t=“</strong>/“}{t=a*</em></p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))
})

describe('the shortest shapes of each reading', () => {
  it.each([
    ['{/{_*_}*{t=/}', '<p><em><u>*</u>*{t=</em></p>'],
    ['_{*_}/*{t=*/}', '<p><u>{*</u>}<strong><em>{t=</em></strong>}</p>'],
    ['{_{*_}/*{t=*/}', '<p><u>{*</u><strong><em>{t=</em></strong>}</p>'],
    ['{/{_{*_}/*{t=a*/}', '<p><em><u>{*</u>/<strong>{t=a</strong></em></p>'],
    ['_{/_{t=""}{t=/}', '<p>_<em>_{t=““}{t=</em></p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))
})

describe('an attribute run still attaches where its pair forms', () => {
  it.each([
    ['{/a *b*{t=/} c/}', '<p><em>a <strong t="/">b</strong> c</em></p>'],
    ['{_a *b*{t=_} c_}', '<p><u>a <strong t="_">b</strong> c</u></p>'],
    ['{/{_x_} *a*{.q} b/}', '<p><em><u>x</u> <strong class="q">a</strong> b</em></p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))
})

describe('an escaped closer or one in code ends no child region', () => {
  it.each([
    ['{*`_}`{/`/}`_\\*}/*{t=/}*}*/', '<p><strong><code>_}</code>{<em><code>/}</code>_*}</em>*{t=/}</strong>*/</p>'],
    ['{_*`*}``_}`*/`/}`\\/}/*{t=_}_}', '<p><u><strong><code>*}``_}</code></strong><em><code>/}</code>/}</em>*{t=</u>_}</p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))
})
