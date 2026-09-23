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
      ['|= a |= b |', '| 1 | 2 |', '| lazy |', ''].join('\n'),
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
