import { describe, expect, it } from 'vitest'
import { carveToHtml, decisionTrace } from '../src/index.js'

// CARVE-P9-083: a marker-line note's fence is read at the note's body column, so a run
// indented past it is payload and a later `%%` line stays code (carve#6012).
describe('a fence on a note marker line', () => {
  it.each([
    ['x[^n]\n\n[^n]: ```\n   ```\n   %%\n', '<pre><code> ```\n %%\n</code></pre>'],
    ['x[^n]\n\n[^n]: ~~~\n   ~~~\n   %%\n', '<pre><code> ~~~\n %%\n</code></pre>'],
    ['x[^n]\n\n- [^n]: ```\n     c\n     ```\n     %%\n', '<pre><code> c\n ```\n %%\n</code></pre>'],
  ])('%j', (source, code) => {
    expect(carveToHtml(source)).toContain(code)
  })

  it('records the over-indented run and the comment line as payload', () => {
    const records = decisionTrace('x[^n]\n\n[^n]: ```\n   ```\n   %%\n').filter((record) => record.line >= 4)
    expect(records.map((record) => [record.line, record.form, record.owner])).toEqual([
      [4, 'payload', 'doc/footnote:3/code:3'],
      [5, 'payload', 'doc/footnote:3/code:3'],
    ])
  })

  it('still closes at the body column', () => {
    expect(carveToHtml('x[^n]\n\n[^n]: ```\n  c\n  ```\n  %%\n')).toContain('<pre><code>c\n</code></pre>')
  })
})
