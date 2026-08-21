import { describe, it, expect } from 'vitest'
import {
  djotMigrationWarnings,
  applyMigrationFixes,
  migrateScanSteps,
  migrateCrossSteps,
} from '../src/djot-migrate.js'
import { carveToHtml } from '../src/index.js'

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

  it('routes snake_case to the intraword rule, not the bare one', () => {
    // The BARE rule does not claim it - `djot-emphasis-underscore` is word
    // bounded, and its output `/x/` is literal intraword in Carve anyway. The
    // intraword rule claims it instead and converts to the braced form.
    const w = djotMigrationWarnings('a snake_case_name value')
    expect(w.map((x) => x.rule)).not.toContain('djot-emphasis-underscore')
    expect(w.map((x) => x.rule)).toEqual(['djot-intraword-underscore'])
    expect(applyMigrationFixes('a snake_case_name value').output).toBe(
      'a snake{/case/}name value',
    )
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

  it('flags a Djot heading continuation line and joins it', () => {
    // Djot folds the line under a heading into it; Carve does not, so the
    // heading text and its auto-id both change. Valid Carve either way, hence
    // djot-shift: `carve lint` shows it only under --from-djot.
    const w = djotMigrationWarnings('# Title\nSome text.\n')
    expect(w.map((x) => x.rule)).toEqual(['djot-heading-continuation'])
    expect(w[0]!.category).toBe('djot-shift')
    expect(w[0]!.line).toBe(1)
    expect(applyMigrationFixes('# Title\nSome text.\n').output).toBe(
      '# Title Some text.\n',
    )
  })

  it('strips the marker when joining a same-count `#` continuation', () => {
    // Djot folds `## still A` with its marker stripped, so the fix must too:
    // joining the raw line would leave a literal `##` in the title.
    expect(rules('## A\n## still A\n')).toEqual(['djot-heading-continuation'])
    expect(applyMigrationFixes('## A\n## still A\n').output).toBe('## A still A\n')
  })

  it('joins the WHOLE run of continuation lines, not just the first', () => {
    // Djot keeps folding until a blank line or a block opener. Fixing only the
    // first break would produce a document neither language describes.
    expect(rules('# A\nB\nC\n')).toEqual(['djot-heading-continuation'])
    expect(applyMigrationFixes('# A\nB\nC\n').output).toBe('# A B C\n')
    expect(applyMigrationFixes('# A\n# B\n# C\n').output).toBe('# A B C\n')
    // A blank line ends the run, so a second heading is its own warning.
    expect(rules('# A\nB\n\n# C\nD\n')).toEqual([
      'djot-heading-continuation',
      'djot-heading-continuation',
    ])
    expect(applyMigrationFixes('# A\nB\n\n# C\nD\n').output).toBe('# A B\n\n# C D\n')
    // So does a block opener: the quote is not part of the heading.
    expect(applyMigrationFixes('# A\nB\n> q\n').output).toBe('# A B\n> q\n')
  })

  it('does not flag a heading followed by a blank line or another block', () => {
    // Nothing folds in Djot either, so there is no shift to report.
    for (const src of [
      '# Title\n\nSome text.\n',
      '# Title\n- item\n',
      '# Title\n> quote\n',
      '# Title\n## sub\n',
      '# Title\n```php\nx\n```\n',
      '# Title\n{#id}\n',
      '# T\n^ cap\n',
      '### H\n| a | b |\n',
      '```\n# Title\ntext\n```\n',
    ]) {
      expect(rules(src), src).toEqual([])
    }
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
  it('scans a 16000-construct document and finds every construct', () => {
    // NO TIME BOUND. This used to assert under 800ms, and the reading it was
    // comparing moved from 61ms to 634ms - 79% of the bound - purely on how
    // busy the box was (carve-js#1268). What is left is the part that does not
    // depend on the machine: the scan has to find all 16000 constructs in a
    // ~96KB input. Its COST is guarded by the counted per-construct ratio
    // below, which reads the same on any machine.
    const src = '**a** '.repeat(16000) // ~96KB, ~16000 family-* matches
    expect(djotMigrationWarnings(src)).toHaveLength(16000)
  })

  it('applies fixes on a 16000-construct document, every hit applied', () => {
    // THIS IS THE ASSERTION carve-js#1268 WAS FILED FOR. It read
    // `expect(ms).toBeLessThan(2500)`, and on unchanged `main` the value it
    // compared was 417ms at loadavg 10, 1870ms at ~26, and 2651ms at 36 rising
    // to 50 on 16 cores - a 6.4x spread from ambient load alone, which put the
    // default branch red for a reason no ticket described.
    //
    // The bound could not simply be raised, because most of what it measured
    // was never the regression it guarded. `applyMigrationFixes` splices the
    // whole output string once per edit, so 32000 edits over ~96KB is
    // O(edits x length) - a real quadratic, but a separate one from the
    // all-pairs cross scan this test exists to keep out. A loose bound on that
    // jittery dominant term is what load walked across.
    //
    // So the cost question moved to the counted guards below and this test
    // keeps the machine-independent half: every hit is applied, none skipped.
    const src = '**a** '.repeat(16000)
    const r = applyMigrationFixes(src)
    expect(r.applied).toHaveLength(16000)
    expect(r.skipped).toEqual([])
  })

  it('the cross sweep scales near-linearly with the number of constructs', () => {
    // COUNTED, not timed, exactly as the scan guard below is. The regression is
    // the all-pairs `hits.some(crosses)` loop the active-list sweep replaced:
    // that compares every hit against every earlier one, so comparisons PER HIT
    // grow like n and quadruple across a 4x input. The sweep compares a hit only
    // against the intervals still open at its own start, so its per-hit count
    // stays flat.
    //
    // Measured on this commit: healthy gives 1.00 (0.99975 comparisons per
    // construct at n=4000 against 0.9999 at n=16000). Reinstating the all-pairs
    // scan gives exactly 4.00 - 4000 comparisons per construct against 16000,
    // which IS n, which is what quadratic means. A bound of 2 sits 2x above the
    // healthy reading and 2x below the regression, and neither number depends
    // on the machine.
    const stepsPerConstruct = (n: number): number => {
      migrateCrossSteps.count = 0
      applyMigrationFixes('**a** '.repeat(n))

      return migrateCrossSteps.count / n
    }

    const small = stepsPerConstruct(4000)
    const large = stepsPerConstruct(16000) // 4x the constructs

    expect(small).toBeGreaterThan(0)
    expect(large / small).toBeLessThan(2)
  })

  it('the cross-sweep counter tracks the sweep, not a constant', () => {
    // Same hole the scan counter's companion test closes, for the same reason:
    // a counter pinned to a fixed number is deterministic AND its per-construct
    // figure shrinks as the input grows, so it would sail through the ratio
    // bound above while measuring nothing. More constructs, more comparisons.
    const count = (n: number): number => {
      migrateCrossSteps.count = 0
      applyMigrationFixes('**a** '.repeat(n))

      return migrateCrossSteps.count
    }

    expect(count(100)).toBeGreaterThan(0)
    expect(count(1000)).toBeGreaterThan(count(100))
    expect(count(4000)).toBeGreaterThan(count(1000))
  })

  it('the cross-sweep counter is deterministic across runs', () => {
    const count = (): number => {
      migrateCrossSteps.count = 0
      applyMigrationFixes('**a** '.repeat(2000))

      return migrateCrossSteps.count
    }

    expect(count()).toBe(count())
    expect(count()).toBe(count())
  })

  it('scales near-linearly with the number of constructs (scan)', () => {
    // COUNTED, not timed. The previous version of this test measured wall-clock
    // cost per construct at two input sizes and compared the ratio. It flaked on
    // CI at 2.079 against a bound of 2 (carve-js#656) - the two measurements are
    // seconds apart, so a runner busy for part of the run skews one relative to
    // the other, and interleaving and medians cannot fix that.
    //
    // The scan's work is countable, so count it. A healthy scan is O(n log n),
    // making steps PER CONSTRUCT grow like log n; the regression this guards - a
    // linear scan of the growing `taken` array - makes it O(n^2) and the
    // per-construct count grow like n.
    //
    // Measured on this commit: healthy gives 1.20, and reinstating the linear
    // scan gives exactly 4.00. A bound of 2 separates them with room on both
    // sides, and neither number depends on the machine.
    const stepsPerConstruct = (n: number): number => {
      migrateScanSteps.count = 0
      djotMigrationWarnings('**a** '.repeat(n))

      return migrateScanSteps.count / n
    }

    const small = stepsPerConstruct(4000)
    const large = stepsPerConstruct(16000) // 4x the constructs

    expect(small).toBeGreaterThan(0)
    expect(large / small).toBeLessThan(2)
  })

  it('the step counter tracks the scan, not a constant', () => {
    // The hole the two guards around this one leave open. A counter that
    // always reports the same number is deterministic, and its per-construct
    // figure SHRINKS as the input grows - 500/4000 against 500/16000 is a
    // ratio of 0.25, comfortably under the bound. Measured: replacing the two
    // increments with a fixed `count = 500` passes all 60 tests in this file.
    //
    // So the count has to be tied to the work. More constructs, more steps.
    const count = (n: number): number => {
      migrateScanSteps.count = 0
      djotMigrationWarnings('**a** '.repeat(n))

      return migrateScanSteps.count
    }

    expect(count(100)).toBeGreaterThan(0)
    expect(count(1000)).toBeGreaterThan(count(100))
    expect(count(4000)).toBeGreaterThan(count(1000))
  })

  it('the step counter is deterministic across runs', () => {
    // The whole point of the change: the same input must give the same count
    // every time, or the guard is just a slower timing test.
    const count = (): number => {
      migrateScanSteps.count = 0
      djotMigrationWarnings('**a** '.repeat(2000))

      return migrateScanSteps.count
    }

    expect(count()).toBe(count())
    expect(count()).toBe(count())
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

describe('djot-heading-continuation — openers Djot has and Carve does not', () => {
  const contHits = (src: string) =>
    djotMigrationWarnings(src).filter((w) => w.rule === 'djot-heading-continuation')

  it('does not flag a line that opens a block in DJOT but reads as prose in Carve', () => {
    // Verified against @djot/djot, not from memory: each of these ends the Djot
    // heading, so nothing shifted. Flagging one would be worse than silence -
    // the fix joins the lines, pulling a list item or a definition term INTO
    // the title.
    expect(contHits('# H\n(1) item\n')).toEqual([]) // parenthesized ordered marker
    expect(contHits('# H\n(a) item\n')).toEqual([])
    expect(contHits('# H\n(iv) item\n')).toEqual([])
    expect(contHits('# H\n: term\n')).toEqual([]) // Djot definition list
  })

  it('leaves those lines untouched under the autofix', () => {
    expect(applyMigrationFixes('# H\n(1) item\n').output).toBe('# H\n(1) item\n')
    expect(applyMigrationFixes('# H\n: term\n').output).toBe('# H\n: term\n')
  })

  it('still flags the forms Djot really does fold', () => {
    expect(contHits('# Title\nSome text.\n')).toHaveLength(1)
    expect(contHits('## A\n## B\n')).toHaveLength(1)
    expect(applyMigrationFixes('# Title\nSome text.\n').output).toBe('# Title Some text.\n')
  })
})

describe('djot-intraword-underscore — the divergence made visible', () => {
  it('flags an intraword pair that Djot emphasizes and the migration does not', () => {
    const w = djotMigrationWarnings('snake_case_name here')
    expect(w.map((x) => x.rule)).toContain('djot-intraword-underscore')
  })

  it('does not flag a word-bounded pair, which the emphasis rule already owns', () => {
    const w = djotMigrationWarnings('use _emphasis_ here')
    expect(w.map((x) => x.rule)).toContain('djot-emphasis-underscore')
    expect(w.map((x) => x.rule)).not.toContain('djot-intraword-underscore')
  })

  /**
   * It CONVERTS. The input is a Djot document, where an intraword `_` IS
   * emphasis and an author who wanted the literal characters had to escape
   * them - so an unescaped run is emphasis the author saw in their own renderer
   * and kept, and dropping it would lose what the source states.
   */
  it('converts the intraword run to the braced form', () => {
    const result = applyMigrationFixes('snake_case_name here')
    expect(result.output).toBe('snake{/case/}name here')
    expect(result.applied.map((w) => w.rule)).toContain('djot-intraword-underscore')
  })

  /**
   * The other side of the same argument, and the row that makes it safe: an
   * author who meant the literal identifier escaped it in Djot, and the escape
   * survives untouched. Djot renders `snake\_case\_name` as `snake_case_name`
   * and so does the converted output.
   */
  it('leaves an escaped identifier alone', () => {
    const result = applyMigrationFixes('snake\\_case\\_name here')
    expect(result.output).toBe('snake\\_case\\_name here')
    expect(carveToHtml(result.output)).toContain('snake_case_name')
    expect(carveToHtml(result.output)).not.toContain('<em>')
  })

  it('suggests the braced form for an author who did mean emphasis', () => {
    const w = djotMigrationWarnings('snake_case_name')
    const hit = w.find((x) => x.rule === 'djot-intraword-underscore')
    expect(hit?.suggestion).toBe('{/case/}')
  })

  /**
   * The suggestion has to be the spelling that PRESERVES the meaning. Carve's
   * `{_x_}` is an underline, so suggesting it would answer a lost `<em>` with a
   * rendered `<u>` - a rule against silent semantic change causing one. This is
   * the assertion that catches that, so it renders both forms rather than
   * comparing strings.
   */
  it('suggests a spelling that renders as emphasis, not underline', () => {
    const w = djotMigrationWarnings('snake_case_name')
    const hit = w.find((x) => x.rule === 'djot-intraword-underscore')
    const applied = `snake${hit!.suggestion}name`
    expect(carveToHtml(applied)).toContain('<em>case</em>')
    expect(carveToHtml(applied)).not.toContain('<u>')
  })

  it('applies alongside an ordinary fix in the same document', () => {
    const result = applyMigrationFixes('snake_case_name and **bold**')
    expect(result.output).toBe('snake{/case/}name and *bold*')
    expect(result.applied).toHaveLength(2)
  })
})
