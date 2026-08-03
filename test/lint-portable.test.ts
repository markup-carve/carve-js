import { describe, it, expect } from 'vitest'
import { lintCarve } from '../src/lint.js'

const portableRules = (src: string) =>
  lintCarve(src, { portable: true }).map((w) => w.rule)

describe('lintCarve - portable-quote-marker-space', () => {
  it('flags a blockquote marker with no space after it', () => {
    const w = lintCarve('>quote\n', { portable: true })
    expect(w).toHaveLength(1)
    expect(w[0]!.rule).toBe('portable-quote-marker-space')
    expect(w[0]!.line).toBe(1)
    expect(w[0]!.column).toBe(1)
    expect(w[0]!.message).toContain('djot')
  })

  it('does not flag a spaced marker', () => {
    expect(portableRules('> quote\n')).toEqual([])
  })

  it('does not flag a tab, two spaces, or a bare marker line', () => {
    expect(portableRules('>\tquote\n')).toEqual([])
    expect(portableRules('>  quote\n')).toEqual([])
    expect(portableRules('> a\n>\n> b\n')).toEqual([])
  })

  it('flags only the outer marker of ">> q", whose inner marker is spaced', () => {
    const w = lintCarve('>> q\n', { portable: true })
    expect(w.map((x) => x.rule)).toEqual(['portable-quote-marker-space'])
    expect(w[0]!.column).toBe(1)
  })

  it('flags both levels of ">>q"', () => {
    const w = lintCarve('>>q\n', { portable: true })
    expect(w.map((x) => x.column)).toEqual([1, 2])
  })

  it('accepts the djot-valid nested form', () => {
    expect(portableRules('> > q\n')).toEqual([])
  })

  it('is off by default', () => {
    expect(lintCarve('>quote\n')).toEqual([])
  })

  it('does not fire on a ">" inside a code block', () => {
    expect(portableRules('```\n>quote\n```\n')).toEqual([])
  })

  it('flags an unspaced marker on a continuation line of an open blockquote', () => {
    const w = lintCarve('> ok\n>bad\n', { portable: true })
    expect(w).toHaveLength(1)
    expect(w[0]!.rule).toBe('portable-quote-marker-space')
    expect(w[0]!.line).toBe(2)
    expect(w[0]!.column).toBe(1)
  })

  it('does not flag a spaced marker on a continuation line', () => {
    expect(portableRules('> ok\n> good\n')).toEqual([])
  })

  it('does not flag a lazy continuation line that carries no marker at all', () => {
    expect(portableRules('> ok\nbad\n')).toEqual([])
  })

  it('does not fire on an unspaced ">" inside a code fence nested in a blockquote', () => {
    expect(portableRules('> ```\n>x\n> ```\n')).toEqual([])
  })

  // KNOWN LIMITATION (documented on the rule): each block_quote node is
  // checked at its OWN recorded startColumn, computed from the line it
  // opens on. When an unspaced OUTER marker on a later line shifts where an
  // INNER marker actually sits on that physical line, the inner node's
  // recorded column no longer matches, and its check is silently skipped.
  // The three cases below pin that this converges rather than hides the
  // divergence forever: fixing the reported outer marker and re-linting
  // moves the inner marker back onto its recorded column, so it is then
  // reported too - a divergent document is never reported clean.
  it('flags only the outer marker when an unspaced outer shifts an unspaced inner one', () => {
    const w = lintCarve('> > a\n>>bad\n', { portable: true })
    expect(w.map((x) => [x.line, x.column])).toEqual([[2, 1]])
  })

  it('flags the inner marker once the outer is fixed (convergence)', () => {
    // Same document as above with the outer marker spaced - the inner
    // marker (still unspaced) is no longer hidden by the drift.
    const w = lintCarve('> > a\n> >bad\n', { portable: true })
    expect(w.map((x) => [x.line, x.column])).toEqual([[2, 3]])
  })

  it('does not flag a fully spaced two-level continuation line', () => {
    expect(portableRules('> > a\n> > b\n')).toEqual([])
  })

  it('flags an unspaced inner marker past a tab-separated outer marker', () => {
    const w = lintCarve('>\t>bad\n', { portable: true })
    expect(w.map((x) => [x.line, x.column])).toEqual([[1, 3]])
  })

  it('flags an unspaced marker on a quote nested in a list item content column', () => {
    const w = lintCarve('- >quote\n', { portable: true })
    expect(w.map((x) => [x.line, x.column])).toEqual([[1, 3]])
  })

  it('flags an unspaced marker on a list-nested quote continuation line', () => {
    const w = lintCarve('- > a\n  >bad\n', { portable: true })
    expect(w.map((x) => [x.line, x.column])).toEqual([[2, 3]])
  })

  it('does not flag a spaced list-nested quote continuation line', () => {
    expect(portableRules('- > a\n  > good\n')).toEqual([])
  })
})

