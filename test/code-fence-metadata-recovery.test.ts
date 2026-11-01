import { describe, expect, it } from 'vitest'
import { carveToHtml, lintCarve } from '../src/index.js'

describe('code fence metadata recovery', () => {
  it.each(['`', '~'])('keeps a %s fence and its language after invalid metadata', (mark) => {
    const run = mark.repeat(3)
    const source = `${run}js {1,3}\na\n${run}\n\ntext *x*\n`
    expect(carveToHtml(source)).toBe('<pre><code class="language-js">a\n</code></pre>\n<p>text <strong>x</strong></p>')
    expect(lintCarve(source).filter(w => w.rule === 'fence-title-syntax').map(w => w.line)).toEqual([1])
  })

  it('leaves a same-line closer as inline code', () => {
    const source = '```js foo``` is inline\n'
    expect(carveToHtml(source)).toBe('<p><code>js foo</code> is inline</p>')
    expect(lintCarve(source).some(w => w.rule === 'fence-title-syntax')).toBe(false)
  })

  it('recovers inside a quote through the shared fence matcher', () => {
    const source = '> ```js {1,3}\n> a\n> ```\n'
    expect(carveToHtml(source)).toContain('<code class="language-js">a\n</code>')
    expect(lintCarve(source).filter(w => w.rule === 'fence-title-syntax').map(w => w.line)).toEqual([1])
  })
})
