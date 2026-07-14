import { describe, it, expect } from 'vitest'
import {
  djotMigrationWarnings,
  applyMigrationFixes,
} from '../src/djot-migrate.js'

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
    expect(w[0]!.suggestion).toBe('{,2,}')
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
    expect(w[0]!.suggestion).toBe('{=note=}')
  })

  it('does not flag full reference-style links (resolve identically)', () => {
    // Carve resolves `[text][ref]` against a `[ref]: url` def exactly like
    // djot (corpus 34-reference-link), so there is no mis-render to warn on.
    expect(rules('see [the docs][ref] now')).toEqual([])
  })

  it('does not warn on Carve-native syntax', () => {
    expect(
      djotMigrationWarnings(
        '/italic/ *bold* _underline_is fine when not paired_? {,sub,} =hl= {^sup^}',
      ).filter((w) => w.rule !== 'djot-emphasis-underscore'),
    ).toEqual([])
    // Genuinely Carve-only line: no warnings at all.
    expect(djotMigrationWarnings('/italic/ and *bold* and {,x,} and =y=')).toEqual([])
  })

  it('warns on djot superscript ^x^ (literal in Carve) and suggests the braced form', () => {
    const w = djotMigrationWarnings('an area of 10^6^ km')
    expect(w).toHaveLength(1)
    expect(w[0]!.rule).toBe('djot-superscript-caret')
    expect(w[0]!.suggestion).toBe('{^6^}')
  })

  it('does not pair footnote-reference carets into a superscript warning', () => {
    const w = djotMigrationWarnings('a [^x] b [^y]').filter((x) => x.rule === 'djot-superscript-caret')
    expect(w).toEqual([])
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

  it('flags a Djot `+` bullet (not a Carve bullet) and suggests `-`', () => {
    const w = djotMigrationWarnings('+ item one\n+ item two')
    expect(w.map((x) => x.rule)).toEqual(['djot-plus-bullet', 'djot-plus-bullet'])
    expect(w[0]!.suggestion).toBe('-')
    expect(w[0]!.line).toBe(1)
    expect(w[0]!.column).toBe(1)
  })

  it('does not flag a lone `+` (the legit Carve continuation marker)', () => {
    expect(rules('- item\n+\n> note')).toEqual([])
  })

  it('does not flag a `+` bullet inside a fenced code block', () => {
    expect(rules('```\n+ not a bullet\n```')).toEqual([])
  })

  it('exposes the splice span (start/end) of the construct', () => {
    const w = djotMigrationWarnings('use _emphasis_ here')
    expect(w).toHaveLength(1)
    // `_emphasis_` starts at offset 4 and is 10 chars long.
    expect([w[0]!.start, w[0]!.end]).toEqual([4, 14])
  })

  it('suggestion keeps inline code that the scan masks away', () => {
    // The scanner blanks `` `code` `` to spaces, but the suggestion must be
    // built from the original text so the splice does not lose the code.
    const w = djotMigrationWarnings('**a `code` b**')
    expect(w).toHaveLength(1)
    expect(w[0]!.rule).toBe('markdown-strong-double-star')
    expect(w[0]!.suggestion).toBe('*a `code` b*')
  })
})

