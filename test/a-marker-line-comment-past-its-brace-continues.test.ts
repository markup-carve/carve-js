import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// CARVE-P2-035 compares authored source columns after quote prefixes.
const sources = [
  '[^n]: {% a\n       {k=v}\n       z %} y\n\nr[^n]\n',
  '[^n]: {% a\n        {k=v}\n        z %} y\n\nr[^n]\n',
  '[^n]: {% a\n\t\t{k=v}\n\t\tz %} y\n\nr[^n]\n',
  '> [^n]: {% a\n>        {k=v}\n>        z %} y\n\nr[^n]\n',
  '- [^n]: {% a\n         {k=v}\n         z %} y\n\nr[^n]\n',
  ':: t\n: [^n]: {% a\n         {k=v}\n         z %} y\n\nr[^n]\n',
]

it.each(sources)('continues a marker-line comment past its written brace: %s', source => {
  const html = carveToHtml(source)
  expect(html).toContain('<p> y<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>')
  expect(html).not.toContain('{% a')
})
