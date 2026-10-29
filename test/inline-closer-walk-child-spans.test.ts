import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).trim()

// PART 9 E2a and section 22: a combined `*/` inside a braced inline is that child's (carve-js#3893).
describe('a combined closer inside a braced inline stays in it', () => {
  it.each([
    ['/*{_a*/_} b*/', '<p><strong><em><u>a*/</u> b</em></strong></p>'],
    ['/*{/a*//} b*/', '<p><strong><em><em>a*/</em> b</em></strong></p>'],
    ['/*{^a*/^} b*/', '<p><strong><em><sup>a*/</sup> b</em></strong></p>'],
    ['/*{=a*/=} b*/', '<p><strong><em><mark>a*/</mark> b</em></strong></p>'],
    ['/*{_a*/_} b', '<p>/*<u>a*/</u> b</p>'],
    ['/*{_a*/x*/_} b*/', '<p><strong><em><u>a*<em>x*</em></u> b</em></strong></p>'],
    ['/*{+a*/+} b*/', '<p><strong><em><ins>a*/</ins> b</em></strong></p>'],
    ['/*{-a*/-} b*/', '<p><strong><em><del>a*/</del> b</em></strong></p>'],
    ['/*{#a*/#} b*/', '<p><strong><em><span class="critic-comment">a*/</span> b</em></strong></p>'],
    ['/*{%a*/%} b*/', '<p><strong><em> b</em></strong></p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))
})

// `edScan` steps over a closed editorial comment body (carve-js#3895).
describe('an editorial comment hides the frame closer inside it', () => {
  it.each([
    ['{-{#a-}b#}-}', '<p><del><span class="critic-comment">a-}b</span></del></p>'],
    ['{+{#a+}b#}+}', '<p><ins><span class="critic-comment">a+}b</span></ins></p>'],
    ['{-{#x-}', '<p><del>{<span class="tag"><strong>#x</strong></span></del></p>'],
    ['{-{#}x-}y#}-}', '<p><del><span class="critic-comment">}x-}y</span></del></p>'],
    ['{-{#a-}b#}{.k}-}', '<p><del><span class="critic-comment">a-}b</span>{.k}</del></p>'],
    ['[{-{#a-}b#}-}](/u)', '<p><a href="/u"><del><span class="critic-comment">a-}b</span></del></a></p>'],
    ['{~x{#a~}b#}~>y~}', '<p><del>x<span class="critic-comment">a~}b</span></del><ins>y</ins></p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))
})

// PART 3: a `_` or `/` that opens a span that closes is not the character before the next opener (carve-js#3894).
describe('an attribute block after a span behind a guarding opener belongs to that span', () => {
  it.each([
    ['/_a_{title="/"} b/', '<p><em><u title="/">a</u> b</em></p>'],
    ['_*a*{title="_"} b_', '<p><u><strong title="_">a</strong> b</u></p>'],
    ['_/a/{title="_"} b_', '<p><u><em title="_">a</em> b</u></p>'],
    ['/_a b_{title="/"} b/', '<p><em><u title="/">a b</u> b</em></p>'],
    ['*/_a_{title="*"} b/ c*', '<p><strong><em><u title="*">a</u> b</em> c</strong></p>'],
    ['*_/a/{title="*"} b_ c*', '<p><strong><u><em title="*">a</em> b</u> c</strong></p>'],
    ['{/_a_{title="/"} b/}', '<p><em><u title="/">a</u> b</em></p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))

  it.each([
    ['/_a_{title="/"} b', '<p><em><u>a</u>{title=“</em>”} b</p>'],
    ['*/_a_{title="*"} b c*', '<p><strong>/_a_{title=“</strong>”} b c*</p>'],
  ])('keeps the guard when the opener before it never closes: %s', (source, expected) => expect(html(source)).toBe(expected))

  it.each([
    ['/_a_{t="/"} /_a_{t="/"}', '<p><em><u>a</u>{t=“</em>”} <em><u>a</u>{t=“</em>”}</p>'],
    ['/_a_{t="/"} /_b_{t="/"} c/', '<p><em><u t="/">a</u> /_b_{t=“</em>”} c/</p>'],
    ['_*a*{t="_"} _*b*{t="_"} c_', '<p><u><strong t="_">a</strong> _*b*{t=“</u>”} c_</p>'],
    // All three engines; the spec model differs (markup-carve/carve#3915).
    ['_/a/{t="q"} _/a/{t="_"}', '<p><u><em t="q">a</em> _/a/{t=“</u>”}</p>'],
  ])('reads a later guarded unit under E3: %s', (source, expected) => expect(html(source)).toBe(expected))
})
