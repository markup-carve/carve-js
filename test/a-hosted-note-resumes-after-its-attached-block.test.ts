import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#5512 ruling (2026-11-08): a note hosted in a list item or description that takes
// a block with a marker-line `+` resumes at its body column after that block, so a block
// there belongs to the note, not to the host item.

it('keeps an unclosed fence and its payload in the note after the attached paragraph', () => {
  expect(carveToHtml('- [^a]: +\n  p\n    ``` x\n    [^z]: code\n\nsee[^a]\n').trim()).toBe(`<ul>
  <li></li>
</ul>
<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>p</p>
      <pre><code class="language-x">[^z]: code

</code></pre>
      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`)
})

it('keeps a heading at the note body column in the note', () => {
  expect(carveToHtml('- see[^n]\n  [^n]: +\n  x\n    # z\n\nsee[^n]\n')).toContain(`<li id="fn1">
      <p>x</p>
      <h1 id="z">z</h1>`)
})

it('returns a block at the item content column to the item', () => {
  expect(carveToHtml('- [^a]: +\n  p\n  # z\n\nsee[^a]\n')).toContain(`<ul>
  <li>
    <h1 id="z">z</h1>
  </li>
</ul>`)
})

const hosts: Record<string, [string, number]> = {
  item: ['- [^a]: +\n', 2],
  'item, note on the next line': ['- see[^a]\n  [^a]: +\n', 2],
  ordered: ['1. [^a]: +\n', 3],
  nested: ['- x\n  - [^a]: +\n', 4],
  description: [':: t\n: [^a]: +\n', 2],
}
const attached = ['p', '# h', '> aq']
const followers: Array<[string, string]> = [
  ['``` x\n{I}[^z]: code', '[^z]: code'],
  ['``` x\n{I}zc\n{I}```', 'zc'],
  ['# z', 'id="z"'],
  ['> zq', 'zq'],
  ['::: d\n{I}zd\n{I}:::', 'zd'],
  ['| zt |', 'zt'],
]
const quote = (s: string): string => s.replace(/\n$/, '').split('\n').map((l) => l ? `> ${l}` : '>').join('\n') + '\n'

describe('a hosted note resumes after its attached block', () => {
  for (const [name, [pre, col]] of Object.entries(hosts)) {
    const at = ' '.repeat(col + 2)
    for (const block of attached) {
      for (const [follower, mark] of followers) {
        for (const blank of ['', '\n']) {
          for (const quoted of [false, true]) {
            const body = `${pre}${' '.repeat(col)}${block}\n${blank}${at}${follower.replaceAll('{I}', at)}\n`
            const src = `${quoted ? quote(body) : body}\nsee[^a]\n`
            it(`${name}, ${JSON.stringify(block)}, ${JSON.stringify(follower)}${blank ? ', blank' : ''}${quoted ? ', quoted' : ''}`, () => {
              const html = carveToHtml(src)
              const note = html.indexOf('<li id="fn1">')
              expect(note).toBeGreaterThan(-1)
              expect(html.lastIndexOf(mark)).toBeGreaterThan(note)
            })
          }
        }
      }
    }
  }
})
