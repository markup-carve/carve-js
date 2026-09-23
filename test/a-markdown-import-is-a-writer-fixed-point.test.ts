import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carveToCarve, carveToHtml, markdownToCarve } from '../src/index.js'

/**
 * The Markdown importer emits the source `carve fmt` emits, like the HTML
 * importer does (`an-imported-source-is-a-writer-fixed-point.test.ts`).
 *
 * Table rows were the gap: the header was rebuilt, but body rows passed through
 * verbatim, so a padded GFM table kept its column padding and failed
 * `carve fmt --check` (markup-carve/carve-js#1918).
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const convertDir = resolve(__dirname, '../spec/tests/corpus-convert')

const markdownInputs = existsSync(convertDir)
  ? readdirSync(convertDir)
      .filter((name) => existsSync(resolve(convertDir, name, 'input.md')))
      .sort()
  : []

describe('a Markdown import is a writer fixed point', () => {
  it('finds the convert corpus', () => {
    expect(markdownInputs.length).toBeGreaterThan(0)
  })

  it.each(markdownInputs)('%s', (name) => {
    const out = markdownToCarve(readFileSync(resolve(convertDir, name, 'input.md'), 'utf8'))
    expect(carveToCarve(out)).toBe(out)
  })
})

describe('a Markdown table imports as canonical rows', () => {
  const cases: Array<[string, string, string]> = [
    [
      'collapses body-row padding',
      ['| Name | Value |', '|------|-------|', '| a    | 1     |', ''].join('\n'),
      ['|= Name |= Value |', '| a | 1 |', ''].join('\n'),
    ],
    [
      'pads unpadded cells and keeps alignment on the header',
      ['| L | R |', '|:--|--:|', '|  x  |y|', ''].join('\n'),
      ['|=< L |=> R |', '| x | y |', ''].join('\n'),
    ],
    [
      'writes an empty cell as one space',
      ['|   | b |', '|---|---|', '|   | 2 |', ''].join('\n'),
      ['|= |= b |', '| | 2 |', ''].join('\n'),
    ],
    [
      'converts inline markup cell by cell',
      ['| a | b |', '|---|---|', '| **x**   | `p\\|q`   |', ''].join('\n'),
      ['|= a |= b |', '| *x* | `p|q` |', ''].join('\n'),
    ],
    [
      'keeps the rows of a table inside a list item at its content column',
      ['- item', '  | a | b |', '  |---|---|', '  | 1   | 2   |', ''].join('\n'),
      ['- item', '  |= a |= b |', '  | 1 | 2 |', ''].join('\n'),
    ],
    [
      'writes a quoted table with a native header',
      ['> | a | b |', '> |:--|--:|', '> | 1   | 2   |', ''].join('\n'),
      ['> |=< a |=> b |', '> | 1 | 2 |', ''].join('\n'),
    ],
    [
      'keeps a plain line under a table as the one-cell row GFM reads',
      ['| a | b |', '|---|---|', '| 1 | 2 |', 'lazy', ''].join('\n'),
      ['|= a |= b |', '| 1 | 2 |', '| lazy | |', ''].join('\n'),
    ],
    [
      'drops body cells past the header width, as GFM does',
      ['| a | b |', '|---|---|', '| 1 | 2 | 3 |', ''].join('\n'),
      ['|= a |= b |', '| 1 | 2 |', ''].join('\n'),
    ],
    [
      'pads a short body row with empty cells, as GFM does',
      ['| a | b | c |', '|---|---|---|', '| 1 |', ''].join('\n'),
      ['|= a |= b |= c |', '| 1 | | |', ''].join('\n'),
    ],
    [
      'fits a quoted table row to the header width',
      ['> | a | b |', '> |---|---|', '> | 1 | 2 | 3 |', '> | x |', ''].join('\n'),
      ['> |= a |= b |', '> | 1 | 2 |', '> | x | |', ''].join('\n'),
    ],
    [
      'keeps a pipeless body row in its table',
      ['A | B', '--|--', '1 | 2', ''].join('\n'),
      ['|= A |= B |', '| 1 | 2 |', ''].join('\n'),
    ],
  ]

  it.each(cases)('%s', (_label, md, expected) => {
    const out = markdownToCarve(md)
    expect(out).toBe(expected)
    expect(carveToCarve(out)).toBe(out)
  })

  it('does not read a literal `<` or `^` cell as a span marker', () => {
    const out = markdownToCarve(['| < | b |', '|---|---|', '| x | ^ |', ''].join('\n'))
    expect(out).toBe(['|= \\< |= b |', '| x | \\^ |', ''].join('\n'))
    const html = carveToHtml(out)
    expect(html).not.toContain('colspan')
    expect(html).not.toContain('rowspan')
  })
})

describe('a Markdown import writes the spelling carve fmt writes (#1921)', () => {
  const md = (...lines: string[]): string => [...lines, ''].join('\n')
  const cases: Array<[string, string, string]> = [
    ['writes a tilde fence with backticks', md('~~~ python', 'y', '~~~'), md('```python', 'y', '```')],
    ['widens the fence past a backtick run in the body', md('~~~', '```', '~~~'), md('````', '```', '````')],
    ['narrows an over-long fence to three', md('````', 'x', '````'), md('```', 'x', '```')],
    ['writes a fence on an item line with backticks', md('- ~~~', '  x', '  ~~~'), md('- ```', '  x', '  ```')],
    ['keeps a quoted tilde fence a fence', md('> ~~~', '> *x*', '> ~~~'), md('> ```', '> *x*', '> ```')],
    [
      'strips a quoted fence opener indent from its body',
      md('>   ~~~', '>   x', '>    y', '>   ~~~'),
      md('> ```', '> x', '>  y', '> ```'),
    ],
    [
      'separates a quoted fence from the paragraphs around it',
      md('> para', '> ~~~', '> x', '> ~~~', '> after'),
      md('> para', '>', '> ```', '> x', '> ```', '>', '> after'),
    ],
    [
      'reads past a shorter backtick run inside a quoted fence',
      md('> ~~~', '> ```', '> ~~~', '> 1. a', '> 1. b'),
      md('> ````', '> ```', '> ````', '>', '> 1. a', '> 2. b'),
    ],
    ['numbers ordered items the way fmt does', md('1. x', '1. y'), md('1. x', '2. y')],
    ['counts on from the start number', md('3. x', '3. y'), md('3. x', '4. y')],
    ['counts past a digit boundary', md('9. a', '9. b', '9. c'), md('9. a', '10. b', '11. c')],
    [
      'numbers a nested list on its own',
      md('1. a', '   1. b', '   1. c', '1. d'),
      md('1. a', '   1. b', '   2. c', '2. d'),
    ],
    ['numbers a loose list across the blank', md('1. a', '', '1. b'), md('1. a', '', '2. b')],
    ['restarts after a paragraph', md('1. a', '', 'para', '', '1. b'), md('1. a', '', 'para', '', '1. b')],
    ['numbers a quoted list', md('> 1. x', '> 1. y'), md('> 1. x', '> 2. y')],
    ['numbers a quoted list past a digit boundary', md('> 9. a', '> 9. b'), md('> 9. a', '> 10. b')],
    ['numbers a loose quoted list across its empty line', md('> 1. a', '>', '> 1. b'), md('> 1. a', '>', '> 2. b')],
    ['keeps a quoted `+` list apart across an empty line', md('> - a', '>', '> + b'), md('> - a', '>', '> * b')],
    ['separates a list whose bullet changes', md('* x', '- y'), md('* x', '', '- y')],
    ['separates a list whose delimiter changes', md('1. x', '2) y'), md('1. x', '', '2) y')],
    ['keeps a `+` list apart from a `-` list above it', md('- x', '+ y'), md('- x', '', '* y')],
    ['keeps a `-` list apart from a `+` list above it', md('+ x', '- y'), md('- x', '', '* y')],
    ['keeps the flipped bullet for the rest of its list', md('- x', '+ y', '+ z'), md('- x', '', '* y', '* z')],
    ['keeps nested lists apart by bullet', md('- a', '  - x', '  + y'), md('- a', '  - x', '  * y')],
    ['separates quoted lists whose bullet changes', md('> * x', '> - y'), md('> * x', '>', '> - y')],
    ['writes a quoted `+` bullet as a bullet', md('> - x', '> + y'), md('> - x', '>', '> * y')],
    ['separates a nested quote from the paragraph above it', md('> a', '> > b'), md('> a', '>', '> > b')],
    ['separates a deeper nested quote', md('> > a', '> > > b'), md('> > a', '> >', '> > > b')],
    [
      'writes a table in a quoted list item with a native header',
      md('> - item', '>   | a | b |', '>   |---|---|', '>   | 1  | 2  |'),
      md('> - item', '>   |= a |= b |', '>   | 1 | 2 |'),
    ],
  ]

  it.each(cases)('%s', (_label, source, expected) => {
    const out = markdownToCarve(source)
    expect(out).toBe(expected)
    expect(carveToCarve(out)).toBe(out)
  })
})

describe('a Markdown import closes, renumbers and re-indents the way carve fmt does (#1929)', () => {
  const md = (...lines: string[]): string => [...lines, ''].join('\n')
  const cases: Array<[string, string, string]> = [
    // An unclosed fence runs to the end of its container, blank lines included.
    ['closes a fence the document never closed', md('~~~', 'x'), md('```', 'x', '```')],
    ['closes it after its trailing blank line', md('~~~ js', 'x', ''), md('```js', 'x', '', '```')],
    ['closes an unclosed fence on an item line', md('- ~~~', '  x', '- b'), md('- ```', '  x', '  ```', '- b')],
    [
      'keeps the blank lines an unclosed item fence ran through',
      md('- ~~~', '  x', '', '- b'),
      md('- ```', '  x', '', '  ```', '', '- b'),
    ],
    ['closes a quoted fence the quote ended', md('> ~~~', '> x'), md('> ```', '> x', '> ```')],
    ['closes a quoted fence before the paragraph after the quote', md('> ~~~', '> x', '', 'para'), md('> ```', '> x', '> ```', '', 'para')],
    [
      'keeps a quoted fence open across an empty quote line',
      md('> ~~~', '> a', '>', '> *y* 1. x', '> ~~~'),
      md('> ```', '> a', '>', '> *y* 1. x', '> ```'),
    ],
    [
      'closes a quoted fence that ran across an empty quote line',
      md('> ~~~', '> a', '>', '> b'),
      md('> ```', '> a', '>', '> b', '> ```'),
    ],

    // A number of another width moves the content column, and the lines under
    // the item move with it.
    ['moves an item paragraph with its wider number', md('9. a', '   x', '9. b', '   y'), md('9. a', '   x', '10. b', '    y')],
    [
      'moves a loose item paragraph with its wider number',
      md('9. a', '', '   x', '', '9. b', '', '   y'),
      md('9. a', '', '   x', '', '10. b', '', '    y'),
    ],
    [
      'moves a nested list with its wider number',
      md('9. a', '9. b', '   - n', '   - m', '9. c'),
      md('9. a', '10. b', '    - n', '    - m', '11. c'),
    ],
    [
      'adds up the moves of nested wider numbers',
      md('9. a', '9. b', '   9. i', '   9. j', '      deep', '9. c'),
      md('9. a', '10. b', '    9. i', '    10. j', '        deep', '11. c'),
    ],
    [
      'moves a quote in the item with its wider number',
      md('9. a', '9. b', '   > q', '   > r', '9. c'),
      md('9. a', '10. b', '    > q', '    > r', '11. c'),
    ],
    [
      'moves a fence in the item and keeps its body verbatim',
      md('9. a', '', '9. b', '', '   ~~~', '     code', '   ~~~', '', '9. c'),
      md('9. a', '', '10. b', '', '    ```', '      code', '    ```', '', '11. c'),
    ],
    ['moves an item fence with its wider number', md('9. a', '9. ~~~', '   x', '   ~~~'), md('9. a', '10. ```', '    x', '    ```')],
    [
      'moves a nested list inside an outer item',
      md('- l', '  9. a', '  9. b', '     x', '  9. c'),
      md('- l', '  9. a', '  10. b', '      x', '  11. c'),
    ],
    ['moves the lines under a narrower number back', md('9. a', '100. b', '     x'), md('9. a', '10. b', '    x')],
    ['moves a quoted item paragraph with its wider number', md('> 9. a', '>    x', '> 9. b', '>    y'), md('> 9. a', '>    x', '> 10. b', '>     y')],
    [
      'moves a quoted item across its empty quote line',
      md('> 9. a', '>', '> 9. b', '>', '>    y'),
      md('> 9. a', '>', '> 10. b', '>', '>     y'),
    ],

    // A loose list is written with a blank line between every two items.
    [
      'separates every item of a list a blank line in an item loosens',
      md('8. a', '9. b', '9. c', '', '   more c'),
      md('8. a', '', '9. b', '', '10. c', '', '    more c'),
    ],
    ['separates every item of a list loose between two items', md('- a', '', '- b', '- c'), md('- a', '', '- b', '', '- c')],
    ['separates the items of a loose quoted list', md('> - a', '> - b', '>', '>   x'), md('> - a', '>', '> - b', '>', '>   x')],
    ['decides looseness per nested list', md('- a', '  - x', '', '  - y', '- b'), md('- a', '  - x', '', '  - y', '- b')],
    [
      'separates the blocks of a loose item and keeps its tight nested list',
      md('- a', '  - x', '  - y', '', '- b', '- c'),
      md('- a', '', '  - x', '  - y', '', '- b', '', '- c'),
    ],

    // A lazy line continues the paragraph of the item above it.
    ['re-indents a lazy line to its item', md('- a', 'lazy'), md('- a', '  lazy')],
    ['keeps a list tight across a lazy line', md('- a', 'lazy', '- b'), md('- a', '  lazy', '- b')],
    ['re-indents a lazy line under an ordered item', md('1. a', 'lazy', '1. b'), md('1. a', '   lazy', '2. b')],
    ['re-indents a lazy line to the nested item it continues', md('- a', '  - b', 'lazy'), md('- a', '  - b', '    lazy')],
    ['re-indents a partly indented lazy line', md('- a', '  - b', '  lazy'), md('- a', '  - b', '    lazy')],
    ['re-indents a lazy line under a task item', md('- [ ] task', 'lazy'), md('- [ ] task', '  lazy')],
    ['converts the inlines of a lazy line', md('- a', 'lazy *em*'), md('- a', '  lazy /em/')],
    ['re-indents a lazy line in a loose item', md('- a', '', '  b', 'lazy', '- c'), md('- a', '', '  b', '  lazy', '', '- c')],
    ['re-indents a lazy line under a wider number', md('9. a', '9. b', 'lazy'), md('9. a', '10. b', '    lazy')],
    ['re-indents a quoted lazy line to its item', md('> 1. a', '> continuation', '> 1. b'), md('> 1. a', '>    continuation', '> 2. b')],
    ['re-indents a quoted lazy line after an item line', md('> 1. a', '>    b', '> c'), md('> 1. a', '>    b', '>    c')],
    ['writes the quote marker on a lazy line', md('> a', 'lazy'), md('> a', '> lazy')],
    ['writes every quote marker on a lazy line', md('> > a', 'lazy'), md('> > a', '> > lazy')],
    ['keeps a quoted ordered marker that cannot interrupt as text', md('> a', '> 2. a', '> a'), md('> a', '> 2. a', '> a')],
    ['opens a list after a quote on an unquoted marker', md('> a', '9. b', 'x'), md('> a', '', '9. b', '   x')],
    ['writes the quote marker and item indent on a lazy line', md('> - a', 'lazy'), md('> - a', '>   lazy')],
    ['continues the list after a lazy line', md('1. a', 'lazy', '2. b'), md('1. a', '   lazy', '2. b')],
    ['separates another list after a lazy line', md('- a', 'lazy', '1. b'), md('- a', '  lazy', '', '1. b')],

    // Quoted fences read the way CommonMark reads them.
    ['keeps a nested quote marker inside a quoted fence as code', md('> ~~~', '> > x', '> ~~~'), md('> ```', '> > x', '> ```')],
    [
      'keeps a fence under a quoted item in the item',
      md('> - a', '>   ~~~', '>   x', '>   ~~~', '> - b'),
      md('> - a', '>   ```', '>   x', '>   ```', '> - b'),
    ],
  ]

  it.each(cases)('%s', (_label, source, expected) => {
    const out = markdownToCarve(source)
    expect(out).toBe(expected)
    expect(carveToCarve(out)).toBe(out)
  })

  it('reads a list tight across a lazy line, as GFM does', () => {
    expect(carveToHtml(markdownToCarve(md('- a', 'lazy', '- b')))).not.toContain('<p>')
  })

  it('does not read a line under a heading item as lazy', () => {
    expect(markdownToCarve(md('- # h', 'lazy'))).toBe(md('- # h', 'lazy'))
  })

  it('keeps a lazy line out of a fence the item line opened', () => {
    expect(markdownToCarve(md('- ~~~', '  x', 'after'))).toBe(md('- ```', '  x', '  ```', 'after'))
  })

  // Not fmt's spelling yet: fmt drops the blank line the importer writes
  // before a block under item text, and puts one between a list and the text
  // after it. That spacing is the part #1925 left open.
  it.each([
    ['closes an unclosed fence under item text', md('- a', '  ~~~', '  x'), md('- a', '', '  ```', '  x', '  ```')],
    // Closed, the item would read tight where GFM and the open fence read it loose.
    [
      'leaves open a fence set apart from its item text with a blank line inside',
      md('- a', '', '  ~~~', '  x', '', '  y'),
      md('- a', '', '  ```', '  x', '', '  y'),
    ],
    ['numbers a list after an item fence from its own marker', md('9. ~~~', '   x', 'more', '', '9. b'), md('9. ```', '   x', '   ```', 'more', '', '9. b')],
    ['keeps a marker left of the lazy line item out of it', md('1. a', 'lazy', '  - n'), md('1. a', '   lazy', '', '  - n')],
    ['keeps a quote the item left out of the item quote', md('- a', '', '  > iq', '> q'), md('- a', '', '  > iq', '', '> q')],
    [
      'writes a quoted fence at the quote column once a block left the item',
      md('> - a', '> # h', '>   ~~~', '>   x', '>   ~~~'),
      md('> - a', '> # h', '>', '> ```', '> x', '> ```'),
    ],
  ])('%s', (_label, source, expected) => {
    expect(markdownToCarve(source)).toBe(expected)
  })
})
