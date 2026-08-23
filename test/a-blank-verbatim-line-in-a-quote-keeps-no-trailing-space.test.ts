import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/**
 * PART 11 §7, applied to the CONTAINER PREFIX a blank verbatim line inherits
 * (markup-carve/carve#1544).
 *
 * A blank line inside a code block is carried through document normalization as
 * a sentinel so the whole-document trim cannot eat it, and by the time the
 * sentinel is restored the host has already written its prefix in front of it.
 * §7 emits the STRUCTURAL INDENT of such a line as nothing - "when the verbatim
 * content on that line is EMPTY the indent alone is what remains -- that is
 * layout, and it is omitted" - and a list item's indent was already dropped
 * here for exactly that reason.
 *
 * A BLOCK QUOTE'S PREFIX IS TWO THINGS AT ONCE and only one of them is layout.
 * The `>` stays: an empty line would close the quote and take the open fence
 * with it. The SPACE after it is layout, and dropping it is how the quote
 * spells a blank line everywhere else - an authored blank quote line is written
 * `>`, and the §11 N1a boundary drops the same run off the same prefix on its
 * own path through `normalize`. Keeping it wrote `> `, a line with a trailing
 * run, which is the tooling hazard §7 names and which a whitespace-only-line
 * check cannot see.
 *
 * Three core corpus documents diverged on it - carve-rs wrote `>` and this
 * writer wrote `> `.
 */

describe('a blank verbatim line inside a quote keeps no trailing space', () => {
  it('an unterminated fence in a quote closes over a bare marker line', () => {
    // Corpus 69-opaque-spans-inside-a-container-6.
    expect(carveToCarve('> ```\n')).toBe('> ```\n>\n> ```\n')
  })

  it('a blank line inside a fenced block inside a quote is a bare marker line', () => {
    expect(carveToCarve('> ```\n> x\n>\n> y\n> ```\n')).toBe('> ```\n> x\n>\n> y\n> ```\n')
  })

  it('a nested quote drops the trailing run and keeps every marker', () => {
    expect(carveToCarve('> > ```\n> > x\n> >\n> > y\n> > ```\n')).toBe(
      '> > ```\n> > x\n> >\n> > y\n> > ```\n',
    )
  })

  it('a list item inside a quote keeps the quote marker and drops both runs', () => {
    expect(carveToCarve('> - ```\n>   x\n>\n>   y\n>   ```\n')).toBe(
      '> - ```\n>   x\n>\n>   y\n>   ```\n',
    )
  })

  it('a list item outside a quote still emits the blank line empty', () => {
    // The rule this generalizes: the indent alone is layout, so nothing is left.
    expect(carveToCarve('- ```\n  x\n\n  y\n  ```\n')).toBe('- ```\n  x\n\n  y\n  ```\n')
  })

  it('no emitted line carries a trailing space or tab', () => {
    const written = carveToCarve('> ```\n> x\n>\n> y\n> ```\n')
    expect(written.split('\n').filter((line) => /[ \t]$/.test(line))).toEqual([])
  })

  it('PART 11 §1 holds: the written form says what the source says', () => {
    for (const source of [
      '> ```\n',
      '> ```\n> x\n>\n> y\n> ```\n',
      '> > ```\n> > x\n> >\n> > y\n> > ```\n',
      '> - ```\n>   x\n>\n>   y\n>   ```\n',
    ]) {
      const once = carveToCarve(source)
      expect(carveToHtml(once)).toBe(carveToHtml(source))
      expect(carveToCarve(once)).toBe(once)
    }
  })
})
