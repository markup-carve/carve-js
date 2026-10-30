import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

for (const [name, host, column] of [
  ['unordered host', ['- a', '  [^b]: inner'], 4],
  ['ordered host', ['1. a', '   [^b]: inner'], 5],
  ['nested host', ['- a', '  - b', '    [^b]: inner'], 6],
  ['marker-line note', ['- [^b]: inner'], 4],
] as const) {
  for (const marker of ['- c2', '1. c2', '- [ ] c2']) {
    for (const quoted of [false, true]) {
      for (const code of name === 'marker-line note' ? [false] : [false, true]) {
        it(`${name}, ${marker}, quoted ${quoted}, code ${code}`, () => {
          const body = [...host, ' '.repeat(column) + marker]
          if (code) body.push(...['```', 'x', '```'].map(line => ' '.repeat(column) + line))
          const source = [...body.map(line => quoted ? '> ' + line : line), 'below', '', '[^b]'].join('\n')
          const html = carveToHtml(source)
          const [document, note] = html.split('<section role="doc-endnotes"')
          // A note takes the lazy line while its paragraph is open (carve#3885).
          if (code) expect(document).toContain('<p>below</p>')
          else expect(note).toContain('\nbelow')
          expect(document).not.toContain('c2')
          expect(document).not.toContain('<pre>')
          expect(note).toContain('<p>inner\n' + marker)
          expect(note).not.toContain('<ul>')
          if (code) expect(note).toContain('<pre><code>x\n</code></pre>')
        })
      }
    }
  }
}

it('keeps a below-column marker in an open note paragraph', () => {
  const source = ['- a', '  [^b]: inner', '   - c2', 'below', '', '[^b]'].join('\n')
  const [document, note] = carveToHtml(source).split('<section role="doc-endnotes"')
  expect(document).toContain('<li>a</li>')
  expect(note).toContain('<p>inner\n- c2\nbelow<a ')
})
