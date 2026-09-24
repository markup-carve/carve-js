import { describe, expect, it } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToHtml } from '../src/index.js'

/**
 * When a continuation line four columns into a paragraph folds into the setext
 * heading above it, the marker it opened with lands in the middle of a one-line
 * heading, where it opens nothing. So it is written bare.
 *
 * markup-carve/carve#2244 ruled it: an importer does not escape a character that
 * needs no escaping. An escape earns its place by protecting against something,
 * and a decorative one shows a reader a construct that is not there. carve-php
 * already wrote the bare form; this engine escaped it, for every marker at once.
 *
 * ASSERTED AT THE BYTE LEVEL, unlike the fold itself in
 * `an-equals-underline-folds-an-indented-line.test.ts`. Both spellings render
 * identical HTML - the second block below measures that rather than claiming it -
 * so a rendered assertion cannot see this change, and the converter corpus
 * compares an importer by rendering its output. Nothing else in the suite would
 * catch a regression here.
 *
 * `written` is carve-php's spelling at `4d194aa`, `escaped` is what this engine
 * wrote before. Two escapes are absent from the moved list because they stay,
 * and both earn it: a backtick run, which is inline-structural in a heading as
 * anywhere else and which carve-php escapes too, and an escape the SOURCE
 * carried, which belongs to the author rather than the importer.
 *
 * Indentation is the subject, so `sp()` builds every run of spaces.
 */
const sp = (n: number): string => ' '.repeat(n)
const fold = (held: string): string => `foo\n${sp(4)}${held}\n---\n`

// held, the bytes now written, the bytes written before.
const moved: Array<[string, string, string]> = [
  ['# bar', '## foo # bar\n', '## foo \\# bar\n'],
  ['## bar', '## foo ## bar\n', '## foo \\## bar\n'],
  ['###### bar', '## foo ###### bar\n', '## foo \\###### bar\n'],
  ['- bar', '## foo - bar\n', '## foo \\- bar\n'],
  ['> bar', '## foo > bar\n', '## foo \\> bar\n'],
  ['+ bar', '## foo + bar\n', '## foo \\+ bar\n'],
  ['1. bar', '## foo 1. bar\n', '## foo 1\\. bar\n'],
  ['1) bar', '## foo 1) bar\n', '## foo 1\\) bar\n'],
  ['* bar', '## foo * bar\n', '## foo \\* bar\n'],
  ['| bar', '## foo | bar\n', '## foo \\| bar\n'],
  ['| a | b |', '## foo | a | b |\n', '## foo \\| a | b |\n'],
  ['~~~', '## foo ~~~\n', '## foo \\~\\~\\~\n'],
  ['***', '## foo ***\n', '## foo \\*\\*\\*\n'],
  ['- - -', '## foo - - -\n', '## foo \\- \\- \\-\n'],
  ['___', '## foo ___\n', '## foo \\_\\_\\_\n'],
  ['[a]: /u', '## foo [a]: /u\n', '## foo \\[a]: /u\n'],
]

describe('a folded block opener is written bare', () => {
  it('builds four columns as bytes, not as a pasted literal', () => {
    expect(Buffer.from(sp(4)).toString('hex')).toBe('20202020')
  })

  it.each(moved)('writes %s bare', (held, written) => {
    expect(markdownToCarve(fold(held))).toBe(written)
  })

  it.each(moved)('renders %s the same either way, so only bytes can see this', (_held, written, escaped) => {
    expect(written).not.toBe(escaped)
    expect(carveToHtml(written)).toBe(carveToHtml(escaped))
  })

  it('writes the class bare inside a list item, and in a nested one', () => {
    // A container fold is a different code path, over a collected run whose
    // markers are already held apart, so it needs its own rows. carve-php writes
    // all three of these the same way.
    expect(markdownToCarve(`- foo\n${sp(6)}# bar\n${sp(2)}---\n`)).toBe('- ## foo # bar\n')
    expect(markdownToCarve(`- foo\n${sp(6)}1. bar\n${sp(2)}---\n`)).toBe('- ## foo 1. bar\n')
    expect(markdownToCarve(`- a\n  - foo\n${sp(8)}> bar\n${sp(4)}---\n`)).toBe('- a\n  - ## foo > bar\n')
  })

  it('keeps a backtick run escaped, because a backtick is inline-structural', () => {
    // carve-php escapes it here as well, so this is not a divergence. The tilde
    // fence above it is not inline-structural and goes bare in both engines.
    expect(markdownToCarve(fold('```'))).toBe('## foo \\`\\`\\`\n')
  })

  it('keeps an escape the source carried', () => {
    // Only the importer's own escape comes off. carve-php keeps this one too,
    // which is what makes the two engines agree byte for byte.
    expect(markdownToCarve(fold('\\# bar'))).toBe('## foo \\# bar\n')
  })

  it('keeps the escape on a line that stays paragraph text', () => {
    // No underline, so no fold: the marker does stand at the start of a line
    // there and the escape is load-bearing. The control the change must not move.
    expect(markdownToCarve(`foo\n${sp(4)}# bar\n`)).toBe('foo\n    \\# bar\n')
    expect(markdownToCarve(`foo\n${sp(4)}1. bar\n`)).toBe('foo\n    1\\. bar\n')
    expect(markdownToCarve(`foo\n${sp(4)}> bar\n`)).toBe('foo\n    \\> bar\n')
  })
})