describe('lintCarve - portable-blank-line-before-block', () => {
  it('flags a heading directly under a paragraph line', () => {
    const w = lintCarve('text\n# H\n', { portable: true })
    expect(w).toHaveLength(1)
    expect(w[0]!.rule).toBe('portable-blank-line-before-block')
    expect(w[0]!.line).toBe(2)
    expect(w[0]!.message).toContain('blank line')
  })

  it('spans exactly the opening line for a single-line opener', () => {
    const src = 'text\n# H\n'
    const w = lintCarve(src, { portable: true })
    expect(w).toHaveLength(1)
    expect(w[0]!.line).toBe(2)
    expect(w[0]!.column).toBe(1)
    expect(src.slice(w[0]!.start, w[0]!.end)).toBe('# H')
  })

  it('spans only the opening line of a multi-line table, not the whole table', () => {
    const src = 'text\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n'
    const w = lintCarve(src, { portable: true })
    expect(w).toHaveLength(1)
    expect(w[0]!.line).toBe(2)
    expect(w[0]!.column).toBe(1)
    expect(src.slice(w[0]!.start, w[0]!.end)).toBe('| a | b |')
  })

  it('spans only the opening line of a multi-line admonition, not its whole body', () => {
    const src = 'text\n::: note\nbody\n:::\n'
    const w = lintCarve(src, { portable: true })
    expect(w).toHaveLength(1)
    expect(w[0]!.line).toBe(2)
    expect(w[0]!.column).toBe(1)
    expect(src.slice(w[0]!.start, w[0]!.end)).toBe('::: note')
  })

  it('excludes a trailing CR from the span when only the opening line is CRLF', () => {
    // LF before the reported line, CRLF on the reported line only - isolates
    // the `end` computation from the separate, pre-existing whole-document
    // CRLF offset drift in `locate()` (parser codepoint offsets do not
    // account for `\r`), which is out of scope for this rule.
    const src = 'text\n# H\r\n'
    const w = lintCarve(src, { portable: true })
    expect(w).toHaveLength(1)
    expect(w[0]!.line).toBe(2)
    expect(w[0]!.column).toBe(1)
    expect(src.slice(w[0]!.start, w[0]!.end)).toBe('# H')
  })

  it('flags every other interrupting opener', () => {
    expect(portableRules('text\n> q\n')).toEqual(['portable-blank-line-before-block'])
    expect(portableRules('text\n```\nx\n```\n')).toEqual(['portable-blank-line-before-block'])
    expect(portableRules('text\n---\n')).toEqual(['portable-blank-line-before-block'])
    expect(portableRules('text\n::: note\nx\n:::\n')).toEqual(['portable-blank-line-before-block'])
    expect(portableRules('text\n| a |\n|---|\n| 1 |\n')).toEqual(['portable-blank-line-before-block'])
  })

  it('flags a nested list marker directly under its item paragraph', () => {
    const w = lintCarve('- a\n  - b\n', { portable: true })
    expect(w.map((x) => x.rule)).toEqual(['portable-blank-line-before-block'])
    expect(w[0]!.line).toBe(2)
  })

  it('does not flag anything separated by a blank line', () => {
    expect(portableRules('text\n\n# H\n')).toEqual([])
    expect(portableRules('text\n\n> q\n')).toEqual([])
    expect(portableRules('- a\n\n  - b\n')).toEqual([])
  })

  it('does not flag a top-level list, which does not interrupt in either engine', () => {
    expect(portableRules('text\n- a\n')).toEqual([])
  })

  it('does not flag consecutive paragraphs', () => {
    expect(portableRules('a\n\nb\n')).toEqual([])
  })

  it('reaches a paragraph nested inside a blockquote', () => {
    const w = lintCarve('> text\n> # H\n', { portable: true })
    expect(w.map((x) => x.rule)).toEqual(['portable-blank-line-before-block'])
  })

  it('is off by default', () => {
    expect(lintCarve('text\n# H\n')).toEqual([])
  })

  it('reaches a paragraph inside a footnote definition body', () => {
    const w = lintCarve('x[^a]\n\n[^a]: text\n    # H\n', { portable: true })
    expect(w).toHaveLength(1)
    expect(w[0]!.rule).toBe('portable-blank-line-before-block')
    expect(w[0]!.line).toBe(4)
  })

  it('does not flag a footnote definition body separated by a blank line', () => {
    expect(portableRules('x[^a]\n\n[^a]: text\n\n    # H\n')).toEqual([])
  })

  it('does not double-report a footnote definition referenced more than once', () => {
    const w = lintCarve('a[^x] b[^x]\n\n[^x]: text\n    # H\n', { portable: true })
    expect(w.map((x) => x.rule)).toEqual(['portable-blank-line-before-block'])
  })
})
