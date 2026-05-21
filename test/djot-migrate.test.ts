import { describe, it, expect } from 'vitest'
import { djotMigrationWarnings } from '../src/djot-migrate.js'

const rules = (src: string) =>
  djotMigrationWarnings(src).map((w) => w.rule)

describe('djotMigrationWarnings — silent mis-render detection', () => {
  it('flags Djot emphasis _x_ (renders as underline in Carve)', () => {
    const w = djotMigrationWarnings('use _emphasis_ here')
    expect(w).toHaveLength(1)
    expect(w[0]!.rule).toBe('djot-emphasis-underscore')
    expect(w[0]!.suggestion).toBe('/emphasis/')
    expect(w[0]!.column).toBe(5)
  })

  it('flags Djot subscript ~x~ (renders as strikethrough in Carve)', () => {
    const w = djotMigrationWarnings('H~2~O')
    expect(w).toHaveLength(1)
    expect(w[0]!.rule).toBe('djot-subscript-tilde')
    expect(w[0]!.suggestion).toBe(',,2,,')
  })

  it('flags Markdown **strong** and does not double-report as *x*', () => {
    expect(rules('**bold**')).toEqual(['markdown-strong-double-star'])
  })

  it('flags Markdown ~~strike~~ and does not double-report as ~x~', () => {
    expect(rules('~~gone~~')).toEqual(['markdown-strikethrough-double-tilde'])
  })

  it('flags Djot highlight {=x=}', () => {
    const w = djotMigrationWarnings('a {=note=} b')
    expect(w[0]!.rule).toBe('djot-highlight-braces')
    expect(w[0]!.suggestion).toBe('==note==')
  })

  it('does not flag full reference-style links (resolve identically)', () => {
    // Carve resolves `[text][ref]` against a `[ref]: url` def exactly like
    // djot (corpus 34-reference-link), so there is no mis-render to warn on.
    expect(rules('see [the docs][ref] now')).toEqual([])
  })

  it('does not warn on Carve-native syntax', () => {
    expect(
      djotMigrationWarnings(
        '/italic/ *bold* _underline_is fine when not paired_? ,,sub,, ==hl== ^sup^',
      ).filter((w) => w.rule !== 'djot-emphasis-underscore'),
    ).toEqual([])
    // Genuinely Carve-only line: no warnings at all.
    expect(djotMigrationWarnings('/italic/ and *bold* and ,,x,, and ==y==')).toEqual([])
  })

  it('does not warn inside inline code spans', () => {
    expect(djotMigrationWarnings('`_not emphasis_` and `H~2~O`')).toEqual([])
  })

  it('does not warn inside fenced code blocks', () => {
    const src = ['```', '_x_ and ~y~ and **z**', '```'].join('\n')
    expect(djotMigrationWarnings(src)).toEqual([])
  })

  it('resumes warning after a closed fence', () => {
    const src = ['```', '_x_', '```', '', '_y_'].join('\n')
    const w = djotMigrationWarnings(src)
    expect(w).toHaveLength(1)
    expect(w[0]!.line).toBe(5)
  })

  it('does not treat snake_case as Djot emphasis', () => {
    expect(djotMigrationWarnings('a snake_case_name value')).toEqual([])
  })

  it('reports multiple warnings sorted by position', () => {
    const w = djotMigrationWarnings('_a_ then ~b~')
    expect(w.map((x) => x.rule)).toEqual([
      'djot-emphasis-underscore',
      'djot-subscript-tilde',
    ])
    expect(w[0]!.column).toBeLessThan(w[1]!.column)
  })

  it('does not flag either reference form (collapsed or full)', () => {
    expect(djotMigrationWarnings('see [the docs][] now')).toEqual([])
    expect(djotMigrationWarnings('see [the docs][ref] now')).toEqual([])
  })

  it('does not flag backslash-escaped delimiters (literal in both)', () => {
    expect(djotMigrationWarnings('a \\_literal_ and \\**stars** and \\~t~')).toEqual([])
  })

  it('masks a real fence with a single info token', () => {
    const src = ['```ts', '_x_ and ~y~', '```'].join('\n')
    expect(djotMigrationWarnings(src)).toEqual([])
  })

  it('does NOT mask a non-fence header (multiword info string)', () => {
    // ```ts title=demo is not a Carve fence (RE_FENCE), so Carve parses
    // the body as prose and the delimiters there must be flagged.
    const src = ['```ts title=demo', '_x_ here', '```'].join('\n')
    const rs = rules(src)
    expect(rs).toContain('djot-emphasis-underscore')
  })

  it('still flags a live span after an escaped backslash (\\\\_x_)', () => {
    // two backslashes = escaped backslash, the _x_ is live
    const w = djotMigrationWarnings('a \\\\_x_ b')
    expect(w.map((x) => x.rule)).toEqual(['djot-emphasis-underscore'])
  })

  it('does not flag a delimiter that closes inside a code span', () => {
    // `_x ` opens outside code but the closing `_` is inside a backtick
    // span — Carve would not parse emphasis through opaque code.
    expect(djotMigrationWarnings('_x `foo_`')).toEqual([])
  })

  it('does not flag delimiters inside a multi-line inline code span', () => {
    expect(djotMigrationWarnings('`foo\n_bar_\nbaz`')).toEqual([])
  })

  it('an unmatched backtick does not mask the rest of the document', () => {
    const w = djotMigrationWarnings('3` long, then _real_ emphasis')
    expect(w.map((x) => x.rule)).toEqual(['djot-emphasis-underscore'])
  })

  it('catches a delimiter pair that crosses a soft line break', () => {
    const w = djotMigrationWarnings('this is _very\nimportant_ text')
    expect(w.map((x) => x.rule)).toEqual(['djot-emphasis-underscore'])
    expect(w[0]!.line).toBe(1)
  })

  it('does not let a pair cross a blank line (paragraph boundary)', () => {
    expect(djotMigrationWarnings('a _open\n\nclose_ b')).toEqual([])
  })

  it('reports correct line/column for a later-line match', () => {
    const w = djotMigrationWarnings('para one\n\nthen ~2~ here')
    expect(w).toHaveLength(1)
    expect(w[0]!.line).toBe(3)
    expect(w[0]!.column).toBe(6)
  })

  it('keeps both warnings for nested distinct families', () => {
    expect(rules('~~_x_~~')).toEqual([
      'markdown-strikethrough-double-tilde',
      'djot-emphasis-underscore',
    ])
    expect(rules('**_x_**')).toEqual([
      'markdown-strong-double-star',
      'djot-emphasis-underscore',
    ])
  })

  it('still de-dupes same-family re-matches', () => {
    expect(rules('~~x~~')).toEqual(['markdown-strikethrough-double-tilde'])
  })

  it('ignores delimiters inside a link/image destination or title', () => {
    expect(djotMigrationWarnings('[home](https://example.com/~user~)')).toEqual([])
    expect(djotMigrationWarnings('![x](img.png "_alt_")')).toEqual([])
  })

  it('still flags Djot delimiters in the link *text*', () => {
    expect(rules('[_emph_](https://example.com)')).toEqual([
      'djot-emphasis-underscore',
    ])
  })

  it('is line-ending agnostic (CRLF == LF)', () => {
    const lf = djotMigrationWarnings('a _x_\n\nb ~y~')
    const crlf = djotMigrationWarnings('a _x_\r\n\r\nb ~y~')
    expect(crlf).toEqual(lf)
  })

  it('empty / clean input yields no warnings', () => {
    expect(djotMigrationWarnings('')).toEqual([])
    expect(djotMigrationWarnings('plain text, nothing special.')).toEqual([])
  })
})
