import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/index.js'

/*
 * `LintWarning.start`/`end` are UTF-16 code units into the SOURCE THE CALLER
 * PASSED. The parser's offsets are codepoints into line-ending-NORMALIZED text,
 * so on a CRLF document every preceding line makes the reported offset
 * undercount by one and a consumer slicing the source highlights the wrong text
 * (carve-js#545).
 *
 * `codepointToUtf16Map` existed for astral characters and returned identity
 * when there were none - which is exactly the CRLF case, so the drift was
 * invisible to it.
 *
 * The line/column pair was always right; only the offsets drifted. That is why
 * the CLI never showed it and an editor integration would.
 */
describe('lint offsets on a CRLF document', () => {
  it('slices the construct the warning is about', () => {
    const src = '# Intro\r\n\r\nSee </' + '#nope>.\r\n'
    const w = lintCarve(src)[0]!

    expect(src.slice(w.start, w.end)).toBe('</' + '#nope>')
  })

  it('agrees with the LF form on what it points at', () => {
    const crlf = '# Intro\r\n\r\nSee </' + '#nope>.\r\n'
    const lf = crlf.replace(/\r\n/g, '\n')

    const a = lintCarve(crlf)[0]!
    const b = lintCarve(lf)[0]!

    expect(crlf.slice(a.start, a.end)).toBe(lf.slice(b.start, b.end))
    expect(a.line).toBe(b.line)
    expect(a.column).toBe(b.column)
  })

  it('drifts further with more preceding CRLF lines', () => {
    // One undercount per preceding line is the shape of the bug, so a document
    // with several must still land exactly.
    const src = '# A\r\n\r\n# B\r\n\r\n# C\r\n\r\nSee </' + '#nope>.\r\n'
    const w = lintCarve(src)[0]!

    expect(src.slice(w.start, w.end)).toBe('</' + '#nope>')
  })

  it('still handles an astral character, with and without CRLF', () => {
    // The map's original purpose must survive: an astral char is two UTF-16
    // units and one codepoint.
    for (const eol of ['\n', '\r\n']) {
      const src = `# 𝔘${eol}${eol}See </` + `#nope>.${eol}`
      const w = lintCarve(src)[0]!

      expect(src.slice(w.start, w.end)).toBe('</' + '#nope>')
    }
  })

  it('is unchanged on a plain LF document', () => {
    const src = '# Intro\n\nSee </' + '#nope>.\n'
    const w = lintCarve(src)[0]!

    expect(src.slice(w.start, w.end)).toBe('</' + '#nope>')
  })
})
