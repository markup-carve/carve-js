import { describe, expect, it } from 'vitest'
import { carveToCarve } from '../src/index.js'

// CARVE-P11-073 (c): a definition with a region marker below it is written where
// the author wrote it, so a definition between two markers in a quote, a note
// body or a div stays in that region and `fmt` is a fixed point (carve-js#4204).
describe('a region holds a definition in its container', () => {
  it.each([
    '> x\n> %% #region a\n> [^g]: b\n> %% #endregion a\n\n[^g]\n',
    '> x\n> %% #region a\n> [r]: /u\n> %% #endregion a\n\n[r][]\n',
    '> x\n> %% #region a\n>\n> [^g]: b\n>\n> %% #endregion a\n\n[^g]\n',
    '> > x\n> > %% #region a\n> > [^g]: b\n> > %% #endregion a\n\n[^g]\n',
    '::: d\nx\n%% #region a\n[^g]: b\n%% #endregion a\n:::\n\n[^g]\n',
    '> x\n> %% #region a\n> [^g]: b\n>\n> [^h]: c\n> %% #endregion a\n\n[^g] [^h]\n',
  ])('%j', (source) => {
    expect(carveToCarve(source)).toBe(source)
    expect(carveToCarve(carveToCarve(source))).toBe(carveToCarve(source))
  })
})
