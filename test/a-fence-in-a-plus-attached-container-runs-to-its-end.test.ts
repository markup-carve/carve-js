import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const backlink = '<p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>'
const note = (inner: string) => `<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n${inner}\n      ${backlink}\n    </li>\n  </ol>\n</section>`
const ref = '<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>'

describe('a fence nested in a block a marker-line plus attached (carve#5539, carve#5487)', () => {
  it('keeps the blank before the next root line as payload and opens no second fence', () => {
    expect(carveToHtml('[^a]: +\n- li\n  ``` x\n  code\n\nsee[^a]\n')).toBe(`<p>see${ref}</p>\n` + note(
      '      <ul>\n        <li>li\n          <pre><code class="language-x">code\n\n</code></pre>\n        </li>\n      </ul>'))
  })

  it('runs an unclosed empty fence to the end of its item', () => {
    expect(carveToHtml('[^1]\n[^1]: +\n* h\n  ```\n')).toBe(`<p>${ref}</p>\n` + note(
      '      <ul>\n        <li>h\n          <pre><code></code></pre>\n        </li>\n      </ul>'))
  })

  it('reads an item-hosted note and a description the same way', () => {
    expect(carveToHtml('- [^a]: +\n  - li\n    ``` x\n    [^z]: code\n\nsee[^a]\n'))
      .toContain('<pre><code class="language-x">[^z]: code\n\n</code></pre>\n        </li>\n      </ul>\n      <p><a href')
    expect(carveToHtml(':: t\n: +\n- li\n  ``` x\n  code\n\nsee\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>li\n        <pre><code class="language-x">code\n\n</code></pre>\n      </li>\n    </ul>\n  </dd>\n</dl>\n<p>see</p>')
  })

  it('ends the item fence at an unindented root line instead of taking it as lazy text', () => {
    expect(carveToHtml('[^a]: +\n- li\n  ```\n  code\nsee[^a]\n')).toBe(`<p>see${ref}</p>\n` + note(
      '      <ul>\n        <li>li\n          <pre><code>code\n</code></pre>\n        </li>\n      </ul>'))
  })

  it('holds for 1,200 hosts, containers, fences, payloads and tails', () => {
    const hosts = [
      (b: string) => `[^a]: +\n${b}`,
      (b: string) => `[^a]: p\n+\n${b}`,
      (b: string) => `:: t\n: +\n${b}`,
    ]
    const items = [
      (f: string, p: string[]) => `- li\n  ${f}\n${p.map(x => '  ' + x).join('\n')}`,
      (f: string, p: string[]) => `1. li\n   ${f}\n${p.map(x => '   ' + x).join('\n')}`,
      (f: string, p: string[]) => `- a\n- li\n  ${f}\n${p.map(x => '  ' + x).join('\n')}`,
      (f: string, p: string[]) => `- a\n  - li\n    ${f}\n${p.map(x => '    ' + x).join('\n')}`,
    ]
    const fences = ['```', '``` x', '~~~', '````', '~~~ js']
    const payloads = [[], ['code'], ['code', 'more'], ['%% z'], ['+']]
    const tails = ['\n', '\n\nsee[^a]\n', '\nsee[^a]\n', '\n\n\nsee[^a]\n']
    let checked = 0
    for (const host of hosts) for (const item of items) for (const fence of fences) for (const payload of payloads) for (const tail of tails) {
      const source = (tail.includes('see') ? '' : 'r[^a]\n\n') + host(item(fence, payload).replace(/\n$/, '')) + tail
      const html = carveToHtml(source)
      expect(html, source).not.toMatch(/<\/ul>\s*<pre><code><\/code><\/pre>/)
      const fenced = /<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/.exec(html)?.[1]
      // Every blank before the root line is payload, as in the same list outside a note.
      const blanks = tail.includes('see') ? '\n'.repeat(/^\n*/.exec(tail)![0].length - 1) : ''
      const body = payload.length === 0 ? '' : payload.join('\n') + '\n'
      if (tail.includes('see')) expect(html, source).toMatch(/<p>see/)
      expect(fenced, source).toBe(body + blanks)
      checked++
    }
    expect(checked).toBe(1200)
  })
})
