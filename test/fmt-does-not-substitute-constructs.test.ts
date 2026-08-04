import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'
import { parse } from '../src/parse.js'

/*
 * PART 11 §2 (carve#581, closing carve#544): the canonical writer does not
 * substitute one construct for another, and does not escape what needs no
 * escape.
 *
 * §1's invariant `to_html(fmt(x)) == to_html(x)` is NECESSARY, NOT SUFFICIENT -
 * both defects below held it while the output was wrong, which is why the
 * fuzzer that only ever rendered HTML never saw them.
 */

/** Same source text, ignoring only where the text sat. */
const shape = (src: string): string =>
  JSON.stringify(parse(src), (key, value) =>
    key === 'pos' || key === 'footnoteDefPos' || key === 'srcByteLength' ? undefined : value,
  )

const roundTrips = (src: string): void => {
  const out = carveToCarve(src)
  expect(carveToHtml(out)).toBe(carveToHtml(src))
  expect(shape(out)).toBe(shape(src))
  expect(carveToCarve(out)).toBe(out)
}

describe('THE UNIT IS THE OPENER: a comment opener run is not split', () => {
  it('writes an inline comment whose content starts with % as one opener run', () => {
    // Written `| %% %` before: a three-character opener run became an opener
    // plus a stray character - "a shape that happens to work rather than one
    // that says what it means".
    expect(carveToCarve('| %%%\n')).toBe('| %%%\n')
    roundTrips('| %%%\n')
  })

  it('keeps the separating space when the content does not start with %', () => {
    expect(carveToCarve('t %% note\n')).toBe('t %% note\n')
  })

  it('handles a longer run the same way', () => {
    expect(carveToCarve('t %%%%\n')).toBe('t %%%%\n')
    roundTrips('t %%%%\n')
  })
})

describe('§2 escapes only what changes the re-parsed AST', () => {
  it('writes `}^p` bare - all three engines used to over-escape it', () => {
    expect(carveToCarve('}^p\n')).toBe('}^p\n')
    roundTrips('}^p\n')
  })

  it('writes `[^` bare - an unterminated `[^` cannot form a footnote reference', () => {
    expect(carveToCarve('[^\n')).toBe('[^\n')
    roundTrips('[^\n')
  })

  it('still escapes where the bare form would parse as something else', () => {
    // A caret line after a RESOLVABLE image promotes the paragraph to a figure,
    // so dropping the escape there changes the tree and the escape stays.
    expect(carveToCarve('![a](/u)\n\\^ cap')).toBe('![a](/u)\n\\^ cap\n')
    expect(parse(carveToCarve('![a](/u)\n\\^ cap')).children[0]?.type).toBe('paragraph')
    // Without the escape it IS a figure, which is the difference the writer's
    // round-trip check acts on.
    expect(parse('![a](/u)\n^ cap').children[0]?.type).toBe('figure')
  })
})
