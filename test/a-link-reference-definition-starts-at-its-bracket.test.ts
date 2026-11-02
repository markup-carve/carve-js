import { describe, expect, it } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

// markup-carve/carve#4952: a definition is a leaf, so a container's prefix and
// top-level indentation are outside its span.
const spanOf = (source: string): string => {
  const def = (toAstJson(parse(source)) as { children: Array<{ type: string; pos: { startOffset: number; endOffset: number } }> })
    .children.find((child) => child.type === 'link_reference_definition')!
  return [...source].slice(def.pos.startOffset, def.pos.endOffset).join('')
}

describe('a link reference definition starts at its own bracket', () => {
  it.each([
    ['> - para\n>   [A]: b\n', '[A]: b'],
    ['>  [A]: b\n', '[A]: b'],
    ['  [A]: b\n', '[A]: b'],
    ['> [f]: ~\n/\n', '[f]: ~'],
    ['> > [A]: b\n', '[A]: b'],
    ['- [A]: b\n', '[A]: b'],
    ['1. [A]: b\n', '[A]: b'],
    [':: t\n: [A]: b\n', '[A]: b'],
    ['[^n]: [A]: b\n', '[A]: b'],
    ['> [^n]: [A]: b\n', '[A]: b'],
    ['>   - x\n>\n>     [A]: b\n', '[A]: b'],
    ['\u{1F600}\n> [A]: b\n', '[A]: b'],
  ])('%j', (source, span) => {
    expect(spanOf(source)).toBe(span)
  })

  it('reports the column of the bracket', () => {
    const def = toAstJson(parse('  [A]: b\n')).children[0] as { pos: { startColumn: number; endColumn: number } }
    expect([def.pos.startColumn, def.pos.endColumn]).toEqual([3, 9])
  })
})
