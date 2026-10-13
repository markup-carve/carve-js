import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import rows from './fixtures/mixed-nested-marker-note-fence.json'

it.each(rows)('keeps the tail outside the marker note after $id', ({ source, html }) => {
  expect(carveToHtml(source)).toBe(html)
})

it('keeps a separated child fence in its code block', () => {
  const source = '- [^n]: text\n\n    - inner\n\n    %% c\n    ~~~\n    code\n    ~~~\nafter [^n]\n'
  const html = carveToHtml(source)
  expect(html).toContain('<pre><code>code\n</code></pre>')
  expect(html).toMatch(/<\/ul>\s*<p>after <a id="fnref1"/)
})
