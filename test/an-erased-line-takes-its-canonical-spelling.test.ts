import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve } from '../src/index.js'

// carve-js#4380: an erased comment or reference definition line is written in
// its canonical form wherever that keeps the tree (PART 11 §2).
describe('an erased line takes its canonical spelling', () => {
  it.each([
    ['a comment below a nested list (corpus 191)', '- - a\n %% c\n\n b\n', '- - a\n\n%% c\n\nb\n'],
    ['a comment below a description body (corpus 430-5)', ':: t\n:  d\n  %% c\n', ':: t\n: d\n\n%% c\n'],
    ['a block image above an erased definition (corpus 411-2)', ' ![Apollo][moon]\n\n[moon]: a.jpg\n', '![Apollo][moon]\n\n[moon]: a.jpg\n'],
    ['a comment whose content starts with a no-break space (corpus 498-3)', '%% x\n\ntext\n', '%%  x\n\ntext\n'],
    ['a comment whose content is a vertical tab (corpus 498-5)', '%%\u000b\n\ntext\u000b\n', '%% \u000b\n\ntext\u000b\n'],
    ['a comment after the last description', ':: a\n: b\n  :: c\n  %% note\n  more\n', ':: a\n: b\n\n  :: c\n\n  %% note\n\n  more\n'],
  ])('%s', (_name, source, expected) => {
    const written = carveToCarve(source)
    expect(written).toBe(expected)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(carveToCarve(written)).toBe(written)
  })

  it('writes an imported HTML comment that ends a nested list on its own line (convert 105)', () => {
    expect(markdownToCarve('- x\n  - a\n\n  <!-- c -->\n\n  - b\n- y\n'))
      .toBe('- x\n\n  - a\n\n  %% c\n\n\n\n  - b\n\n- y\n')
  })

  it('keeps a comment between paragraph lines where the author wrote it (corpus 506-5)', () => {
    const source = '- intro\n%% a\n  %% b\ntail\n'
    expect(carveToCarve(source)).toBe(source)
  })
})
