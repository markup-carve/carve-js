import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const compact = (html: string) => html.replace(/>\s+</g, '><').replace(/\n +</g, '\n<')

for (const lead of [['- :: term'], ['- intro', '  :: term']]) {
  for (const blank of [false, true]) {
    for (const column of [4, 6, 8]) {
      it(`keeps a block at column ${column} in a ${lead.length === 1 ? 'term' : 'text'}-led description with blank=${blank}`, () => {
        const pad = ' '.repeat(column)
        const source = [
          ...lead,
          '  : desc',
          ...(blank ? [''] : []),
          `${pad}\`\`\``,
          `${pad}code`,
          `${pad}\`\`\``,
          ...(lead.length === 1 ? ['after'] : []),
        ].join('\n')
        const intro = lead.length === 1 ? '' : 'intro\n'
        const after = lead.length === 1 ? '<p>after</p>' : ''
        expect(compact(carveToHtml(source))).toBe(
          `<ul><li>${intro}<dl><dt>term</dt><dd><p>desc</p><pre><code>code\n</code></pre></dd></dl></li></ul>${after}`,
        )
      })
    }
  }
}
