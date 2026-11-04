import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a nested wrapped attribute closes its container', () => {
  it.each([
    // carve#5080: a closer at or below the `{` column refuses the run, and the next line folds into it.
    [':: t\n: - a\n    {.c\n}\npara\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>a\n{.c\n}\npara</li>\n    </ul>\n  </dd>\n</dl>'],
    [':: t\n: d\n\n  - a\n    {.c\n}\npara\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>d</p>\n    <ul>\n      <li>a\n{.c\n}\npara</li>\n    </ul>\n  </dd>\n</dl>'],
    ['> - a\n>   {.c\n> }\npara\n', '<blockquote>\n  <ul>\n    <li>a\n{.c\n}\npara</li>\n  </ul>\n</blockquote>'],
    ['> - a\n>   {.c\n}\npara\n', '<blockquote>\n  <ul>\n    <li>a\n{.c\n}\npara</li>\n  </ul>\n</blockquote>\n'],
  ])('matches the section 653 result for %j', (source, html) => {
    expect(carveToHtml(source)).toBe(html.trimEnd())
  })
})
