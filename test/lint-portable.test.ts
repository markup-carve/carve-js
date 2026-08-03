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
    expect(w[0]!.message).toContain('Djot')
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

  // A lazy continuation line carries no marker of its own at all, at ANY
  // enclosing level - it is ordinary paragraph text. A `>` that happens to
  // land at a nested quote's recorded column there (e.g. ">90%", meaning
  // "greater than 90 percent") is coincidence, not syntax: flagging it is a
  // false positive, and taking the advice would corrupt a document the two
  // engines already agree on (Carve gains a real space before "90%"; Djot
  // reads the now-spaced ">" as a real, oddly placed, blockquote marker and
  // drops it, so the two outputs diverge where they used to match). Fixing
  // this requires every ENCLOSING quote's own marker to be present at its
  // own column on the same physical line before this node's column can be
  // trusted as a marker position - see the comment on the rule.
  it('does not flag literal ">" content on a lazy continuation line under a nested quote', () => {
    const w = lintCarve('> > As the report says.\n  >90% of cases fail.\n', {
      portable: true,
    })
    expect(w).toEqual([])
  })

  it('does not flag literal ">" content on a lazy continuation line three levels deep', () => {
    // Line 2 is a lazy continuation at the MIDDLE level (no marker at column
    // 3, the middle quote's own recorded column), even though the outermost
    // marker (column 1) and a coincidental ">" at the innermost quote's
    // recorded column (5) are both present. The broken link anywhere in the
    // ancestor chain - not only at the outermost level - must still skip it.
    const w = lintCarve('> > > a\n> zz>bad\n', { portable: true })
    expect(w).toEqual([])
  })

  it('still flags an unspaced innermost marker three levels deep when every ancestor marker is present', () => {
    const w = lintCarve('> > > a\n> > >bad\n', { portable: true })
    expect(w.map((x) => [x.line, x.column])).toEqual([[2, 5]])
  })

  // The four cases verified against the false-positive fix above, pinned
  // together so a regression in any one of them is caught here too.
  it('fix verification: no report when the outer ancestor marker is missing on a lazy line', () => {
    expect(portableRules('> > As the report says.\n  >90% of cases fail.\n')).toEqual([])
  })

  it('fix verification: still fires at depth 1 with no ancestors', () => {
    const w = lintCarve('> ok\n>bad\n', { portable: true })
    expect(w.map((x) => [x.line, x.column])).toEqual([[2, 1]])
  })

  it('fix verification: still fires on the inner marker when the ancestor marker is present', () => {
    const w = lintCarve('> > a\n> >bad\n', { portable: true })
    expect(w.map((x) => [x.line, x.column])).toEqual([[2, 3]])
  })

  it('fix verification: outer still fires and the drift-hidden inner is still skipped', () => {
    const w = lintCarve('> > a\n>>bad\n', { portable: true })
    expect(w.map((x) => [x.line, x.column])).toEqual([[2, 1]])
  })
})
