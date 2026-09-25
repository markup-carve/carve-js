import { describe, expect, it } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToCarve, carveToHtml } from '../src/index.js'

/**
 * carve#2256 rules it: an importer escapes a block marker on a paragraph
 * continuation line EXACTLY when that marker would be structural at column 0.
 *
 * `fmt` dedents such a line to column 0, so the reading has to be taken there
 * and not where the line stands. The document-level writer took it where the
 * line stands, through `isParagraphRunLine`, whose thematic test is anchored at
 * three columns of slack. Four columns in a thematic run therefore read as
 * ordinary text and went out bare, and `fmt` wrote the escape itself
 * (carve-js#2020): the import was not a fixed point of this engine's own
 * formatter.
 *
 * PINNED AT THE BYTE LEVEL, because for two of the three spellings both forms
 * render the same and a rendered assertion could not see the difference. The
 * third one can be seen: a bare three-hyphen run reaches smart typography and
 * renders as an em dash, so the source's three hyphens are not what a reader
 * gets. That row carries a render assertion as well.
 *
 * The escape is the thematic run and nothing else, measured one spelling at a
 * time. Widening it to "whatever opens a block at column 0" reads the fence at
 * any indent and takes `~~~` with it, which guards nothing: a tilde fence
 * interrupts no paragraph in Carve. The evidence blocks below are quoted
 * verbatim, hyphen runs included, because the run's exact length is the subject.
 *
 * The FOLDED heading path is deliberately untouched. carve#2244 ruled that one
 * the other way and carve-js#2011 implemented it: a fold has no column left to
 * be dedented to, which is why the two positions decide differently. The fold
 * rows here are the control that says so.
 */
const continued = (marker: string): string => `foo\n    ${marker}\n`

describe('a thematic run on a continuation line keeps its escape', () => {
  // The three thematic spellings CommonMark takes, each of which interrupts a
  // paragraph at column 0 in Carve and so needs the escape there.
  const thematic: Array<[string, string, string]> = [
    ['a star run', '***', '\\*\\*\\*'],
    ['an underscore run', '___', '\\_\\_\\_'],
    ['a hyphen run', '---', '\\-\\-\\-'],
  ]

  it.each(thematic)('escapes %s, and the import is then a fmt fixed point', (_name, marker, escaped) => {
    const out = markdownToCarve(continued(marker))
    expect(out).toBe(`foo\n    ${escaped}\n`)
    // `fmt` dedents the continuation line, so the fixed point is stated per line
    // with the leading columns off: what must not move is the MARKER.
    const trim = (src: string): string => src.split('\n').map((line) => line.trim()).join('\n')
    expect(trim(carveToCarve(out))).toBe(trim(out))
  })

  it('renders three hyphens rather than an em dash', () => {
    // The render-visible half. Bare, the run reached smart typography.
    expect(carveToHtml(markdownToCarve(continued('---')))).toContain('---')
    expect(carveToHtml(markdownToCarve(continued('---')))).not.toContain('—')
    expect(carveToHtml('foo\n    ---\n')).toContain('—')
  })

  it('leaves a lone pipe bare, which is no table without a delimiter row', () => {
    // carve#2256 names this one explicitly: the escape would guard nothing.
    expect(markdownToCarve(continued('| bar'))).toBe('foo\n    | bar\n')
  })

  it('escapes a full pipe row, which IS a table row at column 0', () => {
    // The other side of the same rule, and it was already right.
    expect(markdownToCarve(continued('| a | b |'))).toBe('foo\n    \\| a | b |\n')
  })

  it('leaves a tilde fence bare, which interrupts no paragraph in Carve', () => {
    expect(markdownToCarve(continued('~~~'))).toBe('foo\n    ~~~\n')
    expect(carveToHtml('foo\n~~~\n').trim()).toBe('<p>foo\n~~~</p>')
  })

  it('leaves an equals line bare, which opens nothing at column 0', () => {
    expect(markdownToCarve(continued('=== '))).toBe('foo\n    === \n')
  })

  it('keeps the escape every other marker already carried', () => {
    // All structural at column 0, so they were right by the rule rather than by
    // accident. They pass on both sides of reverting this change.
    expect(markdownToCarve(continued('# bar'))).toBe('foo\n    \\# bar\n')
    expect(markdownToCarve(continued('- bar'))).toBe('foo\n    \\- bar\n')
    expect(markdownToCarve(continued('> bar'))).toBe('foo\n    \\> bar\n')
    expect(markdownToCarve(continued('+ bar'))).toBe('foo\n    \\+ bar\n')
    expect(markdownToCarve(continued('1. bar'))).toBe('foo\n    1\\. bar\n')
    expect(markdownToCarve(continued('* bar'))).toBe('foo\n    \\* bar\n')
    expect(markdownToCarve(continued('[r]: /u'))).toBe('foo\n    \\[r]: /u\n')
  })

  it('writes the folded heading with the spelling carve#2244 ruled', () => {
    // The fold has no column left to be dedented to, so a star or underscore run
    // in the middle of a one-line heading opens nothing and stays bare. The
    // hyphen run keeps its escape there for a different reason - mid-line it
    // reaches smart typography - and both engines write it that way.
    expect(markdownToCarve('foo\n    ***\n---\n')).toBe('## foo ***\n')
    expect(markdownToCarve('foo\n    ___\n===\n')).toBe('# foo ___\n')
    expect(markdownToCarve('foo\n    ---\n---\n')).toBe('## foo \\-\\-\\-\n')
  })

  it('leaves a thematic break that really does open a block alone', () => {
    // Three columns in it interrupts the paragraph, so it is a rule and not a
    // continuation line at all.
    expect(markdownToCarve('foo\n   ***\n')).toBe('foo\n\n---\n')
  })

  it('builds the four columns as bytes, not as a pasted literal', () => {
    expect(Buffer.from(continued('x')).toString('hex')).toBe('666f6f0a20202020780a')
  })
})
