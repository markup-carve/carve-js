import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve } from '../src/index.js'

describe('a Markdown import uses writer spelling for inline and container cases', () => {
  const cases: Array<[string, string, string]> = [
    ['folds an empty list item into its paragraph', '-\n  foo\n', '- foo\n'],
    ['uses the outer emphasis spelling for nested strong', '*foo **bar***\n', '/foo *bar*/\n'],
    ['spells literal backslashes before letters', '\\A\\a\n', '\\\\A\\\\a\n'],
    ['keeps an escaped backslash before a letter', '\\\\A\n', '\\\\A\n'],
    ['spells text before a link', 'foo \\A [x](/u)\n', 'foo \\\\A [x](/u)\n'],
    ['spells text after a link', '[x](/u) \\A\n', '[x](/u) \\\\A\n'],
    ['keeps backslashes in link destinations', 'foo \\A [x](/u\\A)\n', 'foo \\\\A [x](/u\\A)\n'],
    ['spells text before an HTML tag', 'foo \\A <b>hi</b>\n', 'foo \\\\A *hi*\n'],
    ['keeps backslashes in link titles', 'foo \\A [x](/u "title\\A")\n', 'foo \\\\A [x](/u "title\\A")\n'],
    ['keeps backslashes in autolink destinations', 'foo \\A <https://example.com/\\A>\n', 'foo \\\\A [https://example.com/\\A](https://example.com/\\A)\n'],
    ['drops an empty quote line at the opening edge', '>\n> foo\n', '> foo\n'],
    ['places a reference definition after its list', '- a\n\n- b\n\n  [ref]: /url\n\n- d\n', '- a\n\n- b\n\n- d\n\n[ref]: /url\n'],
    ['uses an unquoted simple abbreviation value', '<abbr title="NATO">word</abbr>\n', '[word]{abbr=NATO}\n'],
    ['braces equal emphasis kinds across a link label', '*foo [*bar*](/url)*\n', '{/foo [{/bar/}](/url)/}\n'],
  ]

  it.each(cases)('%s', (_name, markdown, expected) => {
    const imported = markdownToCarve(markdown)
    expect(imported).toBe(expected)
    expect(carveToCarve(imported)).toBe(imported)
  })

  it('keeps the quoted reference definition meaning through formatting', () => {
    const imported = markdownToCarve('> - a\n> - b\n> \n>   [ref]: /url\n> - d\n')
    expect(carveToHtml(imported)).toBe(carveToHtml(carveToCarve(imported)))
  })
})
