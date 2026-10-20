import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve } from '../src/index.js'

describe('a Markdown import uses writer spelling for simple blocks', () => {
  const cases: Array<[string, string, string]> = [
    ['keeps the final newline of a blank document', '\n', '\n'],
    ['drops spaces from a blank document', '  \n', '\n'],
    ['separates adjacent headings', '# one\n## two\n', '# one\n\n## two\n'],
    ['uses a short code span fence', '``` aa ```\n', '`aa`\n'],
    ['uses double quotes around a title', '[x](/u \'title\')\n', '[x](/u "title")\n'],
    ['removes paragraph continuation slack', 'one\n    two\n', 'one\ntwo\n'],
    ['removes decorative edge lines', '\n\none\n\n', 'one\n'],
    ['uses one list marker space', '1.  one\n    two\n', '1. one\n   two\n'],
  ]

  it.each(cases)('%s', (_name, markdown, expected) => {
    const imported = markdownToCarve(markdown)
    expect(imported).toBe(expected)
    expect(carveToCarve(imported)).toBe(imported)
  })

  const contained: Array<[string, string]> = [
    ['ordered marker padding inside a bullet', '- 1.  foo\n  \n      - bar\n'],
    ['quote paragraph slack inside a quote', '> >     code\n> \n> >    not code\n'],
    ['leading empty quote line inside a list', '- >\n  > foo\n  >  \n'],
    ['blank line at a nested list edge', '> - \n>   ====\n'],
    ['code indented inside a quote and list', '> - \n>       \n>       foo\n>       \n>   \n'],
    ['quoted definition at a list edge', '- [foo]\n  \n  > [foo]: /url\n'],
  ]

  it.each(contained)('%s preserves HTML while container spelling remains open', (_name, markdown) => {
    const imported = markdownToCarve(markdown)
    expect(carveToHtml(imported)).toBe(carveToHtml(carveToCarve(imported)))
  })

  it('keeps a definition below an empty item out of visible item text', () => {
    const imported = markdownToCarve('-\n  [r]: /u\n\n[r]\n')
    expect(carveToHtml(imported)).toBe('<ul>\n  <li></li>\n</ul>\n<p>[r]</p>')
  })
})
