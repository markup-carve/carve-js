import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// A `{%` that starts any line, a paragraph continuation line included, follows
// CARVE-P2-035 (markup-carve/carve#5189, corpus 959). Each row is the spec model's output.
describe('a comment run that starts a continuation line', () => {
  it.each([
    ['pre\n{% a\nb %}\n', '<p>pre\n{% a\nb %}</p>'],
    ['- pre\n  {% a\n  b %}\n', '<ul>\n  <li>pre\n{% a\nb %}</li>\n</ul>'],
    ['> pre\n> {% a\n> b %}\n', '<blockquote><p>pre\n{% a\nb %}</p></blockquote>'],
    ['pre\n{% a\nb %}\nafter\n', '<p>pre\n{% a\nb %}\nafter</p>'],
    ['pre\n{% a\n  b %}\n', '<p>pre\n</p>'],
    ['- pre\n  {% a\n    b %}\n', '<ul>\n  <li>pre\n</li>\n</ul>'],
    ['pre {% a\nb %} c\n', '<p>pre  c</p>'],
  ])('renders %j', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it.each([
    ['pre\n{% a\n  b %}\n', 'pre\n{% a\n b %}\n'],
    ['- pre\n  {% a\n    b %}\n', '- pre\n  {% a\n   b %}\n'],
    ['> pre\n> {% a\n>   b %}\n', '> pre\n> {% a\n>  b %}\n'],
    ['{% a\n  b %} tail\n', '{% a\n b %} tail\n'],
    ['pre {% a\nb %} c\n', 'pre {% a\nb %} c\n'],
  ])('writes %j so the run stays a comment', (source, written) => {
    expect(carveToCarve(source)).toBe(written)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
  })
})
