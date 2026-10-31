import { expect, it } from 'vitest'
import { carveToHtml, expandIncludes, parse, renderHtml, resolve } from '../src/index.js'
import fixtures from './fixtures/carve-cause-reproductions.json'

// Reproductions from markup-carve/carve cause tickets (id `carve-<ticket>-<n>`),
// expected HTML from the spec model on carve main.
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')

for (const row of fixtures) {
  it(`renders a carve cause reproduction as the spec model: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(normalized(row.html))
  })
}

// carve#4570: the whole file is decoded, so malformed quoting outside the
// selected lines still makes the include a code block (10:241, 10:281).
it('keeps a table include a code block when malformed quoting lies outside its @lines', () => {
  const files: Record<string, string> = { 'm.csv': 'h\nb\n"x\n' }
  const source = '{table}\n{{ m.csv @code:csv @lines:2-2 }}\n'
  const result = expandIncludes(parse(source, { positions: true }), source, {
    resolve: (path: string) => files[path] ?? null,
    sourcePath: 'doc.crv',
  })
  expect(renderHtml(resolve(result.doc))).toBe('<pre table=""><code class="language-csv">b\n</code></pre>')
})