describe('applyMigrationFixes — autocorrect', () => {
  const fix = (src: string) => applyMigrationFixes(src).output

  it('rewrites a single Djot emphasis to Carve italic', () => {
    const r = applyMigrationFixes('use _emphasis_ here')
    expect(r.output).toBe('use /emphasis/ here')
    expect(r.applied).toHaveLength(1)
    expect(r.skipped).toEqual([])
  })

  it('rewrites multiple non-overlapping constructs in one pass', () => {
    expect(fix('_a_ then ~b~')).toBe('/a/ then {,b,}')
    expect(fix('**bold** and a {=note=}')).toBe('*bold* and a {=note=}')
  })

  it('rewrites `+` bullets to `-` on every line', () => {
    expect(fix('+ item one\n+ item two')).toBe('- item one\n- item two')
  })

  it('does NOT re-correct a fixed `~~strike~~` into a subscript', () => {
    // Single pass, no re-scan: `~~x~~` -> `~x~` (Carve strikethrough) must
    // stay put, never cascade to `{,x,}` (which the subscript rule would
    // suggest if the output were scanned again).
    expect(fix('~~gone~~')).toBe('~gone~')
  })

  it('preserves inline code inside a rewritten construct', () => {
    expect(fix('**a `code` b**')).toBe('*a `code` b*')
  })

  it('composes strictly nested different-family collisions', () => {
    // `**_x_**` is strong over `_x_` AND emphasis over `x`. The delimiter
    // edits sit at distinct offsets, so both fix in one pass.
    const r = applyMigrationFixes('**_x_**')
    expect(r.output).toBe('*/x/*')
    expect(r.applied).toHaveLength(2)
    expect(r.skipped).toEqual([])
  })

  it('composes nested strike + emphasis (~~_x_~~ -> ~/x/~)', () => {
    expect(applyMigrationFixes('~~_x_~~').output).toBe('~/x/~')
  })

  it('skips crossing collisions (neither span contains the other)', () => {
    // `**_x**_`: strong over `_x` [0,6) and emphasis over `x**` [2,7) -
    // they cross. Ambiguous source, so neither is auto-applied.
    const r = applyMigrationFixes('**_x**_')
    expect(r.output).toBe('**_x**_') // untouched
    expect(r.applied).toEqual([])
    expect(r.skipped).toHaveLength(2)
  })

  it('leaves code spans and fences untouched', () => {
    const src = ['`_x_`', '', '```', '_y_ and **z**', '```'].join('\n')
    expect(fix(src)).toBe(src)
  })

  it('normalizes line endings to \\n in the output', () => {
    expect(fix('a _x_\r\nb')).toBe('a /x/\nb')
  })

  it('returns clean input unchanged with nothing applied', () => {
    const r = applyMigrationFixes('/italic/ and *bold*')
    expect(r.output).toBe('/italic/ and *bold*')
    expect(r.applied).toEqual([])
    expect(r.skipped).toEqual([])
  })
})

describe('djot-migrate — overlap/cross detection performance (no O(n^2))', () => {
  // `sameFamilyOverlap` linearly scanned a growing `taken` array, and
  // `applyMigrationFixes` ran a full all-pairs `hits.some(crosses)` loop, both
  // O(n^2). A 96KB input of `**a** ` repeated took ~6s; the sorted single
  // sweep must keep both near-linear.
  it('scans a 16000-construct document quickly', () => {
    const src = '**a** '.repeat(16000) // ~96KB, ~16000 family-* matches
    const t0 = performance.now()
    const w = djotMigrationWarnings(src)
    const ms = performance.now() - t0
    expect(w).toHaveLength(16000)
    expect(ms).toBeLessThan(800)
  })

  it('applies fixes on a 16000-construct document without quadratic blow-up', () => {
    // This budget is a generous DoS ceiling, NOT a micro-benchmark. It still
    // includes applyMigrationFixes' per-edit full-string splice (a separate,
    // pre-existing O(edits x length) cost, sensitive to VM jitter), so the
    // bound is loose: the old all-pairs cross scan pushed this input to seconds
    // (~2.8s), and the near-linear scan guarantee is asserted separately below.
    const src = '**a** '.repeat(16000)
    const t0 = performance.now()
    const r = applyMigrationFixes(src)
    const ms = performance.now() - t0
    expect(r.applied).toHaveLength(16000)
    expect(r.skipped).toEqual([])
    expect(ms).toBeLessThan(2500)
  })

  it('scales near-linearly with the number of constructs (scan)', () => {
    // Measure the scan/overlap detection (the part this fix made near-linear).
    // `applyMigrationFixes` also splices each edit into the output string,
    // which is a separate, pre-existing per-edit string cost - so the scaling
    // guarantee is asserted against djotMigrationWarnings, which scans only.
    const time = (n: number): number => {
      const src = '**a** '.repeat(n)
      const t0 = performance.now()
      djotMigrationWarnings(src)
      return performance.now() - t0
    }
    time(2000) // warm up
    const small = time(4000)
    const large = time(16000) // 4x the constructs
    // Quadratic would be ~16x; linear ~4x. Generous slack for CI noise.
    expect(large).toBeLessThan(small * 9 + 50)
  })

  it('still detects and skips a genuine crossing collision', () => {
    // `**_x**_` is strong over `_x` AND emphasis over `x**` - a crossing
    // overlap that must still be reported as skipped, not auto-fixed.
    const r = applyMigrationFixes('**_x**_')
    expect(r.applied).toEqual([])
    expect(r.skipped).toHaveLength(2)
  })

  it('still composes a strictly nested collision', () => {
    // `**_x_**` is strong wrapping emphasis - nested, not crossing - so both
    // fixes compose into single-star bold around slash emphasis.
    const r = applyMigrationFixes('**_x_**')
    expect(r.output).toBe('*/x/*')
    expect(r.skipped).toEqual([])
  })
})
