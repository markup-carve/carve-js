import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// CARVE-P11-079 (b), carve#5192.
describe('a container-owned comment line is set off by blank lines', () => {
  it.each([
    ['- a\n\n  %% just a note\n- b\n', '- a\n\n  %% just a note\n\n- b\n'],
    ['- - a\n\n  %% just a note\n- b\n', '- - a\n\n  %% just a note\n\n- b\n'],
    ['> a\n> %% b\n', '> a\n>\n> %% b\n'],
    ['> a\n>\n> %% c\n> %% d\n', '> a\n>\n> %% c\n>\n> %% d\n'],
    ['- > a\n  > %% b\n', '- > a\n  >\n  > %% b\n'],
    ['::: note\n> para\n> %% c\n:::\n', '::: note\n> para\n>\n> %% c\n:::\n'],
  ])('%j', (source, written) => {
    expect(carveToCarve(source)).toBe(written)
    expect(carveToCarve(written)).toBe(written)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
  })

  // A blank beside the comment would loosen a tight list (PART 11 §1).
  it.each([
    '- a\n  %% c\n',
    '- a\n  %% c\n- b\n',
    '> - a\n>   %% c\n> - b\n',
  ])('keeps a tight list tight: %j', (source) => {
    expect(carveToCarve(source)).toBe(source)
  })

  it('keeps a comment between two lines of a quoted paragraph in it', () => {
    expect(carveToCarve('> a\n> %% c\n> more\n')).toBe('> a\n> %% c\n> more\n')
  })

  it('keeps the author layout beside a region marker in a quote', () => {
    expect(carveToCarve('> a\n> %% #region r\n> b\n')).toBe('> a\n> %% #region r\n> b\n')
  })
})
