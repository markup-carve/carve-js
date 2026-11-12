import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A closer walk builds the pair tables only when it reads them (carve-js#5022).
describe('bare pair tables built on first read', () => {
  it.each([
    ['A [span 1]{.hl #s1} and *strong*{.x} and `code`{.lang} with [link](https://example.com/1){rel=nofollow}.',
      '<p>A <span class="hl" id="s1">span 1</span> and <strong class="x">strong</strong> and <code class="lang">code</code> with <a href="https://example.com/1" rel="nofollow">link</a>.</p>'],
    ['/a *b*{.x} c/', '<p><em>a <strong class="x">b</strong> c</em></p>'],
    ['*a /b/{.x} c*', '<p><strong>a <em class="x">b</em> c</strong></p>'],
    ['*/a*{.x}/', '<p><strong class="x">/a</strong>/</p>'],
    ['{*a /b/{.x} c*}', '<p><strong>a <em class="x">b</em> c</strong></p>'],
    ['*a `c` /b/{.x}*', '<p><strong>a <code>c</code> <em class="x">b</em></strong></p>'],
    ['_a *b_ c*{.x}', '<p><u>a *b</u> c*{.x}</p>'],
  ])('%s', (src, html) => {
    expect(carveToHtml(`${src}\n`)).toBe(html)
  })
})
