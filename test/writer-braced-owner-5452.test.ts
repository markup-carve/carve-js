import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics, parse, treesEqual } from '../src/index.ts'

describe('C2-W-069: emphasis and strong whose delimiter pairs inside a child take the braced form (carve-js#5452)', () => {
  it.each([
    // The emphasis holds its own mark between word characters (C2-I-053); the strong around it stays bare.
    ['*e {/a/b/} f*\n', '*e {/a/b/} f*\n'],
    ['*e {/a <b/c> d/} f*\n', '*e {/a <b/c> d/} f*\n'],
    // The `*` in the emphasis would close the strong, so the strong is braced rather than the `*` escaped.
    ['*/a\\* b/*\n', '{*/a* b/*}\n'],
    ['/*a\\/ b*/\n', '{/*a/ b*/}\n'],
    ['*{/x {/a\\* b/}/}*\n', '{*{/x {/a* b/}/}*}\n'],
    // Two such `*`, one inside a nested braced emphasis (C2-W-093), were a loss before.
    ['{*{/a* b {/a* b/}/}*}\n', '{*{/a* b {/a* b/}/}*}\n'],
    ['e {/c d{*{*{*ba*b/y*}a/*}e**}/}\n', 'e {/c d{*{*{*ba*b/y*}a/*}e**}/}\n'],
  ])('writes %j as %j', (source, expected) => {
    const written = formatWithDiagnostics(source)
    expect(written.diagnostics).toEqual([])
    expect(written.source).toBe(expected)
    expect(treesEqual(parse(written.source), parse(source))).toBe(true)
  })
})
