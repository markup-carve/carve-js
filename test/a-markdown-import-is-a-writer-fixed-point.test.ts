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

  // The lazy line itself is not re-indented, so this is not a fixed point yet;
  // the numbering on the far side of it is what is pinned.
  it('keeps numbering a quoted list across a lazy line', () => {
    expect(markdownToCarve(md('> 1. a', '> continuation', '> 1. b'))).toBe(md('> 1. a', '> continuation', '> 2. b'))
  })

  // fmt closes these, but a closer inside a list item changes how loose the
  // item reads, so the import leaves them open and only respells the opener.
  it.each([
    [md('~~~', 'x'), md('```', 'x')],
    [md('- ~~~', '  x', '- b'), md('- ```', '  x', '- b')],
    [md('> ~~~', '> x'), md('> ```', '> x')],
  ])('respells an unclosed fence %j without closing it', (source, expected) => {
    expect(markdownToCarve(source)).toBe(expected)
  })
})
