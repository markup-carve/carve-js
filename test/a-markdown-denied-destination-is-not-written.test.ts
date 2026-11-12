import { describe, expect, it } from 'vitest'
import { markdownToCarve, migrateMarkdown } from '../src/index.js'

// carve#6010: Markdown import follows the #2254 importer rule. A destination
// the §25 sink denylist blanks is not written; only the content is.

const written = (markdown: string) => markdownToCarve(markdown).replace(/\n+$/, '')
const dropped = (markdown: string) => migrateMarkdown(markdown).report.diagnostics
  .filter((row) => row.code === 'attribute-dropped')
  .map((row) => [row.severity, row.message])

describe('a Markdown destination with a denied scheme', () => {
  it('imports the reproduction as its content with one warning per destination', () => {
    const markdown = 'Siehe [x](javascript:alert(1)) und ![b](data:image/png;base64,AA).\n'
    expect(markdownToCarve(markdown)).toBe('Siehe x und b.\n')
    expect(dropped(markdown)).toEqual([
      ['warning', 'Dropped a link destination with a denied URL scheme'],
      ['warning', 'Dropped an image source with a denied URL scheme'],
    ])
  })

  it.each([
    ['scheme case', '[x](JaVaScRiPt:x)', 'x'],
    ['a title goes with the destination', '[x](vbscript:x "t")', 'x'],
    ['an entity-encoded scheme', '[x](&#106;avascript:x)', 'x'],
    ['an OS-handler scheme', '[x](ms-msdt:x)', 'x'],
    ['link text keeps its markup', '[*a* `c`](javascript:x)', '/a/ `c`'],
    ['a pointy destination', '[x](<javascript:x>)', 'x'],
    ['an autolink keeps its text', '<javascript:alert(1)>', 'javascript:alert(1)'],
    ['a block image becomes its alt text', '![a b](data:x)', 'a b'],
    ['an empty block image leaves nothing', 'p\n\n![](data:x)', 'p'],
    ['an image inside an allowed link', '[![i](data:x)](https://e)', '[i](https://e)'],
    ['an allowed image inside a denied link', '[![i](https://e/i.png)](javascript:x)', '![i](https://e/i.png)'],
    ['a reference link and its definition', '[x][r] ![i][r]\n\n[r]: javascript:x', 'x i'],
    ['an unused definition', 'p\n\n[r]: data:x', 'p'],
    ['an empty link inside emphasis', 'a *[](javascript:x)* b', 'a  b'],
    ['in a definition term', ':: [x](javascript:x)\n: desc', ':: x\n: desc'],
    ['in a definition description', 'Term\n: [y](javascript:x) d', 'Term\n: y d'],
    ['in a quoted list item', '> - [y](javascript:x)', '> - y'],
    ['in a table cell', '| a |\n|---|\n| [](javascript:x) [ok](https://e) |', '|= a |\n| [ok](https://e) |'],
  ])('%s', (_name, markdown, carve) => {
    expect(written(markdown)).toBe(carve)
  })

  it('reports a reference definition once for every link that used it', () => {
    expect(dropped('[x][r] [y][r]\n\n[r]: javascript:x\n')).toEqual([
      ['warning', 'Dropped a reference definition with a denied URL scheme'],
    ])
  })

  it.each([
    ['https', '[x](https://e)', '[x](https://e)'],
    ['mailto', '[x](mailto:a@b.c)', '[x](mailto:a@b.c)'],
    ['a relative path', '[x](/rel)', '[x](/rel)'],
    ['a scheme that only starts like a denied one', '[x](javascripts:x)', '[x](javascripts:x)'],
    ['a percent-encoded scheme is no scheme', '[x](%6Aavascript:x)', '[x](%6Aavascript:x)'],
    ['an allowed reference', '[x][r]\n\n[r]: https://e', '[x][r]\n\n[r]: https://e'],
  ])('keeps an allowed destination: %s', (_name, markdown, carve) => {
    expect(written(markdown)).toBe(carve)
    expect(dropped(markdown)).toEqual([])
  })
})
