import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#5426: after a closed block a marker-line `+` takes, the host resumes at its
// content column, whatever block follows (CARVE-P0-024, ruling A on carve#5407).
const norm = (html: string): string => html.replace(/\s+/g, ' ').replace(/> </g, '><').trim()

it('opens a sub-list in the item after a closed attached fence and a blank', () => {
  expect(carveToHtml('- +\n```\n```\n\n  - x\n').trim()).toBe(`<ul>
  <li>
    <pre><code></code></pre>
    <ul>
      <li>x</li>
    </ul>
  </li>
</ul>`)
})

it('keeps a heading in the footnote after a closed attached fence', () => {
  expect(carveToHtml('[^1]: +\n```\n```\n\n  # h\n\n[^1]\n')).toContain(`<li id="fn1">
      <pre><code></code></pre>
      <h1 id="h">h</h1>
      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>`)
})

it('keeps a quote in the description after a closed attached fence', () => {
  expect(carveToHtml(':: t\n: +\n```\n```\n\n  > q\n').trim()).toBe(`<dl>
  <dt>t</dt>
  <dd>
    <pre><code></code></pre>
    <blockquote><p>q</p></blockquote>
  </dd>
</dl>`)
})

it('reads a line short of the host content column in the parent', () => {
  expect(norm(carveToHtml('- +\n```\n```\n\n- x\n'))).toBe('<ul><li><pre><code></code></pre></li><li><p>x</p></li></ul>')
})

it('keeps a row past the attached table out of that table', () => {
  expect(norm(carveToHtml('- +\n| a |\n  | c |\n'))).toBe(
    '<ul><li><table><tbody><tr><td>a</td></tr></tbody></table><table><tbody><tr><td>c</td></tr></tbody></table></li></ul>')
})

const hosts: Record<string, (body: string) => [string, string, string]> = {
  item: (body) => [`- +\n${body}`, '<ul><li>', '</li></ul>'],
  note: (body) => [`[^1]: +\n${body}\n[^1]\n`, '<li id="fn1">', '<p><a href="#fnref1"'],
  description: (body) => [`:: t\n: +\n${body}`, '<dd>', '</dd>'],
  quoted: (body) => [`> - +\n${body.replace(/\n$/, '').split('\n').map((l) => l ? `> ${l}` : '>').join('\n')}\n`, '<ul><li>', '</li></ul>'],
}
const blocks = ['```\n```', '~~~\n~~~', '::: x\n:::', '# h', '> q', '| a |']
const followers = ['tail', '- y', '# g', '> z', '::: w\n  :::']

describe('the host resumes after every closed attached block', () => {
  for (const [name, host] of Object.entries(hosts)) {
    for (const block of blocks) {
      for (const blank of ['\n', '']) {
        for (const follower of followers) {
          // Without a blank, `  > z` continues the quote, and a line ending the quote's paragraph is carve#5427.
          if (block === '> q' && !blank && follower !== 'tail') continue
          const body = `${block}\n${blank}  ${follower}\n`
          it(`the ${name} keeps ${JSON.stringify(follower)} after ${JSON.stringify(block)}${blank ? ' and a blank' : ''}`, () => {
            const [src, open, close] = host(body)
            const html = norm(carveToHtml(src))
            const inner = html.slice(html.indexOf(open) + open.length, html.lastIndexOf(close))
            const leaf = follower === 'tail' ? 'tail' : follower.startsWith('- ') ? '<li>y</li>'
              : follower.startsWith('#') ? '>g</h1>' : follower.startsWith('>') ? '<p>z</p>' : '<div class="w">'
            expect(inner, `${JSON.stringify(src)} rendered ${html}`).toContain(leaf)
          })
        }
      }
    }
  }
})
