import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToHtmlWithReport } from '../src/index.js'

/**
 * PART 10 §6 (markup-carve/carve#2795): with raw HTML off, an `=html` raw block
 * is written exactly like the fenced code block of its format. It used to be
 * bare escaped text between two blocks, with no element a stylesheet or a
 * print renderer could reach.
 */
const SAFE = { allowRawHtml: false } as const

describe('an escaped raw block is a code block', () => {
  it('writes the ruling example', () => {
    expect(carveToHtml('Before.\n\n```=html\n<p>raw</p>\n```\n\nAfter.\n', SAFE)).toBe(
      '<p>Before.</p>\n<pre><code class="language-html">&lt;p&gt;raw&lt;/p&gt;\n</code></pre>\n<p>After.</p>',
    )
  })

  it('escapes `&`, `<` and keeps a blank line, exactly as the fenced code block does', () => {
    const payload = 'a & b\n\n<c>\n'
    const escaped = carveToHtml('```=html\n' + payload + '```\n', SAFE)
    expect(escaped).toBe('<pre><code class="language-html">a &amp; b\n\n&lt;c&gt;\n</code></pre>')
    expect(escaped).toBe(carveToHtml('```html\n' + payload + '```\n'))
  })

  it('carries block attributes the way the fenced code block does', () => {
    const escaped = carveToHtml('{#r .x}\n```=html\n<i>y</i>\n```\n', SAFE)
    expect(escaped).toBe(carveToHtml('{#r .x}\n```html\n<i>y</i>\n```\n'))
    expect(escaped).toContain('<pre id="r" class="x">')
  })

  it('writes an empty payload as an empty code block', () => {
    expect(carveToHtml('a\n\n```=html\n```\n\nb\n', SAFE)).toBe(
      '<p>a</p>\n<pre><code class="language-html"></code></pre>\n<p>b</p>',
    )
  })

  it('reports no render loss for an escaped block', () => {
    const result = carveToHtmlWithReport('```=html\n<p>raw</p>\n```\n', SAFE)
    expect(result.losses).toEqual([])
  })

  describe('unchanged', () => {
    it('passes the payload through when raw HTML is allowed', () => {
      expect(carveToHtml('Before.\n\n```=html\n<p>raw</p>\n```\n\nAfter.\n')).toBe(
        '<p>Before.</p>\n<p>raw</p>\n<p>After.</p>',
      )
    })

    it('still drops a =latex block on this target, with its loss row', () => {
      const result = carveToHtmlWithReport('a\n\n```=latex\n\\x & y\n```\n\nb\n', SAFE)
      expect(result.value).toBe('<p>a</p>\n<p>b</p>')
      expect(result.losses.map((loss) => [loss.code, 'format' in loss ? loss.format : undefined])).toEqual([
        ['raw-format-dropped', 'latex'],
      ])
    })

    it('leaves a raw inline escaped in its paragraph', () => {
      expect(carveToHtml('`<b>x</b>`{=html}\n', SAFE)).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>')
    })
  })
})
