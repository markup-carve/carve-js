import { describe, expect, it } from 'vitest'
import { migrateMarkdown } from '../src/index.js'

// carve#6013: the construct assessment models a dropped destination as its
// content and reports `attribute-dropped` at its source line, so the import
// keeps the ruled report instead of falling back to `fidelity-unverified`.

const rows = (markdown: string) => migrateMarkdown(markdown).report.diagnostics
  .map((row) => [row.code, row.severity, row.fidelity, row.confidence, row.path])

describe('a dropped Markdown destination in the import report', () => {
  it('writes the ruled report for the carve#6010 reproduction', () => {
    expect(rows('Siehe [x](javascript:alert(1)) und ![b](data:image/png;base64,AA).\n')).toEqual([
      ['markdown-paragraph', 'info', 'preserved', 'exact', 'line:1'],
      ['attribute-dropped', 'warning', 'dropped', 'exact', 'line:1'],
      ['attribute-dropped', 'warning', 'dropped', 'exact', 'line:1'],
    ])
  })

  it.each([
    ['a decimal entity', 'a [x](&#106;avascript:x) b\n'],
    ['a hex entity', 'a [x](&#x6A;avascript:x) b\n'],
    ['a named entity', 'a [x](javascript&colon;x) b\n'],
    ['a pointy destination', 'a [x](<javascript:x>) b\n'],
    ['an autolink', 'a <javascript:x> b\n'],
    ['a parenthesized destination with a title', 'a [x](javascript:alert(1) "t") b\n'],
  ])('locates %s', (_name, markdown) => {
    expect(rows(markdown)).toEqual([
      ['markdown-paragraph', 'info', 'preserved', 'exact', 'line:1'],
      ['attribute-dropped', 'warning', 'dropped', 'exact', 'line:1'],
    ])
  })

  it('locates a reference definition at its own line, once for every use', () => {
    expect(rows('[x][r] and [y][r]\n\n[r]: &#106;avascript:x\n')).toEqual([
      ['markdown-paragraph', 'info', 'preserved', 'exact', 'line:1'],
      ['attribute-dropped', 'warning', 'dropped', 'exact', 'line:3'],
    ])
  })

  it('locates a definition whose destination has parentheses', () => {
    expect(rows('[x][r]\n\n[r]: javascript:alert(1)\n')).toEqual([
      ['markdown-paragraph', 'info', 'preserved', 'exact', 'line:1'],
      ['attribute-dropped', 'warning', 'dropped', 'exact', 'line:3'],
    ])
  })

  it('reads an escaped ampersand as Markdown does', () => {
    expect(rows('[x](\\&#106;avascript:x)\n').filter((row) => row[0] === 'attribute-dropped')).toEqual([])
  })
})
