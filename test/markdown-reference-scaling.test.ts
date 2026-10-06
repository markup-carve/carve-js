import { describe, expect, it } from 'vitest'
import { extractReferenceDefinitions } from '../src/markdown-empty-destination.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

const extract = (source: string) => extractReferenceDefinitions(source.split('\n'), value => value, () => false)

describe('Markdown reference extraction', () => {
  it('moves continuation text without changing the caller lines', () => {
    const lines = ['- [a]: /a', '', '  text', '- [b]: /b', '  other']
    const before = [...lines]
    const result = extractReferenceDefinitions(lines, value => value, () => false)
    expect(lines).toEqual(before)
    expect(result.lines).toEqual(['- text', '', '- other'])
    expect(result.definitions).toEqual(['[a]: /a', '[b]: /b'])
  })

  perfIt('definitions after a retained blank prefix scale', () => {
    expectBuiltInputScansLinearly(source => { extract(source) },
      n => '\n'.repeat(n) + Array.from({ length: n }, (_, i) => `[r${i}]: /url`).join('\n'),
      { smallRepeats: 4_000, label: 'retained blank prefix' })
  })

  perfIt('chained definitions cross a blank run once', () => {
    expectBuiltInputScansLinearly(source => { extract(source) },
      n => '- [a]: /a\n' + '\n'.repeat(n) + Array.from({ length: n }, (_, i) => `  [r${i}]: /url`).join('\n'),
      { smallRepeats: 4_000, label: 'chained blank rotations' })
  })

  perfIt('definitions with two blanks scale', () => {
    expectBuiltInputScansLinearly(source => { extract(source) },
      n => Array.from({ length: n }, (_, i) => `[r${i}]: /url\n\n\n`).join(''),
      { smallRepeats: 4_000, label: 'definitions with two blanks' })
  })

  for (const continuation of ['- next', '  text', '\n  text']) {
    perfIt(`list reference definitions with ${JSON.stringify(continuation)} scale`, () => {
      expectBuiltInputScansLinearly(source => { extract(source) },
        n => Array.from({ length: n }, (_, i) => `- [r${i}]: /url\n${continuation}\n`).join(''),
        { smallRepeats: 4_000, label: `list references ${continuation}` })
    })
  }
})

it('keeps distinct blank lines while chained definitions move ahead', () => {
  const result = extractReferenceDefinitions(['- [a]: /a', '', ' ', '\t', '  [b]: /b', '', '   ', '  [c]: /c', '  text'], value => value, () => false)
  expect(result.lines).toEqual(['- text', '', ' ', '\t', '', '   '])
  expect(result.definitions).toEqual(['[a]: /a', '[b]: /b', '[c]: /c'])
})


for (const kind of ['dedented complex definitions', 'reserved reference labels']) {
  perfIt(`${kind} scale`, () => {
    expectBuiltInputScansLinearly(source => { extract(source) }, n => {
      if (kind === 'dedented complex definitions') {
        return Array.from({ length: n }, (_, i) => `[a${i}]: /url\n    [x\\]y${i}]: /url`).join('\n')
      }
      const reserved = Array.from({ length: n }, (_, i) => `[carve-import-reference-${i + 1}]`).join(' ')
      return reserved + '\n\n' + Array.from({ length: n }, (_, i) => `[x\\]y${i}]: /url`).join('\n')
    }, { smallRepeats: 4_000, label: kind })
  })
}

it('keeps cached reference offsets when the next line is dedented', () => {
  const result = extract('[a]: /a\n    [x\\]y]: /x\n[b]: /b\n    [z\\]w]: /z')
  expect(result.definitions).toEqual(['[a]: /a', '[b]: /b'])
  expect([...result.references.inline]).toEqual([['carve-import-reference-1', '/x'], ['carve-import-reference-2', '/z']])
})

it('allocates complex reference labels after reserved labels', () => {
  const result = extract('[carve-import-reference-1] [carve-import-reference-3]\n\n[x\\]y]: /x\n[z\\]w]: /z')
  expect([...result.references.inline.keys()]).toEqual(['carve-import-reference-2', 'carve-import-reference-4'])
})


perfIt('list continuation merges reuse future reference chunks', () => {
  expectBuiltInputScansLinearly(source => { extractReferenceDefinitions(source.split('\n'), value => value,
    line => /^ {0,3}(?:[-*+]|0{0,8}1[.)])[ \t]+\S/.test(line)) },
    n => Array.from({ length: n }, (_, i) => `2. [a${i}]: /a\n[b\\]c${i}]: /b\n[q${i}]: /u "x`).join('\n'),
    { smallRepeats: 4_000, label: 'merged list reference chunks' })
})

perfIt('unclosed nested label heads scan once', () => {
  expectBuiltInputScansLinearly(source => { extract(source) }, n => '['.repeat(n),
    { smallRepeats: 25_000, label: 'nested label head' })
})

it('escapes a malformed nested reference head', () => {
  expect(extract('[a[b]: /url').lines).toEqual(['\\[a[b]: /url'])
  expect(extract('[a\\[b]: /url').lines).toEqual([])
})

for (const shape of ['separator', 'quoted title', 'angle destination']) {
  perfIt(`long whitespace in ${shape} scans once`, () => {
    expectBuiltInputScansLinearly(source => { extract(source) }, n => {
      if (shape === 'separator') return '[a]: /u' + ' '.repeat(n) + '"t"'
      if (shape === 'quoted title') return '[a]: /u "a' + ' '.repeat(n) + 'b"'
      return '[a]: <a' + '\t'.repeat(n) + 'b>'
    }, { smallRepeats: 20_000, label: shape })
  })
}

it('rewrites parenthesized titles while preserving escaped parentheses and quotes', () => {
  expect(extract('[a]: /u (a\\(b\\) "c")').definitions).toEqual(['[a]: /u "a\\(b\\) \\"c\\""'])
  expect(extract('[a]: /u "a   b"').definitions).toEqual(['[a]: /u "a   b"'])
})
