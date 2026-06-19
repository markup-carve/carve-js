import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string, o = {}) => carveToHtml(s, o)

describe('raw block (```=FORMAT djot syntax)', () => {
  it('passes content through verbatim for a matching format', () => {
    expect(h('```=html\n<custom-el>V</custom-el>\n```')).toBe(
      '<custom-el>V</custom-el>',
    )
  })

  it('drops content for a non-matching format', () => {
    expect(h('```=latex\n\\emph{x}\n```')).toBe('')
  })

  it('accepts leading whitespace before the = (``` =html)', () => {
    expect(h('``` =html\n<b>x</b>\n```')).toBe('<b>x</b>')
  })

  it('treats = with a space before the format as NOT raw', () => {
    // ```= html is not a raw block; the line opens an inline code span instead.
    expect(h('```= html\n<b>x</b>\n```')).toBe(
      '<p><code>= html\n&lt;b&gt;x&lt;/b&gt;\n</code></p>',
    )
  })

  it('no longer recognizes the removed ```raw FORMAT keyword form', () => {
    expect(h('```raw html\n<b>x</b>\n```')).toBe(
      '<p><code>raw html\n&lt;b&gt;x&lt;/b&gt;\n</code></p>',
    )
  })
})

describe('code fence language token charset', () => {
  it('accepts a slash so MIME-like tags stay one token (text/html)', () => {
    expect(h('```text/html\nx\n```')).toBe(
      '<pre><code class="language-text/html">x\n</code></pre>',
    )
  })

  it('accepts a leading-slash language token', () => {
    expect(h('```/html\nx\n```')).toBe(
      '<pre><code class="language-/html">x\n</code></pre>',
    )
  })
})
