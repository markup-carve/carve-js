import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'
import { importDocument } from '../import/src/index.ts'

// C2-W-088, C2-W-125 (carve#6656, ruling A): a round that reports a kind escapes it beside a case-five backslash
// placed in the same round, also where that backslash alone would break the reported construct.
describe('C2-W-125: a case-five backslash does not cancel a reported kind (carve#6656)', () => {
  it.each([
    // CC-2079, CommonMark example 526.
    ['[foo[https://example.com/?search=\\](uri)](https://example.com/?search=%5D(uri))',
      '\\[foo[https://example.com/?search=\\](uri)](https://example.com/?search=%5D(uri))\n'],
    // CC-2080, CommonMark example 538: the text `[ref` takes the kind, and case five escapes the `]` behind it.
    ['[foo[https://example.com/?search=\\][ref]](https://example.com/?search=%5D%5Bref%5D)',
      '\\[foo[https://example.com/?search=\\]\\[ref\\]](https://example.com/?search=%5D%5Bref%5D)\n'],
    ['[x [a\\]b](u)', '\\[x [a\\]b](u)\n'],
    ['[m [x [a\\][r]](/u)](v)', '\\[m [x [a\\]\\[r\\]](/u)](v)\n'],
    // A text `^[` that no caret pair keeps bare (case eight) reports its kind too.
    ['^[n [a\\]b](/u)', '^\\[n [a\\]b](/u)\n'],
    [':ext[[a\\]b](/u)', '\\:ext\\[[a\\]b](/u)\n'],
  ])('formats %j as a fixed point with the kind escaped', (source, expected) => {
    expect(format(source)).toBe(expected)
    expect(format(expected)).toBe(expected)
    const tree = parse(source)
    const written = writeWithDiagnostics(tree)
    expect(written.diagnostics).toEqual([])
    expect(written.source).toBe(expected)
    expect(treesEqual(parse(expected), tree)).toBe(true)
  })

  it.each([
    ['[foo<https://example.com/?search=](uri)>\n',
      '\\[foo[https://example.com/?search=\\](uri)](https://example.com/?search=%5D(uri))\n'],
    ['[foo<https://example.com/?search=][ref]>\n\n[ref]: /uri\n',
      '\\[foo[https://example.com/?search=\\]\\[ref\\]](https://example.com/?search=%5D%5Bref%5D)\n'],
  ])('imports the Markdown %j in that form', (markdown, expected) => {
    expect(importDocument(markdown, { from: 'markdown' }).source).toBe(expected)
  })
})
