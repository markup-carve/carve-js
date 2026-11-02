import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// CARVE-P11-079 (a), carve#4850.
describe('a definition in a container is collected to the end of the document', () => {
  it.each([
    ['- x\n  [^g]: b\n   [r]: /url\n\nSee [r][] and [^g].\n', '- x\n\nSee [r][] and [^g].\n\n[^g]: b\n\n[r]: /url\n'],
    ['- x\n  [^g]: b\n', '- x\n\n[^g]: b\n'],
    ['1. x\n   [^g]: b\n\n[^g]\n', '1. x\n\n[^g]\n\n[^g]: b\n'],
    ['- a\n  - x\n    [^g]: b\n\n[^g]\n', '- a\n  - x\n\n[^g]\n\n[^g]: b\n'],
  ])('%j', (source, written) => {
    expect(carveToCarve(source)).toBe(written)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
  })

  it('keeps a note whose body line sits below its body column', () => {
    const source = '- a\n  [^f]: x\n  more\n\nsee[^f]\n'
    expect(carveToCarve(source)).toBe(source)
  })

  it('stays idempotent when a + separates the note body', () => {
    const once = carveToCarve('- a\n  [^n]: note\n  +\n  1. ordered\n\nsee[^n]\n')
    expect(carveToCarve(once)).toBe(once)
  })

  it('does not move a note past a region marker', () => {
    const source = '- x\n  [^g]: b\n\n%% #region r\nq\n%% #endregion r\n\n[^g]\n'
    const written = carveToCarve(source)
    expect(written.indexOf('[^g]: b')).toBeLessThan(written.indexOf('%% #region r'))
  })
})
