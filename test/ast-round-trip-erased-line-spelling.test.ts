/*
 * An erased or stand-in line must be written from what the tree holds, so the
 * parsed tree and the tree read back from the AST write the same source, and
 * that source reads back as the same tree (markup-carve/carve#5471).
 */
import { describe, expect, it } from 'vitest'
import { parse, carveToAstJson, fromAstJson } from '../src/index.js'
import { renderCarve } from '../src/render-carve.js'

const shape = (src: string): string =>
  JSON.stringify(carveToAstJson(src), (key, value: unknown) => (key === 'pos' || key === 'srcByteLength') ? undefined : value)

const cases: Array<[string, string, string]> = [
  ['a refused plus leaves a footnote body empty', '[^a]: +\n\nsee[^a]\n', 'see[^a]\n\n[^a]: {empty}'],
  ['a refused plus before a flush line', '[^a]: +\n flush\n\nsee[^a]\n', 'see[^a]\n\n[^a]: flush'],
  ['a quoted refused plus', '> [^b]: +\npara\n\nr[^b]\n', '>\n\nr[^b]\n\n[^b]: para'],
  ['a tab glued to the comment marker', 'a\n%%\tx\nb\n', 'a\n%% \tx\nb'],
  ['a comment an empty item opens with', '- +\n%% c\n- b\n', '- %% c\n- b'],
  ['two comments an empty item opens with', '- +\n%% c\n%% d\n- b\n', '- %% c\n  %% d\n- b'],
  ['a comment an item opens with before its text', '- +\n%% c\n  more\n- b\n', '- %% c\n  more\n- b'],
  ['a quoted item opening with a comment', '> - +\n> %% c\n> - b\n', '> - %% c\n> - b'],
  ['a note opening with a comment', '[^a]: +\n%% c\n\nsee[^a]\n', 'see[^a]\n\n[^a]: %% c'],
  ['a description opening with comments', ':: t\n: [^a]: +\n+\n%% c\n%% d\n', ':: t\n: %% c\n  %% d\n\n[^a]: {empty}'],
  ['a plus-held line in a nested quote', '> > a\n > +\n > %% c\n > b\n', '> > a\n> >\n> > %% c\n> >\n> > b'],
  ['a quote a plus hands a comment', '> [^a]: x\n+\n%% c\n', '> %% c\n\n[^a]: x'],
]

describe('an erased line through the AST', () => {
  it.each(cases)('%s', (_name, src, expected) => {
    const direct = renderCarve(parse(src))
    expect(direct).toBe(`${expected}\n`)
    expect(renderCarve(fromAstJson(carveToAstJson(src)))).toBe(direct)
    expect(shape(direct)).toBe(shape(src))
  })
})
