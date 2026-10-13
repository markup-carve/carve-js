import { expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

const normalized = (html: string) => html.replace(/>\s+</g, '><').replace(/\n +</g, '\n<').trim()
const lines = (...source: string[]) => source.join('\n') + '\n'
const FENCE = '```'

// Ruled on markup-carve/carve-php#3174: CARVE-P0-018 and CARVE-P2-028 give both
// items a description body at column 4, and no clause makes the item's lead
// matter. The spec checker releases the block to the item when a term leads.
const leads: Array<[string, string[], string]> = [
  ['a term', ['- :: term', '  : definition'], '<ul><li><dl>'],
  ['text', ['- intro', '  :: term', '  : definition'], '<ul><li>intro\n<dl>'],
]

for (const [name, lead, open] of leads) {
  for (const column of [4, 5, 6, 8]) {
    it(`keeps code at column ${column} after a blank in the description of an item led by ${name}`, () => {
      const pad = ' '.repeat(column)
      const source = lines(...lead, '', `${pad}${FENCE}`, `${pad}code`, `${pad}${FENCE}`, 'after')
      // CARVE-P0-009: the closed code block leaves no paragraph open, so `after` closes the list.
      const html = `${open}<dt>term</dt><dd><p>definition</p><pre><code>code\n</code></pre></dd></dl></li></ul><p>after</p>`
      expect(normalized(renderHtml(parse(source)))).toBe(html)
      expect(normalized(renderHtml(parse(source, { positions: true })))).toBe(html)
    })
  }

  it(`releases code at the item's column after a blank in an item led by ${name}`, () => {
    const source = lines(...lead, '', `  ${FENCE}`, '  code', `  ${FENCE}`, 'after')
    const html = `${open}<dt>term</dt><dd>definition</dd></dl><pre><code>code\n</code></pre></li></ul><p>after</p>`
    expect(normalized(renderHtml(parse(source)))).toBe(html)
  })
}
