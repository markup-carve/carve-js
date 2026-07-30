import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * PART 11 §9: a hard break is emitted as a BACKSLASH before the newline, never as
 * two trailing spaces.
 *
 * Both mean `<br />` to a CommonMark reader - verified against commonmark.js. The
 * difference is what survives handling: trailing whitespace is removed by editors
 * that strip on save, by `git apply --whitespace=fix` and by CI whitespace checks,
 * and losing ONE of the two spaces is enough for the break to VANISH rather than
 * degrade:
 *
 *     `a` SPACE SPACE newline `b`  ->  <p>a<br />b</p>
 *     `a` SPACE newline `b`        ->  <p>a b</p>
 *
 * A line block converts to hard breaks, so this was our own output carrying the
 * fragile spelling (carve#352, corpus 41-line-blocks).
 */
describe('a Markdown hard break is a backslash', () => {
  it('emits a backslash for an explicit hard break', () => {
    expect(carveToMarkdown('a\\\nb\n')).toBe('a\\\nb\n')
  })

  it('emits no trailing whitespace anywhere', () => {
    const out = carveToMarkdown('a\\\nb\n')
    for (const line of out.split('\n')) {
      expect(line).toBe(line.replace(/[ \t]+$/, ''))
    }
  })

  it('uses it for a line block, which is where it shows up in practice', () => {
    const src = '::: |\nStanza one,\nstill one.\n\nStanza two.\n:::\n'
    expect(carveToMarkdown(src)).toBe('Stanza one,\\\nstill one.\n\nStanza two.\n')
  })

  it('leaves a soft break as a plain newline', () => {
    expect(carveToMarkdown('a\nb\n')).toBe('a\nb\n')
  })
})
